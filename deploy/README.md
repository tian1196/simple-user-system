# 部署指南（公网服务器）

本文档介绍如何把设备台账部署到公网服务器，并以 systemd 常驻、Nginx 对外提供访问。推荐使用一键脚本；需要手动排查时可参考手动步骤。

> 按公网 IP（无域名）逐步实操、含首次创建 owner 账号：见 [公网部署实操手册.md](./公网部署实操手册.md)。

## 一、部署架构

```text
浏览器
  │  http(s)://你的域名或IP/        用户站点
  │  http(s)://你的域名或IP/admin/  Vue 管理后台
  ▼
Nginx（80 / 443）
  │  反向代理 /api 与页面
  ▼
Node（systemd 常驻，仅监听 127.0.0.1:3000）
  │
  ▼
/opt/device-ledger/data/ledger.sqlite
```

目录约定：

| 路径 | 内容 |
| --- | --- |
| `/opt/node24` | 独立 Node 24 运行时（不影响系统 Node） |
| `/opt/device-ledger/app` | 应用代码（含构建好的 `web/dist`） |
| `/opt/device-ledger/data` | 数据库目录（0700，属主 deviceledger） |
| `/etc/systemd/system/device-ledger.service` | 系统服务 |
| `/etc/nginx/conf.d/device-ledger.conf` | Nginx 站点配置 |

## 二、一键部署（推荐）

在**本机项目根目录**执行（需要能 SSH 到服务器）：

```bash
# HTTP（首次验证用）
sh scripts/deploy.sh

# 指定域名/IP（默认就是 SSH 主机）
DEPLOY_DOMAIN=ledger.example.com sh scripts/deploy.sh

# HTTPS（需要域名，证书另需申请）
DEPLOY_DOMAIN=ledger.example.com sh scripts/deploy.sh --https
```

可配置变量：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `DEPLOY_HOST` | `115.190.233.106` | 服务器地址 |
| `DEPLOY_USER` | `root` | SSH 用户（脚本需要安装系统组件） |
| `DEPLOY_BASE` | `/opt/device-ledger` | 部署根目录 |
| `DEPLOY_DOMAIN` | 同 `DEPLOY_HOST` | 对外域名/IP |

脚本会自动完成：打包 → 上传解压 → 安装 Node 24 → 安装依赖并构建前端 → 创建系统用户与数据目录 → 安装启用 systemd → 安装并重启 Nginx。

**脚本不会覆盖服务器已有数据库。** 首次上线或升级前建议先备份：

```bash
install -d -m 0700 /opt/device-ledger/backups
backup_file="/opt/device-ledger/backups/ledger-$(date +%Y%m%d-%H%M%S).sqlite"
sqlite3 /opt/device-ledger/data/ledger.sqlite ".timeout 5000" ".backup '$backup_file'"
```

## 三、HTTPS 证书

`--https` 使用的是 HTTPS 模板，证书路径默认指向 Let's Encrypt。用 certbot 自动申请并改写配置：

```bash
# CentOS/RHEL
dnf install -y certbot python3-certbot-nginx
# Debian/Ubuntu
apt-get update && apt-get install -y certbot python3-certbot-nginx

certbot --nginx -d ledger.example.com
systemctl reload nginx
```

启用 HTTPS 后务必确认服务端 `COOKIE_SECURE=true`（一键 `--https` 已自动设置）。证书每 90 天到期，certbot 会安装自动续期定时任务。

> 没有域名时无法签发常规可信证书，只能先用 HTTP 或自签证书（浏览器会报警告）。

## 四、首次部署后

1. 打开 `https://你的域名/` 确认用户站点；
2. 打开 `https://你的域名/admin/` 进入后台；
3. 首个所有者账号：
   - 若服务器此前已初始化过，使用已有所有者；
   - 若为全新空库，查看服务日志获取初始凭据：`journalctl -u device-ledger -n 30`；
4. 在“系统账号”里创建日常使用的管理员，避免长期只依赖一个 owner。

## 五、常用运维命令

```bash
# 服务状态 / 日志
systemctl status device-ledger
journalctl -u device-ledger -f

# 重启 / 停止
systemctl restart device-ledger
systemctl stop device-ledger

# 健康检查
curl http://127.0.0.1:3000/api/health
curl http://127.0.0.1:3000/api/v1/health/ready

# Nginx 校验 / 重载
nginx -t && systemctl reload nginx
```

## 六、手动部署（脚本不可用时参考）

```bash
# 1) 安装 Node 24（上传 deploy/install-node24.sh 后执行）
sh install-node24.sh
export PATH=/opt/node24/bin:$PATH

# 2) 放置代码
mkdir -p /opt/device-ledger/app /opt/device-ledger/data
# 解压打包文件到 /opt/device-ledger/app
cd /opt/device-ledger/app
npm install
npm --prefix web install
npm --prefix web build

# 3) 专用用户与权限
useradd --system --home-dir /opt/device-ledger --shell /usr/sbin/nologin deviceledger
chown -R deviceledger:deviceledger /opt/device-ledger
chmod 700 /opt/device-ledger/data

# 4) systemd
cp deploy/device-ledger.service /etc/systemd/system/
# 编辑 APP_ORIGINS 为实际来源，HTTPS 下设置 COOKIE_SECURE=true
systemctl daemon-reload
systemctl enable --now device-ledger

# 5) Nginx
cp deploy/nginx-device-ledger.conf /etc/nginx/conf.d/device-ledger.conf
nginx -t && systemctl restart nginx
```

## 七、升级

重新执行一键脚本即可：它会替换 `app` 目录代码、重建前端并重启服务；`data` 与 `web/dist` 之外的数据不受影响。升级前请先备份数据库。

## 八、排错

| 现象 | 排查 |
| --- | --- |
| 页面 502 | `systemctl status device-ledger`，Node 是否启动；端口是否 3000 |
| 写操作 403「请求来源不正确」 | `APP_ORIGINS` 是否包含浏览器实际地址；Nginx 是否透传 `Host` |
| 后台登录后频繁掉登录 | HTTP 下 `COOKIE_SECURE` 必须为 false；HTTPS 下建议 true |
| 服务起不来 | `journalctl -u device-ledger -n 50`，多为数据库路径/版本不符 |
| 404 刷新丢失 | Nginx/Node 已配置 SPA 回退；确认访问路径在 `/admin/` 下 |

> 安全提醒：不要把本地 `data/ledger.sqlite`、`.env` 或 `node_modules` 上传覆盖服务器。真实权限始终由服务端中间件保证。
