const fs = require('node:fs')
const path = require('node:path')
const { DatabaseSync } = require('node:sqlite')
const { DEFAULT_PATH } = require('../server/database-tools')
const filename = path.resolve(process.env.DATABASE_PATH || DEFAULT_PATH)
if (filename.startsWith('/opt/')) throw new Error('此命令仅初始化本地开发库。服务器已有数据库，禁止重新初始化。')
fs.mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 })
// Exclusive creation protects existing local data as well.
const fd = fs.openSync(filename, 'wx', 0o600)
fs.closeSync(fd)
let db
try {
  db = new DatabaseSync(filename)
  db.exec(fs.readFileSync(path.join(__dirname, '../migrations/001_initial.sql'), 'utf8'))
  db.exec('PRAGMA journal_mode=WAL;')
  db.close()
  console.log(`本地开发库已建立：${filename}。没有创建默认账户。`)
} catch (error) {
  if (db) db.close()
  fs.unlinkSync(filename)
  throw error
}
