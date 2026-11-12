// SQLite 在线快照，包含 WAL 中已提交的数据；拒绝覆盖已有备份。
const fs = require('node:fs')
const path = require('node:path')
const { backup } = require('node:sqlite')
const { openDatabase } = require('../server/database-tools')
async function main() {
  if (!process.argv[2]) throw new Error('Usage: node scripts/backup-database.js /absolute/path/backup.sqlite')
  const target = path.resolve(process.argv[2])
  const fd = fs.openSync(target, 'wx', 0o600)
  fs.closeSync(fd)
  let store
  try {
    store = openDatabase()
    await backup(store.connection, target)
    console.log(`数据库备份完成：${target}`)
  } catch (error) {
    fs.unlinkSync(target)
    throw error
  } finally { if (store) store.connection.close() }
}
main().catch(error => { console.error(error.message); process.exitCode = 1 })
