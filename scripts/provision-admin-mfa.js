#!/usr/bin/env node
/**
 * 为尚未绑定 TOTP 的管理员补绑 / 重置动态验证码。
 *
 * 用法：
 *   DATABASE_PATH=/opt/device-ledger/data/ledger.sqlite node scripts/provision-admin-mfa.js owner
 *   DATABASE_PATH=./data/ledger.sqlite node scripts/provision-admin-mfa.js owner --force
 *
 * --force：即使已绑定也重新生成（会使旧 Authenticator 条目失效）。
 */
const path = require('node:path')
const { openDatabase } = require('../server/database-tools')
const totp = require('../server/totp')

const username = String(process.argv[2] || '').trim().toLowerCase()
const force = process.argv.includes('--force')

if (!/^[a-z0-9_]{4,32}$/.test(username)) {
  console.error('用法：node scripts/provision-admin-mfa.js <username> [--force]')
  process.exit(1)
}

const filename = path.resolve(process.env.DATABASE_PATH || path.join(__dirname, '..', 'data', 'ledger.sqlite'))
const store = openDatabase(filename)

try {
  const user = store.connection.prepare(`
    SELECT id, username, role, status, mfa_secret_enc
    FROM users
    WHERE username = ? AND role IN ('owner', 'operator')
  `).get(username)
  if (!user) throw new Error(`找不到管理员账号：${username}`)
  if (user.status !== 'active') throw new Error(`账号 ${username} 已停用，请先恢复后再绑定`)
  if (user.mfa_secret_enc && !force) {
    throw new Error(`账号 ${username} 已绑定动态验证码。如需重置请加 --force`)
  }

  const secret = totp.generateSecret()
  const now = Date.now()
  store.connection.prepare(`
    UPDATE users
    SET mfa_secret_enc = ?, updated_at = ?, version = version + 1
    WHERE id = ?
  `).run(totp.encryptSecret(secret), now, user.id)
  store.connection.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id)

  const uri = totp.buildUri(user.username, secret)
  console.log('动态验证码已写入数据库（旧会话已失效）')
  console.log(`账号：${user.username}`)
  console.log(`密钥：${secret}`)
  console.log(`URI：${uri}`)
  console.log('请用 Google Authenticator / 微软 Authenticator / 1Password 等扫码或手动录入密钥。')
  console.log(`当前动态码（30 秒内有效）：${totp.currentToken(secret)}`)
} catch (error) {
  console.error(error.message || error)
  process.exitCode = 1
} finally {
  store.connection.close()
}
