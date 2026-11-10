/**
 * totp.js —— 管理后台 TOTP（动态验证码）工具。
 *
 * 使用免费开源库 otpauth（MIT）实现 RFC 6238。
 * 密钥入库前用 AES-256-GCM 加密，写入 users.mfa_secret_enc。
 * 登录校验允许 ±1 个 30 秒窗口，兼容手机与服务器轻微时钟差。
 */
const crypto = require('node:crypto')
const OTPAuth = require('otpauth')
const QRCode = require('qrcode')

const ISSUER = '设备台账管理后台'
const WINDOW = 1

/**
 * 派生 32 字节密钥：优先 MFA_KEY 环境变量，否则由固定前缀哈希。
 * 生产环境建议设置 MFA_KEY（至少 16 字符随机串）。
 * @returns {Buffer}
 */
function encryptionKey() {
  const raw = process.env.MFA_KEY || 'device-ledger-default-mfa-key'
  return crypto.createHash('sha256').update(`device-ledger-mfa:${raw}`).digest()
}

/**
 * 加密 TOTP 明文密钥（Base32）。
 * 存储格式：v1$<iv>$<tag>$<ciphertext>（均为 base64url）
 * @param {string} plainBase32
 * @returns {string}
 */
function encryptSecret(plainBase32) {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv)
  const encrypted = Buffer.concat([cipher.update(String(plainBase32), 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [
    'v1',
    iv.toString('base64url'),
    tag.toString('base64url'),
    encrypted.toString('base64url'),
  ].join('$')
}

/**
 * 解密 users.mfa_secret_enc；兼容历史明文 Base32（无 v1$ 前缀）。
 * @param {string|null|undefined} stored
 * @returns {string|null}
 */
function decryptSecret(stored) {
  if (!stored) return null
  const text = String(stored)
  if (!text.startsWith('v1$')) return text
  const [, ivPart, tagPart, dataPart] = text.split('$')
  if (!ivPart || !tagPart || !dataPart) throw new Error('MFA 密钥格式损坏')
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    encryptionKey(),
    Buffer.from(ivPart, 'base64url'),
  )
  decipher.setAuthTag(Buffer.from(tagPart, 'base64url'))
  return Buffer.concat([
    decipher.update(Buffer.from(dataPart, 'base64url')),
    decipher.final(),
  ]).toString('utf8')
}

/** 生成新的 Base32 TOTP 密钥。 */
function generateSecret() {
  return new OTPAuth.Secret({ size: 20 }).base32
}

/**
 * 构造 Authenticator 兼容的 otpauth URI。
 * @param {string} username
 * @param {string} secretBase32
 * @returns {string}
 */
function buildUri(username, secretBase32) {
  const totp = new OTPAuth.TOTP({
    issuer: ISSUER,
    label: username,
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(secretBase32),
  })
  return totp.toString()
}

/**
 * 校验 6 位动态码。
 * @param {string} secretBase32
 * @param {string} token
 * @returns {boolean}
 */
function verifyToken(secretBase32, token) {
  if (!/^\d{6}$/.test(String(token || ''))) return false
  const totp = new OTPAuth.TOTP({
    issuer: ISSUER,
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(secretBase32),
  })
  const delta = totp.validate({ token: String(token), window: WINDOW })
  return delta !== null
}

/**
 * 生成当前时间窗口的动态码（仅测试/本地播种展示用）。
 * @param {string} secretBase32
 * @returns {string}
 */
function currentToken(secretBase32) {
  const totp = new OTPAuth.TOTP({
    issuer: ISSUER,
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(secretBase32),
  })
  return totp.generate()
}

/**
 * 生成创建/重置时一次性返回给前端的绑定信息。
 * @param {string} username
 * @param {string} secretBase32
 * @returns {Promise<{secret:string, otpauth_uri:string, qrcode_data_url:string}>}
 */
async function provisioningPayload(username, secretBase32) {
  const otpauthUri = buildUri(username, secretBase32)
  const qrcodeDataUrl = await QRCode.toDataURL(otpauthUri, {
    errorCorrectionLevel: 'M',
    margin: 2,
    width: 220,
  })
  return {
    secret: secretBase32,
    otpauth_uri: otpauthUri,
    qrcode_data_url: qrcodeDataUrl,
  }
}

module.exports = {
  encryptSecret,
  decryptSecret,
  generateSecret,
  buildUri,
  verifyToken,
  currentToken,
  provisioningPayload,
}
