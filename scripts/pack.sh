#!/bin/sh
# 默认交付本地构建好的用户站、后台和服务端。--source 仅用于服务器构建。
set -eu
cd "$(dirname "$0")/.."
MODE=built
BUILD=1
for arg in "$@"; do
  case "$arg" in
    --source) MODE=source ;;
    --no-build) BUILD=0 ;;
    *) echo "Usage: npm run pack -- [--source | --no-build]" >&2; exit 2 ;;
  esac
done
if [ "$MODE" = built ]; then
  if [ "$BUILD" = 1 ]; then npm run web:build; fi
  for entry in web/dist/index.html web/site-dist/index.html; do
    [ -s "$entry" ] || { echo "Missing build: $entry" >&2; exit 1; }
  done
fi
mkdir -p dist
STAGING=$(mktemp -d "${TMPDIR:-/tmp}/ledger-pack.XXXXXX")
trap 'rm -rf "$STAGING"' EXIT HUP INT TERM
# 白名单收集：不打包项目根目录，防止带入本地凭据、数据库、其他部署包。
# 同时过滤子目录中的 Vite 环境配置和开发缓存。
COPYFILE_DISABLE=1 tar -cf "$STAGING/source.tar" \
  --exclude=node_modules --exclude=.env --exclude='.env.*' \
  --exclude='*.sqlite*' --exclude='*.db*' --exclude='*.log' \
  --exclude=.DS_Store --exclude='*.tsbuildinfo' \
  --exclude=dist --exclude=site-dist \
  package.json package-lock.json README.md server public migrations scripts deploy web
mkdir "$STAGING/app"
tar -xf "$STAGING/source.tar" -C "$STAGING/app"
cp .env.example "$STAGING/app/.env.example"
if [ "$MODE" = built ]; then
  mkdir -p "$STAGING/app/web/dist" "$STAGING/app/web/site-dist"
  COPYFILE_DISABLE=1 tar -cf "$STAGING/build.tar" web/dist web/site-dist
  tar -xf "$STAGING/build.tar" -C "$STAGING/app"
fi
node - "$STAGING/app/release.json" "$MODE" <<'JS'
const fs = require('node:fs')
fs.writeFileSync(process.argv[2], JSON.stringify({
  version: require('./package.json').version,
  built_at: new Date().toISOString(),
  frontend: process.argv[3],
  node: '>=24.13.0 <25',
  entries: { site: '/', admin: '/admin/', api: '/api/v1' },
}, null, 2) + '\n')
JS
COPYFILE_DISABLE=1 tar -czf "$STAGING/device-ledger.tar.gz" -C "$STAGING/app" .
mv "$STAGING/device-ledger.tar.gz" dist/device-ledger.tar.gz
node <<'JS'
const fs = require('node:fs')
const { createHash } = require('node:crypto')
const digest = createHash('sha256').update(fs.readFileSync('dist/device-ledger.tar.gz')).digest('hex')
fs.writeFileSync('dist/device-ledger.tar.gz.sha256', `${digest}  device-ledger.tar.gz\n`)
JS
printf 'Generated dist/device-ledger.tar.gz (%s) and SHA256\n' "$MODE"
