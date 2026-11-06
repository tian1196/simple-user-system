const fs = require('node:fs')
const path = require('node:path')
const { DatabaseSync } = require('node:sqlite')
const { randomUUID } = require('node:crypto')

const DEFAULT_PATH = path.join(__dirname, '..', 'data', 'ledger.sqlite')
const TABLES = ['users', 'auth_identities', 'sessions', 'invite_codes', 'devices', 'maintenance_plans', 'maintenance_logs', 'app_settings', 'privacy_acceptances', 'audit_logs', 'deletion_tombstones', 'schema_migrations']

function openDatabase(filename = process.env.DATABASE_PATH || DEFAULT_PATH) {
  const absolute = path.resolve(filename)
  // Never silently create an empty database if the configured path is wrong.
  if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) {
    throw new Error('数据库文件不存在。检查 DATABASE_PATH；本地首次开发先运行 npm run db:init。')
  }
  const connection = new DatabaseSync(absolute)
  try {
    connection.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA synchronous=FULL;')
    const tables = connection.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => row.name)
    if (TABLES.some(name => !tables.includes(name))) throw new Error('数据库缺少所需表，不能启动。请核对版本，禁止对现有库重跑初始化。')
    if (connection.prepare('PRAGMA user_version').get().user_version !== 1) throw new Error('数据库版本不匹配，当前后端只支持 schema 1。')
    if (!connection.prepare("SELECT version FROM schema_migrations WHERE version=1 AND name='001_initial'").get()) throw new Error('缺少数据库迁移记录。')
    // Prepare representative queries to reject incompatible same-name tables.
    connection.prepare('SELECT id,username,role,status,version FROM users LIMIT 0')
    connection.prepare('SELECT provider_key,password_hash,recovery_code_hash FROM auth_identities LIMIT 0')
    connection.prepare('SELECT token_hash,client_type,last_seen_at,expires_at FROM sessions LIMIT 0')
    connection.prepare('SELECT id,user_id,name,category,model,purchased_on,warranty_until,note,version FROM devices LIMIT 0')
    connection.exec('PRAGMA journal_mode=WAL;')
    connection.prepare('DELETE FROM sessions WHERE expires_at<=?').run(Date.now())
    return { connection, filename: absolute }
  } catch (error) {
    connection.close()
    throw error
  }
}

function transaction(connection, callback) {
  connection.exec('BEGIN IMMEDIATE')
  try {
    const result = callback()
    connection.exec('COMMIT')
    return result
  } catch (error) {
    connection.exec('ROLLBACK')
    throw error
  }
}

function audit(connection, action, userId, requestId, result = 'success', targetId = null) {
  connection.prepare('INSERT INTO audit_logs(id,actor_user_id,action,result,request_id,target_id) VALUES(?,?,?,?,?,?)')
    .run(randomUUID(), userId, action, result, requestId, targetId)
}

function checkDatabase(connection) {
  const migration = connection.prepare('SELECT version FROM schema_migrations WHERE version=1').get()
  const counts = connection.prepare('SELECT (SELECT count(*) FROM users) AS users, (SELECT count(*) FROM devices) AS devices').get()
  if (!migration) throw new Error('migration missing')
  return { connected: true, schema_version: migration.version, journal_mode: connection.prepare('PRAGMA journal_mode').get().journal_mode, foreign_keys: connection.prepare('PRAGMA foreign_keys').get().foreign_keys, counts }
}

module.exports = { openDatabase, transaction, audit, checkDatabase, DEFAULT_PATH, TABLES }
