# 设备台账管理后台（web）

Vue 3 + TypeScript + Vite + Element Plus + Pinia + Vue Router + Axios 搭建的运营后台，对接现有 Express `/api/v1/admin/*` 接口。

## 快速开始

先启动后端（仓库根目录）：

```bash
npm start
# http://127.0.0.1:3000
```

再启动管理后台（本目录）：

```bash
npm install
npm run dev
# http://127.0.0.1:5173/admin/
```

本地演示管理员由后端在空库时自动创建：

```text
账号：owner
密码：ledger-owner-2026
动态码：Authenticator 中的 6 位 TOTP（后端真实校验）
```

登录页只在开发模式下显示这组提示，生产构建不会出现。

## 常用脚本

| 命令 | 说明 |
| --- | --- |
| `npm run dev` | Vite 开发服务器，`/api` 代理到 `127.0.0.1:3000` |
| `npm run build` | 先 `vue-tsc` 类型检查，再输出 `dist/` |
| `npm run build:only` | 只构建，不做类型检查 |
| `npm run type-check` | 仅执行 `vue-tsc` |
| `npm run preview` | 预览构建产物（需要另行处理 `/api` 代理） |
| `npm run format` | Prettier 格式化 `src` |

根目录也提供了快捷命令：

```bash
npm run admin:dev
npm run admin:build
```

## 已实现功能

| 页面 | 路由 | 能力 | 权限 |
| --- | --- | --- | --- |
| 管理员登录 | `/login` | 账号 / 密码 / 6 位动态码、记住账号、登录后回跳 | 公开 |
| 运营概览 | `/dashboard` | 用户数、设备数、近 7 日新增、注册与写入状态、快捷入口 | 所有管理员 |
| 账号管理 | `/users`、`/users/:id` | 搜索、状态筛选、分页、详情抽屉、停用 / 恢复；保留旧后台深链接 | 所有管理员 |
| 邀请管理 | `/invites` | 列表、使用进度、创建邀请、明文仅展示一次、撤销 | 所有管理员 |
| 系统账号 | `/accounts` | 管理员账号增删改查、角色与状态、重置密码 | 仅所有者 |
| 运营配置 | `/settings` | 注册开关、业务写入开关、二次确认、版本冲突处理 | 仅所有者 |
| 操作审计 | `/audit` | 最近 50 条、关键词 / 动作 / 结果筛选 | 仅所有者 |
| 404 | 兜底路由 | 返回上一页 / 回到概览 | 公开 |

登录态使用后端下发的 HttpOnly Cookie（`ledger_admin`），前端不保存 token；本地只缓存管理员资料用于首屏展示，刷新后会通过 `/admin/auth/me` 重新校验。

## 目录结构

```text
web/
├── src/
│   ├── api/                 # Axios 实例与按领域拆分的接口模块
│   │   ├── request.ts       # 解包 { data, request_id }、401 / 业务错误处理
│   │   ├── auth.ts          # 登录、退出、当前管理员
│   │   ├── users.ts         # 普通账号查询与状态变更
│   │   ├── accounts.ts      # 管理员账号增删改查、重置密码
│   │   ├── invites.ts       # 邀请创建与撤销
│   │   ├── settings.ts      # 运营配置读写
│   │   ├── audit.ts         # 审计日志
│   │   └── types.ts         # 与后端字段对应的类型
│   ├── components/          # PageHeader、StatCard 等通用组件
│   ├── layout/              # 侧边栏、顶栏、主布局
│   ├── router/              # 路由表与登录 / 角色守卫
│   ├── stores/              # Pinia：auth、app（侧边栏与移动端状态）
│   ├── styles/              # 全局样式与 Element Plus 变量覆盖
│   ├── types/               # 环境变量、路由 meta、axios 扩展、自动导入声明
│   ├── utils/               # 时间格式化、复制、401 事件总线
│   ├── views/               # 登录、概览、账号、邀请、系统账号、配置、审计、404
│   ├── App.vue              # Element Plus 中文 locale
│   └── main.ts              # 应用入口、全局 401 退出处理
├── public/favicon.svg
├── .env.development         # Vite 代理与接口前缀
├── .env.production          # 生产 base 与接口前缀
└── vite.config.ts
```

## 接口约定与错误处理

后端业务响应统一为：

```json
{ "data": {}, "request_id": "..." }
```

`src/api/request.ts` 在请求层统一：

- 解包 `data`，页面拿到的就是业务对象；
- 401：清理本地登录态并跳转登录页，同时带上 `redirect` 参数；
- 403 / 409 / 422 / 5xx：优先展示后端 `error.message`；
- 409 `VERSION_CONFLICT`：页面刷新后重试（账号状态、管理员账号、配置开关都带 `version` 乐观锁）；
- 网络错误 / 超时：给出可读提示；
- 登录与启动会话探测使用 `silent` / `skipAuthHandler`，避免多余的全局提示。

新增接口时，建议在 `src/api/` 下按领域新增模块，复用 `request<T>()`，并把后端字段补进 `types.ts`。

## 系统账号

`/accounts` 页面用于管理可以登录后台的 `owner` / `operator` 账号：

- 仅所有者可访问接口与页面；
- 可新增管理员、调整角色、启用/停用、重置密码、删除账号；
- 不能停用、降级或删除当前登录账号；
- 至少保留一个启用状态的所有者，否则会拒绝操作；
- 停用或删除账号会撤销其后台会话；重置他人密码也会撤销其会话，重置自己的密码会保留当前会话；
- 新增、修改、重置密码和删除都会写入操作审计。

管理员账号与普通业务账号共用 `users` / `auth_identities` 表，但后台账号接口只处理 `owner` / `operator` 角色，不会混入普通用户的设备数据。

接口：`GET/POST /admin/accounts`、`PATCH /admin/accounts/:id`、`PUT /admin/accounts/:id/password`、`DELETE /admin/accounts/:id`，全部要求 `owner` 权限。

## 权限

- 路由 `meta.roles` 控制页面级权限，例如配置和审计只允许 `owner`；
- 侧边菜单根据当前 `role` 过滤；
- 页面内敏感动作再结合 `authStore.isOwner` 做展示控制；
- 权限判断只是前端体验，真实权限仍由后端 `requireAdmin` / `requireOwner` 兜底。

运营者（operator）账号可访问概览、普通账号与邀请；所有者（owner）额外拥有系统账号、配置与审计权限。

## 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `VITE_BASE` | `/admin/` | 应用部署路径，同时作为 Router base |
| `VITE_API_BASE_URL` | `/api/v1` | 接口前缀 |
| `VITE_PROXY_TARGET` | `http://127.0.0.1:3000` | 仅开发服务器使用 |
| `VITE_APP_TITLE` | `设备台账管理后台` | 浏览器标题后缀 |

开发代理 `changeOrigin` 必须保持 `false`。后端会对非 GET 请求校验 `Origin` 与 `Host` 是否同源；改成 `true` 后浏览器登录会被 403 拒绝。

## 构建与部署

### 方式一：Express 直接托管（当前默认）

```bash
cd web
npm run build        # 输出 web/dist
```

根目录启动后端后，`server/index.js` 检测到 `web/dist/index.html` 会自动：

- 把 `web/dist` 挂到 `/admin`；
- 为 `/admin/*` 深链接回退到 `index.html`；
- 未构建时继续使用旧的 `/admin` 页面。

访问 <http://127.0.0.1:3000/admin/>。可用 `ADMIN_DIST` 指定其他构建目录。

### 方式二：Nginx 托管

```nginx
location /admin/ {
  alias /opt/device-ledger/app/web/dist/;
  try_files $uri $uri/ /admin/index.html;
}

location /api/ {
  proxy_pass http://127.0.0.1:3000;
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-Proto $scheme;
}
```

如果经过反向代理，请确保后端 `APP_ORIGINS` 包含实际访问来源，或让代理保留原始 `Host`，否则写请求会被同源校验拒绝。

## 注意

- 管理员动态码已接入真实 TOTP；新增/重置账号时会展示一次性二维码与密钥。
- 后台按产品约束只展示账号元数据与设备数量，不提供查看用户设备名称、备注、维护记录的入口。
- `src/types/auto-imports.d.ts` 与 `src/types/components.d.ts` 由 Vite 插件生成，建议随代码提交，保证全新克隆后 `npm run type-check` 可直接运行。
