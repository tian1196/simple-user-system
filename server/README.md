# Server 服务端架构说明

本文档说明 `server/` 目录的整体架构、每个文件的职责、模块依赖关系、数据模型、请求处理流程以及关键的安全设计，便于快速理解和后续维护。

## 一、总览

服务端是一个基于 **Express + Node 内置 SQLite（node:sqlite）** 的单体后端，运行时无外部数据库依赖，数据库就是本机的一个 `.sqlite` 文件。

整体采用经典的分层思路：

```text
HTTP 请求
   │
   ▼
index.js            路由与协议层：接收请求、鉴权、统一响应/错误格式
   │  仅调用，不写业务规则
   ▼
db.js               数据访问与业务逻辑层：校验规则、读写数据、事务、审计
   │
   ▼
database-tools.js   连接与校验工具：安全打开数据库、事务封装、健康检查
   │
   ▼
SQLite 文件          data/ledger.sqlite（本地）或 DATABASE_PATH 指定路径
```

另外两个工具文件提供可复用能力：

- `dates.js`：业务日期处理（按天、上海时区）；
- `security.js`：通用安全原语（哈希、随机串、scrypt、限流器，部分为备用方案）。

## 二、文件职责

| 文件 | 行数 | 角色 | 主要职责 |
| --- | --- | --- | --- |
| `index.js` | ~460 | HTTP 入口 | 创建 Express 应用、注册中间件、定义 `/api/v1` 全部路由、会话 Cookie 读写、统一响应格式、托管静态站点与 Vue 后台 |
| `db.js` | ~1670 | 数据访问 / 业务核心 | 建表迁移、账号与会话、邀请码、设备、维护计划与记录、待办汇总、数据/日历导出、管理员账号、运营配置、审计 |
| `database-tools.js` | ~60 | 数据库工具 | 安全打开并校验数据库、事务封装、审计写入、就绪健康检查 |
| `dates.js` | ~70 | 日期工具 | 今天、日期校验、日期加减、相差天数、到期/保修文案 |
| `security.js` | ~80 | 安全工具 | sha256、随机密钥、CSRF 令牌、scrypt 口令派生、内存限流器 |

### 模块依赖方向

```text
index.js ─────► db.js ─────► database-tools.js
   │              │  └────────► dates.js
   │              └──────────► dates.js
   └────────────► (node:sqlite / express)

security.js ：独立工具集，目前不被主流程强制依赖（保留备用）
```

依赖方向是单向的：`index → db → database-tools / dates`，不存在循环依赖。`security.js` 与主流程解耦，可独立复用。

## 三、各文件详解

### 1. `index.js` —— HTTP 服务入口

负责一切与 HTTP 协议相关的事情，本身不包含业务规则。

**全局中间件**

- `express.json({ limit: '16kb' })`：解析 JSON 请求体并限制大小；
- `requestId`：为每个请求生成 UUID，写入 `req.id`，随响应返回，便于日志排查；
- `sameOrigin`：对非 GET/HEAD 请求做同源校验，阻挡跨站伪造写操作。

**核心辅助函数**

- `cookieValue(req, name)`：手动从 Cookie 头解析指定值；
- `setSessionCookie / clearSessionCookie`：下发或失效 `HttpOnly` 会话 Cookie；
- `send / fail`：统一成功响应 `{ data, request_id }` 与错误响应 `{ error, request_id }`；
- `handle(fn)`：包装同步处理器，捕获业务异常并转成统一错误响应；
- `requireClient(clientType, cookieName)`：生成会话鉴权中间件；
- `requireOwner`：在管理员基础上进一步要求 `owner` 角色。

**路由分组（均挂在 `/api/v1` 下）**

| 分组 | 代表路由 | 鉴权 |
| --- | --- | --- |
| 用户认证 | `/auth/register`、`/auth/login`、`/auth/logout` | 登录/注册 |
| 账户安全 | `/auth/recover`、`/auth/reauth`、`/auth/password`、`DELETE /me` | 用户 |
| 设备 | `/devices`、`/devices/:id` | 用户 |
| 维护计划 | `/devices/:id/plans`、`/plans/:id` | 用户 |
| 维护记录 | `/plans/:id/completions`、`/devices/:id/logs`、`/logs/:id/void` | 用户 |
| 待办/导出 | `/due-items`、`/exports/account`、`/exports/calendar` | 用户 |
| 后台概览/用户 | `/admin/overview`、`/admin/users` | 管理员 |
| 系统账号 | `/admin/accounts` 系列 | 仅 owner |
| 邀请码 | `/admin/invites` 系列 | 管理员 |
| 配置/审计 | `/admin/settings`、`/admin/audit-logs` | 仅 owner |
| 健康检查 | `/api/health`、`/health/ready` | 公开 |

**静态托管**

1. 若 `web/dist/index.html` 存在，把 Vue 管理后台挂到 `/admin`，并为 SPA 深链接回退 `index.html`；
2. 再托管 `public/` 下的用户站点，其余非 API 路径回退入口。

### 2. `db.js` —— 数据访问与业务核心

服务端最大的模块，所有真实读写与规则判断都在这里。按职责可分为几块：

1. **连接初始化**：确定数据库路径、创建连接、设置 PRAGMA、统一事务入口；
2. **建表迁移 `migrate()`**：幂等创建全部表与索引，初始化默认运营开关；
3. **本地播种 `seedLocalAccounts()`**：仅在本地空库创建演示 owner、恢复码和邀请码；
4. **会话体系**：`createSession`、`sessionUser`、`revokeSession`、`touchReauth`、`assertReauth`；
5. **认证**：`login`、`registerWithInvite`、`recoverAccount`、`changePassword`、`reauthenticate`；
6. **设备**：`listDevices`、`ownedDevice`、`presentDevice`、`cleanDeviceInput`、增删改；
7. **维护计划**：`listPlans`、`ownedPlan`、`presentPlan`、增删改；
8. **维护记录**：`completePlan`、`createManualLog`、`voidLog`、`replayOrConflict`、`listLogs`；
9. **待办与导出**：`dueItems`、`exportAccount`、`calendarText`；
10. **管理后台**：普通用户管理、管理员账号管理、邀请码、运营配置、审计。

### 3. `database-tools.js` —— 数据库连接与校验工具

- `openDatabase(filename)`：**安全打开**数据库。文件不存在直接报错（避免路径写错静默建空库），并逐项核对：表是否齐全、schema 版本是否为 1、迁移记录、关键字段是否可查询；任何一步失败即关闭连接并抛错；
- `transaction(connection, callback)`：`BEGIN IMMEDIATE` 手动事务，成功 `COMMIT`、异常 `ROLLBACK`；
- `audit(...)`：供脚本直接写一条审计；
- `checkDatabase(connection)`：汇总迁移版本、日志模式、外键开关和用户/设备计数，供就绪检查使用。

### 4. `dates.js` —— 日期工具

系统在“天”粒度工作，统一使用上海时区的 `YYYY-MM-DD`，避免时区跨天误差。

- `today()`：上海时区今天（用 `Intl` + `en-CA` 取巧得到标准格式）；
- `isDate(value)`：校验格式并排除 `2026-02-30` 这类假日期；
- `addDays(iso, days)`：日期加减；
- `diffDays(from, to)`：相差整天数；
- `dueLabel(...)`：维护到期状态与中文文案；
- `warrantyLabel(...)`：保修状态文案。

### 5. `security.js` —— 通用安全原语

集中提供可复用的安全工具。**注意：当前业务口令实际使用 db.js 的 bcrypt 方案，本文件的 scrypt/CSRF/限流属于早期“联调版”方案，保留备用。**

- `hash(value)`：sha256 摘要；
- `randomSecret()`：32 字节 URL 安全随机串；
- `csrfToken(sessionToken)`：由会话派生 CSRF 令牌；
- `hashPassword / verifyPassword`：scrypt 口令派生与校验（含时序攻击防护）；
- `cookieToken(req)`：提取格式合法的会话令牌；
- `rateLimiter({ windowMs, max, key })`：单进程内存固定窗限流器。

## 四、数据模型

数据库共 12 张表（schema 1）：

| 表 | 作用 |
| --- | --- |
| `users` | 用户、运营者、所有者（靠 `role` 区分） |
| `auth_identities` | 登录凭据：口令哈希、恢复码哈希 |
| `sessions` | 会话（只存令牌哈希），区分 `web`/`admin` |
| `invite_codes` | 邀请码（只存哈希）、次数、过期、撤销 |
| `devices` | 设备，归属普通用户 |
| `maintenance_plans` | 维护计划：周期、下次到期日、状态 |
| `maintenance_logs` | 维护记录：手动/计划、幂等键、撤销标记 |
| `app_settings` | 运营配置（键值，JSON） |
| `privacy_acceptances` | 隐私版本确认记录 |
| `audit_logs` | 关键操作审计 |
| `deletion_tombstones` | 删除标记（注销留痕） |
| `schema_migrations` | 迁移版本记录 |

**通用字段约定**

- 主键 `id`：UUID 字符串；
- 业务表带 `created_at`、`updated_at`（毫秒时间戳）与 `version`（乐观锁）；
- 关联靠外键 + `ON DELETE`，配合 `PRAGMA foreign_keys=ON` 级联。

## 五、请求处理流程

以“用户登录”为例：

```text
POST /api/v1/auth/login
   │
   ├─ requestId：生成 req.id
   ├─ sameOrigin：校验 Origin 是否同源
   ├─ handle：捕获异常
   │     └─ db.login(...)
   │           ├─ identityByUsername 查询用户与口令哈希
   │           ├─ bcrypt 校验口令、账号状态、角色入口
   │           ├─ 更新最近登录时间、写审计
   │           └─ createSession：建会话，返回明文令牌
   ├─ setSessionCookie：下发 HttpOnly Cookie
   └─ send：返回 { data: { user }, request_id }
```

## 六、统一响应与错误

**成功**

```json
{ "data": {}, "request_id": "uuid" }
```

**失败**

```json
{ "error": { "code": "ERROR_CODE", "message": "可读信息" }, "request_id": "uuid" }
```

常见错误码：`AUTH_REQUIRED`(401)、`FORBIDDEN`(403)、`VALIDATION_ERROR`(400)、`NOT_FOUND`(404)、`VERSION_CONFLICT`(409)、`LAST_OWNER`(409)、`WRITES_PAUSED`(503)。

## 七、关键安全设计

- **口令存储**：业务口令使用 `bcrypt`；
- **敏感令牌只存哈希**：会话令牌、邀请码、恢复码入库前先 sha256，明文只在生成当次返回；
- **HttpOnly + SameSite Cookie**：降低 XSS 窃取与跨站请求风险；`COOKIE_SECURE=true` 时加 `Secure`；
- **同源校验**：写请求校验 `Origin`，配合 `APP_ORIGINS` 白名单；
- **乐观锁**：设备、计划、账号、配置更新都带 `version`，防止并发覆盖；
- **最后所有者保护**：至少保留一个启用中的 owner，禁止停用/降级/删除；
- **自我保护**：不能停用/删除当前登录账号、不能改自身角色；
- **幂等**：维护记录使用 `request_key + fingerprint`，网络重试不会重复登记；
- **审计留痕**：登录、账号/邀请/配置/导出/注销等关键操作全部写审计，且不记录口令等敏感正文。

## 八、本地运行

```bash
# 后端
npm start                 # http://127.0.0.1:3000

# Vue 管理后台（开发）
cd web && npm install && npm run dev
# http://127.0.0.1:5173/admin/

# 构建后台，由 Express 直接托管在 /admin
npm run admin:build
```

本地空库首次启动时，终端会打印演示管理员 `owner / ledger-owner-2026`；管理后台登录需填写页面图形验证码。

## 九、已知边界与后续建议

- 管理后台登录使用自研 SVG 图形验证码（`server/captcha.js`）；
- `security.js` 的 scrypt/CSRF/限流尚未接入主链路，如启用需同步替换口令方案并补测试；
- 当前结构固定为 schema 1，缺少自动升级迁移机制；新增字段时应补充正式迁移并更新版本；
- 限流器为单进程内存实现，多实例部署需换成共享存储；
- 前端权限控制只用于体验，真实安全边界始终由 `requireUser / requireAdmin / requireOwner` 在服务端保证。
