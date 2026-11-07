const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const bcrypt = require('bcryptjs')
const { DatabaseSync } = require('node:sqlite')
const { openDatabase, transaction } = require('./database-tools')
const dates = require('./dates')

/**
 * 默认使用本机 data/ledger.sqlite。
 * 放到火山引擎那台机器上跑时，设置 DATABASE_PATH=/opt/device-ledger/data/ledger.sqlite。
 * SQLite 是本机文件，开发电脑不能直接打开服务器上的库。
 * 只有默认本机空库会写入初始邀请码和所有者，避免误往已有线上库里塞账号。
 */
const databasePath = process.env.DATABASE_PATH
  ? path.resolve(process.env.DATABASE_PATH)
  : path.join(__dirname, '..', 'data', 'ledger.sqlite')

const LOCAL_INVITE = 'WELCOME-2026'
const LOCAL_OWNER = 'owner'
const LOCAL_OWNER_PASSWORD = 'ledger-owner-2026'
const POLICY_VERSION = '2026-11-05'

fs.mkdirSync(path.dirname(databasePath), { recursive: true })

const database = process.env.DATABASE_PATH
  ? openDatabase(databasePath).connection
  : new DatabaseSync(databasePath)
database.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA synchronous=FULL;')
database.transaction = callback => () => transaction(database, callback)

const CATEGORIES = {
  appliance: '家电',
  computer: '电脑',
  camera: '相机',
  digital: '数码',
  other: '其他',
}

function fail(status, code, message) {
  const error = new Error(message)
  error.status = status
  error.code = code
  return error
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function normalizeUsername(username) {
  return String(username || '').trim().toLowerCase()
}

function normalizeSecret(value) {
  return String(value || '').trim().toUpperCase()
}

function makeRecoveryCode() {
  const raw = crypto.randomBytes(8).toString('hex').toUpperCase()
  return `RC-${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}`
}

function publicUser(row) {
  if (!row) return null
  return {
    id: row.id,
    username: row.username,
    role: row.role,
    status: row.status,
    created_at: row.created_at,
    last_login_at: row.last_login_at || null,
  }
}

function migrate() {
  database.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'operator', 'owner')),
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
      mfa_secret_enc TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      last_login_at INTEGER,
      version INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS auth_identities (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      provider TEXT NOT NULL DEFAULT 'password',
      provider_key TEXT NOT NULL,
      password_hash TEXT,
      recovery_code_hash TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE (provider, provider_key),
      UNIQUE (user_id, provider)
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      client_type TEXT NOT NULL CHECK (client_type IN ('web', 'admin')),
      created_at INTEGER NOT NULL,
      last_seen_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      reauthenticated_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS invite_codes (
      id TEXT PRIMARY KEY,
      code_hash TEXT NOT NULL UNIQUE,
      max_uses INTEGER NOT NULL,
      used_count INTEGER NOT NULL DEFAULT 0,
      expires_at INTEGER NOT NULL,
      revoked_at INTEGER,
      created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS devices (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'other' CHECK (category IN ('appliance', 'computer', 'camera', 'digital', 'other')),
      model TEXT,
      purchased_on TEXT,
      warranty_until TEXT,
      note TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      version INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS maintenance_plans (
      id TEXT PRIMARY KEY,
      device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      interval_days INTEGER NOT NULL CHECK (interval_days BETWEEN 1 AND 3650),
      next_due_on TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused')),
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      version INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS maintenance_logs (
      id TEXT PRIMARY KEY,
      device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
      plan_id TEXT REFERENCES maintenance_plans(id) ON DELETE SET NULL,
      source TEXT NOT NULL CHECK (source IN ('manual', 'plan')),
      title TEXT NOT NULL,
      completed_on TEXT NOT NULL,
      note TEXT,
      request_key TEXT NOT NULL,
      request_fingerprint TEXT NOT NULL,
      previous_due_on TEXT,
      plan_version_after INTEGER,
      voided_at INTEGER,
      created_at INTEGER NOT NULL,
      UNIQUE (device_id, request_key)
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS privacy_acceptances (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      policy_version TEXT NOT NULL,
      accepted_at INTEGER NOT NULL,
      UNIQUE (user_id, policy_version)
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      actor_user_id TEXT,
      action TEXT NOT NULL,
      target_type TEXT,
      target_id TEXT,
      result TEXT NOT NULL CHECK (result IN ('success', 'failure')),
      request_id TEXT NOT NULL,
      source_ip TEXT,
      detail_json TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_devices_user ON devices(user_id, created_at, id);
    CREATE INDEX IF NOT EXISTS idx_plans_device ON maintenance_plans(device_id);
    CREATE INDEX IF NOT EXISTS idx_plans_due ON maintenance_plans(status, next_due_on);
    CREATE INDEX IF NOT EXISTS idx_logs_device ON maintenance_logs(device_id, completed_on, id);
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
  `)

  const now = Date.now()
  const insertSetting = database.prepare(`
    INSERT OR IGNORE INTO app_settings (key, value_json, version, updated_at)
    VALUES (?, 'true', 1, ?)
  `)
  insertSetting.run('registration_enabled', now)
  insertSetting.run('writes_enabled', now)
}

function seedLocalAccounts() {
  if (process.env.DATABASE_PATH) return []
  const messages = []
  const userCount = database.prepare('SELECT COUNT(*) AS n FROM users').get().n
  if (userCount > 0) return messages

  const now = Date.now()
  const ownerId = crypto.randomUUID()
  const passwordHash = bcrypt.hashSync(LOCAL_OWNER_PASSWORD, 10)
  const recovery = makeRecoveryCode()
  const inviteId = crypto.randomUUID()

  const tx = database.transaction(() => {
    database.prepare(`
      INSERT INTO users (id, username, role, status, created_at, updated_at, version)
      VALUES (?, ?, 'owner', 'active', ?, ?, 1)
    `).run(ownerId, LOCAL_OWNER, now, now)
    database.prepare(`
      INSERT INTO auth_identities (
        id, user_id, provider, provider_key, password_hash, recovery_code_hash, created_at, updated_at
      ) VALUES (?, ?, 'password', ?, ?, ?, ?, ?)
    `).run(crypto.randomUUID(), ownerId, LOCAL_OWNER, passwordHash, sha256(recovery), now, now)
    database.prepare(`
      INSERT INTO invite_codes (id, code_hash, max_uses, used_count, expires_at, created_by, created_at)
      VALUES (?, ?, 20, 0, ?, ?, ?)
    `).run(inviteId, sha256(LOCAL_INVITE), now + 90 * 24 * 60 * 60 * 1000, ownerId, now)
  })
  tx()
  messages.push(`本地所有者 ${LOCAL_OWNER} / ${LOCAL_OWNER_PASSWORD}`)
  messages.push(`本地邀请码 ${LOCAL_INVITE}`)
  messages.push(`所有者恢复码 ${recovery}`)
  return messages
}

function settingEnabled(key) {
  const row = database.prepare('SELECT value_json FROM app_settings WHERE key = ?').get(key)
  if (!row) return true
  return JSON.parse(row.value_json) !== false
}

function assertWrites() {
  if (!settingEnabled('writes_enabled')) throw fail(503, 'WRITES_PAUSED', '业务写入已暂停')
}

function writeAudit({ actorId, action, targetType, targetId, result, requestId, ip, detail }) {
  database.prepare(`
    INSERT INTO audit_logs (
      id, actor_user_id, action, target_type, target_id, result, request_id, source_ip, detail_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    crypto.randomUUID(),
    actorId || null,
    action,
    targetType || null,
    targetId || null,
    result,
    requestId || crypto.randomUUID(),
    ip || null,
    detail ? JSON.stringify(detail) : null,
    Date.now(),
  )
}

function identityByUsername(username) {
  return database.prepare(`
    SELECT u.*, i.password_hash, i.recovery_code_hash, i.id AS identity_id
    FROM users u
    JOIN auth_identities i ON i.user_id = u.id AND i.provider = 'password'
    WHERE u.username = ?
  `).get(normalizeUsername(username))
}

function createSession(userId, clientType) {
  const token = crypto.randomBytes(32).toString('base64url')
  const now = Date.now()
  const ttl = clientType === 'admin' ? 8 * 60 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000
  database.prepare(`
    INSERT INTO sessions (token_hash, user_id, client_type, created_at, last_seen_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(sha256(token), userId, clientType, now, now, now + ttl)
  return token
}

function sessionUser(token, clientType) {
  if (!token) return null
  const row = database.prepare(`
    SELECT s.token_hash, s.expires_at, s.reauthenticated_at, s.client_type,
           u.id, u.username, u.role, u.status, u.created_at, u.last_login_at, u.version
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.client_type = ?
  `).get(sha256(token), clientType)
  if (!row) return null
  if (row.expires_at <= Date.now() || row.status !== 'active') {
    database.prepare('DELETE FROM sessions WHERE token_hash = ?').run(row.token_hash)
    return null
  }
  return row
}

function revokeSession(token) {
  if (!token) return
  database.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token))
}

function touchReauth(token) {
  database.prepare('UPDATE sessions SET reauthenticated_at = ? WHERE token_hash = ?').run(Date.now(), sha256(token))
}

function assertReauth(token) {
  const row = database.prepare('SELECT reauthenticated_at FROM sessions WHERE token_hash = ?').get(sha256(token))
  if (!row?.reauthenticated_at || Date.now() - row.reauthenticated_at > 5 * 60 * 1000) {
    throw fail(403, 'REAUTH_REQUIRED', '导出或注销前需要重新验证密码')
  }
}

function login(username, password, clientType, meta) {
  const user = identityByUsername(username)
  const valid = user && bcrypt.compareSync(password, user.password_hash)
  if (!valid) {
    writeAudit({ ...meta, actorId: user?.id, action: 'login_failure', result: 'failure', detail: { client: clientType } })
    throw fail(401, 'INVALID_CREDENTIALS', '用户名或密码错误')
  }
  if (user.status !== 'active') throw fail(403, 'ACCOUNT_DISABLED', '账号已停用')
  if (clientType === 'web' && user.role !== 'user') {
    throw fail(403, 'FORBIDDEN', '管理账号请从后台登录')
  }
  if (clientType === 'admin' && user.role === 'user') {
    throw fail(401, 'INVALID_CREDENTIALS', '用户名或密码错误')
  }
  const now = Date.now()
  database.prepare('UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ?').run(now, now, user.id)
  writeAudit({ ...meta, actorId: user.id, action: 'login_success', result: 'success', detail: { client: clientType } })
  return { token: createSession(user.id, clientType), user: publicUser({ ...user, last_login_at: now }) }
}

function registerWithInvite({ inviteCode, username, password, policyVersion }, meta) {
  if (!settingEnabled('registration_enabled')) throw fail(422, 'INVITE_INVALID', '当前未开放注册')
  const name = normalizeUsername(username)
  if (!/^[a-z0-9_]{4,32}$/.test(name)) throw fail(400, 'VALIDATION_ERROR', '用户名需为 4–32 位小写字母、数字或下划线')
  if (password.length < 8 || password.length > 128) throw fail(400, 'VALIDATION_ERROR', '密码长度需 8–128 位')
  if (policyVersion !== POLICY_VERSION) throw fail(400, 'VALIDATION_ERROR', '请确认当前隐私说明')

  const now = Date.now()
  const userId = crypto.randomUUID()
  const recovery = makeRecoveryCode()
  const tx = database.transaction(() => {
    const invite = database.prepare('SELECT * FROM invite_codes WHERE code_hash = ?').get(sha256(normalizeSecret(inviteCode)))
    if (!invite || invite.revoked_at || invite.expires_at < now) throw fail(422, 'INVITE_INVALID', '邀请码无效或已过期')
    const consumed = database.prepare(`
      UPDATE invite_codes SET used_count = used_count + 1
      WHERE id = ? AND revoked_at IS NULL AND expires_at >= ? AND used_count < max_uses
    `).run(invite.id, now)
    if (consumed.changes !== 1) throw fail(422, 'INVITE_INVALID', '邀请码无效或已用完')
    try {
      database.prepare(`
        INSERT INTO users (id, username, role, status, created_at, updated_at, version)
        VALUES (?, ?, 'user', 'active', ?, ?, 1)
      `).run(userId, name, now, now)
    } catch (error) {
      if (/UNIQUE constraint failed: users.username/.test(error.message)) throw fail(409, 'USERNAME_TAKEN', '用户名已被使用')
      throw error
    }
    database.prepare(`
      INSERT INTO auth_identities (
        id, user_id, provider, provider_key, password_hash, recovery_code_hash, created_at, updated_at
      ) VALUES (?, ?, 'password', ?, ?, ?, ?, ?)
    `).run(crypto.randomUUID(), userId, name, bcrypt.hashSync(password, 10), sha256(recovery), now, now)
    database.prepare(`
      INSERT INTO privacy_acceptances (id, user_id, policy_version, accepted_at) VALUES (?, ?, ?, ?)
    `).run(crypto.randomUUID(), userId, POLICY_VERSION, now)
  })
  tx()
  const user = database.prepare('SELECT * FROM users WHERE id = ?').get(userId)
  writeAudit({ ...meta, actorId: userId, action: 'register', result: 'success' })
  return { token: createSession(userId, 'web'), user: publicUser(user), recovery_code: recovery }
}

function recoverAccount({ username, recoveryCode, password }, meta) {
  if (password.length < 8 || password.length > 128) throw fail(400, 'VALIDATION_ERROR', '密码长度需 8–128 位')
  const user = identityByUsername(username)
  const recoveryOk = user && user.recovery_code_hash === sha256(normalizeSecret(recoveryCode))
  if (!recoveryOk || user.status !== 'active') {
    writeAudit({ ...meta, actorId: user?.id, action: 'recover', result: 'failure' })
    throw fail(401, 'INVALID_CREDENTIALS', '用户名或恢复码不正确')
  }
  const recovery = makeRecoveryCode()
  const now = Date.now()
  database.prepare(`
    UPDATE auth_identities
    SET password_hash = ?, recovery_code_hash = ?, updated_at = ?
    WHERE id = ?
  `).run(bcrypt.hashSync(password, 10), sha256(recovery), now, user.identity_id)
  database.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id)
  writeAudit({ ...meta, actorId: user.id, action: 'recover', result: 'success' })
  return { recovery_code: recovery }
}

function changePassword(userId, currentPassword, nextPassword, meta) {
  if (nextPassword.length < 8 || nextPassword.length > 128) throw fail(400, 'VALIDATION_ERROR', '密码长度需 8–128 位')
  const user = database.prepare(`
    SELECT u.id, i.password_hash, i.id AS identity_id
    FROM users u JOIN auth_identities i ON i.user_id = u.id AND i.provider = 'password'
    WHERE u.id = ?
  `).get(userId)
  if (!user || !bcrypt.compareSync(currentPassword, user.password_hash)) {
    throw fail(401, 'INVALID_CREDENTIALS', '原密码不正确')
  }
  const recovery = makeRecoveryCode()
  const now = Date.now()
  database.prepare(`
    UPDATE auth_identities SET password_hash = ?, recovery_code_hash = ?, updated_at = ? WHERE id = ?
  `).run(bcrypt.hashSync(nextPassword, 10), sha256(recovery), now, user.identity_id)
  database.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId)
  writeAudit({ ...meta, actorId: userId, action: 'password_change', result: 'success' })
  return { recovery_code: recovery }
}

function reauthenticate(userId, token, password) {
  const user = database.prepare(`
    SELECT password_hash FROM auth_identities WHERE user_id = ? AND provider = 'password'
  `).get(userId)
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    throw fail(401, 'INVALID_CREDENTIALS', '密码不正确')
  }
  touchReauth(token)
  return { valid_until: Date.now() + 5 * 60 * 1000 }
}

function ownedDevice(userId, deviceId) {
  const device = database.prepare('SELECT * FROM devices WHERE id = ? AND user_id = ?').get(deviceId, userId)
  if (!device) throw fail(404, 'NOT_FOUND', '设备不存在')
  return device
}

function presentDevice(row, todayValue = dates.today()) {
  const planCount = database.prepare('SELECT COUNT(*) AS n FROM maintenance_plans WHERE device_id = ?').get(row.id).n
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    category_label: CATEGORIES[row.category] || row.category,
    model: row.model,
    purchased_on: row.purchased_on,
    warranty_until: row.warranty_until,
    warranty_label: dates.warrantyLabel(row.warranty_until, todayValue),
    note: row.note,
    created_at: row.created_at,
    updated_at: row.updated_at,
    version: row.version,
    plan_count: planCount,
  }
}

function listDevices(userId) {
  const todayValue = dates.today()
  const rows = database.prepare(`
    SELECT * FROM devices WHERE user_id = ? ORDER BY created_at DESC, id DESC
  `).all(userId)
  return { today: todayValue, items: rows.map((row) => presentDevice(row, todayValue)), total: rows.length }
}

function cleanDeviceInput(input, { partial } = {}) {
  const todayValue = dates.today()
  const name = String(input.name || '').trim()
  if (!partial || input.name !== undefined) {
    if (!name || name.length > 80) throw fail(400, 'VALIDATION_ERROR', '设备名称需为 1–80 字')
  }
  const category = input.category || 'other'
  if (!CATEGORIES[category]) throw fail(400, 'VALIDATION_ERROR', '分类不正确')
  const model = String(input.model || '').trim()
  if (model.length > 80) throw fail(400, 'VALIDATION_ERROR', '型号不能超过 80 字')
  const note = String(input.note || '').trim()
  if (note.length > 500) throw fail(400, 'VALIDATION_ERROR', '备注不能超过 500 字')
  const purchased = String(input.purchased_on || '').trim()
  const warranty = String(input.warranty_until || '').trim()
  if (purchased && !dates.isDate(purchased)) throw fail(400, 'VALIDATION_ERROR', '购买日期不正确')
  if (warranty && !dates.isDate(warranty)) throw fail(400, 'VALIDATION_ERROR', '保修日期不正确')
  if (purchased && purchased > todayValue) throw fail(400, 'VALIDATION_ERROR', '购买日不能晚于今天')
  if (purchased && warranty && warranty < purchased) throw fail(400, 'VALIDATION_ERROR', '保修日不能早于购买日')
  return {
    name,
    category,
    model: model || null,
    purchased_on: purchased || null,
    warranty_until: warranty || null,
    note: note || null,
  }
}

function createDevice(userId, input) {
  assertWrites()
  const count = database.prepare('SELECT COUNT(*) AS n FROM devices WHERE user_id = ?').get(userId).n
  if (count >= 100) throw fail(422, 'QUOTA_EXCEEDED', '每账号最多 100 台设备')
  const value = cleanDeviceInput(input)
  const now = Date.now()
  const id = crypto.randomUUID()
  database.prepare(`
    INSERT INTO devices (
      id, user_id, name, category, model, purchased_on, warranty_until, note, created_at, updated_at, version
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
  `).run(id, userId, value.name, value.category, value.model, value.purchased_on, value.warranty_until, value.note, now, now)
  return presentDevice(database.prepare('SELECT * FROM devices WHERE id = ?').get(id))
}

function updateDevice(userId, deviceId, input) {
  assertWrites()
  const current = ownedDevice(userId, deviceId)
  if (Number(input.version) !== current.version) throw fail(409, 'VERSION_CONFLICT', '设备已被修改，请刷新后再保存')
  const value = cleanDeviceInput(input)
  const now = Date.now()
  const result = database.prepare(`
    UPDATE devices
    SET name = ?, category = ?, model = ?, purchased_on = ?, warranty_until = ?, note = ?, updated_at = ?, version = version + 1
    WHERE id = ? AND user_id = ? AND version = ?
  `).run(value.name, value.category, value.model, value.purchased_on, value.warranty_until, value.note, now, deviceId, userId, current.version)
  if (result.changes !== 1) throw fail(409, 'VERSION_CONFLICT', '设备已被修改，请刷新后再保存')
  return presentDevice(database.prepare('SELECT * FROM devices WHERE id = ?').get(deviceId))
}

function deleteDevice(userId, deviceId, version) {
  assertWrites()
  const current = ownedDevice(userId, deviceId)
  if (Number(version) !== current.version) throw fail(409, 'VERSION_CONFLICT', '设备已被修改，请刷新后再删除')
  database.prepare('DELETE FROM devices WHERE id = ? AND user_id = ? AND version = ?').run(deviceId, userId, current.version)
}

function presentPlan(row, todayValue = dates.today()) {
  const due = dates.dueLabel(row.next_due_on, todayValue)
  return {
    id: row.id,
    device_id: row.device_id,
    title: row.title,
    interval_days: row.interval_days,
    next_due_on: row.next_due_on,
    status: row.status,
    version: row.version,
    due_status: row.status === 'paused' ? 'paused' : due.status,
    due_label: row.status === 'paused' ? '已暂停' : due.label,
  }
}

function listPlans(userId, deviceId) {
  ownedDevice(userId, deviceId)
  const todayValue = dates.today()
  const rows = database.prepare('SELECT * FROM maintenance_plans WHERE device_id = ? ORDER BY next_due_on ASC').all(deviceId)
  return rows.map((row) => presentPlan(row, todayValue))
}

function ownedPlan(userId, planId) {
  const plan = database.prepare(`
    SELECT p.*, d.user_id
    FROM maintenance_plans p
    JOIN devices d ON d.id = p.device_id
    WHERE p.id = ? AND d.user_id = ?
  `).get(planId, userId)
  if (!plan) throw fail(404, 'NOT_FOUND', '维护计划不存在')
  return plan
}

function createPlan(userId, deviceId, input) {
  assertWrites()
  ownedDevice(userId, deviceId)
  const count = database.prepare('SELECT COUNT(*) AS n FROM maintenance_plans WHERE device_id = ?').get(deviceId).n
  if (count >= 5) throw fail(422, 'QUOTA_EXCEEDED', '每台设备最多 5 个维护计划')
  const title = String(input.title || '').trim()
  const interval = Number(input.interval_days)
  const due = String(input.next_due_on || '').trim()
  if (!title || title.length > 80) throw fail(400, 'VALIDATION_ERROR', '维护事项需为 1–80 字')
  if (!Number.isInteger(interval) || interval < 1 || interval > 3650) throw fail(400, 'VALIDATION_ERROR', '周期需为 1–3650 的整数天')
  if (!dates.isDate(due)) throw fail(400, 'VALIDATION_ERROR', '下次到期日不正确')
  const now = Date.now()
  const id = crypto.randomUUID()
  database.prepare(`
    INSERT INTO maintenance_plans (id, device_id, title, interval_days, next_due_on, status, created_at, updated_at, version)
    VALUES (?, ?, ?, ?, ?, 'active', ?, ?, 1)
  `).run(id, deviceId, title, interval, due, now, now)
  return presentPlan(database.prepare('SELECT * FROM maintenance_plans WHERE id = ?').get(id))
}

function updatePlan(userId, planId, input) {
  assertWrites()
  const current = ownedPlan(userId, planId)
  if (Number(input.version) !== current.version) throw fail(409, 'VERSION_CONFLICT', '计划已被修改，请刷新后再保存')
  const title = String(input.title ?? current.title).trim()
  const interval = input.interval_days === undefined ? current.interval_days : Number(input.interval_days)
  const due = String(input.next_due_on ?? current.next_due_on).trim()
  const status = input.status || current.status
  if (!title || title.length > 80) throw fail(400, 'VALIDATION_ERROR', '维护事项需为 1–80 字')
  if (!Number.isInteger(interval) || interval < 1 || interval > 3650) throw fail(400, 'VALIDATION_ERROR', '周期需为 1–3650 的整数天')
  if (!dates.isDate(due)) throw fail(400, 'VALIDATION_ERROR', '下次到期日不正确')
  if (!['active', 'paused'].includes(status)) throw fail(400, 'VALIDATION_ERROR', '计划状态不正确')
  const now = Date.now()
  const result = database.prepare(`
    UPDATE maintenance_plans
    SET title = ?, interval_days = ?, next_due_on = ?, status = ?, updated_at = ?, version = version + 1
    WHERE id = ? AND version = ?
  `).run(title, interval, due, status, now, planId, current.version)
  if (result.changes !== 1) throw fail(409, 'VERSION_CONFLICT', '计划已被修改，请刷新后再保存')
  return presentPlan(database.prepare('SELECT * FROM maintenance_plans WHERE id = ?').get(planId))
}

function deletePlan(userId, planId, version) {
  assertWrites()
  const current = ownedPlan(userId, planId)
  if (Number(version) !== current.version) throw fail(409, 'VERSION_CONFLICT', '计划已被修改，请刷新后再删除')
  database.prepare('DELETE FROM maintenance_plans WHERE id = ? AND version = ?').run(planId, current.version)
}

function replayOrConflict(deviceId, requestKey, fingerprint) {
  const existing = database.prepare(`
    SELECT * FROM maintenance_logs WHERE device_id = ? AND request_key = ?
  `).get(deviceId, requestKey)
  if (!existing) return null
  if (existing.request_fingerprint === fingerprint) return existing
  throw fail(409, 'DUPLICATE_REQUEST', '重复提交的内容不一致')
}

function presentLog(row, canVoid) {
  return {
    id: row.id,
    device_id: row.device_id,
    plan_id: row.plan_id,
    source: row.source,
    title: row.title,
    completed_on: row.completed_on,
    note: row.note,
    voided_at: row.voided_at,
    can_void: Boolean(canVoid),
    created_at: row.created_at,
  }
}

function listLogs(userId, deviceId) {
  ownedDevice(userId, deviceId)
  const logs = database.prepare(`
    SELECT * FROM maintenance_logs WHERE device_id = ? ORDER BY completed_on DESC, id DESC
  `).all(deviceId)
  const plans = database.prepare('SELECT * FROM maintenance_plans WHERE device_id = ?').all(deviceId)
  const planMap = new Map(plans.map((plan) => [plan.id, plan]))
  const latestByPlan = new Map()
  const byCreated = [...logs].sort((a, b) => b.created_at - a.created_at || String(b.id).localeCompare(String(a.id)))
  for (const log of byCreated) {
    if (log.source === 'plan' && log.plan_id && !log.voided_at && !latestByPlan.has(log.plan_id)) {
      latestByPlan.set(log.plan_id, log.id)
    }
  }
  return logs.map((log) => {
    const plan = planMap.get(log.plan_id)
    const canVoid = !log.voided_at && (
      (log.source === 'manual' && !log.plan_id) ||
      (log.source === 'plan' && plan && latestByPlan.get(log.plan_id) === log.id && plan.version === log.plan_version_after)
    )
    return presentLog(log, canVoid)
  })
}

function completePlan(userId, planId, input) {
  assertWrites()
  const completedOn = String(input.completed_on || '').trim()
  const note = String(input.note || '').trim()
  const requestKey = String(input.request_key || '').trim()
  if (!dates.isDate(completedOn) || completedOn > dates.today()) throw fail(400, 'VALIDATION_ERROR', '完成日不能晚于今天')
  if (note.length > 500) throw fail(400, 'VALIDATION_ERROR', '备注不能超过 500 字')
  if (!requestKey || requestKey.length > 80) throw fail(400, 'VALIDATION_ERROR', '缺少请求标识')

  const current = ownedPlan(userId, planId)
  if (Number(input.version) !== current.version) throw fail(409, 'VERSION_CONFLICT', '计划已被修改，请刷新后再登记')
  const fingerprint = sha256(['plan', planId, completedOn, note].join('|'))
  const replay = replayOrConflict(current.device_id, requestKey, fingerprint)
  if (replay) {
    return {
      log: presentLog(replay, false),
      plan: presentPlan(database.prepare('SELECT * FROM maintenance_plans WHERE id = ?').get(planId)),
    }
  }

  const now = Date.now()
  const nextDue = dates.addDays(completedOn, current.interval_days)
  const logId = crypto.randomUUID()
  const tx = database.transaction(() => {
    const updated = database.prepare(`
      UPDATE maintenance_plans
      SET next_due_on = ?, updated_at = ?, version = version + 1
      WHERE id = ? AND version = ?
    `).run(nextDue, now, planId, current.version)
    if (updated.changes !== 1) throw fail(409, 'VERSION_CONFLICT', '计划已被修改，请刷新后再登记')
    database.prepare(`
      INSERT INTO maintenance_logs (
        id, device_id, plan_id, source, title, completed_on, note, request_key, request_fingerprint,
        previous_due_on, plan_version_after, created_at
      ) VALUES (?, ?, ?, 'plan', ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      logId,
      current.device_id,
      planId,
      current.title,
      completedOn,
      note || null,
      requestKey,
      fingerprint,
      current.next_due_on,
      current.version + 1,
      now,
    )
  })
  tx()
  return {
    log: presentLog(database.prepare('SELECT * FROM maintenance_logs WHERE id = ?').get(logId), true),
    plan: presentPlan(database.prepare('SELECT * FROM maintenance_plans WHERE id = ?').get(planId)),
  }
}

function createManualLog(userId, deviceId, input) {
  assertWrites()
  ownedDevice(userId, deviceId)
  const title = String(input.title || '').trim()
  const completedOn = String(input.completed_on || '').trim()
  const note = String(input.note || '').trim()
  const requestKey = String(input.request_key || '').trim()
  if (!title || title.length > 80) throw fail(400, 'VALIDATION_ERROR', '维护事项需为 1–80 字')
  if (!dates.isDate(completedOn) || completedOn > dates.today()) throw fail(400, 'VALIDATION_ERROR', '完成日不能晚于今天')
  if (note.length > 500) throw fail(400, 'VALIDATION_ERROR', '备注不能超过 500 字')
  if (!requestKey || requestKey.length > 80) throw fail(400, 'VALIDATION_ERROR', '缺少请求标识')
  const fingerprint = sha256(['manual', title, completedOn, note].join('|'))
  const replay = replayOrConflict(deviceId, requestKey, fingerprint)
  if (replay) return presentLog(replay, !replay.voided_at)
  const id = crypto.randomUUID()
  database.prepare(`
    INSERT INTO maintenance_logs (
      id, device_id, source, title, completed_on, note, request_key, request_fingerprint, created_at
    ) VALUES (?, ?, 'manual', ?, ?, ?, ?, ?, ?)
  `).run(id, deviceId, title, completedOn, note || null, requestKey, fingerprint, Date.now())
  return presentLog(database.prepare('SELECT * FROM maintenance_logs WHERE id = ?').get(id), true)
}

function voidLog(userId, logId) {
  assertWrites()
  const log = database.prepare(`
    SELECT l.*, d.user_id
    FROM maintenance_logs l
    JOIN devices d ON d.id = l.device_id
    WHERE l.id = ? AND d.user_id = ?
  `).get(logId, userId)
  if (!log) throw fail(404, 'NOT_FOUND', '记录不存在')
  if (log.voided_at) throw fail(409, 'ACTION_NOT_ALLOWED', '这条记录已经撤销')

  const now = Date.now()
  if (log.source === 'manual' && !log.plan_id) {
    database.prepare('UPDATE maintenance_logs SET voided_at = ? WHERE id = ? AND voided_at IS NULL').run(now, logId)
    return { log: presentLog({ ...log, voided_at: now }, false), plan: null }
  }
  if (log.source !== 'plan' || !log.plan_id) throw fail(422, 'ACTION_NOT_ALLOWED', '这条历史不能撤销计划变更')

  const tx = database.transaction(() => {
    const plan = database.prepare('SELECT * FROM maintenance_plans WHERE id = ?').get(log.plan_id)
    const latest = database.prepare(`
      SELECT id FROM maintenance_logs
      WHERE plan_id = ? AND source = 'plan' AND voided_at IS NULL
      ORDER BY created_at DESC, id DESC LIMIT 1
    `).get(log.plan_id)
    if (!plan || !latest || latest.id !== log.id || plan.version !== log.plan_version_after || !log.previous_due_on) {
      throw fail(422, 'ACTION_NOT_ALLOWED', '计划已修改、已删除，或之后又完成过维护')
    }
    const updated = database.prepare(`
      UPDATE maintenance_plans
      SET next_due_on = ?, updated_at = ?, version = version + 1
      WHERE id = ? AND version = ?
    `).run(log.previous_due_on, now, plan.id, plan.version)
    if (updated.changes !== 1) throw fail(409, 'VERSION_CONFLICT', '计划已被修改，请刷新后再试')
    database.prepare('UPDATE maintenance_logs SET voided_at = ? WHERE id = ?').run(now, logId)
  })
  tx()
  const plan = database.prepare('SELECT * FROM maintenance_plans WHERE id = ?').get(log.plan_id)
  return {
    log: presentLog({ ...log, voided_at: now }, false),
    plan: plan ? presentPlan(plan) : null,
  }
}

function dueItems(userId, days) {
  const span = Number(days || 30)
  if (!Number.isInteger(span) || span < 1 || span > 90) throw fail(400, 'VALIDATION_ERROR', '天数需为 1–90')
  const todayValue = dates.today()
  const until = dates.addDays(todayValue, span)
  const devices = database.prepare('SELECT * FROM devices WHERE user_id = ?').all(userId)
  const items = []
  for (const device of devices) {
    if (device.warranty_until && device.warranty_until >= todayValue && device.warranty_until <= until) {
      const due = dates.dueLabel(device.warranty_until, todayValue)
      items.push({
        type: 'warranty',
        device_id: device.id,
        device_name: device.name,
        plan_id: null,
        title: '保修截止',
        due_on: device.warranty_until,
        status: due.status,
        label: due.label,
      })
    }
    const plans = database.prepare(`
      SELECT * FROM maintenance_plans
      WHERE device_id = ? AND status = 'active' AND next_due_on <= ?
    `).all(device.id, until)
    for (const plan of plans) {
      const due = dates.dueLabel(plan.next_due_on, todayValue)
      items.push({
        type: 'plan',
        device_id: device.id,
        device_name: device.name,
        plan_id: plan.id,
        title: plan.title,
        due_on: plan.next_due_on,
        status: due.status,
        label: due.label,
      })
    }
  }
  items.sort((a, b) => a.due_on.localeCompare(b.due_on) || a.device_name.localeCompare(b.device_name, 'zh'))
  return { today: todayValue, items }
}

function exportAccount(userId, token) {
  assertReauth(token)
  const todayValue = dates.today()
  const devices = database.prepare('SELECT * FROM devices WHERE user_id = ? ORDER BY created_at ASC').all(userId)
  const user = database.prepare('SELECT id, username FROM users WHERE id = ?').get(userId)
  return {
    schema_version: 1,
    exported_on: todayValue,
    user,
    devices: devices.map((device) => ({
      ...presentDevice(device, todayValue),
      plans: listPlans(userId, device.id),
      logs: listLogs(userId, device.id),
    })),
  }
}

function calendarText(userId, days) {
  const payload = dueItems(userId, days)
  const upcoming = payload.items.filter((item) => item.due_on >= payload.today)
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//DeviceLedger//ZH', 'CALSCALE:GREGORIAN']
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
  for (const item of upcoming) {
    const start = item.due_on.replaceAll('-', '')
    const end = dates.addDays(item.due_on, 1).replaceAll('-', '')
    const summary = `${item.device_name} ${item.title}`.replace(/[\\,;]/g, ' ')
    lines.push(
      'BEGIN:VEVENT',
      `UID:${item.type}-${item.plan_id || item.device_id}@device-ledger`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${start}`,
      `DTEND;VALUE=DATE:${end}`,
      `SUMMARY:${summary}`,
      'END:VEVENT',
    )
  }
  lines.push('END:VCALENDAR')
  return `${lines.join('\r\n')}\r\n`
}

function deleteAccount(userId, username, token) {
  assertReauth(token)
  const user = database.prepare('SELECT * FROM users WHERE id = ?').get(userId)
  if (!user || user.username !== normalizeUsername(username)) throw fail(400, 'VALIDATION_ERROR', '请输入当前用户名确认')
  database.prepare('DELETE FROM users WHERE id = ?').run(userId)
  writeAudit({ actorId: userId, action: 'account_delete', result: 'success', requestId: crypto.randomUUID() })
}

function adminOverview() {
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000
  return {
    users: database.prepare(`SELECT COUNT(*) AS n FROM users WHERE role = 'user'`).get().n,
    devices: database.prepare('SELECT COUNT(*) AS n FROM devices').get().n,
    new_users_7d: database.prepare(`SELECT COUNT(*) AS n FROM users WHERE role = 'user' AND created_at >= ?`).get(weekAgo).n,
    registration_enabled: settingEnabled('registration_enabled'),
    writes_enabled: settingEnabled('writes_enabled'),
    backup_at: null,
  }
}

function listAdminUsers({ q, status }) {
  const query = String(q || '').trim().toLowerCase()
  const rows = database.prepare(`
    SELECT u.id, u.username, u.role, u.status, u.created_at, u.last_login_at, u.version,
           (SELECT COUNT(*) FROM devices d WHERE d.user_id = u.id) AS device_count
    FROM users u
    WHERE u.role = 'user'
    ORDER BY u.created_at DESC
  `).all()
  return rows.filter((row) => {
    if (query && !row.username.includes(query)) return false
    if (status && status !== 'all' && row.status !== status) return false
    return true
  })
}

function adminUser(userId) {
  const row = database.prepare(`
    SELECT u.id, u.username, u.role, u.status, u.created_at, u.last_login_at, u.version,
           (SELECT COUNT(*) FROM devices d WHERE d.user_id = u.id) AS device_count
    FROM users u WHERE u.id = ?
  `).get(userId)
  if (!row || row.role !== 'user') throw fail(404, 'NOT_FOUND', '账户不存在')
  return row
}

function setUserStatus(actorId, userId, status, version, meta) {
  if (!['active', 'disabled'].includes(status)) throw fail(400, 'VALIDATION_ERROR', '状态不正确')
  const user = adminUser(userId)
  if (Number(version) !== user.version) throw fail(409, 'VERSION_CONFLICT', '账户已被修改，请刷新后再试')
  const now = Date.now()
  const result = database.prepare(`
    UPDATE users SET status = ?, updated_at = ?, version = version + 1 WHERE id = ? AND role = 'user' AND version = ?
  `).run(status, now, userId, user.version)
  if (result.changes !== 1) throw fail(409, 'VERSION_CONFLICT', '账户已被修改，请刷新后再试')
  if (status === 'disabled') database.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId)
  writeAudit({ ...meta, actorId, action: 'user_status_change', targetType: 'user', targetId: userId, result: 'success' })
  return adminUser(userId)
}

function adminAccount(userId) {
  const row = database.prepare(`
    SELECT id, username, role, status, created_at, last_login_at, version
    FROM users
    WHERE id = ? AND role IN ('owner', 'operator')
  `).get(userId)
  if (!row) throw fail(404, 'NOT_FOUND', '管理员账号不存在')
  return row
}

function listAdminAccounts() {
  return database.prepare(`
    SELECT id, username, role, status, created_at, last_login_at, version
    FROM users
    WHERE role IN ('owner', 'operator')
    ORDER BY CASE role WHEN 'owner' THEN 0 ELSE 1 END, created_at ASC
  `).all()
}

function countOtherActiveOwners(excludeId) {
  return database.prepare(`
    SELECT COUNT(*) AS n FROM users
    WHERE role = 'owner' AND status = 'active' AND id <> ?
  `).get(excludeId).n
}

function assertActiveOwnerPreserved(account, nextRole, nextStatus) {
  if (account.role !== 'owner' || account.status !== 'active') return
  if (nextRole === 'owner' && nextStatus === 'active') return
  if (countOtherActiveOwners(account.id) === 0) {
    throw fail(409, 'LAST_OWNER', '至少需要保留一个启用状态的所有者')
  }
}

function assertValidAdminRole(role) {
  if (!['owner', 'operator'].includes(role)) {
    throw fail(400, 'VALIDATION_ERROR', '管理员角色只能是 owner 或 operator')
  }
}

function assertAdminPassword(password) {
  if (password.length < 8 || password.length > 128) {
    throw fail(400, 'VALIDATION_ERROR', '密码长度需为 8–128 位')
  }
}

function createAdminAccount(actorId, { username, password, role }, meta) {
  const name = normalizeUsername(username)
  if (!/^[a-z0-9_]{4,32}$/.test(name)) throw fail(400, 'VALIDATION_ERROR', '用户名需为 4–32 位小写字母、数字或下划线')
  const passwordText = String(password || '')
  assertAdminPassword(passwordText)
  const nextRole = String(role || '')
  assertValidAdminRole(nextRole)

  const now = Date.now()
  const userId = crypto.randomUUID()
  const tx = database.transaction(() => {
    try {
      database.prepare(`
        INSERT INTO users (id, username, role, status, created_at, updated_at, version)
        VALUES (?, ?, ?, 'active', ?, ?, 1)
      `).run(userId, name, nextRole, now, now)
    } catch (error) {
      if (/UNIQUE constraint failed: users.username/.test(error.message)) {
        throw fail(409, 'USERNAME_TAKEN', '用户名已被使用')
      }
      throw error
    }
    database.prepare(`
      INSERT INTO auth_identities (
        id, user_id, provider, provider_key, password_hash, recovery_code_hash, created_at, updated_at
      ) VALUES (?, ?, 'password', ?, ?, NULL, ?, ?)
    `).run(crypto.randomUUID(), userId, name, bcrypt.hashSync(passwordText, 10), now, now)
  })
  tx()
  writeAudit({
    ...meta,
    actorId,
    action: 'admin_create',
    targetType: 'admin',
    targetId: userId,
    result: 'success',
    detail: { role: nextRole },
  })
  return adminAccount(userId)
}

function updateAdminAccount(actorId, userId, { role, status, version }, meta) {
  const account = adminAccount(userId)
  if (Number(version) !== account.version) throw fail(409, 'VERSION_CONFLICT', '管理员账号已被修改，请刷新后再试')

  const nextRole = role === undefined ? account.role : String(role)
  const nextStatus = status === undefined ? account.status : String(status)
  assertValidAdminRole(nextRole)
  if (!['active', 'disabled'].includes(nextStatus)) throw fail(400, 'VALIDATION_ERROR', '状态不正确')

  if (account.id === actorId) {
    if (nextRole !== account.role) throw fail(409, 'SELF_ACTION', '不能修改当前登录账号的角色')
    if (nextStatus === 'disabled') throw fail(409, 'SELF_ACTION', '不能停用当前登录账号')
  }
  assertActiveOwnerPreserved(account, nextRole, nextStatus)

  const now = Date.now()
  const result = database.prepare(`
    UPDATE users
    SET role = ?, status = ?, updated_at = ?, version = version + 1
    WHERE id = ? AND role IN ('owner', 'operator') AND version = ?
  `).run(nextRole, nextStatus, now, userId, account.version)
  if (result.changes !== 1) throw fail(409, 'VERSION_CONFLICT', '管理员账号已被修改，请刷新后再试')
  if (nextStatus === 'disabled') database.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId)
  writeAudit({
    ...meta,
    actorId,
    action: 'admin_update',
    targetType: 'admin',
    targetId: userId,
    result: 'success',
    detail: { role: nextRole, status: nextStatus },
  })
  return adminAccount(userId)
}

function resetAdminPassword(actorId, userId, password, version, meta, keepToken = '') {
  const account = adminAccount(userId)
  if (Number(version) !== account.version) throw fail(409, 'VERSION_CONFLICT', '管理员账号已被修改，请刷新后再试')
  const passwordText = String(password || '')
  assertAdminPassword(passwordText)
  const identity = database.prepare(`
    SELECT id FROM auth_identities WHERE user_id = ? AND provider = 'password'
  `).get(userId)
  if (!identity) throw fail(404, 'NOT_FOUND', '管理员登录凭据不存在')

  const now = Date.now()
  const tx = database.transaction(() => {
    const updated = database.prepare(`
      UPDATE users SET updated_at = ?, version = version + 1
      WHERE id = ? AND role IN ('owner', 'operator') AND version = ?
    `).run(now, userId, account.version)
    if (updated.changes !== 1) throw fail(409, 'VERSION_CONFLICT', '管理员账号已被修改，请刷新后再试')
    database.prepare(`
      UPDATE auth_identities SET password_hash = ?, recovery_code_hash = NULL, updated_at = ? WHERE id = ?
    `).run(bcrypt.hashSync(passwordText, 10), now, identity.id)
    if (userId === actorId && keepToken) {
      database.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?').run(userId, sha256(keepToken))
    } else {
      database.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId)
    }
  })
  tx()
  writeAudit({
    ...meta,
    actorId,
    action: 'admin_password_reset',
    targetType: 'admin',
    targetId: userId,
    result: 'success',
    detail: { self: userId === actorId },
  })
  return adminAccount(userId)
}

function deleteAdminAccount(actorId, userId, version, meta) {
  const account = adminAccount(userId)
  if (Number(version) !== account.version) throw fail(409, 'VERSION_CONFLICT', '管理员账号已被修改，请刷新后再试')
  if (account.id === actorId) throw fail(409, 'SELF_ACTION', '不能删除当前登录账号')
  assertActiveOwnerPreserved(account, null, null)
  const result = database.prepare(`
    DELETE FROM users WHERE id = ? AND role IN ('owner', 'operator') AND version = ?
  `).run(userId, account.version)
  if (result.changes !== 1) throw fail(409, 'VERSION_CONFLICT', '管理员账号已被修改，请刷新后再试')
  writeAudit({
    ...meta,
    actorId,
    action: 'admin_delete',
    targetType: 'admin',
    targetId: userId,
    result: 'success',
    detail: { username: account.username, role: account.role },
  })
}

function listInvites() {
  return database.prepare(`
    SELECT id, max_uses, used_count, expires_at, revoked_at, created_at
    FROM invite_codes ORDER BY created_at DESC
  `).all()
}

function createInvite(actorId, { maxUses, expiresOn }, meta) {
  const uses = Number(maxUses)
  if (!Number.isInteger(uses) || uses < 1 || uses > 20) throw fail(400, 'VALIDATION_ERROR', '可用次数需为 1–20')
  if (!dates.isDate(expiresOn) || expiresOn < dates.today()) throw fail(400, 'VALIDATION_ERROR', '有效期不能早于今天')
  const [year, month, day] = expiresOn.split('-').map(Number)
  const expiresAt = Date.UTC(year, month - 1, day, 15, 59, 59)
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let plain = ''
  const bytes = crypto.randomBytes(8)
  for (const byte of bytes) plain += alphabet[byte % alphabet.length]
  const code = `${plain.slice(0, 4)}-${plain.slice(4, 8)}`
  const id = crypto.randomUUID()
  database.prepare(`
    INSERT INTO invite_codes (id, code_hash, max_uses, used_count, expires_at, created_by, created_at)
    VALUES (?, ?, ?, 0, ?, ?, ?)
  `).run(id, sha256(code), uses, expiresAt, actorId, Date.now())
  writeAudit({ ...meta, actorId, action: 'invite_create', targetType: 'invite', targetId: id, result: 'success' })
  return { id, code, max_uses: uses, expires_at: expiresAt }
}

function revokeInvite(actorId, inviteId, meta) {
  const invite = database.prepare('SELECT * FROM invite_codes WHERE id = ?').get(inviteId)
  if (!invite) throw fail(404, 'NOT_FOUND', '邀请不存在')
  if (!invite.revoked_at) {
    database.prepare('UPDATE invite_codes SET revoked_at = ? WHERE id = ?').run(Date.now(), inviteId)
    writeAudit({ ...meta, actorId, action: 'invite_revoke', targetType: 'invite', targetId: inviteId, result: 'success' })
  }
  return database.prepare('SELECT id, max_uses, used_count, expires_at, revoked_at, created_at FROM invite_codes WHERE id = ?').get(inviteId)
}

function getSettings() {
  return database.prepare('SELECT key, value_json, version, updated_at FROM app_settings ORDER BY key').all().map((row) => ({
    key: row.key,
    value: JSON.parse(row.value_json),
    version: row.version,
    updated_at: row.updated_at,
  }))
}

function setSetting(actorId, key, value, version, meta) {
  if (!['registration_enabled', 'writes_enabled'].includes(key)) throw fail(404, 'NOT_FOUND', '没有这项配置')
  if (typeof value !== 'boolean') throw fail(400, 'VALIDATION_ERROR', '配置值必须是布尔值')
  const result = database.prepare(`
    UPDATE app_settings SET value_json = ?, version = version + 1, updated_by = ?, updated_at = ?
    WHERE key = ? AND version = ?
  `).run(JSON.stringify(value), actorId, Date.now(), key, Number(version))
  if (result.changes !== 1) throw fail(409, 'VERSION_CONFLICT', '配置已被修改，请刷新后再保存')
  writeAudit({ ...meta, actorId, action: 'settings_update', targetType: 'setting', targetId: key, result: 'success' })
  return getSettings().find((item) => item.key === key)
}

function listAudit() {
  return database.prepare(`
    SELECT a.created_at, a.action, a.result, a.target_type, a.target_id, u.username AS actor
    FROM audit_logs a
    LEFT JOIN users u ON u.id = a.actor_user_id
    ORDER BY a.created_at DESC
    LIMIT 50
  `).all()
}

migrate()
const bootstrapMessages = seedLocalAccounts()

module.exports = {
  databasePath,
  bootstrapMessages,
  POLICY_VERSION,
  CATEGORIES,
  publicUser,
  sessionUser,
  revokeSession,
  login,
  registerWithInvite,
  recoverAccount,
  changePassword,
  reauthenticate,
  listDevices,
  ownedDevice,
  presentDevice,
  createDevice,
  updateDevice,
  deleteDevice,
  listPlans,
  createPlan,
  updatePlan,
  deletePlan,
  listLogs,
  completePlan,
  createManualLog,
  voidLog,
  dueItems,
  exportAccount,
  calendarText,
  deleteAccount,
  adminOverview,
  listAdminUsers,
  adminUser,
  setUserStatus,
  adminAccount,
  listAdminAccounts,
  createAdminAccount,
  updateAdminAccount,
  resetAdminPassword,
  deleteAdminAccount,
  listInvites,
  createInvite,
  revokeInvite,
  getSettings,
  setSetting,
  listAudit,
  writeAudit,
}
