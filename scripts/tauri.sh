#!/usr/bin/env bash
set -euo pipefail

command="${1:?usage: scripts/tauri.sh dev|build}"
shift

if [ "$command" = "build" ]; then
  domain="$(sec get FLAREBOT_DOMAIN)"
  TAURI_CONFIG="{\"app\":{\"windows\":[{\"title\":\"Flarebot\",\"url\":\"https://${domain}\",\"width\":1200,\"height\":800,\"minWidth\":800,\"minHeight\":560}]}}"
  export TAURI_CONFIG
  bun run build
fi

exec bunx tauri "$command" "$@"
