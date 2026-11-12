#!/usr/bin/env bash
# 由 deploy.sh 在 Linux 服务器调用，不直接在开发电脑执行。
set -Eeuo pipefail
umask 022
UPLOAD=$1
BASE=$2
DOMAIN=$3
HTTPS=$4
[[ $EUID -eq 0 ]] || { echo '部署需要 root（systemd/Nginx）' >&2; exit 1; }
[[ "$BASE" =~ ^/opt/[a-zA-Z0-9_-]+(/[a-zA-Z0-9_-]+)*$ ]] || exit 2
[[ "$DOMAIN" =~ ^[a-zA-Z0-9][a-zA-Z0-9.-]*$ ]] || exit 2
[[ "$HTTPS" = 0 || "$HTTPS" = 1 ]] || exit 2
for cmd in sha256sum tar flock curl runuser systemctl; do command -v "$cmd" >/dev/null; done
install -d -m 0755 "$BASE"
exec 9>"$BASE/.deploy.lock"
flock -n 9 || { echo '已有部署正在运行' >&2; exit 1; }
(cd "$UPLOAD" && sha256sum --check device-ledger.tar.gz.sha256)
STAGE=$(mktemp -d "$BASE/.release.XXXXXX")
SWITCHED=0
OLD_MOVED=0
HAD_SERVICE=0
HAD_NGINX=0
SERVICE_INSTALLED=0
NGINX_INSTALLED=0
WAS_ACTIVE=0
systemctl is-active --quiet device-ledger && WAS_ACTIVE=1
SERVICE=/etc/systemd/system/device-ledger.service
NGINX=/etc/nginx/conf.d/device-ledger.conf
BACKUP="$(mktemp -d "$BASE/.deploy-config.XXXXXX")"
[[ ! -f "$SERVICE" ]] || { cp -p "$SERVICE" "$BACKUP/service"; HAD_SERVICE=1; }
[[ ! -f "$NGINX" ]] || { cp -p "$NGINX" "$BACKUP/nginx"; HAD_NGINX=1; }
rollback() {
  status=$?
  trap - EXIT
  if [[ $status -ne 0 && ( $SWITCHED = 1 || $OLD_MOVED = 1 ) ]]; then
    echo '部署失败，正在恢复旧应用与配置' >&2
    systemctl stop device-ledger || true
    if [[ $SWITCHED = 1 ]]; then mv "$BASE/app" "$BASE/failed-$(date +%s)"; fi
    if [[ $OLD_MOVED = 1 ]]; then mv "$BASE/previous" "$BASE/app"; fi
    if [[ $SERVICE_INSTALLED = 1 ]]; then
      if [[ $HAD_SERVICE = 1 ]]; then cp "$BACKUP/service" "$SERVICE"; else rm -f "$SERVICE"; fi
    fi
    if [[ $NGINX_INSTALLED = 1 ]]; then
      if [[ $HAD_NGINX = 1 ]]; then cp "$BACKUP/nginx" "$NGINX"; else rm -f "$NGINX"; fi
      nginx -t && systemctl reload nginx || true
    fi
    systemctl daemon-reload || true
    if [[ $WAS_ACTIVE = 1 ]]; then systemctl start device-ledger || true; fi
  fi
  rm -rf -- "$STAGE" "$BACKUP"
  exit "$status"
}
trap rollback EXIT
# 仅解压本项目打包器产物（已校验摘要）。数据库始终留在独立 data 目录。
tar --no-same-owner -xzf "$UPLOAD/device-ledger.tar.gz" -C "$STAGE"
chmod 0755 "$STAGE"
for entry in web/dist/index.html web/site-dist/index.html; do
  [[ -s "$STAGE/$entry" ]] || { echo "缺少双站点构建：$entry" >&2; exit 1; }
done
bash "$STAGE/deploy/install-node24.sh"
export PATH=/opt/node24/bin:$PATH
if ! id deviceledger >/dev/null 2>&1; then
  useradd --system --home-dir "$BASE" --shell /usr/sbin/nologin deviceledger
fi
install -d -m 0700 -o deviceledger -g deviceledger "$BASE/data"
[[ -f "$BASE/data/ledger.sqlite" ]] || {
  echo "缺少 $BASE/data/ledger.sqlite；禁止自动创建线上空库。请先按 deploy/README.md 准备已有 schema 1 数据库。旧应用未切换。" >&2; exit 1;
}
cd "$STAGE"
# 前端已经本地构建，只安装服务端生产依赖；禁用 Husky 等开发生命周期。
npm ci --omit=dev --ignore-scripts --no-audit --no-fund
runuser -u deviceledger -- env DATABASE_PATH="$BASE/data/ledger.sqlite" /opt/node24/bin/node scripts/db-check.js
if ! command -v nginx >/dev/null 2>&1; then
  if command -v apt-get >/dev/null; then apt-get update && apt-get install -y nginx
  elif command -v dnf >/dev/null; then dnf install -y nginx
  elif command -v yum >/dev/null; then yum install -y nginx
  else echo '请先安装 Nginx' >&2; exit 1; fi
fi
ORIGIN="http://$DOMAIN"
TEMPLATE=nginx-device-ledger.conf
if [[ "$HTTPS" = 1 ]]; then
  ORIGIN="https://$DOMAIN"
  TEMPLATE=nginx-device-ledger.ssl.conf
  for cert in fullchain.pem privkey.pem; do
    [[ -s "/etc/letsencrypt/live/$DOMAIN/$cert" ]] || { echo "缺少证书 $cert，请先申请证书，再使用 --https" >&2; exit 1; }
  done
fi
sed -e "s#/opt/device-ledger#$BASE#g" -e "s#http://CHANGE_ME#$ORIGIN#g" \
  -e "s#COOKIE_SECURE=false#COOKIE_SECURE=$([[ $HTTPS = 1 ]] && echo true || echo false)#" \
  deploy/device-ledger.service > "$BACKUP/new-service"
sed -e "s#server_name _#server_name $DOMAIN#g" -e "s#live/CHANGE_ME/#live/$DOMAIN/#g" \
  "deploy/$TEMPLATE" > "$BACKUP/new-nginx"
# 切换前校验候选 Nginx 配置，不覆盖当前站点。
printf 'events {}\nhttp { include %s; }\n' "$BACKUP/new-nginx" > "$BACKUP/nginx-test.conf"
nginx -t -c "$BACKUP/nginx-test.conf"
# 快照可用于人工灾难恢复；失败回退不会自动覆盖业务数据库。
install -d -m 0700 -o deviceledger -g deviceledger "$BASE/backups"
runuser -u deviceledger -- env DATABASE_PATH="$BASE/data/ledger.sqlite" \
  /opt/node24/bin/node scripts/backup-database.js "$BASE/backups/pre-deploy-$(date +%Y%m%d-%H%M%S).sqlite"
chmod 0755 "$STAGE"
# 应用代码归 root，服务账户只有 data 写权限。
if [[ -e "$BASE/previous" ]]; then mv "$BASE/previous" "$BASE/previous-$(date +%s)"; fi
if [[ -e "$BASE/app" || -L "$BASE/app" ]]; then mv "$BASE/app" "$BASE/previous"; OLD_MOVED=1; fi
mv "$STAGE" "$BASE/app"
SWITCHED=1
install -m 0644 "$BACKUP/new-service" "$SERVICE"
SERVICE_INSTALLED=1
systemctl daemon-reload
systemctl restart device-ledger
READY=0
for attempt in {1..20}; do
  if curl -fsS --max-time 3 http://127.0.0.1:3000/api/v1/health/ready >/dev/null; then READY=1; break; fi
  sleep 1
done
[[ $READY = 1 ]] || { journalctl -u device-ledger -n 30 --no-pager; exit 1; }
# 路由/资源冒烟检查，与本地部署包验收使用同一脚本。
node "$BASE/app/scripts/check-release.js" http://127.0.0.1:3000
install -m 0644 "$BACKUP/new-nginx" "$NGINX"
NGINX_INSTALLED=1
nginx -t
systemctl enable device-ledger nginx
if systemctl is-active --quiet nginx; then systemctl reload nginx; else systemctl start nginx; fi
echo "部署完成：$ORIGIN/（普通用户） $ORIGIN/admin/（后台）"
echo "上一版：$BASE/previous；数据库备份：$BASE/backups"
