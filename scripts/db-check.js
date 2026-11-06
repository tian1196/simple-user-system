const { openDatabase, checkDatabase } = require('../server/database-tools')
let store
try {
  store = openDatabase()
  const connection = checkDatabase(store.connection)
  const integrity = store.connection.prepare('PRAGMA integrity_check').all()
  const foreignKeys = store.connection.prepare('PRAGMA foreign_key_check').all()
  const valid = integrity.length === 1 && integrity[0].integrity_check === 'ok' && foreignKeys.length === 0
  console.log(JSON.stringify({ ok: valid, database_path: store.filename, ...connection, integrity: valid ? 'ok' : 'failed', foreign_key_errors: foreignKeys.length }, null, 2))
  if (!valid) process.exitCode = 1
} catch (error) { console.error(`数据库检查失败：${error.message}`); process.exitCode = 1 } finally { if (store) store.connection.close() }
