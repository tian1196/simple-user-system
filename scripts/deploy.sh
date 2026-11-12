#!/usr/bin/env bash
# 双站点部署：本地构建打包，SSH 上传，服务器预检后切换。
# Usage: DEPLOY_HOST=server DEPLOY_DOMAIN=ledger.example.com npm run deploy:https
# --help 仅显示帮助；不会连接服务器。需要 root SSH 与已有 schema 1 数据库。
set -Eeuo pipefail
DEPLOY_HOST="${DEPLOY_HOST:-}"
DEPLOY_USER="${DEPLOY_USER:-root}"
BASE="${DEPLOY_BASE:-/opt/device-ledger}"
USE_HTTPS=0
for arg in "$@"; do
  case "$arg" in
    --https) USE_HTTPS=1 ;;
    -h|--help) sed -n '2,4p' "$0"; exit 0 ;;
    *) echo "未知参数：$arg" >&2; exit 2 ;;
  esac
done
# 变量会传给远端 shell/sed，限制为简单主机名、用户名与绝对目录。
[[ "$DEPLOY_HOST" =~ ^[a-zA-Z0-9][a-zA-Z0-9.-]*$ ]] || { echo '请设置 DEPLOY_HOST（主机名或 IPv4）' >&2; exit 2; }
[[ "$DEPLOY_USER" =~ ^[a-z_][a-z0-9_-]*$ ]] || exit 2
[[ "$BASE" =~ ^/opt/[a-zA-Z0-9_-]+(/[a-zA-Z0-9_-]+)*$ ]] || { echo 'DEPLOY_BASE 必须是 /opt 下的应用目录' >&2; exit 2; }
DEPLOY_DOMAIN="${DEPLOY_DOMAIN:-$DEPLOY_HOST}"
[[ "$DEPLOY_DOMAIN" =~ ^[a-zA-Z0-9][a-zA-Z0-9.-]*$ ]] || { echo 'DEPLOY_DOMAIN 只填写域名或 IPv4，不带协议/端口/路径' >&2; exit 2; }
cd "$(dirname "$0")/.."
sh scripts/pack.sh
SSH_TARGET="${DEPLOY_USER}@${DEPLOY_HOST}"
# 使用独立上传目录，避免不同部署互相覆盖。
REMOTE_TMP=$(ssh "$SSH_TARGET" 'mktemp -d /tmp/ledger-upload.XXXXXX')
[[ "$REMOTE_TMP" =~ ^/tmp/ledger-upload\.[a-zA-Z0-9]+$ ]] || exit 1
cleanup() { ssh "$SSH_TARGET" "rm -rf -- '$REMOTE_TMP'" || true; }
trap cleanup EXIT
scp dist/device-ledger.tar.gz dist/device-ledger.tar.gz.sha256 \
  scripts/deploy-remote.sh "$SSH_TARGET:$REMOTE_TMP/"
ssh "$SSH_TARGET" "bash '$REMOTE_TMP/deploy-remote.sh' '$REMOTE_TMP' '$BASE' '$DEPLOY_DOMAIN' '$USE_HTTPS'"
