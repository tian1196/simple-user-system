/**
 * db.js —— 数据访问层（DAL）与业务核心。
 *
 * 这是整个服务最大的模块，集中管理：
 *   1. SQLite 连接初始化与表结构迁移（migrate）；
 *   2. 账号体系：用户、所有者/运营者、会话、邀请码、恢复码；
 *   3. 业务数据：设备、维护计划、维护记录（完成/撤销/手动登记）；
 *   4. 待办汇总、账户导出、日历导出；
 *   5. 管理后台：普通用户管理、管理员账号管理、运营配置、审计日志。
 *
 * index.js 只负责 HTTP，所有真正的读写与规则判断都调用这里导出的函数。
 * 安全要点：口令用 bcrypt；会话令牌、邀请码、恢复码只存哈希（sha256），
 * 明文只在生成的那一刻返回给客户端。
 */
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const bcrypt = require('bcryptjs')
const { DatabaseSync } = require('node:sqlite')
const { openDatabase, transaction } = require('./database-tools')
const dates = require('./dates')
const access = require('./permissions')
const saas = require('./saas')

/**
 * 默认使用本机 data/ledger.sqlite。
 * 放到火山引擎那台机器上跑时，设置 DATABASE_PATH=/opt/device-ledger/data/ledger.sqlite。
 * SQLite 是本机文件，开发电脑不能直接打开服务器上的库。
 * 只有默认本机空库会写入初始邀请码和所有者，避免误往已有线上库里塞账号。
 */
const databasePath = process.env.DATABASE_PATH
  ? path.resolve(process.env.DATABASE_PATH)
  : path.join(__dirname, '..', 'data', 'ledger.sqlite')

// 仅本地空库使用的演示账号/邀请码常量。
const LOCAL_INVITE = 'WELCOME-2026'
const LOCAL_OWNER = 'owner'
const LOCAL_OWNER_PASSWORD = 'ledger-owner-2026'
// 用户注册时必须勾选的隐私说明版本，过期版本需重新确认。
const POLICY_VERSION = '2026-11-05'

fs.mkdirSync(path.dirname(databasePath), { recursive: true })

// 配置了 DATABASE_PATH 时走严格校验打开；本地默认路径允许直接新建。
const database = process.env.DATABASE_PATH
  ? openDatabase(databasePath).connection
  : new DatabaseSync(databasePath)
database.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA synchronous=FULL;')
// 统一事务入口：传入回调，返回一个“执行该事务”的函数。
database.transaction = callback => () => transaction(database, callback)

/** 设备分类 code -> 中文标签，输入校验与展示都依赖它。 */
const CATEGORIES = {
  appliance: '家电',
  computer: '电脑',
  camera: '相机',
  digital: '数码',
  other: '其他',
}

/**
 * 构造一个带 HTTP 状态码和错误码的业务错误，
 * 供 index.js 的 handle 捕获后转成统一错误响应。
 * @param {number} status HTTP 状态码
 * @param {string} code 机器可读错误码
 * @param {string} message 用户可读信息
 */
function fail(status, code, message) {
  const error = new Error(message)
  error.status = status
  error.code = code
  return error
}

/**
 * sha256 摘要。用于给“需要保密但不需要抗暴力破解”的内容做哈希存储：
 * 会话令牌、邀请码、恢复码。用户口令不走这里（用 bcrypt）。
 * @param {string} value
 * @returns {string}
 */
function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

/** 用户名规范化：去空白并转小写，保证登录/查重一致。 */
function normalizeUsername(username) {
  return String(username || '').trim().toLowerCase()
}

/** 密钥类内容规范化：去空白并转大写（邀请码、恢复码不区分大小写）。 */
function normalizeSecret(value) {
  return String(value || '').trim().toUpperCase()
}

/**
 * 生成恢复码：RC-XXXX-XXXX-XXXX-XXXX（共 16 个十六进制字符）。
 * 返回明文，同时库里只存它的 sha256。
 * @returns {string}
 */
function makeRecoveryCode() {
  const raw = crypto.randomBytes(8).toString('hex').toUpperCase()
  return `RC-${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}`
}

/**
 * 输出可安全返回给前端的用户公开信息（剔除内部字段）。
 * @param {object|null} row 数据库用户行
 */
function publicUser(row) {
  if (!row) return null
  return {
    id: row.id,
    username: row.username,
    role: row.role,
    status: row.status,
    created_at: row.created_at,
    last_login_at: row.last_login_at || null,
    permissions: access.permissionsOf(row.role),
    workspace: workspaceSummary(row),
  }
}

/** 管理后台身份与用户端使用同一份公开字段，权限都按角色现算。 */
function adminPublicUser(row) {
  return publicUser(row)
}

/**
 * migrate —— 建表与初始化（幂等）。
 *
 * 全部使用 CREATE TABLE IF NOT EXISTS，因此每次启动都可安全执行：
 * 已存在的表不会被修改或清空。当前没有真正的“版本升级”逻辑，
 * 结构固定为 schema 1；需要演进时应新增迁移并同步 schema 版本。
 *
 * 通用约定：
 *   - 主键 id 为 UUID 字符串；
 *   - 业务表都带 created_at / updated_at（毫秒时间戳）和 version（乐观锁）；
 *   - 关联关系靠外键 + ON DELETE，配合 PRAGMA foreign_keys=ON 级联。
 */
function migrate() {
  database.exec(`
    -- 用户表：普通用户、运营者、所有者共用，靠 role 区分。
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin', 'operator', 'support', 'auditor', 'partner')),
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
      mfa_secret_enc TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      last_login_at INTEGER,
      version INTEGER NOT NULL DEFAULT 1
    );

    -- 登录身份/凭据：与 users 分离，便于未来扩展多种登录方式。
    CREATE TABLE IF NOT EXISTS auth_identities (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      provider TEXT NOT NULL DEFAULT 'password',
      provider_key TEXT NOT NULL,
      password_hash TEXT,
      recovery_code_hash TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE (provider, provider_key),
      UNIQUE (user_id, provider)
    );

    -- 会话：只存令牌哈希。client_type 区分用户端 / 管理后台。
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      client_type TEXT NOT NULL CHECK (client_type IN ('web', 'admin')),
      created_at INTEGER NOT NULL,
      last_seen_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      reauthenticated_at INTEGER
    );

    -- 邀请码：只存哈希，带使用上限、过期时间和撤销标记。
    CREATE TABLE IF NOT EXISTS invite_codes (
      id TEXT PRIMARY KEY,
      code_hash TEXT NOT NULL UNIQUE,
      max_uses INTEGER NOT NULL,
      used_count INTEGER NOT NULL DEFAULT 0,
      expires_at INTEGER NOT NULL,
      revoked_at INTEGER,
      created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at INTEGER NOT NULL
    );

    -- 设备：归属于某个普通用户，分类受 CHECK 约束。
    CREATE TABLE IF NOT EXISTS devices (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'other' CHECK (category IN ('appliance', 'computer', 'camera', 'digital', 'other')),
      model TEXT,
      purchased_on TEXT,
      warranty_until TEXT,
      note TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      version INTEGER NOT NULL DEFAULT 1
    );

    -- 维护计划：周期（天）+ 下次到期日，可暂停。
    CREATE TABLE IF NOT EXISTS maintenance_plans (
      id TEXT PRIMARY KEY,
      device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      interval_days INTEGER NOT NULL CHECK (interval_days BETWEEN 1 AND 3650),
      next_due_on TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused')),
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      version INTEGER NOT NULL DEFAULT 1
    );

    -- 维护记录：手动登记或计划完成都会落一条，支持撤销（voided_at）。
    -- request_key + request_fingerprint 用于幂等，防止网络重试造成重复登记。
    CREATE TABLE IF NOT EXISTS maintenance_logs (
      id TEXT PRIMARY KEY,
      device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
      plan_id TEXT REFERENCES maintenance_plans(id) ON DELETE SET NULL,
      source TEXT NOT NULL CHECK (source IN ('manual', 'plan')),
      title TEXT NOT NULL,
      completed_on TEXT NOT NULL,
      note TEXT,
      request_key TEXT NOT NULL,
      request_fingerprint TEXT NOT NULL,
      previous_due_on TEXT,
      plan_version_after INTEGER,
      voided_at INTEGER,
      created_at INTEGER NOT NULL,
      UNIQUE (device_id, request_key)
    );

    -- 运营配置：键值形式，value 以 JSON 字符串存储。
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
      updated_at INTEGER NOT NULL
    );

    -- 隐私确认记录：用户对某个版本隐私说明的接受留痕。
    CREATE TABLE IF NOT EXISTS privacy_acceptances (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      policy_version TEXT NOT NULL,
      accepted_at INTEGER NOT NULL,
      UNIQUE (user_id, policy_version)
    );

    -- 审计日志：记录关键操作，不含口令、恢复码等敏感正文。
    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      actor_user_id TEXT,
      action TEXT NOT NULL,
      target_type TEXT,
      target_id TEXT,
      result TEXT NOT NULL CHECK (result IN ('success', 'failure')),
      request_id TEXT NOT NULL,
      source_ip TEXT,
      detail_json TEXT,
      created_at INTEGER NOT NULL
    );

    -- 常用查询索引：按用户/设备/到期/会话维度加速。
    CREATE INDEX IF NOT EXISTS idx_devices_user ON devices(user_id, created_at, id);
    CREATE INDEX IF NOT EXISTS idx_plans_device ON maintenance_plans(device_id);
    CREATE INDEX IF NOT EXISTS idx_plans_due ON maintenance_plans(status, next_due_on);
    CREATE INDEX IF NOT EXISTS idx_logs_device ON maintenance_logs(device_id, completed_on, id);
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
  `)

  // 初始化两项默认开关（INSERT OR IGNORE 保证已有时不覆盖）。
  const now = Date.now()
  const insertSetting = database.prepare(`
    INSERT OR IGNORE INTO app_settings (key, value_json, version, updated_at)
    VALUES (?, 'true', 1, ?)
  `)
  insertSetting.run('registration_enabled', now)
  insertSetting.run('writes_enabled', now)
  migrateUserRoles()
}

/**
 * 把旧的 owner 角色升成 admin，并放宽角色约束。
 * SQLite 不能直接改 CHECK，所以在发现旧表时重建 users。
 */
function migrateUserRoles() {
  const row = database.prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'users'`).get()
  if (!row || String(row.sql).includes("'partner'")) return
  database.exec('PRAGMA foreign_keys = OFF')
  try {
    database.exec(`
      BEGIN IMMEDIATE;
      DROP TABLE IF EXISTS users_next;
      CREATE TABLE users_next (
        id TEXT PRIMARY KEY NOT NULL,
        username TEXT NOT NULL UNIQUE CHECK(length(username) BETWEEN 4 AND 32 AND username NOT GLOB '*[^a-z0-9_]*'),
        role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin', 'operator', 'support', 'auditor', 'partner')),
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
        mfa_secret_enc TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        last_login_at INTEGER,
        version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1)
      );
      INSERT INTO users_next (
        id, username, role, status, mfa_secret_enc, created_at, updated_at, last_login_at, version
      )
      SELECT id, username,
             CASE role WHEN 'owner' THEN 'admin' ELSE role END,
             status, mfa_secret_enc, created_at, updated_at, last_login_at, version
      FROM users;
      DROP TABLE users;
      ALTER TABLE users_next RENAME TO users;
      CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);
      CREATE INDEX IF NOT EXISTS idx_users_created ON users(created_at, id);
      COMMIT;
    `)
  } catch (error) {
    try { database.exec('ROLLBACK') } catch { /* 事务未打开时忽略 */ }
    throw error
  } finally {
    database.exec('PRAGMA foreign_keys = ON')
  }
}

/**
 * seedLocalAccounts —— 本地空库播种。
 * 仅在“本地默认路径 + 完全空库”时执行：设置了 DATABASE_PATH 直接跳过，
 * 已有用户也跳过，因此绝不会污染线上库或重复创建。
 * 在同一事务内创建一个 owner（含口令、恢复码）和一个 90 天有效的邀请码。
 * @returns {string[]} 要打印到终端的凭据提示
 */
function seedLocalAccounts() {
  if (process.env.DATABASE_PATH) return []
  const messages = []
  const userCount = database.prepare('SELECT COUNT(*) AS n FROM users').get().n
  if (userCount > 0) return messages

  const now = Date.now()
  const ownerId = crypto.randomUUID()
  const passwordHash = bcrypt.hashSync(LOCAL_OWNER_PASSWORD, 10)
  const recovery = makeRecoveryCode()
  const inviteId = crypto.randomUUID()

  const tx = database.transaction(() => {
    database.prepare(`
      INSERT INTO users (id, username, role, status, created_at, updated_at, version)
      VALUES (?, ?, 'admin', 'active', ?, ?, 1)
    `).run(ownerId, LOCAL_OWNER, now, now)
    database.prepare(`
      INSERT INTO auth_identities (
        id, user_id, provider, provider_key, password_hash, recovery_code_hash, created_at, updated_at
      ) VALUES (?, ?, 'password', ?, ?, ?, ?, ?)
    `).run(crypto.randomUUID(), ownerId, LOCAL_OWNER, passwordHash, sha256(recovery), now, now)
    database.prepare(`
      INSERT INTO invite_codes (id, code_hash, max_uses, used_count, expires_at, created_by, created_at)
      VALUES (?, ?, 20, 0, ?, ?, ?)
    `).run(inviteId, sha256(LOCAL_INVITE), now + 90 * 24 * 60 * 60 * 1000, ownerId, now)
  })
  tx()
  messages.push(`本地所有者 ${LOCAL_OWNER} / ${LOCAL_OWNER_PASSWORD}`)
  messages.push(`本地邀请码 ${LOCAL_INVITE}`)
  messages.push(`所有者恢复码 ${recovery}`)
  return messages
}

/**
 * 读取某个布尔开关；未配置时默认开启（true）。
 * @param {string} key 如 registration_enabled / writes_enabled
 * @returns {boolean}
 */
function settingEnabled(key) {
  const row = database.prepare('SELECT value_json FROM app_settings WHERE key = ?').get(key)
  if (!row) return true
  return JSON.parse(row.value_json) !== false
}

/**
 * 写操作前置校验。
 * 全局写入关闭时抛 503；工作区订阅欠费或停用时抛 402。
 * @param {string} [userId]
 */
function assertWrites(userId) {
  if (!settingEnabled('writes_enabled')) throw fail(503, 'WRITES_PAUSED', '业务写入已暂停')
  if (!userId) return
  const entitlement = userEntitlement(userId)
  if (entitlement && !saas.isWritableStatus(entitlement.status)) {
    throw fail(402, 'SUBSCRIPTION_INACTIVE', '当前套餐不可用，暂时不能写入')
  }
}

/**
 * writeAudit —— 写审计记录。可选字段缺省补 null，detail 对象序列化为 JSON。
 * @param {object} entry
 * @param {string|null} [entry.actorId] 操作者 id
 * @param {string} entry.action 动作名
 * @param {string} [entry.targetType] 对象类型
 * @param {string} [entry.targetId] 对象 id
 * @param {string} entry.result success / failure
 * @param {string} [entry.requestId] 请求 id
 * @param {string} [entry.ip] 来源 IP
 * @param {object} [entry.detail] 附加结构化信息
 */
function writeAudit({ actorId, action, targetType, targetId, result, requestId, ip, detail }) {
  database.prepare(`
    INSERT INTO audit_logs (
      id, actor_user_id, action, target_type, target_id, result, request_id, source_ip, detail_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    crypto.randomUUID(),
    actorId || null,
    action,
    targetType || null,
    targetId || null,
    result,
    requestId || crypto.randomUUID(),
    ip || null,
    detail ? JSON.stringify(detail) : null,
    Date.now(),
  )
}

/**
 * 按用户名查询其密码身份（连表带出 password_hash / recovery_code_hash）。
 * @param {string} username
 * @returns {object|undefined}
 */
function identityByUsername(username) {
  return database.prepare(`
    SELECT u.*, i.password_hash, i.recovery_code_hash, i.id AS identity_id
    FROM users u
    JOIN auth_identities i ON i.user_id = u.id AND i.provider = 'password'
    WHERE u.username = ?
  `).get(normalizeUsername(username))
}

/**
 * 创建会话并返回明文令牌（仅本次返回，库里只存哈希）。
 * 用户端 7 天有效，管理后台 8 小时有效。
 * @param {string} userId
 * @param {'web'|'admin'} clientType
 * @returns {string} 会话令牌明文
 */
function createSession(userId, clientType) {
  const token = crypto.randomBytes(32).toString('base64url')
  const now = Date.now()
  const ttl = clientType === 'admin' ? 8 * 60 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000
  database.prepare(`
    INSERT INTO sessions (token_hash, user_id, client_type, created_at, last_seen_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(sha256(token), userId, clientType, now, now, now + ttl)
  return token
}

/**
 * 校验会话令牌并返回用户，失败返回 null。
 * 会话过期或用户被停用时顺手删除该会话。
 * @param {string} token 明文令牌
 * @param {'web'|'admin'} clientType
 * @returns {object|null}
 */
function sessionUser(token, clientType) {
  if (!token) return null
  const row = database.prepare(`
    SELECT s.token_hash, s.expires_at, s.reauthenticated_at, s.client_type,
           u.id, u.username, u.role, u.status, u.tenant_id, u.created_at, u.last_login_at, u.version
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.client_type = ?
  `).get(sha256(token), clientType)
  if (!row) return null
  if (row.expires_at <= Date.now() || row.status !== 'active') {
    database.prepare('DELETE FROM sessions WHERE token_hash = ?').run(row.token_hash)
    return null
  }
  return row
}

/** 撤销单个会话（退出登录）。@param {string} token 明文令牌 */
function revokeSession(token) {
  if (!token) return
  database.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token))
}

/** 记录“已重新验证口令”的时间点（导出/注销前置条件）。@param {string} token */
function touchReauth(token) {
  database.prepare('UPDATE sessions SET reauthenticated_at = ? WHERE token_hash = ?').run(Date.now(), sha256(token))
}

/**
 * 确认最近 5 分钟内重新验证过口令，否则抛出 403（REAUTH_REQUIRED）。
 * 用于账户导出、注销等敏感操作。
 * @param {string} token
 */
function assertReauth(token) {
  const row = database.prepare('SELECT reauthenticated_at FROM sessions WHERE token_hash = ?').get(sha256(token))
  if (!row?.reauthenticated_at || Date.now() - row.reauthenticated_at > 5 * 60 * 1000) {
    throw fail(403, 'REAUTH_REQUIRED', '导出或注销前需要重新验证密码')
  }
}

/**
 * login —— 统一登录（用户端 / 管理后台共用）。
 * 校验 bcrypt 口令、账号状态，并按 client_type 限制角色入口：
 * 用户端只允许普通用户，管理端只允许后台角色。
 * 管理端图形验证码在路由层校验，不在这里处理。
 * 成功更新最近登录时间、写成功审计并下发新会话；失败写失败审计。
 * @param {string} username
 * @param {string} password
 * @param {'web'|'admin'} clientType
 * @param {{requestId:string, ip:string}} meta 请求元信息
 * @returns {{token:string, user:object}}
 */
function login(username, password, clientType, meta) {
  const user = identityByUsername(username)
  const valid = user && bcrypt.compareSync(password, user.password_hash)
  if (!valid) {
    writeAudit({ ...meta, actorId: user?.id, action: 'login_failure', result: 'failure', detail: { client: clientType } })
    throw fail(401, 'INVALID_CREDENTIALS', '用户名或密码错误')
  }
  if (user.status !== 'active') throw fail(403, 'ACCOUNT_DISABLED', '账号已停用')
  if (clientType === 'web' && user.role !== 'user') {
    throw fail(403, 'FORBIDDEN', '管理账号请从后台登录')
  }
  if (clientType === 'admin' && !access.isStaffRole(user.role)) {
    throw fail(401, 'INVALID_CREDENTIALS', '用户名或密码错误')
  }
  const now = Date.now()
  database.prepare('UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ?').run(now, now, user.id)
  writeAudit({ ...meta, actorId: user.id, action: 'login_success', result: 'success', detail: { client: clientType } })
  const profile = { ...user, last_login_at: now }
  return {
    token: createSession(user.id, clientType),
    user: clientType === 'admin' ? adminPublicUser(profile) : publicUser(profile),
  }
}

/**
 * registerWithInvite —— 凭邀请码注册普通用户。
 * 依次校验注册开关、用户名格式、口令长度、隐私版本，
 * 再在事务内校验并消费邀请码、创建用户与凭据、记录隐私确认。
 * 返回新会话、用户信息与一次性恢复码。
 * @returns {{token:string, user:object, recovery_code:string}}
 */
function registerWithInvite({ inviteCode, username, password, policyVersion }, meta) {
  if (!settingEnabled('registration_enabled')) throw fail(422, 'INVITE_INVALID', '当前未开放注册')
  const name = normalizeUsername(username)
  if (!/^[a-z0-9_]{4,32}$/.test(name)) throw fail(400, 'VALIDATION_ERROR', '用户名需为 4–32 位小写字母、数字或下划线')
  if (password.length < 8 || password.length > 128) throw fail(400, 'VALIDATION_ERROR', '密码长度需 8–128 位')
  if (policyVersion !== POLICY_VERSION) throw fail(400, 'VALIDATION_ERROR', '请确认当前隐私说明')

  const now = Date.now()
  const userId = crypto.randomUUID()
  const recovery = makeRecoveryCode()
  const tx = database.transaction(() => {
    const invite = database.prepare('SELECT * FROM invite_codes WHERE code_hash = ?').get(sha256(normalizeSecret(inviteCode)))
    if (!invite || invite.revoked_at || invite.expires_at < now) throw fail(422, 'INVITE_INVALID', '邀请码无效或已过期')
    const consumed = database.prepare(`
      UPDATE invite_codes SET used_count = used_count + 1
      WHERE id = ? AND revoked_at IS NULL AND expires_at >= ? AND used_count < max_uses
    `).run(invite.id, now)
    if (consumed.changes !== 1) throw fail(422, 'INVITE_INVALID', '邀请码无效或已用完')
    const tenantId = tenantIdForInvite(invite)
    const tenant = database.prepare('SELECT * FROM tenants WHERE id = ?').get(tenantId)
    if (!tenant || !saas.isWritableStatus(tenant.status)) {
      throw fail(402, 'SUBSCRIPTION_INACTIVE', '工作区订阅不可用，暂时不能注册')
    }
    const members = database.prepare(`
      SELECT COUNT(*) AS n FROM users WHERE tenant_id = ? AND role = 'user'
    `).get(tenantId).n
    if (members >= tenant.seat_limit) throw fail(422, 'SEAT_LIMIT', '当前工作区席位已满')
    const assigned = planDefaultsForTenant(tenant)
    try {
      database.prepare(`
        INSERT INTO users (
          id, username, role, status, tenant_id, plan_id, device_limit, subscription_status,
          created_at, updated_at, version
        ) VALUES (?, ?, 'user', 'active', ?, ?, ?, ?, ?, ?, 1)
      `).run(userId, name, tenantId, assigned.planId, assigned.deviceLimit, assigned.status, now, now)
    } catch (error) {
      if (/UNIQUE constraint failed: users.username/.test(error.message)) throw fail(409, 'USERNAME_TAKEN', '用户名已被使用')
      throw error
    }
    database.prepare(`
      INSERT INTO auth_identities (
        id, user_id, provider, provider_key, password_hash, recovery_code_hash, created_at, updated_at
      ) VALUES (?, ?, 'password', ?, ?, ?, ?, ?)
    `).run(crypto.randomUUID(), userId, name, bcrypt.hashSync(password, 10), sha256(recovery), now, now)
    database.prepare(`
      INSERT INTO privacy_acceptances (id, user_id, policy_version, accepted_at) VALUES (?, ?, ?, ?)
    `).run(crypto.randomUUID(), userId, POLICY_VERSION, now)
  })
  tx()
  const user = database.prepare('SELECT * FROM users WHERE id = ?').get(userId)
  writeAudit({ ...meta, actorId: userId, action: 'register', result: 'success' })
  return { token: createSession(userId, 'web'), user: publicUser(user), recovery_code: recovery }
}

/**
 * recoverAccount —— 凭恢复码重置口令。
 * 校验恢复码哈希与账号状态后更新口令，并作废旧有全部会话，
 * 同时生成并返回一组新恢复码。
 * @returns {{recovery_code:string}}
 */
function recoverAccount({ username, recoveryCode, password }, meta) {
  if (password.length < 8 || password.length > 128) throw fail(400, 'VALIDATION_ERROR', '密码长度需 8–128 位')
  const user = identityByUsername(username)
  const recoveryOk = user && user.recovery_code_hash === sha256(normalizeSecret(recoveryCode))
  if (!recoveryOk || user.status !== 'active') {
    writeAudit({ ...meta, actorId: user?.id, action: 'recover', result: 'failure' })
    throw fail(401, 'INVALID_CREDENTIALS', '用户名或恢复码不正确')
  }
  const recovery = makeRecoveryCode()
  const now = Date.now()
  database.prepare(`
    UPDATE auth_identities
    SET password_hash = ?, recovery_code_hash = ?, updated_at = ?
    WHERE id = ?
  `).run(bcrypt.hashSync(password, 10), sha256(recovery), now, user.identity_id)
  database.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id)
  writeAudit({ ...meta, actorId: user.id, action: 'recover', result: 'success' })
  return { recovery_code: recovery }
}

/**
 * changePassword —— 修改当前用户口令。
 * 校验原口令后写入新口令、生成新恢复码并撤销全部已有会话
 * （前端随后需要重新登录）。
 * @returns {{recovery_code:string}}
 */
function changePassword(userId, currentPassword, nextPassword, meta) {
  if (nextPassword.length < 8 || nextPassword.length > 128) throw fail(400, 'VALIDATION_ERROR', '密码长度需 8–128 位')
  const user = database.prepare(`
    SELECT u.id, i.password_hash, i.id AS identity_id
    FROM users u JOIN auth_identities i ON i.user_id = u.id AND i.provider = 'password'
    WHERE u.id = ?
  `).get(userId)
  if (!user || !bcrypt.compareSync(currentPassword, user.password_hash)) {
    throw fail(401, 'INVALID_CREDENTIALS', '原密码不正确')
  }
  const recovery = makeRecoveryCode()
  const now = Date.now()
  database.prepare(`
    UPDATE auth_identities SET password_hash = ?, recovery_code_hash = ?, updated_at = ? WHERE id = ?
  `).run(bcrypt.hashSync(nextPassword, 10), sha256(recovery), now, user.identity_id)
  database.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId)
  writeAudit({ ...meta, actorId: userId, action: 'password_change', result: 'success' })
  return { recovery_code: recovery }
}

/**
 * reauthenticate —— 敏感操作前的口令再验证。
 * 校验通过后 touchReauth 标记，返回 5 分钟有效期时间戳。
 * @returns {{valid_until:number}}
 */
function reauthenticate(userId, token, password) {
  const user = database.prepare(`
    SELECT password_hash FROM auth_identities WHERE user_id = ? AND provider = 'password'
  `).get(userId)
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    throw fail(401, 'INVALID_CREDENTIALS', '密码不正确')
  }
  touchReauth(token)
  return { valid_until: Date.now() + 5 * 60 * 1000 }
}

/**
 * 取出归属当前用户的设备，找不到抛 404。用于所有设备操作的归属校验。
 * @param {string} userId
 * @param {string} deviceId
 * @returns {object}
 */
function ownedDevice(userId, deviceId) {
  const device = database.prepare('SELECT * FROM devices WHERE id = ? AND user_id = ?').get(deviceId, userId)
  if (!device) throw fail(404, 'NOT_FOUND', '设备不存在')
  return device
}

/**
 * 把设备数据库行整理成对外响应：补中文分类、保修文案、维护计划数量。
 * @param {object} row 设备行
 * @param {string} [todayValue] 基准今天，测试可注入
 * @returns {object}
 */
function presentDevice(row, todayValue = dates.today()) {
  const planCount = database.prepare('SELECT COUNT(*) AS n FROM maintenance_plans WHERE device_id = ?').get(row.id).n
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    category_label: CATEGORIES[row.category] || row.category,
    model: row.model,
    purchased_on: row.purchased_on,
    warranty_until: row.warranty_until,
    warranty_label: dates.warrantyLabel(row.warranty_until, todayValue),
    note: row.note,
    created_at: row.created_at,
    updated_at: row.updated_at,
    version: row.version,
    plan_count: planCount,
  }
}

/**
 * 列出某用户的全部设备（含今日日期与总数）。
 * @param {string} userId
 * @returns {{today:string, items:object[], total:number}}
 */
function listDevices(userId) {
  const todayValue = dates.today()
  const rows = database.prepare(`
    SELECT * FROM devices WHERE user_id = ? ORDER BY created_at DESC, id DESC
  `).all(userId)
  return { today: todayValue, items: rows.map((row) => presentDevice(row, todayValue)), total: rows.length }
}

/**
 * cleanDeviceInput —— 校验并清洗设备输入。
 * 检查名称长度、分类、型号/备注长度、购买/保修日期及其先后关系；
 * partial 用于部分更新场景（PATCH）。
 * @param {object} input
 * @param {{partial?:boolean}} [options]
 * @returns {object} 规范化后的字段
 */
function cleanDeviceInput(input, { partial } = {}) {
  const todayValue = dates.today()
  const name = String(input.name || '').trim()
  if (!partial || input.name !== undefined) {
    if (!name || name.length > 80) throw fail(400, 'VALIDATION_ERROR', '设备名称需为 1–80 字')
  }
  const category = input.category || 'other'
  if (!CATEGORIES[category]) throw fail(400, 'VALIDATION_ERROR', '分类不正确')
  const model = String(input.model || '').trim()
  if (model.length > 80) throw fail(400, 'VALIDATION_ERROR', '型号不能超过 80 字')
  const note = String(input.note || '').trim()
  if (note.length > 500) throw fail(400, 'VALIDATION_ERROR', '备注不能超过 500 字')
  const purchased = String(input.purchased_on || '').trim()
  const warranty = String(input.warranty_until || '').trim()
  if (purchased && !dates.isDate(purchased)) throw fail(400, 'VALIDATION_ERROR', '购买日期不正确')
  if (warranty && !dates.isDate(warranty)) throw fail(400, 'VALIDATION_ERROR', '保修日期不正确')
  if (purchased && purchased > todayValue) throw fail(400, 'VALIDATION_ERROR', '购买日不能晚于今天')
  if (purchased && warranty && warranty < purchased) throw fail(400, 'VALIDATION_ERROR', '保修日不能早于购买日')
  return {
    name,
    category,
    model: model || null,
    purchased_on: purchased || null,
    warranty_until: warranty || null,
    note: note || null,
  }
}

/**
 * createDevice —— 新增设备。
 * 先校验写入开关与每账号 100 台上限，再落库并返回完整设备。
 * @param {string} userId
 * @param {object} input
 * @returns {object}
 */
function createDevice(userId, input) {
  assertWrites(userId)
  const count = database.prepare('SELECT COUNT(*) AS n FROM devices WHERE user_id = ?').get(userId).n
  const deviceLimit = userEntitlement(userId)?.device_limit || 100
  if (count >= deviceLimit) throw fail(422, 'QUOTA_EXCEEDED', `当前套餐每账号最多 ${deviceLimit} 台设备`)
  const value = cleanDeviceInput(input)
  const now = Date.now()
  const id = crypto.randomUUID()
  database.prepare(`
    INSERT INTO devices (
      id, user_id, name, category, model, purchased_on, warranty_until, note, created_at, updated_at, version
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
  `).run(id, userId, value.name, value.category, value.model, value.purchased_on, value.warranty_until, value.note, now, now)
  return presentDevice(database.prepare('SELECT * FROM devices WHERE id = ?').get(id))
}

/**
 * updateDevice —— 更新设备（带 version 乐观锁，冲突抛 409）。
 * @param {string} userId
 * @param {string} deviceId
 * @param {object} input
 * @returns {object}
 */
function updateDevice(userId, deviceId, input) {
  assertWrites(userId)
  const current = ownedDevice(userId, deviceId)
  if (Number(input.version) !== current.version) throw fail(409, 'VERSION_CONFLICT', '设备已被修改，请刷新后再保存')
  const value = cleanDeviceInput(input)
  const now = Date.now()
  const result = database.prepare(`
    UPDATE devices
    SET name = ?, category = ?, model = ?, purchased_on = ?, warranty_until = ?, note = ?, updated_at = ?, version = version + 1
    WHERE id = ? AND user_id = ? AND version = ?
  `).run(value.name, value.category, value.model, value.purchased_on, value.warranty_until, value.note, now, deviceId, userId, current.version)
  if (result.changes !== 1) throw fail(409, 'VERSION_CONFLICT', '设备已被修改，请刷新后再保存')
  return presentDevice(database.prepare('SELECT * FROM devices WHERE id = ?').get(deviceId))
}

/**
 * deleteDevice —— 删除设备（校验写入开关、归属与 version）。
 * @param {string} userId
 * @param {string} deviceId
 * @param {number} version
 */
function deleteDevice(userId, deviceId, version) {
  assertWrites(userId)
  const current = ownedDevice(userId, deviceId)
  if (Number(version) !== current.version) throw fail(409, 'VERSION_CONFLICT', '设备已被修改，请刷新后再删除')
  database.prepare('DELETE FROM devices WHERE id = ? AND user_id = ? AND version = ?').run(deviceId, userId, current.version)
}

/**
 * 把维护计划行整理成对外响应：补到期状态/文案，暂停计划单独标记。
 * @param {object} row
 * @param {string} [todayValue]
 * @returns {object}
 */
function presentPlan(row, todayValue = dates.today()) {
  const due = dates.dueLabel(row.next_due_on, todayValue)
  return {
    id: row.id,
    device_id: row.device_id,
    title: row.title,
    interval_days: row.interval_days,
    next_due_on: row.next_due_on,
    status: row.status,
    version: row.version,
    due_status: row.status === 'paused' ? 'paused' : due.status,
    due_label: row.status === 'paused' ? '已暂停' : due.label,
  }
}

/**
 * 列出某设备下的全部维护计划（先校验设备归属）。
 * @param {string} userId
 * @param {string} deviceId
 * @returns {object[]}
 */
function listPlans(userId, deviceId) {
  ownedDevice(userId, deviceId)
  const todayValue = dates.today()
  const rows = database.prepare('SELECT * FROM maintenance_plans WHERE device_id = ? ORDER BY next_due_on ASC').all(deviceId)
  return rows.map((row) => presentPlan(row, todayValue))
}

/**
 * 取出归属当前用户的维护计划（连设备表带 user_id），找不到抛 404。
 * @param {string} userId
 * @param {string} planId
 * @returns {object}
 */
function ownedPlan(userId, planId) {
  const plan = database.prepare(`
    SELECT p.*, d.user_id
    FROM maintenance_plans p
    JOIN devices d ON d.id = p.device_id
    WHERE p.id = ? AND d.user_id = ?
  `).get(planId, userId)
  if (!plan) throw fail(404, 'NOT_FOUND', '维护计划不存在')
  return plan
}

/**
 * createPlan —— 新增维护计划。
 * 校验写入开关、设备归属、每设备 5 个上限、标题/周期/到期日后落库。
 * @param {string} userId
 * @param {string} deviceId
 * @param {object} input
 * @returns {object}
 */
function createPlan(userId, deviceId, input) {
  assertWrites(userId)
  ownedDevice(userId, deviceId)
  const count = database.prepare('SELECT COUNT(*) AS n FROM maintenance_plans WHERE device_id = ?').get(deviceId).n
  if (count >= 5) throw fail(422, 'QUOTA_EXCEEDED', '每台设备最多 5 个维护计划')
  const title = String(input.title || '').trim()
  const interval = Number(input.interval_days)
  const due = String(input.next_due_on || '').trim()
  if (!title || title.length > 80) throw fail(400, 'VALIDATION_ERROR', '维护事项需为 1–80 字')
  if (!Number.isInteger(interval) || interval < 1 || interval > 3650) throw fail(400, 'VALIDATION_ERROR', '周期需为 1–3650 的整数天')
  if (!dates.isDate(due)) throw fail(400, 'VALIDATION_ERROR', '下次到期日不正确')
  const now = Date.now()
  const id = crypto.randomUUID()
  database.prepare(`
    INSERT INTO maintenance_plans (id, device_id, title, interval_days, next_due_on, status, created_at, updated_at, version)
    VALUES (?, ?, ?, ?, ?, 'active', ?, ?, 1)
  `).run(id, deviceId, title, interval, due, now, now)
  return presentPlan(database.prepare('SELECT * FROM maintenance_plans WHERE id = ?').get(id))
}

/**
 * updatePlan —— 更新维护计划（标题/周期/到期日/状态，带 version 乐观锁）。
 * @param {string} userId
 * @param {string} planId
 * @param {object} input
 * @returns {object}
 */
function updatePlan(userId, planId, input) {
  assertWrites(userId)
  const current = ownedPlan(userId, planId)
  if (Number(input.version) !== current.version) throw fail(409, 'VERSION_CONFLICT', '计划已被修改，请刷新后再保存')
  const title = String(input.title ?? current.title).trim()
  const interval = input.interval_days === undefined ? current.interval_days : Number(input.interval_days)
  const due = String(input.next_due_on ?? current.next_due_on).trim()
  const status = input.status || current.status
  if (!title || title.length > 80) throw fail(400, 'VALIDATION_ERROR', '维护事项需为 1–80 字')
  if (!Number.isInteger(interval) || interval < 1 || interval > 3650) throw fail(400, 'VALIDATION_ERROR', '周期需为 1–3650 的整数天')
  if (!dates.isDate(due)) throw fail(400, 'VALIDATION_ERROR', '下次到期日不正确')
  if (!['active', 'paused'].includes(status)) throw fail(400, 'VALIDATION_ERROR', '计划状态不正确')
  const now = Date.now()
  const result = database.prepare(`
    UPDATE maintenance_plans
    SET title = ?, interval_days = ?, next_due_on = ?, status = ?, updated_at = ?, version = version + 1
    WHERE id = ? AND version = ?
  `).run(title, interval, due, status, now, planId, current.version)
  if (result.changes !== 1) throw fail(409, 'VERSION_CONFLICT', '计划已被修改，请刷新后再保存')
  return presentPlan(database.prepare('SELECT * FROM maintenance_plans WHERE id = ?').get(planId))
}

/**
 * deletePlan —— 删除维护计划（校验写入开关、归属与 version）。
 * @param {string} userId
 * @param {string} planId
 * @param {number} version
 */
function deletePlan(userId, planId, version) {
  assertWrites(userId)
  const current = ownedPlan(userId, planId)
  if (Number(version) !== current.version) throw fail(409, 'VERSION_CONFLICT', '计划已被修改，请刷新后再删除')
  database.prepare('DELETE FROM maintenance_plans WHERE id = ? AND version = ?').run(planId, current.version)
}

/**
 * 幂等辅助：同一 device_id + request_key 已存在时，
 * 指纹相同则返回旧记录（安全重试），指纹不同抛 409（内容冲突）。
 * @param {string} deviceId
 * @param {string} requestKey
 * @param {string} fingerprint
 * @returns {object|null}
 */
function replayOrConflict(deviceId, requestKey, fingerprint) {
  const existing = database.prepare(`
    SELECT * FROM maintenance_logs WHERE device_id = ? AND request_key = ?
  `).get(deviceId, requestKey)
  if (!existing) return null
  if (existing.request_fingerprint === fingerprint) return existing
  throw fail(409, 'DUPLICATE_REQUEST', '重复提交的内容不一致')
}

/**
 * 把维护记录行整理成对外响应，并标记当前是否可撤销。
 * @param {object} row
 * @param {boolean} canVoid
 * @returns {object}
 */
function presentLog(row, canVoid) {
  return {
    id: row.id,
    device_id: row.device_id,
    plan_id: row.plan_id,
    source: row.source,
    title: row.title,
    completed_on: row.completed_on,
    note: row.note,
    voided_at: row.voided_at,
    can_void: Boolean(canVoid),
    created_at: row.created_at,
  }
}

/**
 * 列出某设备全部维护记录，并计算每条是否允许撤销：
 * 仅手动记录、或计划记录中“计划未再变更且该记录是最新一条”时可撤销。
 * @param {string} userId
 * @param {string} deviceId
 * @returns {object[]}
 */
function listLogs(userId, deviceId) {
  ownedDevice(userId, deviceId)
  const logs = database.prepare(`
    SELECT * FROM maintenance_logs WHERE device_id = ? ORDER BY completed_on DESC, created_at DESC, id DESC
  `).all(deviceId)
  const plans = database.prepare('SELECT * FROM maintenance_plans WHERE device_id = ?').all(deviceId)
  const planMap = new Map(plans.map((plan) => [plan.id, plan]))
  const latestByPlan = new Map()
  const byCreated = [...logs].sort((a, b) => b.created_at - a.created_at || String(b.id).localeCompare(String(a.id)))
  for (const log of byCreated) {
    if (log.source === 'plan' && log.plan_id && !log.voided_at && !latestByPlan.has(log.plan_id)) {
      latestByPlan.set(log.plan_id, log.id)
    }
  }
  return logs.map((log) => {
    const plan = planMap.get(log.plan_id)
    const canVoid = !log.voided_at && (
      (log.source === 'manual' && !log.plan_id) ||
      (log.source === 'plan' && plan && latestByPlan.get(log.plan_id) === log.id && plan.version === log.plan_version_after)
    )
    return presentLog(log, canVoid)
  })
}

/**
 * completePlan —— 登记一次计划维护。
 * 校验完成日/备注/request_key、计划归属与 version，做幂等判断后，
 * 在事务内把计划下次到期日顺延一个周期，并写入一条来源为 plan 的记录。
 * @param {string} userId
 * @param {string} planId
 * @param {object} input
 * @returns {{log:object, plan:object}}
 */
function completePlan(userId, planId, input) {
  assertWrites(userId)
  const completedOn = String(input.completed_on || '').trim()
  const note = String(input.note || '').trim()
  const requestKey = String(input.request_key || '').trim()
  if (!dates.isDate(completedOn) || completedOn > dates.today()) throw fail(400, 'VALIDATION_ERROR', '完成日不能晚于今天')
  if (note.length > 500) throw fail(400, 'VALIDATION_ERROR', '备注不能超过 500 字')
  if (!requestKey || requestKey.length > 80) throw fail(400, 'VALIDATION_ERROR', '缺少请求标识')

  const current = ownedPlan(userId, planId)
  const fingerprint = sha256(['plan', planId, completedOn, note].join('|'))
  const replay = replayOrConflict(current.device_id, requestKey, fingerprint)
  if (replay) {
    return {
      log: presentLog(replay, false),
      plan: presentPlan(database.prepare('SELECT * FROM maintenance_plans WHERE id = ?').get(planId)),
    }
  }

  // 同一请求的安全重试应先返回原结果；首次登记仍必须通过版本校验。
  if (Number(input.version) !== current.version) throw fail(409, 'VERSION_CONFLICT', '计划已被修改，请刷新后再登记')

  const now = Date.now()
  const nextDue = dates.addDays(completedOn, current.interval_days)
  const logId = crypto.randomUUID()
  const tx = database.transaction(() => {
    const updated = database.prepare(`
      UPDATE maintenance_plans
      SET next_due_on = ?, updated_at = ?, version = version + 1
      WHERE id = ? AND version = ?
    `).run(nextDue, now, planId, current.version)
    if (updated.changes !== 1) throw fail(409, 'VERSION_CONFLICT', '计划已被修改，请刷新后再登记')
    database.prepare(`
      INSERT INTO maintenance_logs (
        id, device_id, plan_id, source, title, completed_on, note, request_key, request_fingerprint,
        previous_due_on, plan_version_after, created_at
      ) VALUES (?, ?, ?, 'plan', ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      logId,
      current.device_id,
      planId,
      current.title,
      completedOn,
      note || null,
      requestKey,
      fingerprint,
      current.next_due_on,
      current.version + 1,
      now,
    )
  })
  tx()
  return {
    log: presentLog(database.prepare('SELECT * FROM maintenance_logs WHERE id = ?').get(logId), true),
    plan: presentPlan(database.prepare('SELECT * FROM maintenance_plans WHERE id = ?').get(planId)),
  }
}

/**
 * createManualLog —— 手动登记一条维护记录（不改动计划）。
 * 同样做写入开关、归属、字段与幂等校验。
 * @param {string} userId
 * @param {string} deviceId
 * @param {object} input
 * @returns {object}
 */
function createManualLog(userId, deviceId, input) {
  assertWrites(userId)
  ownedDevice(userId, deviceId)
  const title = String(input.title || '').trim()
  const completedOn = String(input.completed_on || '').trim()
  const note = String(input.note || '').trim()
  const requestKey = String(input.request_key || '').trim()
  if (!title || title.length > 80) throw fail(400, 'VALIDATION_ERROR', '维护事项需为 1–80 字')
  if (!dates.isDate(completedOn) || completedOn > dates.today()) throw fail(400, 'VALIDATION_ERROR', '完成日不能晚于今天')
  if (note.length > 500) throw fail(400, 'VALIDATION_ERROR', '备注不能超过 500 字')
  if (!requestKey || requestKey.length > 80) throw fail(400, 'VALIDATION_ERROR', '缺少请求标识')
  const fingerprint = sha256(['manual', title, completedOn, note].join('|'))
  const replay = replayOrConflict(deviceId, requestKey, fingerprint)
  if (replay) return presentLog(replay, !replay.voided_at)
  const id = crypto.randomUUID()
  database.prepare(`
    INSERT INTO maintenance_logs (
      id, device_id, source, title, completed_on, note, request_key, request_fingerprint, created_at
    ) VALUES (?, ?, 'manual', ?, ?, ?, ?, ?, ?)
  `).run(id, deviceId, title, completedOn, note || null, requestKey, fingerprint, Date.now())
  return presentLog(database.prepare('SELECT * FROM maintenance_logs WHERE id = ?').get(id), true)
}

/**
 * voidLog —— 撤销一条维护记录。
 * 手动记录仅标记 voided_at；计划记录会把计划的下次到期日回滚为撤销前日期。
 * 若计划之后又被完成/修改，则不允许撤销。
 * @param {string} userId
 * @param {string} logId
 * @returns {{log:object, plan:object|null}}
 */
function voidLog(userId, logId) {
  assertWrites(userId)
  const log = database.prepare(`
    SELECT l.*, d.user_id
    FROM maintenance_logs l
    JOIN devices d ON d.id = l.device_id
    WHERE l.id = ? AND d.user_id = ?
  `).get(logId, userId)
  if (!log) throw fail(404, 'NOT_FOUND', '记录不存在')
  if (log.voided_at) throw fail(409, 'ACTION_NOT_ALLOWED', '这条记录已经撤销')

  const now = Date.now()
  if (log.source === 'manual' && !log.plan_id) {
    database.prepare('UPDATE maintenance_logs SET voided_at = ? WHERE id = ? AND voided_at IS NULL').run(now, logId)
    return { log: presentLog({ ...log, voided_at: now }, false), plan: null }
  }
  if (log.source !== 'plan' || !log.plan_id) throw fail(422, 'ACTION_NOT_ALLOWED', '这条历史不能撤销计划变更')

  const tx = database.transaction(() => {
    const plan = database.prepare('SELECT * FROM maintenance_plans WHERE id = ?').get(log.plan_id)
    const latest = database.prepare(`
      SELECT id FROM maintenance_logs
      WHERE plan_id = ? AND source = 'plan' AND voided_at IS NULL
      ORDER BY created_at DESC, id DESC LIMIT 1
    `).get(log.plan_id)
    if (!plan || !latest || latest.id !== log.id || plan.version !== log.plan_version_after || !log.previous_due_on) {
      throw fail(422, 'ACTION_NOT_ALLOWED', '计划已修改、已删除，或之后又完成过维护')
    }
    const updated = database.prepare(`
      UPDATE maintenance_plans
      SET next_due_on = ?, updated_at = ?, version = version + 1
      WHERE id = ? AND version = ?
    `).run(log.previous_due_on, now, plan.id, plan.version)
    if (updated.changes !== 1) throw fail(409, 'VERSION_CONFLICT', '计划已被修改，请刷新后再试')
    database.prepare('UPDATE maintenance_logs SET voided_at = ? WHERE id = ?').run(now, logId)
  })
  tx()
  const plan = database.prepare('SELECT * FROM maintenance_plans WHERE id = ?').get(log.plan_id)
  return {
    log: presentLog({ ...log, voided_at: now }, false),
    plan: plan ? presentPlan(plan) : null,
  }
}

/**
 * dueItems —— 汇总未来若干天内的保修截止与维护到期事项。
 * @param {string} userId
 * @param {number} days 窗口天数（1–90）
 * @returns {{today:string, items:object[]}}
 */
function dueItems(userId, days) {
  const span = Number(days || 30)
  if (!Number.isInteger(span) || span < 1 || span > 90) throw fail(400, 'VALIDATION_ERROR', '天数需为 1–90')
  const todayValue = dates.today()
  const until = dates.addDays(todayValue, span)
  const devices = database.prepare('SELECT * FROM devices WHERE user_id = ?').all(userId)
  const items = []
  for (const device of devices) {
    if (device.warranty_until && device.warranty_until >= todayValue && device.warranty_until <= until) {
      const due = dates.dueLabel(device.warranty_until, todayValue)
      items.push({
        type: 'warranty',
        device_id: device.id,
        device_name: device.name,
        plan_id: null,
        title: '保修截止',
        due_on: device.warranty_until,
        status: due.status,
        label: due.label,
      })
    }
    const plans = database.prepare(`
      SELECT * FROM maintenance_plans
      WHERE device_id = ? AND status = 'active' AND next_due_on <= ?
    `).all(device.id, until)
    for (const plan of plans) {
      const due = dates.dueLabel(plan.next_due_on, todayValue)
      items.push({
        type: 'plan',
        device_id: device.id,
        device_name: device.name,
        plan_id: plan.id,
        title: plan.title,
        due_on: plan.next_due_on,
        status: due.status,
        label: due.label,
      })
    }
  }
  items.sort((a, b) => a.due_on.localeCompare(b.due_on) || a.device_name.localeCompare(b.device_name, 'zh'))
  return { today: todayValue, items }
}

/**
 * exportAccount —— 导出当前用户完整账户数据（设备含计划与记录）。
 * 要求最近 5 分钟内重新验证过口令。
 * @param {string} userId
 * @param {string} token
 * @returns {object}
 */
function exportAccount(userId, token) {
  assertReauth(token)
  const todayValue = dates.today()
  const devices = database.prepare('SELECT * FROM devices WHERE user_id = ? ORDER BY created_at ASC').all(userId)
  const user = database.prepare('SELECT id, username FROM users WHERE id = ?').get(userId)
  return {
    schema_version: 1,
    exported_on: todayValue,
    user,
    devices: devices.map((device) => ({
      ...presentDevice(device, todayValue),
      plans: listPlans(userId, device.id),
      logs: listLogs(userId, device.id),
    })),
    ledger: database.prepare(`
      SELECT e.*, u.username
      FROM ledger_entries e
      JOIN users u ON u.id = e.user_id
      WHERE e.user_id = ?
      ORDER BY e.occurred_on ASC, e.created_at ASC
    `).all(userId).map(presentLedgerEntry),
  }
}

/**
 * calendarText —— 把未来事项生成符合 RFC5545 的 iCalendar（.ics）文本。
 * @param {string} userId
 * @param {number} days
 * @returns {string}
 */
function calendarText(userId, days) {
  const payload = dueItems(userId, days)
  const upcoming = payload.items.filter((item) => item.due_on >= payload.today)
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//DeviceLedger//ZH', 'CALSCALE:GREGORIAN']
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
  for (const item of upcoming) {
    const start = item.due_on.replaceAll('-', '')
    const end = dates.addDays(item.due_on, 1).replaceAll('-', '')
    const summary = `${item.device_name} ${item.title}`.replace(/[\\,;]/g, ' ')
    lines.push(
      'BEGIN:VEVENT',
      `UID:${item.type}-${item.plan_id || item.device_id}@device-ledger`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${start}`,
      `DTEND;VALUE=DATE:${end}`,
      `SUMMARY:${summary}`,
      'END:VEVENT',
    )
  }
  lines.push('END:VCALENDAR')
  return `${lines.join('\r\n')}\r\n`
}

/**
 * deleteAccount —— 注销账户。
 * 要求近期重新验证口令、再次输入用户名确认，随后删除用户并写审计。
 * @param {string} userId
 * @param {string} username
 * @param {string} token
 */
function deleteAccount(userId, username, token) {
  assertReauth(token)
  const user = database.prepare('SELECT * FROM users WHERE id = ?').get(userId)
  if (!user || user.username !== normalizeUsername(username)) throw fail(400, 'VALIDATION_ERROR', '请输入当前用户名确认')
  database.prepare('DELETE FROM users WHERE id = ?').run(userId)
  writeAudit({ actorId: userId, action: 'account_delete', result: 'success', requestId: crypto.randomUUID() })
}

/**
 * adminOverview —— 后台概览的聚合数据：
 * 用户数、设备数、近 7 日新增、注册/写入开关、备份时间。
 * @returns {object}
 */
function adminOverview() {
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000
  return {
    users: database.prepare(`SELECT COUNT(*) AS n FROM users WHERE role = 'user'`).get().n,
    devices: database.prepare('SELECT COUNT(*) AS n FROM devices').get().n,
    new_users_7d: database.prepare(`SELECT COUNT(*) AS n FROM users WHERE role = 'user' AND created_at >= ?`).get(weekAgo).n,
    registration_enabled: settingEnabled('registration_enabled'),
    writes_enabled: settingEnabled('writes_enabled'),
    backup_at: null,
  }
}

/**
 * listAdminUsers —— 后台查询普通用户（仅 role=user），
 * 支持按用户名与状态过滤。
 * @param {{q?:string, status?:string}}
 * @returns {object[]}
 */
function listAdminUsers({ q, status }) {
  const query = String(q || '').trim().toLowerCase()
  const rows = database.prepare(`
    SELECT u.id, u.username, u.role, u.status, u.created_at, u.last_login_at, u.version,
           (SELECT COUNT(*) FROM devices d WHERE d.user_id = u.id) AS device_count
    FROM users u
    WHERE u.role = 'user'
    ORDER BY u.created_at DESC
  `).all()
  return rows.filter((row) => {
    if (query && !row.username.includes(query)) return false
    if (status && status !== 'all' && row.status !== status) return false
    return true
  })
}

/**
 * 按 id 取普通用户（含设备数量），不存在或非普通用户抛 404。
 * @param {string} userId
 * @returns {object}
 */
function adminUser(userId) {
  const row = database.prepare(`
    SELECT u.id, u.username, u.role, u.status, u.created_at, u.last_login_at, u.version,
           (SELECT COUNT(*) FROM devices d WHERE d.user_id = u.id) AS device_count
    FROM users u WHERE u.id = ?
  `).get(userId)
  if (!row || row.role !== 'user') throw fail(404, 'NOT_FOUND', '账户不存在')
  return row
}

/**
 * setUserStatus —— 启用/停用普通用户（带 version 乐观锁）。
 * 停用时撤销其全部会话并写审计。
 * @param {string} actorId 操作者
 * @param {string} userId 目标用户
 * @param {string} status active / disabled
 * @param {number} version
 * @param {object} meta
 * @returns {object}
 */
function setUserStatus(actorId, userId, status, version, meta) {
  if (!['active', 'disabled'].includes(status)) throw fail(400, 'VALIDATION_ERROR', '状态不正确')
  const user = adminUser(userId)
  if (Number(version) !== user.version) throw fail(409, 'VERSION_CONFLICT', '账户已被修改，请刷新后再试')
  const now = Date.now()
  const result = database.prepare(`
    UPDATE users SET status = ?, updated_at = ?, version = version + 1 WHERE id = ? AND role = 'user' AND version = ?
  `).run(status, now, userId, user.version)
  if (result.changes !== 1) throw fail(409, 'VERSION_CONFLICT', '账户已被修改，请刷新后再试')
  if (status === 'disabled') database.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId)
  writeAudit({ ...meta, actorId, action: 'user_status_change', targetType: 'user', targetId: userId, result: 'success' })
  return adminUser(userId)
}

/**
 * 生成可读但不弱的重置密码：含大小写、数字和连字符，避开易混字符。
 * @returns {string}
 */
function generateUserResetPassword() {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
  const digits = '23456789'
  const pick = (set, count) => Array.from({ length: count }, () => set[crypto.randomInt(set.length)]).join('')
  return `Ld${pick(letters, 2)}${pick(digits, 2)}-${pick(letters, 4)}-${pick(digits, 4)}`
}

/**
 * resetUserPassword —— 把普通用户密码重置为随机密码。
 * 明文只在返回值里出现一次；同时作废恢复码并撤销全部会话。
 * @param {string} actorId
 * @param {string} userId
 * @param {number} version
 * @param {object} meta
 * @returns {{ user: object, password: string }}
 */
function resetUserPassword(actorId, userId, version, meta) {
  const user = adminUser(userId)
  if (Number(version) !== user.version) throw fail(409, 'VERSION_CONFLICT', '账户已被修改，请刷新后再试')
  const identity = database.prepare(`
    SELECT id FROM auth_identities WHERE user_id = ? AND provider = 'password'
  `).get(userId)
  if (!identity) throw fail(404, 'NOT_FOUND', '登录凭据不存在')
  const password = generateUserResetPassword()
  const now = Date.now()
  const tx = database.transaction(() => {
    const updated = database.prepare(`
      UPDATE users SET updated_at = ?, version = version + 1
      WHERE id = ? AND role = 'user' AND version = ?
    `).run(now, userId, user.version)
    if (updated.changes !== 1) throw fail(409, 'VERSION_CONFLICT', '账户已被修改，请刷新后再试')
    database.prepare(`
      UPDATE auth_identities
      SET password_hash = ?, recovery_code_hash = NULL, updated_at = ?
      WHERE id = ?
    `).run(bcrypt.hashSync(password, 10), now, identity.id)
    database.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId)
  })
  tx()
  writeAudit({
    ...meta,
    actorId,
    action: 'user_password_reset',
    targetType: 'user',
    targetId: userId,
    result: 'success',
  })
  return { user: adminUser(userId), password }
}

/**
 * 按 id 取后台账号，不存在或是普通用户时抛 404。
 * @param {string} userId
 * @returns {object}
 */
function adminAccount(userId) {
  const row = database.prepare(`
    SELECT id, username, role, status, created_at, last_login_at, version
    FROM users
    WHERE id = ? AND role IN (${access.staffInSql()})
  `).get(userId)
  if (!row) throw fail(404, 'NOT_FOUND', '管理员账号不存在')
  return row
}

/**
 * listAdminAccounts —— 列出全部后台账号，按权限从高到低排列。
 * @returns {object[]}
 */
function listAdminAccounts() {
  return database.prepare(`
    SELECT id, username, role, status, created_at, last_login_at, version
    FROM users
    WHERE role IN (${access.staffInSql()})
    ORDER BY ${access.roleOrderSql()}, created_at ASC
  `).all()
}

/**
 * 统计除指定账号外、处于启用状态的管理员数量，用于“最后管理员”保护。
 * @param {string} excludeId
 * @returns {number}
 */
function countOtherActiveOwners(excludeId) {
  return database.prepare(`
    SELECT COUNT(*) AS n FROM users
    WHERE role = 'admin' AND status = 'active' AND id <> ?
  `).get(excludeId).n
}

/**
 * 最后管理员保护：若目标是唯一启用中的管理员，
 * 任何会让它降级、停用或删除的操作都抛 409（LAST_ADMIN）。
 * @param {object} account 目标账号
 * @param {string|null} nextRole 变更后角色
 * @param {string|null} nextStatus 变更后状态
 */
function assertActiveOwnerPreserved(account, nextRole, nextStatus) {
  if (account.role !== 'admin' || account.status !== 'active') return
  if (nextRole === 'admin' && nextStatus === 'active') return
  if (countOtherActiveOwners(account.id) === 0) {
    throw fail(409, 'LAST_ADMIN', '至少需要保留一个启用状态的管理员')
  }
}

/**
 * 校验后台角色，普通用户不能从这里分配。
 * @param {string} role
 */
function assertValidAdminRole(role) {
  if (!access.isStaffRole(role)) {
    throw fail(400, 'VALIDATION_ERROR', '后台角色只能是管理员、运营、客服、审计或第三方')
  }
}

/**
 * 校验管理员口令长度为 8–128，否则抛 400。
 * @param {string} password
 */
function assertAdminPassword(password) {
  if (password.length < 8 || password.length > 128) {
    throw fail(400, 'VALIDATION_ERROR', '密码长度需为 8–128 位')
  }
}

/**
 * createAdminAccount —— 新增管理员账号（owner/operator）。
 * 校验用户名、口令、角色后，在事务内创建 users + auth_identities，并写审计。
 * @param {string} actorId
 * @param {{username:string, password:string, role:string}} data
 * @param {object} meta
 * @returns {object}
 */
function createAdminAccount(actorId, { username, password, role }, meta) {
  const name = normalizeUsername(username)
  if (!/^[a-z0-9_]{4,32}$/.test(name)) throw fail(400, 'VALIDATION_ERROR', '用户名需为 4–32 位小写字母、数字或下划线')
  const passwordText = String(password || '')
  assertAdminPassword(passwordText)
  const nextRole = String(role || '')
  assertValidAdminRole(nextRole)

  const now = Date.now()
  const userId = crypto.randomUUID()
  const tx = database.transaction(() => {
    try {
      const tenantId = defaultTenantId()
      const assigned = planDefaultsForTenant(database.prepare('SELECT * FROM tenants WHERE id = ?').get(tenantId))
      database.prepare(`
        INSERT INTO users (
          id, username, role, status, tenant_id, plan_id, device_limit, subscription_status,
          created_at, updated_at, version
        ) VALUES (?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, 1)
      `).run(
        userId,
        name,
        nextRole,
        tenantId,
        assigned.planId,
        assigned.deviceLimit,
        assigned.status,
        now,
        now,
      )
    } catch (error) {
      if (/UNIQUE constraint failed: users.username/.test(error.message)) {
        throw fail(409, 'USERNAME_TAKEN', '用户名已被使用')
      }
      throw error
    }
    database.prepare(`
      INSERT INTO auth_identities (
        id, user_id, provider, provider_key, password_hash, recovery_code_hash, created_at, updated_at
      ) VALUES (?, ?, 'password', ?, ?, NULL, ?, ?)
    `).run(crypto.randomUUID(), userId, name, bcrypt.hashSync(passwordText, 10), now, now)
  })
  tx()
  writeAudit({
    ...meta,
    actorId,
    action: 'admin_create',
    targetType: 'admin',
    targetId: userId,
    result: 'success',
    detail: { role: nextRole },
  })
  return adminAccount(userId)
}

/**
 * updateAdminAccount —— 修改管理员的角色与状态（带 version 乐观锁）。
 * 不允许对当前登录账号改角色或停用；同时受最后所有者保护。
 * @param {string} actorId
 * @param {string} userId
 * @param {{role?:string, status?:string, version:number}} data
 * @param {object} meta
 * @returns {object}
 */
function updateAdminAccount(actorId, userId, { role, status, version }, meta) {
  const account = adminAccount(userId)
  if (Number(version) !== account.version) throw fail(409, 'VERSION_CONFLICT', '管理员账号已被修改，请刷新后再试')

  const nextRole = role === undefined ? account.role : String(role)
  const nextStatus = status === undefined ? account.status : String(status)
  assertValidAdminRole(nextRole)
  if (!['active', 'disabled'].includes(nextStatus)) throw fail(400, 'VALIDATION_ERROR', '状态不正确')

  if (account.id === actorId) {
    if (nextRole !== account.role) throw fail(409, 'SELF_ACTION', '不能修改当前登录账号的角色')
    if (nextStatus === 'disabled') throw fail(409, 'SELF_ACTION', '不能停用当前登录账号')
  }
  assertActiveOwnerPreserved(account, nextRole, nextStatus)

  const now = Date.now()
  const result = database.prepare(`
    UPDATE users
    SET role = ?, status = ?, updated_at = ?, version = version + 1
    WHERE id = ? AND role IN (${access.staffInSql()}) AND version = ?
  `).run(nextRole, nextStatus, now, userId, account.version)
  if (result.changes !== 1) throw fail(409, 'VERSION_CONFLICT', '管理员账号已被修改，请刷新后再试')
  if (nextStatus === 'disabled') database.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId)
  writeAudit({
    ...meta,
    actorId,
    action: 'admin_update',
    targetType: 'admin',
    targetId: userId,
    result: 'success',
    detail: { role: nextRole, status: nextStatus },
  })
  return adminAccount(userId)
}

/**
 * resetAdminPassword —— 重置管理员口令。
 * 重置他人会撤销其全部会话；重置自己时保留当前会话（keepToken），其余设备退出。
 * @param {string} actorId
 * @param {string} userId
 * @param {string} password
 * @param {number} version
 * @param {object} meta
 * @param {string} [keepToken] 需保留的当前会话令牌
 * @returns {object}
 */
function resetAdminPassword(actorId, userId, password, version, meta, keepToken = '') {
  const account = adminAccount(userId)
  if (Number(version) !== account.version) throw fail(409, 'VERSION_CONFLICT', '管理员账号已被修改，请刷新后再试')
  const passwordText = String(password || '')
  assertAdminPassword(passwordText)
  const identity = database.prepare(`
    SELECT id FROM auth_identities WHERE user_id = ? AND provider = 'password'
  `).get(userId)
  if (!identity) throw fail(404, 'NOT_FOUND', '管理员登录凭据不存在')

  const now = Date.now()
  const tx = database.transaction(() => {
    const updated = database.prepare(`
      UPDATE users SET updated_at = ?, version = version + 1
      WHERE id = ? AND role IN (${access.staffInSql()}) AND version = ?
    `).run(now, userId, account.version)
    if (updated.changes !== 1) throw fail(409, 'VERSION_CONFLICT', '管理员账号已被修改，请刷新后再试')
    database.prepare(`
      UPDATE auth_identities SET password_hash = ?, recovery_code_hash = NULL, updated_at = ? WHERE id = ?
    `).run(bcrypt.hashSync(passwordText, 10), now, identity.id)
    if (userId === actorId && keepToken) {
      database.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?').run(userId, sha256(keepToken))
    } else {
      database.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId)
    }
  })
  tx()
  writeAudit({
    ...meta,
    actorId,
    action: 'admin_password_reset',
    targetType: 'admin',
    targetId: userId,
    result: 'success',
    detail: { self: userId === actorId },
  })
  return adminAccount(userId)
}

/**
 * deleteAdminAccount —— 删除管理员账号。
 * 不允许删除当前登录账号，并受最后所有者保护；删除后写审计。
 * @param {string} actorId
 * @param {string} userId
 * @param {number} version
 * @param {object} meta
 */
function deleteAdminAccount(actorId, userId, version, meta) {
  const account = adminAccount(userId)
  if (Number(version) !== account.version) throw fail(409, 'VERSION_CONFLICT', '管理员账号已被修改，请刷新后再试')
  if (account.id === actorId) throw fail(409, 'SELF_ACTION', '不能删除当前登录账号')
  assertActiveOwnerPreserved(account, null, null)
  const result = database.prepare(`
    DELETE FROM users WHERE id = ? AND role IN (${access.staffInSql()}) AND version = ?
  `).run(userId, account.version)
  if (result.changes !== 1) throw fail(409, 'VERSION_CONFLICT', '管理员账号已被修改，请刷新后再试')
  writeAudit({
    ...meta,
    actorId,
    action: 'admin_delete',
    targetType: 'admin',
    targetId: userId,
    result: 'success',
    detail: { username: account.username, role: account.role },
  })
}

/**
 * listInvites —— 列出全部邀请码（按创建时间倒序）。
 * @returns {object[]}
 */
function listInvites() {
  return database.prepare(`
    SELECT id, max_uses, used_count, expires_at, revoked_at, created_at
    FROM invite_codes ORDER BY created_at DESC
  `).all()
}

/**
 * createInvite —— 创建邀请码。
 * 校验可用次数（1–20）与到期日，生成去除易混淆字符的明文码，
 * 库里只存哈希；明文仅本次返回。
 * @param {string} actorId
 * @param {{maxUses:number, expiresOn:string}} data
 * @param {object} meta
 * @returns {{id:string, code:string, max_uses:number, expires_at:number}}
 */
function createInvite(actorId, { maxUses, expiresOn }, meta) {
  const uses = Number(maxUses)
  if (!Number.isInteger(uses) || uses < 1 || uses > 20) throw fail(400, 'VALIDATION_ERROR', '可用次数需为 1–20')
  if (!dates.isDate(expiresOn) || expiresOn < dates.today()) throw fail(400, 'VALIDATION_ERROR', '有效期不能早于今天')
  const [year, month, day] = expiresOn.split('-').map(Number)
  const expiresAt = Date.UTC(year, month - 1, day, 15, 59, 59)
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let plain = ''
  const bytes = crypto.randomBytes(8)
  for (const byte of bytes) plain += alphabet[byte % alphabet.length]
  const code = `${plain.slice(0, 4)}-${plain.slice(4, 8)}`
  const id = crypto.randomUUID()
  database.prepare(`
    INSERT INTO invite_codes (id, code_hash, max_uses, used_count, expires_at, created_by, created_at)
    VALUES (?, ?, ?, 0, ?, ?, ?)
  `).run(id, sha256(code), uses, expiresAt, actorId, Date.now())
  writeAudit({ ...meta, actorId, action: 'invite_create', targetType: 'invite', targetId: id, result: 'success' })
  return { id, code, max_uses: uses, expires_at: expiresAt }
}

/**
 * revokeInvite —— 撤销邀请（幂等，已撤销不重复处理）。
 * @param {string} actorId
 * @param {string} inviteId
 * @param {object} meta
 * @returns {object}
 */
function revokeInvite(actorId, inviteId, meta) {
  const invite = database.prepare('SELECT * FROM invite_codes WHERE id = ?').get(inviteId)
  if (!invite) throw fail(404, 'NOT_FOUND', '邀请不存在')
  if (!invite.revoked_at) {
    database.prepare('UPDATE invite_codes SET revoked_at = ? WHERE id = ?').run(Date.now(), inviteId)
    writeAudit({ ...meta, actorId, action: 'invite_revoke', targetType: 'invite', targetId: inviteId, result: 'success' })
  }
  return database.prepare('SELECT id, max_uses, used_count, expires_at, revoked_at, created_at FROM invite_codes WHERE id = ?').get(inviteId)
}

/**
 * getSettings —— 读取全部运营配置，解析出 value 与版本。
 * @returns {object[]}
 */
function getSettings() {
  return database.prepare('SELECT key, value_json, version, updated_at FROM app_settings ORDER BY key').all().map((row) => ({
    key: row.key,
    value: JSON.parse(row.value_json),
    version: row.version,
    updated_at: row.updated_at,
  }))
}

/**
 * setSetting —— 修改单个运营配置（仅布尔值，带 version 乐观锁），并写审计。
 * @param {string} actorId
 * @param {string} key
 * @param {boolean} value
 * @param {number} version
 * @param {object} meta
 * @returns {object}
 */
function setSetting(actorId, key, value, version, meta) {
  if (!['registration_enabled', 'writes_enabled'].includes(key)) throw fail(404, 'NOT_FOUND', '没有这项配置')
  if (typeof value !== 'boolean') throw fail(400, 'VALIDATION_ERROR', '配置值必须是布尔值')
  const result = database.prepare(`
    UPDATE app_settings SET value_json = ?, version = version + 1, updated_by = ?, updated_at = ?
    WHERE key = ? AND version = ?
  `).run(JSON.stringify(value), actorId, Date.now(), key, Number(version))
  if (result.changes !== 1) throw fail(409, 'VERSION_CONFLICT', '配置已被修改，请刷新后再保存')
  writeAudit({ ...meta, actorId, action: 'settings_update', targetType: 'setting', targetId: key, result: 'success' })
  return getSettings().find((item) => item.key === key)
}

/**
 * listAudit —— 读取最近 50 条审计记录（带操作者用户名）。
 * @returns {object[]}
 */
function columnExists(table, column) {
  return database.prepare(`PRAGMA table_info(${table})`).all().some((item) => item.name === column)
}

/**
 * 补齐工作区表，并把还没有工作区的账号归入默认工作区。
 * 默认工作区使用专业版，保持原来每账号 100 台设备的额度。
 */
function ensureSaas() {
  database.exec(`
    CREATE TABLE IF NOT EXISTS tenants (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      plan TEXT NOT NULL CHECK (plan IN ('free', 'pro', 'enterprise')),
      status TEXT NOT NULL CHECK (status IN ('trialing', 'active', 'past_due', 'canceled')),
      seat_limit INTEGER NOT NULL,
      device_limit INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      version INTEGER NOT NULL DEFAULT 1
    );
  `)
  if (!columnExists('users', 'tenant_id')) {
    database.exec('ALTER TABLE users ADD COLUMN tenant_id TEXT')
  }
  let tenant = database.prepare(`SELECT id FROM tenants WHERE slug = 'default'`).get()
  if (!tenant) {
    const now = Date.now()
    const members = database.prepare(`SELECT COUNT(*) AS n FROM users WHERE role = 'user'`).get().n
    const id = crypto.randomUUID()
    database.prepare(`
      INSERT INTO tenants (
        id, name, slug, plan, status, seat_limit, device_limit, created_at, updated_at, version
      ) VALUES (?, '默认工作区', 'default', 'pro', 'active', ?, 100, ?, ?, 1)
    `).run(id, Math.max(20, members), now, now)
    tenant = { id }
  }
  database.prepare('UPDATE users SET tenant_id = ? WHERE tenant_id IS NULL').run(tenant.id)
  relaxTenantPlanCheck()
  ensurePlans()
  if (!columnExists('users', 'plan_id')) database.exec('ALTER TABLE users ADD COLUMN plan_id TEXT')
  if (!columnExists('users', 'device_limit')) database.exec('ALTER TABLE users ADD COLUMN device_limit INTEGER')
  if (!columnExists('users', 'subscription_status')) {
    database.exec('ALTER TABLE users ADD COLUMN subscription_status TEXT')
  }
  if (!columnExists('users', 'plan_override')) {
    database.exec('ALTER TABLE users ADD COLUMN plan_override INTEGER NOT NULL DEFAULT 0')
  }
  database.prepare(`
    UPDATE users
    SET plan_id = (
      SELECT p.id FROM plans p
      JOIN tenants t ON t.plan = p.key
      WHERE t.id = users.tenant_id
    )
    WHERE plan_id IS NULL
  `).run()
  database.prepare(`
    UPDATE users
    SET device_limit = (SELECT t.device_limit FROM tenants t WHERE t.id = users.tenant_id)
    WHERE device_limit IS NULL
  `).run()
  database.prepare(`
    UPDATE users
    SET subscription_status = (SELECT t.status FROM tenants t WHERE t.id = users.tenant_id)
    WHERE subscription_status IS NULL OR subscription_status = ''
  `).run()
  database.prepare(`
    UPDATE tenants
    SET seat_limit = (SELECT seats FROM plans WHERE key = tenants.plan),
        device_limit = (SELECT devices FROM plans WHERE key = tenants.plan)
    WHERE EXISTS (SELECT 1 FROM plans WHERE key = tenants.plan)
  `).run()
  database.prepare(`
    UPDATE users
    SET device_limit = (SELECT devices FROM plans WHERE id = users.plan_id)
    WHERE plan_id IS NOT NULL
  `).run()
  database.prepare(`
    UPDATE users
    SET plan_override = 1
    WHERE plan_override = 0
      AND plan_id IS NOT (
        SELECT p.id FROM plans p
        JOIN tenants t ON t.plan = p.key
        WHERE t.id = users.tenant_id
      )
  `).run()
}

/** 去掉套餐键的固定枚举，自定义套餐才能写进工作区默认套餐。 */
function relaxTenantPlanCheck() {
  const row = database.prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'tenants'`).get()
  if (!row || !String(row.sql).includes("plan IN ('free', 'pro', 'enterprise')")) return
  database.exec(`
    CREATE TABLE tenants_next (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      plan TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('trialing', 'active', 'past_due', 'canceled')),
      seat_limit INTEGER NOT NULL,
      device_limit INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      version INTEGER NOT NULL DEFAULT 1
    );
    INSERT INTO tenants_next (
      id, name, slug, plan, status, seat_limit, device_limit, created_at, updated_at, version
    )
    SELECT id, name, slug, plan, status, seat_limit, device_limit, created_at, updated_at, version
    FROM tenants;
    DROP TABLE tenants;
    ALTER TABLE tenants_next RENAME TO tenants;
  `)
}

/** 把内置套餐写入目录。已有同名键的不覆盖，避免改掉管理员改过的说明。 */
function ensurePlans() {
  database.exec(`
    CREATE TABLE IF NOT EXISTS plans (
      id TEXT PRIMARY KEY,
      key TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      seats INTEGER NOT NULL,
      devices INTEGER NOT NULL,
      builtin INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      version INTEGER NOT NULL DEFAULT 1
    );
  `)
  const insert = database.prepare(`
    INSERT INTO plans (
      id, key, name, description, seats, devices, builtin, created_at, updated_at, version
    ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, 1)
    ON CONFLICT(key) DO NOTHING
  `)
  const now = Date.now()
  for (const plan of saas.catalog()) {
    insert.run(crypto.randomUUID(), plan.key, plan.name, plan.description, plan.seats, plan.devices, now, now)
  }
}

function defaultTenantId() {
  return database.prepare(`SELECT id FROM tenants WHERE slug = 'default'`).get().id
}

function tenantByUser(userId) {
  return database.prepare(`
    SELECT t.* FROM tenants t
    JOIN users u ON u.tenant_id = t.id
    WHERE u.id = ?
  `).get(userId) || null
}

function tenantIdForInvite(invite) {
  if (invite?.created_by) {
    const creator = database.prepare('SELECT tenant_id FROM users WHERE id = ?').get(invite.created_by)
    if (creator?.tenant_id) return creator.tenant_id
  }
  return defaultTenantId()
}

function planByKey(key) {
  if (!key) return null
  return database.prepare('SELECT * FROM plans WHERE key = ?').get(key) || null
}

function planDefaultsForTenant(tenant) {
  const plan = tenant ? planByKey(tenant.plan) : null
  return {
    planId: plan?.id || null,
    deviceLimit: plan?.devices || tenant?.device_limit || 100,
    status: tenant?.status || 'active',
  }
}

/**
 * 某个账号当前生效的套餐。设备额度和订阅状态以账号上的分配为准。
 * @param {string} userId
 * @returns {object|null}
 */
function userEntitlement(userId) {
  const row = database.prepare(`
    SELECT u.id, u.plan_id, u.device_limit AS user_device_limit, u.subscription_status,
           t.id AS tenant_id, t.name, t.slug, t.plan AS tenant_plan, t.status AS tenant_status,
           t.seat_limit, t.device_limit AS tenant_device_limit
    FROM users u
    LEFT JOIN tenants t ON t.id = u.tenant_id
    WHERE u.id = ?
  `).get(userId)
  if (!row?.tenant_id) return null
  const plan = row.plan_id
    ? database.prepare('SELECT * FROM plans WHERE id = ?').get(row.plan_id)
    : planByKey(row.tenant_plan)
  return {
    tenant_id: row.tenant_id,
    name: row.name,
    slug: row.slug,
    plan,
    device_limit: plan?.devices || row.user_device_limit || row.tenant_device_limit || 100,
    status: row.subscription_status || row.tenant_status || 'active',
    seat_limit: row.seat_limit,
  }
}

function workspaceSummary(row) {
  if (!row?.id) return null
  const entitlement = userEntitlement(row.id)
  if (!entitlement) return null
  const deviceCount = database.prepare('SELECT COUNT(*) AS n FROM devices WHERE user_id = ?').get(row.id).n
  const memberCount = database.prepare(`
    SELECT COUNT(*) AS n FROM users WHERE tenant_id = ? AND role = 'user'
  `).get(entitlement.tenant_id).n
  return {
    id: entitlement.tenant_id,
    name: entitlement.name,
    slug: entitlement.slug,
    plan: entitlement.plan?.key || 'pro',
    status: entitlement.status,
    seat_limit: entitlement.seat_limit,
    device_limit: entitlement.device_limit,
    plan_name: entitlement.plan?.name || '专业版',
    device_count: deviceCount,
    member_count: memberCount,
  }
}

/**
 * listSaas —— 套餐目录和各工作区用量。设备数只做汇总，不返回私人台账。
 * @returns {{plans: object[], tenants: object[]}}
 */
function presentPlan(row) {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    description: row.description,
    seats: row.seats,
    devices: row.devices,
    builtin: row.builtin === 1,
    version: row.version,
  }
}

const SAAS_ACCOUNT_SELECT = `
  SELECT u.id, u.username, u.role, u.plan_id, u.device_limit, u.subscription_status, u.plan_override, u.version,
         p.key AS plan_key, p.name AS plan_name,
         (SELECT COUNT(*) FROM devices d WHERE d.user_id = u.id) AS device_count
  FROM users u
  LEFT JOIN plans p ON p.id = u.plan_id
`

function presentSaasAccount(row) {
  return { ...row, plan_override: row.plan_override === 1 }
}

function pageSizeNumber(value) {
  if (value === undefined || value === '') return 10
  const number = Number(value)
  if (!Number.isInteger(number) || number < 1 || number > 50) {
    throw fail(400, 'VALIDATION_ERROR', '每页条数需为 1–50 的整数')
  }
  return number
}

function pageNumber(value, total, size) {
  const pages = Math.max(1, Math.ceil(total / size))
  if (value === undefined || value === '') return 1
  const number = Number(value)
  if (!Number.isInteger(number) || number < 1) throw fail(400, 'VALIDATION_ERROR', '页码不正确')
  return Math.min(number, pages)
}

/**
 * 按账号、角色名或套餐名查询可分配账号，并分页。
 * @param {{q?: string, page?: number|string, pageSize?: number|string, all?: boolean}} [query]
 * @returns {{items: object[], total: number, page: number, page_size: number}}
 */
function listSaasAccounts({ q, page, pageSize, all } = {}) {
  const query = String(q || '').trim().toLowerCase()
  const params = []
  let where = ''
  if (query) {
    const like = `%${query.replace(/[\\%_]/g, (char) => `\\${char}`)}%`
    const roles = access.catalog().roles
      .filter((role) => role.key.includes(query) || role.name.toLowerCase().includes(query))
      .map((role) => role.key)
    const roleSql = roles.length ? ` OR u.role IN (${roles.map(() => '?').join(', ')})` : ''
    where = `WHERE (lower(u.username) LIKE ? ESCAPE '\\' OR lower(IFNULL(p.name, '')) LIKE ? ESCAPE '\\'${roleSql})`
    params.push(like, like, ...roles)
  }
  const total = database.prepare(`
    SELECT COUNT(*) AS n
    FROM users u
    LEFT JOIN plans p ON p.id = u.plan_id
    ${where}
  `).get(...params).n
  const size = all ? Math.max(total, 1) : pageSizeNumber(pageSize)
  const current = all ? 1 : pageNumber(page, total, size)
  const limitSql = all ? '' : 'LIMIT ? OFFSET ?'
  const limitParams = all ? [] : [size, (current - 1) * size]
  const items = database.prepare(`
    ${SAAS_ACCOUNT_SELECT}
    ${where}
    ORDER BY u.created_at ASC, u.username ASC
    ${limitSql}
  `).all(...params, ...limitParams).map(presentSaasAccount)
  return { items, total, page: current, page_size: all ? total : size }
}

function saasAccountById(userId) {
  const row = database.prepare(`${SAAS_ACCOUNT_SELECT} WHERE u.id = ?`).get(userId)
  return row ? presentSaasAccount(row) : null
}

function listSaas() {
  return {
    plans: database.prepare('SELECT * FROM plans ORDER BY builtin DESC, created_at ASC').all().map(presentPlan),
    tenants: database.prepare(`
      SELECT t.*,
        (SELECT COUNT(*) FROM users u WHERE u.tenant_id = t.id AND u.role = 'user') AS member_count,
        (SELECT COUNT(*) FROM devices d
           JOIN users u ON u.id = d.user_id
          WHERE u.tenant_id = t.id) AS device_count
      FROM tenants t
      ORDER BY t.created_at ASC
    `).all(),
    accounts: listSaasAccounts({ all: true }).items,
  }
}

/**
 * 校验可手填的额度：正整数，上限 100 万。
 * @param {number|string} value
 * @param {string} label
 * @returns {number}
 */
function quotaNumber(value, label) {
  const number = Number(value)
  if (!Number.isInteger(number) || number < 1 || number > 1000000) {
    throw fail(400, 'VALIDATION_ERROR', `${label}需为 1–1000000 的整数`)
  }
  return number
}

/**
 * updateTenant —— 为工作区选择套餐和订阅状态。
 * 席位和设备额度只来自所选套餐，不在工作区上另写一套数字。
 * @param {string} actorId
 * @param {string} tenantId
 * @param {{plan?: string, status?: string, version: number}} data
 * @param {object} meta
 * @returns {object}
 */
function updateTenant(actorId, tenantId, { plan, status, version }, meta) {
  const current = database.prepare('SELECT * FROM tenants WHERE id = ?').get(tenantId)
  if (!current) throw fail(404, 'NOT_FOUND', '工作区不存在')
  if (Number(version) !== current.version) throw fail(409, 'VERSION_CONFLICT', '工作区已被修改，请刷新后再试')
  const nextPlan = plan === undefined ? current.plan : String(plan)
  const nextStatus = status === undefined ? current.status : String(status)
  const planRecord = planByKey(nextPlan)
  if (!planRecord) throw fail(400, 'VALIDATION_ERROR', '套餐不正确')
  if (!saas.STATUSES.includes(nextStatus)) throw fail(400, 'VALIDATION_ERROR', '订阅状态不正确')
  const nextSeats = planRecord.seats
  const nextDevices = planRecord.devices
  const now = Date.now()
  const updated = database.prepare(`
    UPDATE tenants
    SET plan = ?, status = ?, seat_limit = ?, device_limit = ?, updated_at = ?, version = version + 1
    WHERE id = ? AND version = ?
  `).run(nextPlan, nextStatus, nextSeats, nextDevices, now, tenantId, current.version)
  if (updated.changes !== 1) throw fail(409, 'VERSION_CONFLICT', '工作区已被修改，请刷新后再试')
  database.prepare(`
    UPDATE users
    SET plan_id = ?, device_limit = ?, subscription_status = ?, updated_at = ?, version = version + 1
    WHERE tenant_id = ? AND plan_override = 0
  `).run(planRecord.id, nextDevices, nextStatus, now, tenantId)
  writeAudit({
    ...meta,
    actorId,
    action: 'saas_update',
    targetType: 'tenant',
    targetId: tenantId,
    result: 'success',
    detail: { plan: nextPlan, status: nextStatus, seat_limit: nextSeats, device_limit: nextDevices },
  })
  return listSaas().tenants.find((item) => item.id === tenantId)
}

/**
 * createSaasPlan —— 新增一个可分配的套餐。
 * 席位和设备数属于这个套餐，选用它的工作区和账号都用这组额度。
 * @param {string} actorId
 * @param {{name?: string, description?: string, seats?: number, devices?: number}} data
 * @param {object} meta
 * @returns {object}
 */
function createSaasPlan(actorId, { name, description, seats, devices }, meta) {
  const title = String(name || '').trim()
  if (title.length < 1 || title.length > 32) throw fail(400, 'VALIDATION_ERROR', '套餐名称需为 1–32 个字')
  const text = String(description || '').trim()
  if (text.length > 200) throw fail(400, 'VALIDATION_ERROR', '套餐说明不能超过 200 字')
  const seatLimit = quotaNumber(seats, '席位')
  const deviceLimit = quotaNumber(devices, '每账号设备数')
  const now = Date.now()
  const id = crypto.randomUUID()
  const key = `custom-${crypto.randomBytes(4).toString('hex')}`
  database.prepare(`
    INSERT INTO plans (
      id, key, name, description, seats, devices, builtin, created_at, updated_at, version
    ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, 1)
  `).run(id, key, title, text, seatLimit, deviceLimit, now, now)
  writeAudit({
    ...meta,
    actorId,
    action: 'saas_plan_create',
    targetType: 'plan',
    targetId: id,
    result: 'success',
    detail: { name: title, seats: seatLimit, devices: deviceLimit },
  })
  return presentPlan(database.prepare('SELECT * FROM plans WHERE id = ?').get(id))
}

/**
 * updateSaasPlan —— 只修改一个套餐自己的额度。
 * 正在使用该套餐的工作区和账号会跟着变，其他套餐不动。
 * @param {string} actorId
 * @param {string} planId
 * @param {{seats?: number, devices?: number, version: number}} data
 * @param {object} meta
 * @returns {object}
 */
function updateSaasPlan(actorId, planId, { seats, devices, version }, meta) {
  const current = database.prepare('SELECT * FROM plans WHERE id = ?').get(planId)
  if (!current) throw fail(404, 'NOT_FOUND', '套餐不存在')
  if (Number(version) !== current.version) throw fail(409, 'VERSION_CONFLICT', '套餐已被修改，请刷新后再试')
  const seatLimit = quotaNumber(seats, '席位')
  const deviceLimit = quotaNumber(devices, '每账号设备数')
  const now = Date.now()
  const updated = database.prepare(`
    UPDATE plans
    SET seats = ?, devices = ?, updated_at = ?, version = version + 1
    WHERE id = ? AND version = ?
  `).run(seatLimit, deviceLimit, now, planId, current.version)
  if (updated.changes !== 1) throw fail(409, 'VERSION_CONFLICT', '套餐已被修改，请刷新后再试')
  database.prepare(`
    UPDATE tenants
    SET seat_limit = ?, device_limit = ?, updated_at = ?, version = version + 1
    WHERE plan = ?
  `).run(seatLimit, deviceLimit, now, current.key)
  database.prepare(`
    UPDATE users
    SET device_limit = ?, updated_at = ?, version = version + 1
    WHERE plan_id = ?
  `).run(deviceLimit, now, planId)
  writeAudit({
    ...meta,
    actorId,
    action: 'saas_plan_update',
    targetType: 'plan',
    targetId: planId,
    result: 'success',
    detail: { seats: seatLimit, devices: deviceLimit },
  })
  return presentPlan(database.prepare('SELECT * FROM plans WHERE id = ?').get(planId))
}

/**
 * assignUserPlan —— 把套餐分配给一个账号，不影响其他账号。
 * @param {string} actorId
 * @param {string} userId
 * 单独控制时写入这个账号自己的套餐。关闭单独控制时恢复为工作区默认套餐。
 * @param {{planId?: string, deviceLimit?: number, status?: string, followDefault?: boolean, version: number}} data
 * @param {object} meta
 * @returns {object}
 */
function assignUserPlan(actorId, userId, { planId, status, followDefault, version }, meta) {
  const current = database.prepare('SELECT * FROM users WHERE id = ?').get(userId)
  if (!current) throw fail(404, 'NOT_FOUND', '账号不存在')
  if (Number(version) !== current.version) throw fail(409, 'VERSION_CONFLICT', '账号已被修改，请刷新后再试')
  const now = Date.now()
  let plan = null
  let nextStatus = String(status || '')
  let nextDevices
  let override = 1
  if (followDefault) {
    const tenant = database.prepare('SELECT * FROM tenants WHERE id = ?').get(current.tenant_id)
    const assigned = planDefaultsForTenant(tenant)
    plan = assigned.planId ? database.prepare('SELECT * FROM plans WHERE id = ?').get(assigned.planId) : null
    if (!plan) throw fail(400, 'VALIDATION_ERROR', '套餐不正确')
    nextStatus = assigned.status
    nextDevices = assigned.deviceLimit
    override = 0
  } else {
    plan = database.prepare('SELECT * FROM plans WHERE id = ?').get(String(planId || ''))
    if (!plan) throw fail(400, 'VALIDATION_ERROR', '套餐不正确')
    if (!saas.STATUSES.includes(nextStatus)) throw fail(400, 'VALIDATION_ERROR', '订阅状态不正确')
    nextDevices = plan.devices
  }
  const updated = database.prepare(`
    UPDATE users
    SET plan_id = ?, device_limit = ?, subscription_status = ?, plan_override = ?, updated_at = ?, version = version + 1
    WHERE id = ? AND version = ?
  `).run(plan.id, nextDevices, nextStatus, override, now, userId, current.version)
  if (updated.changes !== 1) throw fail(409, 'VERSION_CONFLICT', '账号已被修改，请刷新后再试')
  writeAudit({
    ...meta,
    actorId,
    action: 'saas_assign',
    targetType: 'user',
    targetId: userId,
    result: 'success',
    detail: { plan: plan.key, status: nextStatus, device_limit: nextDevices },
  })
  return saasAccountById(userId)
}

const LEDGER_CATEGORIES = {
  expense: [
    ['food', '餐饮'],
    ['transport', '交通'],
    ['shopping', '购物'],
    ['housing', '居住'],
    ['daily', '日用'],
    ['fun', '娱乐'],
    ['medical', '医疗'],
    ['study', '学习'],
    ['social', '人情'],
    ['other', '其他'],
  ],
  income: [
    ['salary', '工资'],
    ['bonus', '奖金'],
    ['refund', '退款'],
    ['redpacket', '红包'],
    ['other', '其他'],
  ],
}

function ledgerCatalog() {
  return {
    expense: LEDGER_CATEGORIES.expense.map(([key, label]) => ({ key, label })),
    income: LEDGER_CATEGORIES.income.map(([key, label]) => ({ key, label })),
  }
}

function ledgerCategoryLabel(kind, category) {
  const found = (LEDGER_CATEGORIES[kind] || []).find((item) => item[0] === category)
  return found ? found[1] : category
}

function formatYuan(cents) {
  const abs = Math.abs(cents)
  return `${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`
}

function amountCents(value) {
  const text = String(value ?? '').trim()
  if (!/^\d{1,8}(\.\d{1,2})?$/.test(text)) throw fail(400, 'VALIDATION_ERROR', '金额需为最多两位小数的正数')
  const [yuan, frac = ''] = text.split('.')
  const cents = Number(yuan) * 100 + Number((frac + '00').slice(0, 2))
  if (!Number.isSafeInteger(cents) || cents < 1 || cents > 1000000000) {
    throw fail(400, 'VALIDATION_ERROR', '金额需在 0.01–10000000 元之间')
  }
  return cents
}

function ledgerMonth(value) {
  const month = String(value || dates.today().slice(0, 7)).trim()
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw fail(400, 'VALIDATION_ERROR', '月份不正确')
  return month
}

function nextMonthStart(month) {
  const [year, mon] = month.split('-').map(Number)
  const date = new Date(Date.UTC(year, mon, 1))
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-01`
}

function shiftUtcDate(date, days) {
  const [year, month, day] = date.split('-').map(Number)
  const next = new Date(Date.UTC(year, month - 1, day + days))
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-${String(next.getUTCDate()).padStart(2, '0')}`
}

function ledgerDate(value, label) {
  const date = String(value || '').trim()
  if (!dates.isDate(date) || date < '2000-01-01' || date > '2100-12-31') {
    throw fail(400, 'VALIDATION_ERROR', `${label}不正确`)
  }
  return date
}

/** 月份或闭区间。区间最长 366 天，结束日当天计入。返回的 until 是开区间上界。 */
function ledgerSpan(input) {
  const source = typeof input === 'string' ? { month: input } : (input || {})
  const fromText = String(source.from || '').trim()
  const toText = String(source.to || '').trim()
  if (fromText || toText) {
    if (!fromText || !toText) throw fail(400, 'VALIDATION_ERROR', '请同时填写开始和结束日期')
    const from = ledgerDate(fromText, '开始日期')
    const to = ledgerDate(toText, '结束日期')
    if (from > to) throw fail(400, 'VALIDATION_ERROR', '开始日期不能晚于结束日期')
    const length = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000)
    if (length > 366) throw fail(400, 'VALIDATION_ERROR', '区间最长 366 天')
    return { from, to, until: shiftUtcDate(to, 1), month: null }
  }
  const month = ledgerMonth(source.month)
  const until = nextMonthStart(month)
  return { from: `${month}-01`, to: shiftUtcDate(until, -1), until, month }
}

function presentLedgerEntry(row) {
  return {
    id: row.id,
    user_id: row.user_id,
    username: row.username || null,
    kind: row.kind,
    category: row.category,
    category_label: ledgerCategoryLabel(row.kind, row.category),
    amount_cents: row.amount_cents,
    amount: formatYuan(row.amount_cents),
    occurred_on: row.occurred_on,
    note: row.note,
    created_at: row.created_at,
    updated_at: row.updated_at,
    version: row.version,
  }
}

function cleanLedgerInput(input) {
  const kind = String(input.kind || '')
  if (!LEDGER_CATEGORIES[kind]) throw fail(400, 'VALIDATION_ERROR', '请选择支出或收入')
  const category = String(input.category || '')
  if (!LEDGER_CATEGORIES[kind].some((item) => item[0] === category)) {
    throw fail(400, 'VALIDATION_ERROR', '分类不正确')
  }
  const occurredOn = String(input.occurred_on || '').trim()
  if (!dates.isDate(occurredOn) || occurredOn < '2000-01-01' || occurredOn > '2100-12-31') {
    throw fail(400, 'VALIDATION_ERROR', '日期不正确')
  }
  const note = String(input.note || '').trim()
  if (note.length > 200) throw fail(400, 'VALIDATION_ERROR', '备注不能超过 200 字')
  return { kind, category, amountCents: amountCents(input.amount), occurredOn, note }
}

function ledgerSummary(where, params) {
  const rows = database.prepare(`
    SELECT e.kind, COALESCE(SUM(e.amount_cents), 0) AS amount_cents
    FROM ledger_entries e
    JOIN users u ON u.id = e.user_id
    ${where}
    GROUP BY e.kind
  `).all(...params)
  const expense = rows.find((row) => row.kind === 'expense')?.amount_cents || 0
  const income = rows.find((row) => row.kind === 'income')?.amount_cents || 0
  return {
    expense_cents: expense,
    income_cents: income,
    balance_cents: income - expense,
    expense: formatYuan(expense),
    income: formatYuan(income),
    balance: `${income - expense < 0 ? '-' : ''}${formatYuan(income - expense)}`,
  }
}

function categoryStats(where, params) {
  const rows = database.prepare(`
    SELECT e.kind, e.category, SUM(e.amount_cents) AS amount_cents
    FROM ledger_entries e
    JOIN users u ON u.id = e.user_id
    ${where}
    GROUP BY e.kind, e.category
    ORDER BY amount_cents DESC
  `).all(...params)
  const totals = { expense: 0, income: 0 }
  for (const row of rows) totals[row.kind] += row.amount_cents
  return rows.map((row) => ({
    kind: row.kind,
    category: row.category,
    category_label: ledgerCategoryLabel(row.kind, row.category),
    amount_cents: row.amount_cents,
    amount: formatYuan(row.amount_cents),
    share: totals[row.kind] ? Math.round((row.amount_cents * 100) / totals[row.kind]) : 0,
  }))
}

function dailyStats(where, params) {
  return database.prepare(`
    SELECT e.occurred_on AS date,
      SUM(CASE WHEN e.kind = 'expense' THEN e.amount_cents ELSE 0 END) AS expense_cents,
      SUM(CASE WHEN e.kind = 'income' THEN e.amount_cents ELSE 0 END) AS income_cents
    FROM ledger_entries e
    JOIN users u ON u.id = e.user_id
    ${where}
    GROUP BY e.occurred_on
    ORDER BY e.occurred_on ASC
  `).all(...params).map((row) => ({
    date: row.date,
    expense_cents: row.expense_cents,
    income_cents: row.income_cents,
    expense: formatYuan(row.expense_cents),
    income: formatYuan(row.income_cents),
  }))
}

/**
 * listLedger —— 当前用户一段日期内的账。可传月份，或 from/to 闭区间，并返回分类占比和按日合计。
 * @param {string} userId
 * @param {string|{month?: string, from?: string, to?: string}} [query]
 */
function listLedger(userId, query) {
  const span = ledgerSpan(query)
  const where = 'WHERE e.user_id = ? AND e.occurred_on >= ? AND e.occurred_on < ?'
  const params = [userId, span.from, span.until]
  const items = database.prepare(`
    SELECT e.*, u.username
    FROM ledger_entries e
    JOIN users u ON u.id = e.user_id
    ${where}
    ORDER BY e.occurred_on DESC, e.created_at DESC
  `).all(...params).map(presentLedgerEntry)
  return {
    month: span.month,
    from: span.from,
    to: span.to,
    summary: ledgerSummary(where, params),
    categories: categoryStats(where, params),
    days: dailyStats(where, params),
    items,
    catalog: ledgerCatalog(),
  }
}

function createLedgerEntry(userId, input) {
  assertWrites(userId)
  const value = cleanLedgerInput(input)
  const now = Date.now()
  const id = crypto.randomUUID()
  database.prepare(`
    INSERT INTO ledger_entries (
      id, user_id, kind, category, amount_cents, occurred_on, note, created_at, updated_at, version
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
  `).run(id, userId, value.kind, value.category, value.amountCents, value.occurredOn, value.note, now, now)
  return presentLedgerEntry(database.prepare(`
    SELECT e.*, u.username FROM ledger_entries e JOIN users u ON u.id = e.user_id WHERE e.id = ?
  `).get(id))
}

function updateLedgerEntry(userId, entryId, input) {
  assertWrites(userId)
  const current = database.prepare('SELECT * FROM ledger_entries WHERE id = ? AND user_id = ?').get(entryId, userId)
  if (!current) throw fail(404, 'NOT_FOUND', '这笔账不存在')
  if (Number(input.version) !== current.version) throw fail(409, 'VERSION_CONFLICT', '这笔账已被修改，请刷新后再试')
  const value = cleanLedgerInput(input)
  const now = Date.now()
  const updated = database.prepare(`
    UPDATE ledger_entries
    SET kind = ?, category = ?, amount_cents = ?, occurred_on = ?, note = ?, updated_at = ?, version = version + 1
    WHERE id = ? AND user_id = ? AND version = ?
  `).run(value.kind, value.category, value.amountCents, value.occurredOn, value.note, now, entryId, userId, current.version)
  if (updated.changes !== 1) throw fail(409, 'VERSION_CONFLICT', '这笔账已被修改，请刷新后再试')
  return presentLedgerEntry(database.prepare(`
    SELECT e.*, u.username FROM ledger_entries e JOIN users u ON u.id = e.user_id WHERE e.id = ?
  `).get(entryId))
}

function deleteLedgerEntry(userId, entryId, version) {
  assertWrites(userId)
  const current = database.prepare('SELECT * FROM ledger_entries WHERE id = ? AND user_id = ?').get(entryId, userId)
  if (!current) throw fail(404, 'NOT_FOUND', '这笔账不存在')
  if (Number(version) !== current.version) throw fail(409, 'VERSION_CONFLICT', '这笔账已被修改，请刷新后再试')
  const removed = database.prepare('DELETE FROM ledger_entries WHERE id = ? AND user_id = ? AND version = ?').run(entryId, userId, current.version)
  if (removed.changes !== 1) throw fail(409, 'VERSION_CONFLICT', '这笔账已被修改，请刷新后再试')
}

/**
 * listAdminLedger —— 管理员查看所有账号的记账。支持账号、类型、月份或日期区间、分页，以及分类和按日统计。
 * @param {{q?: string, kind?: string, month?: string, from?: string, to?: string, page?: number|string, pageSize?: number|string}} query
 */
function listAdminLedger({ q, kind, month, from, to, page, pageSize } = {}) {
  const query = String(q || '').trim().toLowerCase()
  const entryKind = String(kind || '').trim()
  if (entryKind && entryKind !== 'expense' && entryKind !== 'income') {
    throw fail(400, 'VALIDATION_ERROR', '类型不正确')
  }
  const hasRange = String(from || '').trim() || String(to || '').trim()
  const hasMonth = month !== undefined && month !== ''
  const span = hasRange || hasMonth ? ledgerSpan(hasRange ? { from, to } : { month }) : null
  const params = []
  const conditions = []
  if (query) {
    const like = `%${query.replace(/[\\%_]/g, (char) => `\\${char}`)}%`
    conditions.push(`(lower(u.username) LIKE ? ESCAPE '\\' OR lower(e.note) LIKE ? ESCAPE '\\')`)
    params.push(like, like)
  }
  if (entryKind) {
    conditions.push('e.kind = ?')
    params.push(entryKind)
  }
  if (span) {
    conditions.push('e.occurred_on >= ? AND e.occurred_on < ?')
    params.push(span.from, span.until)
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  const total = database.prepare(`
    SELECT COUNT(*) AS n
    FROM ledger_entries e
    JOIN users u ON u.id = e.user_id
    ${where}
  `).get(...params).n
  const size = pageSizeNumber(pageSize)
  const current = pageNumber(page, total, size)
  const items = database.prepare(`
    SELECT e.*, u.username
    FROM ledger_entries e
    JOIN users u ON u.id = e.user_id
    ${where}
    ORDER BY e.occurred_on DESC, e.created_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, size, (current - 1) * size).map(presentLedgerEntry)
  return {
    items,
    total,
    page: current,
    page_size: size,
    month: span ? span.month : null,
    from: span ? span.from : null,
    to: span ? span.to : null,
    summary: ledgerSummary(where, params),
    categories: categoryStats(where, params),
    days: span ? dailyStats(where, params) : [],
  }
}

function ensureLedger() {
  database.exec(`
    CREATE TABLE IF NOT EXISTS ledger_entries (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK (kind IN ('expense', 'income')),
      category TEXT NOT NULL,
      amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
      occurred_on TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      version INTEGER NOT NULL DEFAULT 1
    );
    CREATE INDEX IF NOT EXISTS idx_ledger_user_date ON ledger_entries(user_id, occurred_on);
    CREATE INDEX IF NOT EXISTS idx_ledger_date ON ledger_entries(occurred_on);
  `)
}

function listAudit() {
  return database.prepare(`
    SELECT a.created_at, a.action, a.result, a.target_type, a.target_id, u.username AS actor
    FROM audit_logs a
    LEFT JOIN users u ON u.id = a.actor_user_id
    ORDER BY a.created_at DESC
    LIMIT 50
  `).all()
}

migrate()
const bootstrapMessages = seedLocalAccounts()
ensureSaas()
ensureLedger()

module.exports = {
  databasePath,
  bootstrapMessages,
  POLICY_VERSION,
  CATEGORIES,
  publicUser,
  adminPublicUser,
  sessionUser,
  revokeSession,
  login,
  registerWithInvite,
  recoverAccount,
  changePassword,
  reauthenticate,
  listDevices,
  ownedDevice,
  presentDevice,
  createDevice,
  updateDevice,
  deleteDevice,
  listPlans,
  createPlan,
  updatePlan,
  deletePlan,
  listLogs,
  completePlan,
  createManualLog,
  voidLog,
  dueItems,
  exportAccount,
  calendarText,
  deleteAccount,
  adminOverview,
  listAdminUsers,
  adminUser,
  setUserStatus,
  resetUserPassword,
  adminAccount,
  listAdminAccounts,
  createAdminAccount,
  updateAdminAccount,
  resetAdminPassword,
  deleteAdminAccount,
  listInvites,
  createInvite,
  revokeInvite,
  getSettings,
  setSetting,
  listAudit,
  listSaas,
  listSaasAccounts,
  updateTenant,
  createSaasPlan,
  updateSaasPlan,
  assignUserPlan,
  listLedger,
  createLedgerEntry,
  updateLedgerEntry,
  deleteLedgerEntry,
  listAdminLedger,
  writeAudit,
}
