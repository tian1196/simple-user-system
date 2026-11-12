# 双站点部署指南

同一域名部署普通用户网站 `/`、后台 `/admin/` 和接口 `/api/v1`。Nginx 反向代理至仅监听 `127.0.0.1:3000` 的 Node 服务；Express 提供两个独立 Vue 构建及 SPA 深链接。

## 1. 本地准备部署包

要求 Node `>=24.13.0 <25`，安装项目锁定依赖：

```bash
npm ci
npm --prefix web ci
npm test
npm run pack
npm run pack:check
```

`pack` 会重新构建管理后台 `web/dist` 和用户站 `web/site-dist`，再生成：

- `dist/device-ledger.tar.gz`：服务端、双站点产物、部署工具、源码和依赖锁文件；
- `dist/device-ledger.tar.gz.sha256`：传输完整性校验；
- 包内 `release.json`：版本、构建时间、入口信息。

白名单打包不包含本地 `.env`、Vite `.env.*`、数据库、`node_modules`、日志、Git 或旧部署包。`.env.example` 作为配置说明保留。前端默认同源请求 `/api/v1`，后台资源路径固定 `/admin/`；生产构建前不要设置指向本机的 `VITE_API_BASE_URL` 或修改后台 `VITE_BASE`。

`pack:check` 解压实际部署包，在临时目录安装锁定的后端生产依赖，创建临时数据库并分配临时端口；检查 14 条页面路由、双站点入口资源、缓存、404、接口鉴权和数据库就绪。结束自动清理，不使用业务数据库与现有 3000/5174 端口。

额外选项：`npm run pack -- --source` 仅打源码，需自行安装前端依赖并执行 `npm run web:build`；自动部署只接受含双站点构建的包。`--no-build` 可打包刚完成的构建，但不会检测源码是否更新，正式发布推荐默认命令。

## 2. 服务器前提

自动部署支持 Linux x86_64、systemd、root SSH。使用独立 `/opt/node24`，不修改系统 Node；已有不匹配的 `/opt/node24` 会拒绝覆盖。运行时安装脚本锁定版本并校验 [Node 官方 SHA256](https://nodejs.org/download/release/v24.22.2/SHASUMS256.txt)。SSH 主机和公网域名分开设置，不再默认连接某台服务器。

默认目录：

| 路径 | 用途 |
| --- | --- |
| `/opt/device-ledger/app` | 当前应用（含双站点构建） |
| `/opt/device-ledger/previous` | 上一次应用 |
| `/opt/device-ledger/data/ledger.sqlite` | 业务数据库 |
| `/opt/device-ledger/backups` | 切换前 SQLite 在线快照 |
| `/etc/systemd/system/device-ledger.service` | 服务配置 |
| `/etc/nginx/conf.d/device-ledger.conf` | Nginx 站点配置 |

**首次部署也必须先准备正确的 schema 1 数据库。** 脚本不会创建线上空库、播种演示账号或覆盖数据库。已有服务器保持原库；迁移时先停写并使用 SQLite 在线备份生成一致快照，核对内容，再恢复到目标数据目录并设置 `deviceledger` 所有权、目录 0700、数据库 0600。不要直接复制正在写入的 SQLite 主文件（可能遗漏 WAL）。

设置了 `DATABASE_PATH` 后不会自动生成所有者，也不会在日志打印初始口令；已有 owner 沿用。首次建库与创建所有者须作为单独操作审核执行，可参考 [公网部署实操手册](./公网部署实操手册.md)，不要对已有业务库重跑初始化。

## 3. 执行部署

在本机项目根目录：

```bash
# HTTP 仅用于初步验证/申请证书
DEPLOY_HOST=服务器IP DEPLOY_DOMAIN=ledger.example.com npm run deploy

# 已有有效证书时部署 HTTPS
DEPLOY_HOST=服务器IP DEPLOY_DOMAIN=ledger.example.com npm run deploy:https
```

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `DEPLOY_HOST` | 必填 | SSH 主机名或 IPv4 |
| `DEPLOY_USER` | `root` | SSH 用户；远端操作要求 root |
| `DEPLOY_BASE` | `/opt/device-ledger` | `/opt/` 下的应用根目录 |
| `DEPLOY_DOMAIN` | 同 SSH 主机 | 浏览器访问域名或 IPv4，不带协议、端口、路径 |

脚本使用 Bash：手动调用应为 `bash scripts/deploy.sh`，不要使用 `sh`。旧入口 `npm run upload` 也会转调 Bash。

执行顺序：本地双站构建 → 打包及 SHA256 → 独立上传目录 → 远端部署锁 → 临时版本目录安装生产依赖 → 数据库完整性校验 → 证书和候选 Nginx 配置校验 → 数据库在线备份 → 保留旧应用并切换 → 重启服务 → 数据库就绪与双站点路由验收 → Nginx 校验与重载。

切换前失败不替换现有应用；切换后失败会尝试恢复旧应用、systemd 和 Nginx 配置，并恢复原有服务运行状态。失败版本保留在 `failed-*`；数据库不会自动回滚，以免覆盖发布期间业务写入。脚本不执行数据库版本迁移，当前仅支持 schema 1。

## 4. HTTPS

先使域名指向服务器，放行 80/443；3000 不应对公网开放。证书需预先存在：

```text
/etc/letsencrypt/live/你的域名/fullchain.pem
/etc/letsencrypt/live/你的域名/privkey.pem
```

可先 HTTP 部署，再按服务器发行版安装 Certbot，用 `certbot certonly --webroot -w /var/www/html -d 你的域名` 申请证书。HTTP 模板已放行挑战目录；先创建该目录。证书就绪后运行 `deploy:https`，会配置 HTTPS 重定向、实际证书路径和 `COOKIE_SECURE=true`，并将 `APP_ORIGINS` 设置为实际 HTTPS 来源。确认续期任务有效，续期后重载 Nginx。

部署前检查服务器没有其他站点抢占该域名；脚本不会删除系统默认站点或其他项目配置。

## 5. 上线验收与维护

```bash
systemctl status device-ledger --no-pager
journalctl -u device-ledger -n 50 --no-pager
curl -f http://127.0.0.1:3000/api/v1/health/ready
nginx -t
```

浏览器使用最终 HTTPS 地址检查首页、`/admin/`、普通用户注册/登录、设备维护和导出。注册邀请码由后台创建；两个站点登录入口分别管理普通用户与管理员身份。

补充在线备份（以服务账户执行，不复制正在使用的主文件）：

```bash
cd /opt/device-ledger/app
runuser -u deviceledger -- env DATABASE_PATH=/opt/device-ledger/data/ledger.sqlite \
  /opt/node24/bin/node scripts/backup-database.js \
  /opt/device-ledger/backups/manual-$(date +%Y%m%d-%H%M%S).sqlite
```

升级重新运行部署命令即可。按保留策略人工清理历史版本与备份。若需人工恢复代码，停止服务后核对 `previous`、恢复对应配置并重新启动；数据库恢复应单独决策。

| 现象 | 排查 |
| --- | --- |
| 数据库预检失败 | 核对路径、schema 1、服务用户权限；不要重新初始化已有库 |
| 502 | `systemctl status device-ledger` 和服务日志 |
| 写操作来源错误 | `APP_ORIGINS` 必须与浏览器实际协议和域名一致 |
| HTTP 登录不保留 | 检查是否错误设置了 `COOKIE_SECURE=true` |
| HTTPS 模板校验失败 | 核对证书存在、权限及 Nginx TLS 支持 |
| 页面/资源 404 | 两个构建目录必须同时存在，后台基路径必须为 `/admin/` |
