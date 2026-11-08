/**
 * database-tools.js —— SQLite 连接与校验工具。
 *
 * 使用 Node 内置的 node:sqlite（DatabaseSync）。
 * 核心职责是“安全地打开一个已知且健康的数据库”：
 * 不允许因为路径写错而静默新建空库，并核对表结构、schema 版本
 * 与关键字段，防止拿错库（比如把别的项目的同名文件）启动服务。
 */
const fs = require('node:fs')
const path = require('node:path')
const { DatabaseSync } = require('node:sqlite')
const { randomUUID } = require('node:crypto')

/** 默认数据库位置（未显式配置 DATABASE_PATH 时使用）。 */
const DEFAULT_PATH = path.join(__dirname, '..', 'data', 'ledger.sqlite')

/** 当前后端所依赖的全部业务表，缺一即视为库不匹配。 */
const TABLES = ['users', 'auth_identities', 'sessions', 'invite_codes', 'devices', 'maintenance_plans', 'maintenance_logs', 'app_settings', 'privacy_acceptances', 'audit_logs', 'deletion_tombstones', 'schema_migrations']

/**
 * 打开并校验数据库，返回连接对象。
 * 任何校验失败都会关闭连接并抛错，绝不带病启动。
 * @param {string} [filename] 数据库路径，默认读 DATABASE_PATH 或 DEFAULT_PATH
 * @returns {{connection:DatabaseSync, filename:string}}
 */
function openDatabase(filename = process.env.DATABASE_PATH || DEFAULT_PATH) {
  const absolute = path.resolve(filename)
  // Never silently create an empty database if the configured path is wrong.
  if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) {
    throw new Error('数据库文件不存在。检查 DATABASE_PATH；本地首次开发先运行 npm run db:init。')
  }
  const connection = new DatabaseSync(absolute)
  try {
    // 基础 PRAGMA：外键约束、锁等待、落盘策略。
    connection.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA synchronous=FULL;')

    // 1) 必须包含全部业务表。
    const tables = connection.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => row.name)
    if (TABLES.some(name => !tables.includes(name))) throw new Error('数据库缺少所需表，不能启动。请核对版本，禁止对现有库重跑初始化。')

    // 2) schema 版本必须为 1（PRAGMA user_version 与迁移表双重确认）。
    if (connection.prepare('PRAGMA user_version').get().user_version !== 1) throw new Error('数据库版本不匹配，当前后端只支持 schema 1。')
    if (!connection.prepare("SELECT version FROM schema_migrations WHERE version=1 AND name='001_initial'").get()) throw new Error('缺少数据库迁移记录。')

    // 3) 预编译代表性查询：即使表名相同但字段结构不对，也会在此暴露。
    // Prepare representative queries to reject incompatible same-name tables.
    connection.prepare('SELECT id,username,role,status,version FROM users LIMIT 0')
    connection.prepare('SELECT provider_key,password_hash,recovery_code_hash FROM auth_identities LIMIT 0')
    connection.prepare('SELECT token_hash,client_type,last_seen_at,expires_at FROM sessions LIMIT 0')
    connection.prepare('SELECT id,user_id,name,category,model,purchased_on,warranty_until,note,version FROM devices LIMIT 0')

    // WAL 提升并发读写能力；顺手清理已过期会话。
    connection.exec('PRAGMA journal_mode=WAL;')
    connection.prepare('DELETE FROM sessions WHERE expires_at<=?').run(Date.now())
    return { connection, filename: absolute }
  } catch (error) {
    connection.close()
    throw error
  }
}

/**
 * 手动事务封装：BEGIN IMMEDIATE 立即加写锁，
 * 成功则 COMMIT，异常则 ROLLBACK，避免事务半途留下脏状态。
 * @param {DatabaseSync} connection
 * @param {()=>any} callback 事务体，返回值会透传
 * @returns {any} 事务体返回值
 */
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

/**
 * 写一条审计记录（供脚本/工具直接使用，db.js 内另有更完整的 writeAudit）。
 * @param {DatabaseSync} connection
 * @param {string} action 动作名
 * @param {string|null} userId 操作者
 * @param {string} requestId 请求标识
 * @param {string} [result] success / failure
 * @param {string|null} [targetId] 被操作对象
 */
function audit(connection, action, userId, requestId, result = 'success', targetId = null) {
  connection.prepare('INSERT INTO audit_logs(id,actor_user_id,action,result,request_id,target_id) VALUES(?,?,?,?,?,?)')
    .run(randomUUID(), userId, action, result, requestId, targetId)
}

/**
 * 健康检查：汇总迁移版本、日志模式、外键开关与用户/设备计数。
 * 供 /health/ready 接口判断数据库是否真正可用。
 * @param {DatabaseSync} connection
 * @returns {object}
 */
function checkDatabase(connection) {
  const migration = connection.prepare('SELECT version FROM schema_migrations WHERE version=1').get()
  const counts = connection.prepare('SELECT (SELECT count(*) FROM users) AS users, (SELECT count(*) FROM devices) AS devices').get()
  if (!migration) throw new Error('migration missing')
  return { connected: true, schema_version: migration.version, journal_mode: connection.prepare('PRAGMA journal_mode').get().journal_mode, foreign_keys: connection.prepare('PRAGMA foreign_keys').get().foreign_keys, counts }
}

module.exports = { openDatabase, transaction, audit, checkDatabase, DEFAULT_PATH, TABLES }
