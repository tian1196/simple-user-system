// SQLite在线快照及匹配附件；失败不留下不完整的备份，拒绝覆盖已有文件。
const fs = require('node:fs')
const path = require('node:path')
const { backup, DatabaseSync } = require('node:sqlite')
const { openDatabase } = require('../server/database-tools')
async function main() {
  if (!process.argv[2]) throw new Error('Usage: node scripts/backup-database.js /absolute/path/backup.sqlite')
  const target = path.resolve(process.argv[2])
  const files = `${target}.attachments`
  if (fs.existsSync(files)) throw new Error('附件备份已存在，拒绝覆盖')
  const fd = fs.openSync(target, 'wx', 0o600)
  fs.closeSync(fd)
  let store, snapshot, createdFiles = false
  try {
    store = openDatabase()
    await backup(store.connection, target)
    snapshot = new DatabaseSync(target, { readOnly: true })
    if (snapshot.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok') throw new Error('备份完整性检查失败')
    if (snapshot.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='feedback_attachments'").get()) {
      fs.mkdirSync(files, { mode: 0o700 }); createdFiles = true
      const source = path.join(path.dirname(store.filename), 'feedback-attachments')
      // 图片不可修改：按快照中的引用复制。若并发注销使原图消失，则整个备份失败，避免发布残缺快照。
      for (const row of snapshot.prepare('SELECT id,size FROM feedback_attachments').all()) {
        if (!/^[a-f0-9-]{36}$/.test(row.id)) throw new Error('附件标识异常')
        const destination = path.join(files, `${row.id}.bin`)
        fs.copyFileSync(path.join(source, `${row.id}.bin`), destination, fs.constants.COPYFILE_EXCL)
        fs.chmodSync(destination, 0o600)
        if (fs.statSync(destination).size !== row.size) throw new Error('附件大小校验失败')
      }
    }
    console.log(`数据库及匹配附件备份完成：${target}${createdFiles ? ' + ' + files : ''}`)
  } catch (error) {
    fs.unlinkSync(target)
    if (createdFiles) fs.rmSync(files, { recursive: true, force: true })
    throw error
  } finally { snapshot?.close(); store?.connection.close() }
}
main().catch(error => { console.error(error.message); process.exitCode = 1 })
