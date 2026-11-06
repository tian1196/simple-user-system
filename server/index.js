const crypto = require('crypto')
const os = require('os')
const path = require('path')
const express = require('express')
const db = require('./db')

const app = express()
const PORT = Number(process.env.PORT) || 80
const publicDir = path.join(__dirname, '..', 'public')

app.disable('x-powered-by')
app.use(express.json({ limit: '16kb' }))

function requestId(req, res, next) {
  req.id = crypto.randomUUID()
  next()
}

function cookieValue(req, name) {
  const raw = req.headers.cookie || ''
  for (const part of raw.split(/; */)) {
    const index = part.indexOf('=')
    if (index > 0 && part.slice(0, index) === name) return decodeURIComponent(part.slice(index + 1))
  }
  return ''
}

function setSessionCookie(res, name, token, maxAge) {
  res.setHeader('Set-Cookie', `${name}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}`)
}

function clearSessionCookie(res, name) {
  res.setHeader('Set-Cookie', `${name}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`)
}

function send(req, res, data, status = 200) {
  res.status(status).json({ data, request_id: req.id })
}

function fail(req, res, status, code, message) {
  res.status(status).json({ error: { code, message }, request_id: req.id })
}

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

function sameOrigin(req, res, next) {
  if (req.method === 'GET' || req.method === 'HEAD') return next()
  const origin = req.headers.origin
  if (!origin) return next()
  const expected = `${req.protocol}://${req.get('host')}`
  if (origin !== expected) return fail(req, res, 403, 'FORBIDDEN', '请求来源不正确')
  next()
}

function meta(req) {
  return { requestId: req.id, ip: req.ip }
}

function requireClient(clientType, cookieName) {
  return (req, res, next) => {
    const session = db.sessionUser(cookieValue(req, cookieName), clientType)
    if (!session) return fail(req, res, 401, 'AUTH_REQUIRED', '请先登录')
    req.sessionToken = cookieValue(req, cookieName)
    req.user = session
    next()
  }
}

const requireUser = requireClient('web', 'ledger_session')
const requireAdmin = requireClient('admin', 'ledger_admin')

function requireOwner(req, res, next) {
  if (req.user.role !== 'owner') return fail(req, res, 403, 'FORBIDDEN', '只有所有者可以执行这个操作')
  next()
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'device-ledger' })
})

const api = express.Router()
api.use(requestId)
api.use(sameOrigin)

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

api.post('/plans/:id/completions', requireUser, handle((req, res) => {
  send(req, res, db.completePlan(req.user.id, req.params.id, req.body), 201)
}))

api.post('/devices/:id/logs', requireUser, handle((req, res) => {
  send(req, res, db.createManualLog(req.user.id, req.params.id, req.body), 201)
}))

api.post('/logs/:id/void', requireUser, handle((req, res) => {
  send(req, res, db.voidLog(req.user.id, req.params.id))
}))

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

api.get('/admin/overview', requireAdmin, handle((req, res) => {
  send(req, res, db.adminOverview())
}))

api.get('/admin/users', requireAdmin, handle((req, res) => {
  send(req, res, { items: db.listAdminUsers({ q: req.query.q, status: req.query.status }) })
}))

api.get('/admin/users/:id', requireAdmin, handle((req, res) => {
  send(req, res, db.adminUser(req.params.id))
}))

api.patch('/admin/users/:id/status', requireAdmin, handle((req, res) => {
  send(req, res, db.setUserStatus(req.user.id, req.params.id, req.body.status, req.body.version, meta(req)))
}))

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

api.get('/admin/settings', requireAdmin, requireOwner, handle((req, res) => {
  send(req, res, { items: db.getSettings() })
}))

api.patch('/admin/settings/:key', requireAdmin, requireOwner, handle((req, res) => {
  send(req, res, db.setSetting(req.user.id, req.params.key, req.body.value, req.body.version, meta(req)))
}))

api.get('/admin/audit-logs', requireAdmin, requireOwner, handle((req, res) => {
  send(req, res, { items: db.listAudit() })
}))

app.use('/api/v1', api)
app.use(express.static(publicDir))
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) return next()
  res.sendFile(path.join(publicDir, 'index.html'))
})

function siteUrl(host) {
  return PORT === 80 ? `http://${host}/` : `http://${host}:${PORT}/`
}

const server = app.listen(PORT, '0.0.0.0', () => {
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
