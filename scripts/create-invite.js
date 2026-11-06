const { randomUUID } = require('node:crypto')
const { openDatabase, audit, transaction } = require('../server/database-tools')
const { randomSecret, hash } = require('../server/security')
let store
try {
  const maxUses = Number(process.argv[2] || 5)
  if (!Number.isInteger(maxUses) || maxUses < 1 || maxUses > 20) throw new Error('使用次数需1—20')
  store = openDatabase()
  const code = randomSecret().toUpperCase()
  const expires = Date.now() + 7 * 24 * 3600000
  transaction(store.connection, () => {
    const id = randomUUID()
    store.connection.prepare('INSERT INTO invite_codes(id,code_hash,max_uses,expires_at) VALUES(?,?,?,?)').run(id, hash(code), maxUses, expires)
    audit(store.connection, 'invite_create_cli', null, randomUUID(), 'success', id)
  })
  console.log(`邀请码（仅本次展示，请勿公开）：${code}\n可用次数：${maxUses}\n有效期：${new Date(expires).toISOString()}`)
} catch (error) { console.error(error.message); process.exitCode = 1 } finally { if (store) store.connection.close() }
