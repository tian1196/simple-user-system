const fs = require('node:fs')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { transaction } = require('./database-tools')
function migrateFeedback(database, filename) {
  const version = database.prepare('PRAGMA user_version').get().user_version
  if (version === 3) return null
  if (version !== 2) throw new Error('反馈功能需要从 schema 2 升级')
  const backup = `${filename}.pre-feedback-${Date.now()}-${randomUUID()}.sqlite`
  database.prepare('VACUUM INTO ?').run(backup)
  fs.chmodSync(backup, 0o600)
  transaction(database, () => {
    if (database.prepare('PRAGMA user_version').get().user_version === 3) return
    database.exec(fs.readFileSync(path.join(__dirname, '../migrations/003_feedback.sql'), 'utf8'))
  })
  return backup
}
module.exports = { migrateFeedback }
