#!/usr/bin/env bash
set -euo pipefail
export CLAUDE_LOCAL_URL="${CLAUDE_LOCAL_URL-http://127.0.0.1:8788}"
if [ -n "$CLAUDE_LOCAL_URL" ]; then
  if ! curl -fsS "$CLAUDE_LOCAL_URL/health" >/dev/null 2>&1; then
    echo "Local Claude is not running at $CLAUDE_LOCAL_URL. Run: bun run claude:local" >&2
    exit 1
  fi
else
  CLAUDE_CODE_OAUTH_TOKEN="$(sec get CLAUDE_CODE_OAUTH_TOKEN)"
  export CLAUDE_CODE_OAUTH_TOKEN
fi
CODEMODE_API_KEY="$(sec get CODEMODE_API_KEY)"
export CODEMODE_API_KEY
CLOUDFLARE_ACCOUNT_ID="$(sec get FLAREBOT_CLOUDFLARE_ACCOUNT_ID)"
export CLOUDFLARE_ACCOUNT_ID
export FLAREBOT_LOCAL_DEV=1
export CLOUDFLARE_INCLUDE_PROCESS_ENV=true
exec bunx vite dev --host 127.0.0.1 --port "${PORT:-8787}" --strictPort
