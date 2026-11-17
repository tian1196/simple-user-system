const fs = require('node:fs')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { transaction } = require('./database-tools')

// 启动时执行一次增量迁移；先用 VACUUM INTO 生成包含 WAL 已提交数据的快照。
function migrateReminders(database, filename) {
  const version = database.prepare('PRAGMA user_version').get().user_version
  if (version === 2 || version === 3) return null
  if (![0, 1].includes(version)) throw new Error('不支持的数据库版本，不能升级提醒功能')
  const backupPath = `${filename}.pre-reminders-${Date.now()}-${randomUUID()}.sqlite`
  database.prepare('VACUUM INTO ?').run(backupPath)
  fs.chmodSync(backupPath, 0o600)
  transaction(database, () => {
    if (database.prepare('PRAGMA user_version').get().user_version === 2) return
    // 兼容仅未设置 DATABASE_PATH 的旧开发模式所建的 schema 0 数据库。
    if (version === 0) {
      database.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY, name TEXT NOT NULL,
        applied_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER)*1000)
      ); INSERT OR IGNORE INTO schema_migrations(version,name) VALUES(1,'001_initial');`)
    }
    database.exec(fs.readFileSync(path.join(__dirname, '../migrations/002_reminders.sql'), 'utf8'))
  })
  return backupPath
}
module.exports = { migrateReminders }
