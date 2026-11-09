#!/usr/bin/env bash
# ============================================================
# deploy.sh —— 设备台账一键部署（在你的“本机”执行）
#
# 它会：
#   1. 打包源码；
#   2. scp 上传并解压到服务器 /opt/device-ledger/app；
#   3. 在服务器安装 Node 24（如尚未安装）；
#   4. 安装依赖并构建前端（输出 web/dist）；
#   5. 创建专用系统用户、数据目录（不覆盖已有数据库）；
#   6. 安装并启用 systemd 服务（常驻 + 开机自启）；
#   7. 安装 Nginx 配置（默认 HTTP；--https 安装 HTTPS 模板）。
#
# 用法：
#   sh scripts/deploy.sh                         # 用默认值部署（HTTP）
#   DEPLOY_DOMAIN=ledger.example.com sh scripts/deploy.sh --https
#
# 可配置环境变量：
#   DEPLOY_HOST   服务器地址，默认 115.190.233.106
#   DEPLOY_USER   SSH 用户，默认 root
#   DEPLOY_BASE   部署根目录，默认 /opt/device-ledger
#   DEPLOY_DOMAIN 对外域名或 IP（用于 APP_ORIGINS 与 server_name）
#
# 安全：脚本不会删除/覆盖服务器已有数据库；但首次上线前建议先备份。
# ============================================================
set -Eeuo pipefail

DEPLOY_HOST="${DEPLOY_HOST:-115.190.233.106}"
DEPLOY_USER="${DEPLOY_USER:-root}"
BASE="${DEPLOY_BASE:-/opt/device-ledger}"
APP_DIR="$BASE/app"
DATA_DIR="$BASE/data"

USE_HTTPS=0
for arg in "$@"; do
  case "$arg" in
    --https) USE_HTTPS=1 ;;
    -h|--help)
      sed -n '2,30p' "$0"; exit 0 ;;
    *) echo "未知参数：$arg" >&2; exit 2 ;;
  esac
done

# 对外访问地址：优先域名，否则用主机 IP
if [ "${DEPLOY_DOMAIN:-}" = "" ]; then
  DEPLOY_DOMAIN="$DEPLOY_HOST"
fi
if [ "$USE_HTTPS" = 1 ]; then
  ORIGIN="https://$DEPLOY_DOMAIN"
else
  ORIGIN="http://$DEPLOY_DOMAIN"
fi

cd "$(dirname "$0")/.."
SSH_TARGET="${DEPLOY_USER}@${DEPLOY_HOST}"

echo "==> [1/6] 打包源码"
sh scripts/pack.sh

echo "==> [2/6] 上传并解压到 ${APP_DIR}"
scp dist/device-ledger.tar.gz "${SSH_TARGET}:/tmp/device-ledger.tar.gz"
# 解压到临时目录后再整体替换应用目录，避免半更新；数据目录独立于 app
ssh "$SSH_TARGET" "
  set -e
  rm -rf /tmp/device-ledger-extract
  mkdir -p /tmp/device-ledger-extract
  tar -xzf /tmp/device-ledger.tar.gz -C /tmp/device-ledger-extract
  rm -rf '${APP_DIR}'
  mkdir -p '${APP_DIR}' '${DATA_DIR}'
  cp -a /tmp/device-ledger-extract/. '${APP_DIR}/'
  rm -rf /tmp/device-ledger-extract /tmp/device-ledger.tar.gz
"

echo "==> [3/6] 确保 Node 24 已安装"
# 上传 Node 安装脚本并执行（幂等：已安装且版本正确则跳过）
scp deploy/install-node24.sh "${SSH_TARGET}:/tmp/install-node24.sh"
ssh "$SSH_TARGET" "sh /tmp/install-node24.sh && rm -f /tmp/install-node24.sh"

echo "==> [4/6] 创建用户、安装依赖并构建前端"
ssh "$SSH_TARGET" "
  set -e
  if ! id deviceledger >/dev/null 2>&1; then
    useradd --system --home-dir '${BASE}' --shell /usr/sbin/nologin deviceledger
  fi
  cd '${APP_DIR}'
  export PATH=/opt/node24/bin:\$PATH
  node -v
  npm install --no-audit --no-fund
  npm --prefix web install --no-audit --no-fund
  npm --prefix web run build
  install -d -m 0700 -o deviceledger -g deviceledger '${DATA_DIR}'
  chown -R deviceledger:deviceledger '${BASE}'
"

echo "==> [5/6] 安装并启用 systemd 服务"
scp deploy/device-ledger.service "${SSH_TARGET}:/tmp/device-ledger.service"
ssh "$SSH_TARGET" "
  set -e
  install -m 0644 /tmp/device-ledger.service /etc/systemd/system/device-ledger.service
  sed -i 's#http://CHANGE_ME#${ORIGIN}#' /etc/systemd/system/device-ledger.service
  rm -f /tmp/device-ledger.service
  if [ '${USE_HTTPS}' = 1 ]; then
    sed -i 's#Environment=COOKIE_SECURE=false#Environment=COOKIE_SECURE=true#' /etc/systemd/system/device-ledger.service
  fi
  systemctl daemon-reload
  systemctl enable device-ledger.service
  systemctl restart device-ledger.service
  sleep 1
  systemctl --no-pager --full status device-ledger.service | head -12 || true
"

echo "==> [6/6] 安装 Nginx 配置"
if [ "$USE_HTTPS" = 1 ]; then
  NGINX_TPL="deploy/nginx-device-ledger.ssl.conf"
else
  NGINX_TPL="deploy/nginx-device-ledger.conf"
fi
scp "$NGINX_TPL" "${SSH_TARGET}:/tmp/device-ledger.nginx.conf"
ssh "$SSH_TARGET" "
  set -e
  if ! command -v nginx >/dev/null 2>&1; then
    echo 'Nginx 未安装，正在安装...'
    if command -v dnf >/dev/null 2>&1; then dnf install -y nginx
    elif command -v yum >/dev/null 2>&1; then yum install -y nginx
    elif command -v apt-get >/dev/null 2>&1; then apt-get update && apt-get install -y nginx
    else echo '无法自动安装 Nginx，请手动安装'; exit 1
    fi
  fi
  install -m 0644 /tmp/device-ledger.nginx.conf /etc/nginx/conf.d/device-ledger.conf
  sed -i 's#server_name _#server_name ${DEPLOY_DOMAIN}#' /etc/nginx/conf.d/device-ledger.conf
  rm -f /tmp/device-ledger.nginx.conf
  nginx -t
  systemctl enable nginx
  systemctl restart nginx
"

cat <<EOF

============================================================
部署完成
  用户站点：  ${ORIGIN}/
  管理后台：  ${ORIGIN}/admin/
  健康检查：  ${ORIGIN}/api/health

$( [ "$USE_HTTPS" = 1 ] && echo "HTTPS：请确认证书路径已正确（certbot --nginx -d $DEPLOY_DOMAIN 可自动申请）。" || echo "当前为 HTTP；确认可用后可加 --https 升级（需要域名与证书）。" )
注意：数据保存在 ${DATA_DIR}/ledger.sqlite，请定期用 sqlite3 .backup 备份。
============================================================
EOF
