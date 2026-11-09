#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../model-container"
[ -d node_modules ] || npm ci --ignore-scripts --no-audit --no-fund

unset CLAUDE_CODE_OAUTH_TOKEN ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN
export PORT="${CLAUDE_LOCAL_PORT:-8788}"
export HOST=127.0.0.1
export SESSIONS_DIR="$HOME/.flarebot-local/sessions"
export PI_CODING_AGENT_DIR="$HOME/.flarebot-local/pi-agent"
exec node --import tsx server.ts
