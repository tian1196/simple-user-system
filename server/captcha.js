/**
 * captcha.js —— 管理后台登录用图形验证码（自研 SVG，无第三方依赖）。
 *
 * 答案仅存进程内存，5 分钟过期、校验后即焚，适合单机 Node 部署。
 */
const crypto = require('node:crypto')

const TTL_MS = 5 * 60 * 1000
const CHARSET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const entries = new Map()

function cleanup(now = Date.now()) {
  for (const [id, item] of entries) {
    if (item.expiresAt <= now) entries.delete(id)
  }
  // 防止异常增长
  if (entries.size > 5000) {
    const overflow = [...entries.entries()].sort((a, b) => a[1].expiresAt - b[1].expiresAt)
    for (const [id] of overflow.slice(0, entries.size - 4000)) entries.delete(id)
  }
}

function randomText(length = 4) {
  let out = ''
  const bytes = crypto.randomBytes(length)
  for (let i = 0; i < length; i += 1) out += CHARSET[bytes[i] % CHARSET.length]
  return out
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function renderSvg(text) {
  const width = 132
  const height = 44
  const noise = []
  for (let i = 0; i < 18; i += 1) {
    const x1 = crypto.randomInt(0, width)
    const y1 = crypto.randomInt(0, height)
    const x2 = crypto.randomInt(0, width)
    const y2 = crypto.randomInt(0, height)
    noise.push(
      `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#c5d0e0" stroke-width="1" />`,
    )
  }
  for (let i = 0; i < 24; i += 1) {
    const cx = crypto.randomInt(0, width)
    const cy = crypto.randomInt(0, height)
    noise.push(`<circle cx="${cx}" cy="${cy}" r="1.2" fill="#9aabbf" />`)
  }

  const letters = [...text].map((ch, index) => {
    const x = 18 + index * 28
    const y = 28 + crypto.randomInt(-4, 5)
    const rotate = crypto.randomInt(-18, 19)
    const color = ['#1f3b63', '#2d5b9a', '#355f8c', '#243f66'][index % 4]
    return `<text x="${x}" y="${y}" fill="${color}" font-size="24" font-family="Verdana, Geneva, sans-serif" font-weight="700" transform="rotate(${rotate} ${x} ${y})">${escapeXml(ch)}</text>`
  }).join('')

  return `<?xml version="1.0" encoding="UTF-8"?>` +
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<rect width="100%" height="100%" rx="8" fill="#f4f7fb"/>` +
    noise.join('') +
    letters +
    `</svg>`
}

/**
 * 生成新验证码。
 * @returns {{id:string, image:string}} image 为 data URL
 */
function createCaptcha() {
  cleanup()
  const id = crypto.randomUUID()
  const text = randomText(4)
  const svg = renderSvg(text)
  const image = `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`
  entries.set(id, {
    text: text.toLowerCase(),
    expiresAt: Date.now() + TTL_MS,
  })
  const payload = { id, image }
  // 仅测试环境回传明文，便于自动化用例；生产切勿开启。
  if (process.env.CAPTCHA_DEBUG === '1') payload.text = text
  return payload
}

/**
 * 校验并消费验证码（不分大小写）。
 * @param {string} id
 * @param {string} answer
 * @returns {boolean}
 */
function consumeCaptcha(id, answer) {
  cleanup()
  const key = String(id || '')
  const item = entries.get(key)
  entries.delete(key)
  if (!item) return false
  if (item.expiresAt <= Date.now()) return false
  const expected = item.text
  const actual = String(answer || '').trim().toLowerCase()
  if (expected.length !== actual.length) return false
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(actual))
}

module.exports = {
  createCaptcha,
  consumeCaptcha,
}
