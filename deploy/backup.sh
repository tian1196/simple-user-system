#!/usr/bin/env bash
# 定时在线备份：SQLite快照及该快照引用的反馈截图。失败由systemd记录，不发布残缺备份。
set -Eeuo pipefail
umask 077
BASE=${LEDGER_BASE:-/opt/device-ledger}
DIR="$BASE/backups"
exec 9>"$DIR/.backup.lock"
flock -n 9 || exit 0
FILE="$DIR/ledger-$(date +%Y%m%d-%H%M%S).sqlite"
runuser -u deviceledger -- env DATABASE_PATH="$BASE/data/ledger.sqlite" \
  /opt/node24/bin/node "$BASE/app/scripts/backup-database.js" "$FILE"
# 沿用14天保留期，只清理本任务命名的历史备份及其配套附件。
while IFS= read -r -d '' old; do
  rm -f -- "$old"
  [[ ! -d "$old.attachments" ]] || rm -rf -- "$old.attachments"
done < <(find "$DIR" -maxdepth 1 -type f -name 'ledger-????????-??????.sqlite' -mmin +20160 -print0)
