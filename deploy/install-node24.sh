#!/usr/bin/env bash
# Project runtime only; never replaces /usr/bin/node or edits global PATH.
set -Eeuo pipefail
umask 022
export PATH=/usr/sbin:/usr/bin:/sbin:/bin
[[ $EUID -eq 0 ]] || { echo 'ERROR: run as root.' >&2; exit 1; }
[[ $(uname -m) == x86_64 ]] || { echo 'ERROR: this package is Linux x86_64 only.' >&2; exit 1; }
for cmd in curl tar gzip sha256sum mktemp flock; do
 command -v "$cmd" >/dev/null || { echo "ERROR: missing command: $cmd" >&2; exit 1; }
done
TARGET=/opt/node24
VERSION=v24.22.2
ARCHIVE=node-v24.22.2-linux-x64.tar.gz
EXPECTED=361718c444e49af2ca5a110c83ba6a8901143f23ab285ebbef0341f391f482a9
install -d -o root -g root -m 0755 /opt/device-ledger
exec 9>/opt/device-ledger/.node24-install.lock
flock -n 9 || { echo 'ERROR: installation already running.' >&2; exit 1; }
if [[ -e "$TARGET" || -L "$TARGET" ]]; then
 if [[ ! -L "$TARGET" && -x "$TARGET/bin/node" && $("$TARGET/bin/node" --version) == "$VERSION" ]]; then
  "$TARGET/bin/node" -e "if (typeof require('node:sqlite').DatabaseSync !== 'function') process.exit(1)"
  echo 'SUCCESS: /opt/node24 already installed; nothing overwritten.'
  exit 0
 fi
 echo 'ERROR: /opt/node24 exists but is not the expected runtime. No overwrite performed.' >&2
 exit 1
fi
TMP_RUNTIME="$(mktemp -d /opt/device-ledger/.node24-install.XXXXXX)"
trap 'rm -rf -- "$TMP_RUNTIME"' EXIT
# Optional offline archive placed beside this script via FinalShell.
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
if [[ -f "$SCRIPT_DIR/$ARCHIVE" ]]; then
 cp -- "$SCRIPT_DIR/$ARCHIVE" "$TMP_RUNTIME/$ARCHIVE"
else
 curl --fail --location --connect-timeout 20 --max-time 600 --retry 2 \
  "https://nodejs.org/download/release/$VERSION/$ARCHIVE" -o "$TMP_RUNTIME/$ARCHIVE"
fi
(cd "$TMP_RUNTIME" && printf '%s  %s\n' "$EXPECTED" "$ARCHIVE" | sha256sum --check --status)
echo 'SHA256 verified.'
tar --no-same-owner -xzf "$TMP_RUNTIME/$ARCHIVE" -C "$TMP_RUNTIME"
"$TMP_RUNTIME/node-$VERSION-linux-x64/bin/node" --version
"$TMP_RUNTIME/node-$VERSION-linux-x64/bin/node" -e "if (typeof require('node:sqlite').DatabaseSync !== 'function') process.exit(1); console.log('SQLite module: OK')"
mv -T --no-clobber "$TMP_RUNTIME/node-$VERSION-linux-x64" "$TARGET"
[[ ! -d "$TMP_RUNTIME/node-$VERSION-linux-x64" ]] || { echo 'ERROR: target appeared; no overwrite.' >&2; exit 1; }
echo 'SUCCESS: project Node runtime installed at /opt/node24'
echo 'Existing /usr/bin/node and database unchanged.'
