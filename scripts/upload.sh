#!/bin/sh
# 已由功能更完整的一键部署脚本取代。
# 保留此入口以兼容旧习惯，实际转调 scripts/deploy.sh。
set -eu
cd "$(dirname "$0")/.."
sh scripts/deploy.sh "$@"
