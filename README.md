# 个人设备保修与维护台账

Express + Node 24 内置 SQLite 后端，`web/` 提供 Vue 3 + TypeScript + Element Plus 的新管理后台。保留完整设备页面、维护计划与记录、日历与账户导出、恢复码找回、账户注销以及管理后台。密码沿用 bcrypt，数据库持久保存 Cookie 会话。

## 本地运行

要求 Node >=24.13.0 且 <25。安装依赖后启动：

```bash
npm ci
npm start
```

默认监听 http://127.0.0.1:3000 。未设置 DATABASE_PATH 时沿用远端版的本地开发模式：自动建表，仅空库创建本地所有者和邀请码，凭据显示在终端。已有数据不会重新初始化。

需要显式初始化的 schema 1 数据库时，复制 .env.example 为 .env，然后执行：

```bash
npm run db:init
npm run db:check
npm run invite:create -- 5
npm start
```

`db:init` 只用于新的本地库，拒绝覆盖文件或初始化 /opt/ 路径。设置 DATABASE_PATH 后，服务会验证数据库文件及 schema 1；路径或版本错误会拒绝启动。已有业务库不要重跑初始化。测试只使用临时数据库，不修改业务数据。

### 管理后台开发

管理后台位于 `web/`，需要另行安装依赖并启动 Vite：

```bash
cd web
npm install
npm run dev
# http://127.0.0.1:5173/admin/
```

开发服务器会把 `/api` 代理到 `http://127.0.0.1:3000`，所以先保持后端运行。空库首次启动时终端会打印本地管理员 `owner / ledger-owner-2026`；管理后台登录需填写页面图形验证码。根目录也可以直接执行 `npm run admin:dev`。

构建并让 Express 在 `/admin` 直接托管：

```bash
npm run admin:build   # 等价于 cd web && npm run build，输出 web/dist
npm start
# http://127.0.0.1:3000/admin/
```

更完整的目录、接口约定、权限与部署说明见 [web/README.md](web/README.md)。

## 页面与接口

首页 `/`，设备 `/app`，用户登录 `/login`，邀请注册 `/register`，管理后台 `/admin`（存在 `web/dist` 时由 Express 托管 Vue 版后台，否则回退旧版页面）。完整接口使用 `/api/v1`：

- `/auth/register`、`/auth/login`、`/auth/me`、`/auth/logout`。
- `/auth/recover`、`/auth/reauth`、`/auth/password` 和 `/me` 账户注销。
- `/devices`、`/devices/:id`、`/devices/:id/plans`、`/plans/:id`、`/plans/:id/completions`、`/devices/:id/logs`、`/logs/:id/void`。
- `/due-items`、`/exports/account`、`/exports/calendar`。
- `/admin/auth/login`、`/admin/overview`、`/admin/users`、`/admin/invites`、`/admin/accounts`、`/admin/settings`、`/admin/audit-logs`。
- `/api/health` 为存活检查；`/api/v1/health/ready` 查询并验证实际 schema 1 数据库。

业务响应为 `{ data, request_id }`，错误为 `{ error: { code, message }, request_id }`。注册隐私版本为 `2026-11-05`，密码要求沿用完整业务版的 8–128 字符。CLI 邀请码会统一大写以匹配注册逻辑。

## 配置与部署

npm 启动脚本自动读取 `.env`。DATABASE_PATH 指定库路径；HOST 默认 127.0.0.1；PORT 默认 3000；APP_ORIGINS 为逗号分隔的允许来源；COOKIE_SECURE=true 为登录 Cookie 添加 Secure 标记。ADMIN_DIST 可覆盖 Vue 管理后台的构建目录（默认 `web/dist`），SITE_DIST 可覆盖用户站构建目录（默认 `web/site-dist`）。

`deploy/device-ledger.service` 提供 systemd 模板，沿用 /opt/device-ledger/data/ledger.sqlite 和独立 Node 24。部署前核对服务用户、目录与现有数据库，通过 `scripts/db-check.js` 检查连接和完整性。`deploy/install-node24.sh` 是可选的独立 Node 安装脚本。不要上传本地 node_modules、.env 或数据库覆盖服务器数据。

### 一键部署到公网

```bash
DEPLOY_HOST=服务器IP npm run deploy                    # HTTP 首次验证
DEPLOY_HOST=服务器IP DEPLOY_DOMAIN=ledger.example.com npm run deploy:https   # HTTPS
```

`npm run pack` 会同时构建用户站和后台，生成 `dist/device-ledger.tar.gz` 与 SHA256；`npm run pack:check` 可隔离启动验收实际部署包。部署脚本使用 Bash，本地构建后上传，远端校验已有数据库、备份并切换版本，失败时尝试恢复旧代码与配置。不会创建或覆盖业务数据库。完整架构、HTTPS 证书、运维与排错见 [deploy/README.md](deploy/README.md)。

写请求沿用完整业务版的来源校验。管理后台登录使用自研 SVG 图形验证码（无需手机 Authenticator），验证码 5 分钟有效且一次性使用。

## 验证与提交

```bash
npm test
cd web && npm run type-check && npm run build
npm run commit
npm run release
```

测试覆盖显式初始化保护、数据库检查、CLI 邀请注册、重复用户名、来源校验、设备与维护计划、版本冲突、重启持久会话、退出，以及管理员账号增删改查、权限边界和自助保护。保留 Husky、Commitlint、Commitizen 和版本发布配置。

## 管理后台前端（web/）

- 技术栈：Vue 3、TypeScript、Vite、Element Plus、Pinia、Vue Router、Axios。
- 开发地址：`http://127.0.0.1:5173/admin/`；生产构建后：`http://127.0.0.1:3000/admin/`。
- 页面：登录、运营概览、账号管理、邀请管理、系统账号（仅所有者）、运营配置（仅所有者）、操作审计（仅所有者）。
- 登录态：后端 HttpOnly Cookie，401 自动清理并回跳登录页；账号状态、系统账号与配置修改使用版本号处理并发冲突。
- 图形验证码：管理后台登录需要；用户端登录不需要。

启动、构建、目录结构与部署细节见 [web/README.md](web/README.md)。
