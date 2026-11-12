#!/usr/bin/env bash
set -euo pipefail

export CLOUDFLARE_ACCOUNT_ID="$(sec get FLAREBOT_CLOUDFLARE_ACCOUNT_ID)"
domain="$(sec get FLAREBOT_DOMAIN)"

bun run build
bunx wrangler d1 migrations apply AUTH_DB --remote --config wrangler.jsonc
bunx wrangler deploy --domain "$domain"

secrets_json() {
  sec run -- bun -e '
    const names = ["CLAUDE_CODE_OAUTH_TOKEN", "CODEMODE_API_KEY", "BETTER_AUTH_SECRET", "FLAREBOT_API_KEY", "FLAREBOT_ALLOWED_EMAILS", "FLAREBOT_MAIL_FROM", "LANGFUSE_HOST", "LANGFUSE_PUBLIC_KEY", "LANGFUSE_SECRET_KEY"];
    const secrets = Object.fromEntries(names.map((name) => [name, process.env[name]]));
    const push = { APNS_KEY_P8: process.env.FLAREBOT_APNS_KEY_P8, APNS_KEY_ID: process.env.FLAREBOT_APNS_KEY_ID, APNS_TEAM_ID: process.env.FLAREBOT_APNS_TEAM_ID, FCM_SERVICE_ACCOUNT: process.env.FLAREBOT_FCM_SERVICE_ACCOUNT };
    console.log(JSON.stringify({ ...secrets, ...push, LANGFUSE_HOST: process.env.FLAREBOT_LANGFUSE_HOST ?? process.env.LANGFUSE_HOST, FLAREBOT_APP_URL: `https://${process.env.FLAREBOT_DOMAIN}` }));
  '
}

secrets_json | bunx wrangler secret bulk
