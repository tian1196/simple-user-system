#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
mkdir -p dist

# 默认打包“源码”，不含 node_modules/data/dist；服务器端再安装依赖并构建前端。
# 如已在本地构建好前端并希望连同 web/dist 一起上传，执行：INCLUDE_WEB_DIST=1 sh scripts/pack.sh
if [ "${INCLUDE_WEB_DIST:-0}" = "1" ] && [ -f web/dist/index.html ]; then
  tar -czf dist/device-ledger.tar.gz \
    --exclude='./node_modules' \
    --exclude='./.git' \
    --exclude='./dist' \
    --exclude='./data' \
    --exclude='./web/node_modules' \
    --exclude .DS_Store \
    .
  echo "已生成 dist/device-ledger.tar.gz（包含 web/dist 构建产物）"
else
  tar -czf dist/device-ledger.tar.gz \
    --exclude='./node_modules' \
    --exclude='./.git' \
    --exclude='./dist' \
    --exclude='./data' \
    --exclude='./web/node_modules' \
    --exclude='./web/dist' \
    --exclude .DS_Store \
    .
  echo "已生成 dist/device-ledger.tar.gz"
  echo "未包含 node_modules、web/dist 和 data（依赖与构建在服务器完成，数据库留在服务器）"
fi
