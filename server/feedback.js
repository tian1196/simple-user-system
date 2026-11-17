const fs = require('node:fs')
const path = require('node:path')
const { randomUUID, createHash } = require('node:crypto')
const { transaction } = require('./database-tools')
const dates = require('./dates')
const { imageType } = require('./feedback-images')
const TYPES = ['issue', 'suggestion', 'experience']
const STATUSES = ['pending', 'processing', 'resolved']
const DAY = 86400000
function createFeedback(database, { filename, fail, assertWrites, audit }) {
  const directory = path.join(path.dirname(filename), 'feedback-attachments')
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
  const attachmentPath = id => {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw fail(404, 'ATTACHMENT_NOT_FOUND', '截图不存在')
    return path.join(directory, `${id}.bin`)
  }
  const checkText = (value, min, max, label) => {
    if (typeof value !== 'string') throw fail(400, 'VALIDATION_ERROR', `请填写${label}`)
    const text = value.trim()
    if (Array.from(text).length < min || Array.from(text).length > max) throw fail(400, 'VALIDATION_ERROR', `${label}需为${min}–${max}个字符`)
    return text
  }
  function number(row) {
    const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(row.created_at)).replaceAll('-', '')
    return `FB${date}-${String(row.seq).padStart(4, '0')}`
  }
  const attachments = id => database.prepare('SELECT id,filename,mime,size,created_at FROM feedback_attachments WHERE feedback_id=? ORDER BY created_at,id').all(id)
  function present(row, admin = false) {
    const out = { id: row.id, number: number(row), type: row.type, title: row.title, content: row.content,
      status: row.status, reply: row.reply, replied_at: row.replied_at, created_at: row.created_at, updated_at: row.updated_at,
      contact: row.contact, diagnostics: row.diagnostics_json ? JSON.parse(row.diagnostics_json) : null,
      attachments: attachments(row.id), version: row.version }
    if (admin) {
      out.username = row.username; out.internal_note = row.internal_note
      out.history = database.prepare(`SELECT h.*,u.username AS actor FROM feedback_history h LEFT JOIN users u ON u.id=h.actor_id WHERE h.feedback_id=? ORDER BY h.created_at,h.rowid`).all(row.id)
        .map(h => ({ id: h.id, actor: h.actor || '已删除的管理员', created_at: h.created_at, before: JSON.parse(h.before_json), after: JSON.parse(h.after_json) }))
    }
    return out
  }
  function detail(userId, id, admin = false) {
    const row = database.prepare(`SELECT f.*,u.username FROM feedback f JOIN users u ON u.id=f.user_id WHERE f.id=? ${admin ? '' : 'AND f.user_id=?'}`).get(...(admin ? [id] : [id, userId]))
    if (!row) throw fail(404, 'FEEDBACK_NOT_FOUND', '反馈不存在')
    return present(row, admin)
  }
  function stats(userId) {
    const rows = database.prepare(`SELECT status,COUNT(*) AS n FROM feedback ${userId ? 'WHERE user_id=?' : ''} GROUP BY status`).all(...(userId ? [userId] : []))
    const counts = { all: 0, pending: 0, processing: 0, resolved: 0 }
    for (const row of rows) { counts[row.status] = row.n; counts.all += row.n }
    return counts
  }
  function list(userId, query = {}, admin = false) {
    const where = []; const values = []
    if (!admin) { where.push('f.user_id=?'); values.push(userId) }
    for (const [key, allowed] of [['status', STATUSES], ['type', TYPES]]) {
      if (query[key] && query[key] !== 'all') {
        if (!allowed.includes(query[key])) throw fail(400, 'VALIDATION_ERROR', '筛选条件不正确')
        where.push(`f.${key}=?`); values.push(query[key])
      }
    }
    if (query.q) {
      const q = checkText(query.q, 0, 80, '搜索词').replace(/[\\%_]/g, '\\$&')
      where.push(`(f.title LIKE ? ESCAPE '\\' OR u.username LIKE ? ESCAPE '\\' OR ('FB'||strftime('%Y%m%d',f.created_at/1000,'unixepoch','+8 hours')||'-'||printf('%04d',f.seq)) LIKE ? ESCAPE '\\')`)
      values.push(`%${q}%`, `%${q}%`, `%${q}%`)
    }
    for (const field of ['from', 'to']) {
      if (query[field]) {
        if (!dates.isDate(query[field])) throw fail(400, 'VALIDATION_ERROR', '日期筛选不正确')
        const stamp = Date.parse(`${query[field]}T00:00:00+08:00`)
        where.push(field === 'from' ? 'f.created_at>=?' : 'f.created_at<?'); values.push(stamp + (field === 'to' ? DAY : 0))
      }
    }
    if (query.from && query.to && query.from > query.to) throw fail(400, 'VALIDATION_ERROR', '开始日期不能晚于结束日期')
    const page = Number(query.page || 1); const pageSize = Number(query.page_size || 10)
    if (!Number.isInteger(page) || page < 1 || page > 100000 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 50) throw fail(400, 'VALIDATION_ERROR', '分页参数不正确')
    const sql = `FROM feedback f JOIN users u ON u.id=f.user_id ${where.length ? 'WHERE ' + where.join(' AND ') : ''}`
    const total = database.prepare(`SELECT count(*) AS n ${sql}`).get(...values).n
    const items = database.prepare(`SELECT f.*,u.username ${sql} ORDER BY f.created_at DESC,f.seq DESC LIMIT ? OFFSET ?`).all(...values, pageSize, (page - 1) * pageSize)
      .map(row => ({ id: row.id, number: number(row), type: row.type, title: row.title, status: row.status, created_at: row.created_at, updated_at: row.updated_at, ...(admin ? { username: row.username } : {}) }))
    return { items, total, page, page_size: pageSize, counts: stats(admin ? null : userId) }
  }
  function cleanup(now = Date.now()) {
    const old = database.prepare('SELECT id FROM feedback_attachments WHERE feedback_id IS NULL AND created_at<?').all(now - DAY)
    for (const row of old) removeUpload(null, row.id, true)
    // 崩溃或账户删除后遗留的文件，保留24小时后清理；不扫描其他目录。
    const known = new Set(database.prepare('SELECT id FROM feedback_attachments').all().map(r => `${r.id}.bin`))
    for (const file of fs.readdirSync(directory)) {
      if (!/^[a-f0-9-]{36}\.bin$/.test(file) || known.has(file)) continue
      const location = path.join(directory, file)
      if (fs.lstatSync(location).isFile() && fs.statSync(location).mtimeMs < now - DAY) fs.unlinkSync(location)
    }
  }
  function upload(userId, data, declaredType, name, uploadKey = randomUUID()) {
    assertWrites()
    if (!Buffer.isBuffer(data) || !data.length || data.length > 5 * 1024 * 1024) throw fail(413, 'ATTACHMENT_SIZE', '截图每张不超过5 MB')
    const mime = imageType(data)
    if (!mime || mime !== declaredType) throw fail(400, 'ATTACHMENT_TYPE', '请选择有效的JPG、PNG或WebP截图，图片不超过4000万像素')
    const key = checkText(uploadKey, 8, 80, '上传标识')
    const fingerprint = createHash('sha256').update(data).digest('hex')
    cleanup()
    const replay = database.prepare('SELECT * FROM feedback_attachments WHERE user_id=? AND upload_key=?').get(userId, key)
    if (replay) {
      if (replay.fingerprint !== fingerprint || replay.mime !== mime) throw fail(409, 'DUPLICATE_REQUEST', '上传标识已用于其他截图')
      return { id: replay.id, filename: replay.filename, mime: replay.mime, size: replay.size }
    }
    const pending = database.prepare('SELECT count(*) AS n FROM feedback_attachments WHERE user_id=? AND feedback_id IS NULL').get(userId).n
    if (pending >= 3) throw fail(422, 'ATTACHMENT_LIMIT', '最多暂存3张截图，请先移除不需要的截图')
    const total = database.prepare('SELECT coalesce(sum(size),0) AS n FROM feedback_attachments WHERE user_id=?').get(userId).n
    if (total + data.length > 50 * 1024 * 1024) throw fail(422, 'ATTACHMENT_QUOTA', '你的反馈截图已达到50 MB存储额度')
    const id = randomUUID(); const location = attachmentPath(id)
    const extension = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[mime]
    const filename = String(name || '截图').replace(/[/\\\x00-\x1f\x7f]/g, '_').slice(0, 100).replace(/\.[^.]*$/, '') + '.' + extension
    fs.writeFileSync(location, data, { mode: 0o600, flag: 'wx' })
    try { database.prepare('INSERT INTO feedback_attachments(id,user_id,upload_key,fingerprint,filename,mime,size,created_at) VALUES(?,?,?,?,?,?,?,?)').run(id, userId, key, fingerprint, filename, mime, data.length, Date.now()) }
    catch (error) { fs.unlinkSync(location); throw error }
    return { id, filename, mime, size: data.length }
  }
  function removeUpload(userId, id, housekeeping = false) {
    const row = database.prepare(`SELECT * FROM feedback_attachments WHERE id=? AND feedback_id IS NULL ${housekeeping ? '' : 'AND user_id=?'}`).get(...(housekeeping ? [id] : [id, userId]))
    if (!row) { if (housekeeping) return; throw fail(404, 'ATTACHMENT_NOT_FOUND', '截图不存在或已提交，不能移除') }
    database.prepare('DELETE FROM feedback_attachments WHERE id=?').run(id)
    try { fs.unlinkSync(attachmentPath(id)) } catch (error) { if (error.code !== 'ENOENT') throw error }
  }
  function readAttachment(userId, id, admin = false) {
    const row = database.prepare(`SELECT * FROM feedback_attachments WHERE id=? ${admin ? 'AND feedback_id IS NOT NULL' : 'AND user_id=?'}`).get(...(admin ? [id] : [id, userId]))
    if (!row || (!row.feedback_id && row.created_at < Date.now() - DAY)) throw fail(404, 'ATTACHMENT_NOT_FOUND', '截图不存在或已过期')
    const location = attachmentPath(id)
    if (!fs.existsSync(location)) throw fail(404, 'ATTACHMENT_NOT_FOUND', '截图文件不存在，请联系管理员')
    return { ...row, location }
  }
  function submit(userId, input) {
    assertWrites()
    const type = input.type
    if (!TYPES.includes(type)) throw fail(400, 'VALIDATION_ERROR', '请选择反馈类型')
    const title = checkText(input.title, 1, 60, '标题'); const content = checkText(input.content, 10, 2000, '详细说明')
    const contact = checkText(input.contact ?? '', 0, 128, '联系方式')
    const key = checkText(input.request_key, 8, 80, '请求标识')
    const ids = input.attachment_ids ?? []
    if (!Array.isArray(ids) || ids.length > 3 || new Set(ids).size !== ids.length || ids.some(id => typeof id !== 'string')) throw fail(400, 'VALIDATION_ERROR', '最多上传3张不同截图')
    let diagnostics = null
    if (input.diagnostics !== undefined && input.diagnostics !== null) {
      if (input.diagnostics_consent !== true || typeof input.diagnostics !== 'object' || Array.isArray(input.diagnostics)) throw fail(400, 'VALIDATION_ERROR', '附带诊断信息需要主动同意')
      const url = checkText(input.diagnostics.page_path ?? '', 0, 160, '页面路径')
      if (url && (!url.startsWith('/') || url.startsWith('//') || /[?#\\]/.test(url))) throw fail(400, 'VALIDATION_ERROR', '页面路径不能包含域名、查询参数或片段')
      diagnostics = { page_path: url, browser: checkText(input.diagnostics.browser ?? '', 0, 240, '浏览器信息') }
    }
    const fingerprint = createHash('sha256').update(JSON.stringify({ type, title, content, contact, ids, diagnostics })).digest('hex')
    return transaction(database, () => {
      const replay = database.prepare('SELECT * FROM feedback WHERE user_id=? AND request_key=?').get(userId, key)
      if (replay) {
        if (replay.fingerprint !== fingerprint) throw fail(409, 'DUPLICATE_REQUEST', '请求标识已用于其他内容，请刷新后重试')
        return detail(userId, replay.id)
      }
      const rate = database.prepare('SELECT count(*) AS n FROM feedback WHERE user_id=? AND created_at>?').get(userId, Date.now() - 3600000).n
      if (rate >= 10) throw fail(429, 'RATE_LIMITED', '每小时最多提交10条反馈，请稍后再试')
      for (const id of ids) {
        const row = database.prepare('SELECT * FROM feedback_attachments WHERE id=? AND user_id=? AND feedback_id IS NULL AND created_at>?').get(id, userId, Date.now() - DAY)
        if (!row || !fs.existsSync(attachmentPath(id))) throw fail(422, 'ATTACHMENT_EXPIRED', '截图不存在、已提交或已过期，请移除后重新上传')
      }
      const id = randomUUID(); const now = Date.now()
      database.prepare(`INSERT INTO feedback(id,user_id,type,title,content,contact,diagnostics_json,request_key,fingerprint,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`)
        .run(id, userId, type, title, content, contact, diagnostics ? JSON.stringify(diagnostics) : null, key, fingerprint, now, now)
      for (const attachment of ids) database.prepare('UPDATE feedback_attachments SET feedback_id=? WHERE id=?').run(id, attachment)
      audit({ actorId: userId, action: 'feedback_submit', targetType: 'feedback', targetId: id, result: 'success', requestId: randomUUID() })
      return detail(userId, id)
    })
  }
  function update(actorId, id, input, meta) {
    assertWrites()
    if (!STATUSES.includes(input.status)) throw fail(400, 'VALIDATION_ERROR', '请选择有效处理状态')
    const reply = checkText(input.reply, 0, 2000, '回复'); const note = checkText(input.internal_note, 0, 2000, '内部备注')
    return transaction(database, () => {
      const current = detail(null, id, true)
      if (input.version !== current.version) throw fail(409, 'VERSION_CONFLICT', '反馈已被其他管理员更新，草稿已保留，请查看最新内容')
      const now = Date.now(); const before = { status: current.status, reply: current.reply, internal_note: current.internal_note }
      const after = { status: input.status, reply, internal_note: note }
      if (JSON.stringify(before) === JSON.stringify(after)) return current
      database.prepare('UPDATE feedback SET status=?,reply=?,internal_note=?,replied_at=?,updated_at=?,version=version+1 WHERE id=?')
        .run(input.status, reply, note, reply !== current.reply ? (reply ? now : null) : current.replied_at, now, id)
      database.prepare('INSERT INTO feedback_history(id,feedback_id,actor_id,before_json,after_json,created_at) VALUES(?,?,?,?,?,?)').run(randomUUID(), id, actorId, JSON.stringify(before), JSON.stringify(after), now)
      audit({ ...meta, actorId, action: 'feedback_update', targetType: 'feedback', targetId: id, result: 'success', detail: { status: input.status } })
      return detail(null, id, true)
    })
  }
  function exportUser(userId) {
    return database.prepare('SELECT * FROM feedback WHERE user_id=? ORDER BY seq').all(userId).map(row => {
      const out = present(row)
      out.attachments = out.attachments.map(a => ({ ...a, content_base64: fs.readFileSync(attachmentPath(a.id)).toString('base64') }))
      return out
    })
  }
  function userFiles(userId) { return database.prepare('SELECT id FROM feedback_attachments WHERE user_id=?').all(userId).map(row => row.id) }
  function purgeFiles(ids) { for (const id of ids) { try { fs.unlinkSync(attachmentPath(id)) } catch (error) { if (error.code !== 'ENOENT') console.error('反馈附件待清理', id, error.code) } } }
  cleanup()
  const timer = setInterval(() => { try { cleanup() } catch (error) { console.error('反馈临时附件清理失败', error.message) } }, 3600000)
  timer.unref()
  return { list, detail, stats, upload, readAttachment, removeUpload, submit, update, exportUser, cleanup, userFiles, purgeFiles, directory, dispose: () => clearInterval(timer) }
}
module.exports = { createFeedback }
