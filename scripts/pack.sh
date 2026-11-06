#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
mkdir -p dist
tar -czf dist/device-ledger.tar.gz \
  --exclude node_modules \
  --exclude .git \
  --exclude dist \
  --exclude data \
  --exclude .DS_Store \
  .
echo "已生成 dist/device-ledger.tar.gz"
echo "未包含 node_modules 和 data（数据库留在服务器上）"
