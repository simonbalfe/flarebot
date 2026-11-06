#!/usr/bin/env bash
set -euo pipefail
OPENROUTER_API_KEY="$(sec get OPENROUTER_API_KEY)"
export OPENROUTER_API_KEY
export FLAREBOT_LOCAL_DEV=1
export CLOUDFLARE_INCLUDE_PROCESS_ENV=true
exec bunx vite dev --host 127.0.0.1 --port "${PORT:-8787}"
