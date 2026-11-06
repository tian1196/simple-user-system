const crypto = require('node:crypto')
const { promisify } = require('node:util')
const scrypt = promisify(crypto.scrypt)
const hash = value => crypto.createHash('sha256').update(value).digest('hex')
const randomSecret = () => crypto.randomBytes(32).toString('base64url')
const csrfToken = sessionToken => hash(`device-ledger-csrf:${sessionToken}`)
const PASSWORD_OPTIONS = { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 }
let activeHashes = 0

async function derive(password, salt) {
  if (activeHashes >= 2) {
    const error = new Error('密码验证繁忙，请稍后重试')
    error.status = 429
    error.code = 'RATE_LIMITED'
    throw error
  }
  activeHashes++
  try { return await scrypt(password, salt, 64, PASSWORD_OPTIONS) } finally { activeHashes-- }
}
async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex')
  return `scrypt$${salt}$${(await derive(password, salt)).toString('hex')}`
}
async function verifyPassword(password, stored) {
  const [scheme, salt, hex] = String(stored || '').split('$')
  // Unknown accounts still incur hashing work to reduce timing enumeration.
  const valid = scheme === 'scrypt' && /^[a-f0-9]{32}$/.test(salt || '') && /^[a-f0-9]{128}$/.test(hex || '')
  const actual = await derive(password, valid ? salt : '0'.repeat(32))
  return valid && crypto.timingSafeEqual(actual, Buffer.from(hex, 'hex'))
}
function cookieToken(req) {
  const part = (req.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith('ledger_session='))
  const token = part ? part.slice('ledger_session='.length) : ''
  return /^[A-Za-z0-9_-]{43}$/.test(token) ? token : ''
}
// Bounded, single-process limit. Cleared by a restart; not a distributed limit.
function rateLimiter({ windowMs, max, key }) {
  const entries = new Map()
  return (req, res, next) => {
    const now = Date.now()
    for (const [id, item] of entries) if (item.until <= now) entries.delete(id)
    const id = key(req)
    let entry = entries.get(id)
    if (!entry) {
      if (entries.size >= 5000) return res.status(429).set('Retry-After', '60').json({ ok: false, code: 'RATE_LIMITED', message: '请求过多，请稍后重试' })
      entry = { count: 0, until: now + windowMs }
      entries.set(id, entry)
    }
    entry.count++
    if (entry.count > max) return res.status(429).set('Retry-After', String(Math.ceil((entry.until - now) / 1000))).json({ ok: false, code: 'RATE_LIMITED', message: '请求过多，请稍后重试' })
    next()
  }
}
module.exports = { hash, randomSecret, csrfToken, hashPassword, verifyPassword, cookieToken, rateLimiter }
