/**
 * security.js —— 通用安全原语集合。
 *
 * 集中提供哈希、随机串、CSRF 令牌、scrypt 口令派生与内存限流器。
 * 说明：当前业务后端实际使用的是 db.js 中的 bcrypt 方案，
 * 本文件的 scrypt/CSRF/限流工具是早期“联调版”方案，保留备用，
 * 供未来切换口令算法或接入显式 CSRF 时复用。
 */
const crypto = require('node:crypto')
const { promisify } = require('node:util')

// scrypt 是 CPU/内存密集型操作，promisify 后以 await 调用。
const scrypt = promisify(crypto.scrypt)

/**
 * 计算任意内容的 sha256 十六进制摘要。
 * 用于令牌指纹、CSRF 派生等“不需要抗暴力破解”的场景，
 * 不应用于用户口令（口令需 scrypt/bcrypt）。
 */
const hash = value => crypto.createHash('sha256').update(value).digest('hex')

/** 生成 32 字节、URL 安全的随机密钥，可用于会话/重置令牌。 */
const randomSecret = () => crypto.randomBytes(32).toString('base64url')

/**
 * 由会话令牌确定性派生出 CSRF 令牌。
 * 同一会话每次得到相同值，服务端可据此比对请求中的令牌。
 */
const csrfToken = sessionToken => hash(`device-ledger-csrf:${sessionToken}`)

// scrypt 参数：N 越大越抗暴力破解，maxmem 提升内存上限以容纳 N=32768。
const PASSWORD_OPTIONS = { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 }

// 当前正在执行的 scrypt 派生数，用于限制并发，避免被大量登录请求打满 CPU。
let activeHashes = 0

/**
 * 用给定盐值派生出 64 字节密钥。
 * 并发派生超过 2 个时直接返回 429，起单进程内的自我保护作用。
 * @param {string} password 明文口令
 * @param {string} salt 十六进制盐
 * @returns {Promise<Buffer>}
 */
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

/**
 * 生成可存储的口令串：`scrypt$<salt>$<derivedHex>`。
 * 每次都生成随机盐，相同口令两次结果不同。
 * @param {string} password
 * @returns {Promise<string>}
 */
async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex')
  return `scrypt$${salt}$${(await derive(password, salt)).toString('hex')}`
}

/**
 * 校验口令是否与存储串匹配。
 * 即使账号不存在/格式非法，也照常做一次 scrypt 派生（使用假盐），
 * 保证攻击者无法通过响应耗时差异枚举账号。
 * @param {string} password 待验证明文
 * @param {string} stored 存储的 `scrypt$salt$hex`
 * @returns {Promise<boolean>}
 */
async function verifyPassword(password, stored) {
  const [scheme, salt, hex] = String(stored || '').split('$')
  // Unknown accounts still incur hashing work to reduce timing enumeration.
  const valid = scheme === 'scrypt' && /^[a-f0-9]{32}$/.test(salt || '') && /^[a-f0-9]{128}$/.test(hex || '')
  const actual = await derive(password, valid ? salt : '0'.repeat(32))
  return valid && crypto.timingSafeEqual(actual, Buffer.from(hex, 'hex'))
}

/**
 * 从请求 Cookie 中提取格式合法的会话令牌。
 * 只做格式校验（base64url，43 字符），不查库。
 * @param {import('http').IncomingMessage} req
 * @returns {string} 合法令牌或空串
 */
function cookieToken(req) {
  const part = (req.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith('ledger_session='))
  const token = part ? part.slice('ledger_session='.length) : ''
  return /^[A-Za-z0-9_-]{43}$/.test(token) ? token : ''
}

/**
 * 单进程内存限流器（固定时间窗）。
 * 重启即清空，不是分布式限流；多实例部署时需要换成共享存储。
 * @param {object} options
 * @param {number} options.windowMs 时间窗长度（毫秒）
 * @param {number} options.max 窗口内最大请求数
 * @param {(req:import('express').Request)=>string} options.key 限流维度（如 IP）
 * @returns {import('express').RequestHandler} Express 中间件
 */
function rateLimiter({ windowMs, max, key }) {
  const entries = new Map()
  return (req, res, next) => {
    const now = Date.now()
    // 顺带清理已过期的时间窗，防止 Map 无限增长。
    for (const [id, item] of entries) if (item.until <= now) entries.delete(id)
    const id = key(req)
    let entry = entries.get(id)
    if (!entry) {
      // 限流条目本身也设上限，避免被海量伪造 key 撑爆内存。
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
