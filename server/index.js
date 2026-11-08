/**
 * index.js —— HTTP 服务入口（Express）。
 *
 * 职责是“路由与协议”，不含业务规则：
 *   - 注册全局中间件（JSON 解析、请求 ID、同源校验）；
 *   - 定义 /api/v1 下的全部 REST 路由，并挂接鉴权中间件；
 *   - 统一响应/错误格式、Cookie 会话读写；
 *   - 托管静态站点（public）与 Vue 管理后台构建产物（web/dist）。
 * 真正的读写与校验都委托给 db.js。
 */
const crypto = require('crypto')
const fs = require('fs')
const os = require('os')
const path = require('path')
const express = require('express')
const db = require('./db')

const app = express()
const PORT = Number(process.env.PORT) || 3000
// 面向用户的旧版静态站点目录。
const publicDir = path.join(__dirname, '..', 'public')

// 隐藏技术栈指纹；限制 JSON body 大小，防止超大请求体占用内存。
app.disable('x-powered-by')
app.use(express.json({ limit: '16kb' }))

/** 给每个请求生成唯一 ID，写入 req.id 并随响应返回，便于排查问题。 */
function requestId(req, res, next) {
  req.id = crypto.randomUUID()
  next()
}

/**
 * 从 Cookie 头中手动解析指定名称的 Cookie 值。
 * 不使用额外 cookie 解析库，会话中间件只依赖它。
 * @param {import('express').Request} req
 * @param {string} name Cookie 名
 * @returns {string}
 */
function cookieValue(req, name) {
  const raw = req.headers.cookie || ''
  for (const part of raw.split(/; */)) {
    const index = part.indexOf('=')
    if (index > 0 && part.slice(0, index) === name) return decodeURIComponent(part.slice(index + 1))
  }
  return ''
}

/**
 * 下发 HttpOnly 会话 Cookie，前端 JS 无法读取以降低 XSS 窃取风险。
 * SameSite=Lax 可阻挡大部分跨站携带；COOKIE_SECURE=true 时额外加 Secure。
 * @param {import('express').Response} res
 * @param {string} name Cookie 名
 * @param {string} token 会话令牌
 * @param {number} maxAge 有效期（秒）
 */
function setSessionCookie(res, name, token, maxAge) {
  res.setHeader('Set-Cookie', `${name}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${process.env.COOKIE_SECURE === 'true' ? '; Secure' : ''}`)
}

/** 让指定会话 Cookie 立即失效（清空 + Max-Age=0）。 */
function clearSessionCookie(res, name) {
  res.setHeader('Set-Cookie', `${name}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`)
}

/**
 * 统一成功响应：{ data, request_id }。
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {*} data 业务数据
 * @param {number} [status] HTTP 状态码
 */
function send(req, res, data, status = 200) {
  res.status(status).json({ data, request_id: req.id })
}

/**
 * 统一错误响应：{ error: { code, message }, request_id }。
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {number} status HTTP 状态码
 * @param {string} code 机器可读错误码
 * @param {string} message 用户可读信息
 */
function fail(req, res, status, code, message) {
  res.status(status).json({ error: { code, message }, request_id: req.id })
}

/**
 * handle —— 同步路由处理器的统一异常捕获包装。
 * 把业务函数抛出的带 status 错误转成统一错误响应；
 * 5xx 视为服务端问题，打印日志并对外隐藏具体细节。
 * @param {(req:import('express').Request,res:import('express').Response)=>void} fn
 * @returns {import('express').RequestHandler}
 */
function handle(fn) {
  return (req, res) => {
    try {
      fn(req, res)
    } catch (error) {
      const status = error.status || 500
      if (status >= 500) console.error(error)
      fail(req, res, status, error.code || 'INTERNAL_ERROR', status >= 500 ? '服务器错误' : error.message)
    }
  }
}

/**
 * sameOrigin —— 写请求同源校验中间件。
 * GET/HEAD 放行；浏览器会自动带 Origin，若与允许来源（APP_ORIGINS
 * 或当前站点）不符则拒绝，用于阻挡跨站伪造写操作。
 */
function sameOrigin(req, res, next) {
  if (req.method === 'GET' || req.method === 'HEAD') return next()
  const origin = req.headers.origin
  if (!origin) return next()
  const expected = `${req.protocol}://${req.get('host')}`
  const allowed = (process.env.APP_ORIGINS || expected).split(',').map(value => value.trim())
  if (!allowed.includes(origin)) return fail(req, res, 403, 'FORBIDDEN', '请求来源不正确')
  next()
}

/** 从请求中提取写审计所需的最小元信息（请求 ID、来源 IP）。 */
function meta(req) {
  return { requestId: req.id, ip: req.ip }
}

/**
 * requireClient —— 生成会话鉴权中间件。
 * 根据指定 Cookie 和客户端类型解析会话；无效则 401，
 * 有效则把令牌挂到 req.sessionToken、用户挂到 req.user。
 * @param {'web'|'admin'} clientType
 * @param {string} cookieName
 * @returns {import('express').RequestHandler}
 */
function requireClient(clientType, cookieName) {
  return (req, res, next) => {
    const session = db.sessionUser(cookieValue(req, cookieName), clientType)
    if (!session) return fail(req, res, 401, 'AUTH_REQUIRED', '请先登录')
    req.sessionToken = cookieValue(req, cookieName)
    req.user = session
    next()
  }
}

// 用户端会话 / 管理后台会话分别使用独立 Cookie，互不干扰。
const requireUser = requireClient('web', 'ledger_session')
const requireAdmin = requireClient('admin', 'ledger_admin')

/** requireOwner —— 在已登录管理员基础上，进一步要求角色为 owner。 */
function requireOwner(req, res, next) {
  if (req.user.role !== 'owner') return fail(req, res, 403, 'FORBIDDEN', '只有所有者可以执行这个操作')
  next()
}

/** 最轻量存活检查：不查库，只证明进程在线。 */
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'device-ledger' })
})

// /api/v1 路由组：统一加请求 ID 和同源校验，业务路由在其下注册。
const api = express.Router()
api.use(requestId)
api.use(sameOrigin)

// ---------- 认证：普通用户注册 / 登录 / 退出 ----------

api.post('/auth/register', handle((req, res) => {
  const result = db.registerWithInvite({
    inviteCode: req.body.invite_code,
    username: req.body.username,
    password: String(req.body.password || ''),
    policyVersion: req.body.policy_version,
  }, meta(req))
  setSessionCookie(res, 'ledger_session', result.token, 7 * 24 * 3600)
  send(req, res, { user: result.user, recovery_code: result.recovery_code }, 201)
}))

api.post('/auth/login', handle((req, res) => {
  const result = db.login(req.body.username, String(req.body.password || ''), 'web', meta(req))
  setSessionCookie(res, 'ledger_session', result.token, 7 * 24 * 3600)
  send(req, res, { user: result.user })
}))

api.post('/admin/auth/login', handle((req, res) => {
  const totp = String(req.body.totp || '')
  if (!/^\d{6}$/.test(totp)) throw Object.assign(new Error('动态验证码需为 6 位数字'), { status: 400, code: 'VALIDATION_ERROR' })
  const result = db.login(req.body.username, String(req.body.password || ''), 'admin', meta(req))
  setSessionCookie(res, 'ledger_admin', result.token, 8 * 3600)
  send(req, res, { user: result.user })
}))

api.post('/auth/logout', requireUser, handle((req, res) => {
  db.revokeSession(req.sessionToken)
  clearSessionCookie(res, 'ledger_session')
  res.status(204).end()
}))

api.post('/admin/auth/logout', requireAdmin, handle((req, res) => {
  db.revokeSession(req.sessionToken)
  clearSessionCookie(res, 'ledger_admin')
  res.status(204).end()
}))

api.get('/auth/me', requireUser, handle((req, res) => {
  send(req, res, db.publicUser(req.user))
}))

api.get('/admin/auth/me', requireAdmin, handle((req, res) => {
  send(req, res, db.publicUser(req.user))
}))

// ---------- 账户安全：恢复码找回、再验证、改密、注销 ----------

api.post('/auth/recover', handle((req, res) => {
  const result = db.recoverAccount({
    username: req.body.username,
    recoveryCode: req.body.recovery_code,
    password: String(req.body.new_password || ''),
  }, meta(req))
  send(req, res, result)
}))

api.post('/auth/reauth', requireUser, handle((req, res) => {
  send(req, res, db.reauthenticate(req.user.id, req.sessionToken, String(req.body.password || '')))
}))

api.put('/auth/password', requireUser, handle((req, res) => {
  const result = db.changePassword(req.user.id, String(req.body.current_password || ''), String(req.body.new_password || ''), meta(req))
  clearSessionCookie(res, 'ledger_session')
  send(req, res, result)
}))

api.delete('/me', requireUser, handle((req, res) => {
  db.deleteAccount(req.user.id, req.body.confirm_username, req.sessionToken)
  clearSessionCookie(res, 'ledger_session')
  res.status(204).end()
}))

// ---------- 设备 CRUD ----------

api.get('/devices', requireUser, handle((req, res) => {
  send(req, res, db.listDevices(req.user.id))
}))

api.post('/devices', requireUser, handle((req, res) => {
  send(req, res, db.createDevice(req.user.id, req.body), 201)
}))

api.get('/devices/:id', requireUser, handle((req, res) => {
  const device = db.presentDevice(db.ownedDevice(req.user.id, req.params.id))
  send(req, res, {
    device,
    plans: db.listPlans(req.user.id, device.id),
    logs: db.listLogs(req.user.id, device.id),
  })
}))

api.patch('/devices/:id', requireUser, handle((req, res) => {
  send(req, res, db.updateDevice(req.user.id, req.params.id, req.body))
}))

api.delete('/devices/:id', requireUser, handle((req, res) => {
  db.deleteDevice(req.user.id, req.params.id, req.body.version)
  res.status(204).end()
}))

// ---------- 维护计划 CRUD ----------

api.post('/devices/:id/plans', requireUser, handle((req, res) => {
  send(req, res, db.createPlan(req.user.id, req.params.id, req.body), 201)
}))

api.patch('/plans/:id', requireUser, handle((req, res) => {
  send(req, res, db.updatePlan(req.user.id, req.params.id, req.body))
}))

api.delete('/plans/:id', requireUser, handle((req, res) => {
  db.deletePlan(req.user.id, req.params.id, req.body.version)
  res.status(204).end()
}))

// ---------- 维护记录：完成 / 手动登记 / 撤销 ----------

api.post('/plans/:id/completions', requireUser, handle((req, res) => {
  send(req, res, db.completePlan(req.user.id, req.params.id, req.body), 201)
}))

api.post('/devices/:id/logs', requireUser, handle((req, res) => {
  send(req, res, db.createManualLog(req.user.id, req.params.id, req.body), 201)
}))

api.post('/logs/:id/void', requireUser, handle((req, res) => {
  send(req, res, db.voidLog(req.user.id, req.params.id))
}))

// ---------- 待办与数据导出 ----------

api.get('/due-items', requireUser, handle((req, res) => {
  send(req, res, db.dueItems(req.user.id, req.query.days || 30))
}))

api.get('/exports/account', requireUser, handle((req, res) => {
  const payload = db.exportAccount(req.user.id, req.sessionToken)
  db.writeAudit({ ...meta(req), actorId: req.user.id, action: 'export_account', result: 'success' })
  res.setHeader('Content-Disposition', 'attachment; filename="device-ledger.json"')
  res.setHeader('Cache-Control', 'no-store')
  send(req, res, payload)
}))

api.get('/exports/calendar', requireUser, handle((req, res) => {
  const text = db.calendarText(req.user.id, req.query.days || 30)
  res.setHeader('Content-Type', 'text/calendar; charset=utf-8')
  res.setHeader('Content-Disposition', 'attachment; filename="device-ledger.ics"')
  res.setHeader('Cache-Control', 'no-store')
  res.send(text)
}))

// ---------- 管理后台：概览 ----------

api.get('/admin/overview', requireAdmin, handle((req, res) => {
  send(req, res, db.adminOverview())
}))

// ---------- 管理后台：普通用户管理 ----------

api.get('/admin/users', requireAdmin, handle((req, res) => {
  send(req, res, { items: db.listAdminUsers({ q: req.query.q, status: req.query.status }) })
}))

api.get('/admin/users/:id', requireAdmin, handle((req, res) => {
  send(req, res, db.adminUser(req.params.id))
}))

api.patch('/admin/users/:id/status', requireAdmin, handle((req, res) => {
  send(req, res, db.setUserStatus(req.user.id, req.params.id, req.body.status, req.body.version, meta(req)))
}))

// ---------- 管理后台：系统账号（owner 限定） ----------

api.get('/admin/accounts', requireAdmin, requireOwner, handle((req, res) => {
  send(req, res, { items: db.listAdminAccounts() })
}))

api.post('/admin/accounts', requireAdmin, requireOwner, handle((req, res) => {
  send(req, res, db.createAdminAccount(req.user.id, {
    username: req.body.username,
    password: req.body.password,
    role: req.body.role,
  }, meta(req)), 201)
}))

api.patch('/admin/accounts/:id', requireAdmin, requireOwner, handle((req, res) => {
  send(req, res, db.updateAdminAccount(req.user.id, req.params.id, {
    role: req.body.role,
    status: req.body.status,
    version: req.body.version,
  }, meta(req)))
}))

api.put('/admin/accounts/:id/password', requireAdmin, requireOwner, handle((req, res) => {
  send(req, res, db.resetAdminPassword(
    req.user.id,
    req.params.id,
    req.body.password,
    req.body.version,
    meta(req),
    req.sessionToken,
  ))
}))

api.delete('/admin/accounts/:id', requireAdmin, requireOwner, handle((req, res) => {
  db.deleteAdminAccount(req.user.id, req.params.id, req.body.version, meta(req))
  res.status(204).end()
}))

// ---------- 管理后台：邀请码 ----------

api.get('/admin/invites', requireAdmin, handle((req, res) => {
  send(req, res, { items: db.listInvites() })
}))

api.post('/admin/invites', requireAdmin, handle((req, res) => {
  send(req, res, db.createInvite(req.user.id, {
    maxUses: req.body.max_uses,
    expiresOn: req.body.expires_on,
  }, meta(req)), 201)
}))

api.post('/admin/invites/:id/revoke', requireAdmin, handle((req, res) => {
  send(req, res, db.revokeInvite(req.user.id, req.params.id, meta(req)))
}))

// ---------- 管理后台：运营配置与审计（owner 限定） ----------

api.get('/admin/settings', requireAdmin, requireOwner, handle((req, res) => {
  send(req, res, { items: db.getSettings() })
}))

api.patch('/admin/settings/:key', requireAdmin, requireOwner, handle((req, res) => {
  send(req, res, db.setSetting(req.user.id, req.params.key, req.body.value, req.body.version, meta(req)))
}))

api.get('/admin/audit-logs', requireAdmin, requireOwner, handle((req, res) => {
  send(req, res, { items: db.listAudit() })
}))

// 就绪检查：真正连接并校验数据库（区别于 /api/health 的纯存活检查）。
api.get('/health/ready', handle((req, res) => {
  const { openDatabase, checkDatabase } = require('./database-tools')
  const store = openDatabase(db.databasePath)
  try { res.json({ ok: true, database: checkDatabase(store.connection) }) }
  finally { store.connection.close() }
}))

// 挂载 /api/v1 全部路由。
app.use('/api/v1', api)

// Vue 管理后台：构建产物存在时挂到 /admin，否则继续使用旧版页面
const adminDist = process.env.ADMIN_DIST
  ? path.resolve(process.env.ADMIN_DIST)
  : path.join(__dirname, '..', 'web', 'dist')
const adminIndex = path.join(adminDist, 'index.html')
if (fs.existsSync(adminIndex)) {
  app.use('/admin', express.static(adminDist))
  // SPA 深链接（/admin/users 等）统一回退到入口 index.html。
  app.get(['/admin', '/admin/*'], (_req, res) => res.sendFile(adminIndex))
}

// 旧版用户站点静态资源；其余非 API 路径回退到其入口（简单前端路由支持）。
app.use(express.static(publicDir))
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) return next()
  res.sendFile(path.join(publicDir, 'index.html'))
})

/** 根据端口拼出完整站点 URL（80 端口不显示端口号）。 */
function siteUrl(host) {
  return PORT === 80 ? `http://${host}/` : `http://${host}:${PORT}/`
}

const server = app.listen(PORT, process.env.HOST || '127.0.0.1', () => {
  console.log(`设备台账已挂在 IP 根目录: ${siteUrl('127.0.0.1')}`)
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries || []) {
      const family = entry.family === 4 || entry.family === 'IPv4'
      if (family && !entry.internal) console.log(`局域网访问: ${siteUrl(entry.address)}`)
    }
  }
  console.log(`数据库: ${db.databasePath}`)
  for (const message of db.bootstrapMessages) console.log(message)
})

// 统一处理监听失败，给出中文原因后退出，避免静默崩溃。
server.on('error', (error) => {
  if (error.code === 'EACCES') {
    console.error(`无法监听 ${PORT} 端口，需要用管理员权限启动`)
  } else if (error.code === 'EADDRINUSE') {
    console.error(`${PORT} 端口已被占用`)
  } else {
    console.error(error)
  }
  process.exit(1)
})
