#!/bin/sh
set -eu
cd "$(dirname "$0")/.."

HOST="${DEPLOY_HOST:-115.190.233.106}"
USER_NAME="${DEPLOY_USER:-root}"
DEST="${DEPLOY_PATH:-/opt/device-ledger}"

sh scripts/pack.sh

echo "上传到 ${USER_NAME}@${HOST}:${DEST}"
scp dist/device-ledger.tar.gz "${USER_NAME}@${HOST}:/tmp/device-ledger.tar.gz"
ssh "${USER_NAME}@${HOST}" "mkdir -p '${DEST}' && tar -xzf /tmp/device-ledger.tar.gz -C '${DEST}' && rm -f /tmp/device-ledger.tar.gz && cd '${DEST}' && npm install --omit=dev --ignore-scripts && npm rebuild better-sqlite3"

echo "代码已上传。没有覆盖 ${DEST}/data 里的数据库。"
echo "在服务器上启动："
echo "ssh ${USER_NAME}@${HOST} \"cd ${DEST} && DATABASE_PATH=${DEST}/data/ledger.sqlite sudo npm start\""
