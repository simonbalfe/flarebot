#!/usr/bin/env bash
set -euo pipefail

command="${1:?usage: scripts/tauri.sh dev|build}"
shift

domain="$(sec get FLAREBOT_DOMAIN)"
FLAREBOT_APP_URL="https://${domain}"
export FLAREBOT_APP_URL

if [ "$command" = "dev" ]; then
  TAURI_CONFIG="{\"build\":{\"devUrl\":\"${FLAREBOT_APP_URL}\"}}"
  export TAURI_CONFIG
fi

if [ "$command" = "build" ]; then
  TAURI_CONFIG="{\"app\":{\"windows\":[{\"title\":\"Flarebot\",\"url\":\"${FLAREBOT_APP_URL}\",\"width\":1200,\"height\":800,\"minWidth\":800,\"minHeight\":560}]}}"
  export TAURI_CONFIG
  bun run build
fi

exec bunx tauri "$command" "$@"
