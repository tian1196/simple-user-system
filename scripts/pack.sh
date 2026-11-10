#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
mkdir -p dist

ARCHIVE=dist/device-ledger.tar.gz
rm -f "$ARCHIVE"

# Default: source only. Dependencies and the web build happen on the server.
# To include an already built frontend, run: INCLUDE_WEB_DIST=1 sh scripts/pack.sh
#
# Note: macOS bsdtar strips "./" before matching excludes, so exclude the
# concrete archive path rather than the "dist" directory; otherwise the
# nested web/dist is excluded as well.
if [ "${INCLUDE_WEB_DIST:-0}" = "1" ] && [ -f web/dist/index.html ]; then
  tar -czf "$ARCHIVE" \
    --exclude='node_modules' \
    --exclude='.git' \
    --exclude='dist/device-ledger.tar.gz' \
    --exclude='data' \
    --exclude .DS_Store \
    .
  echo "Generated $ARCHIVE (includes web/dist)"
else
  tar -czf "$ARCHIVE" \
    --exclude='node_modules' \
    --exclude='.git' \
    --exclude='dist/device-ledger.tar.gz' \
    --exclude='data' \
    --exclude='web/dist' \
    --exclude .DS_Store \
    .
  echo "Generated $ARCHIVE"
  echo "No node_modules, web/dist or data included"
fi
