#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

jdk21="$(brew --prefix openjdk@21 2>/dev/null)/libexec/openjdk.jdk/Contents/Home"
if [ -d "$jdk21" ]; then
  JAVA_HOME="$jdk21"
  export JAVA_HOME
fi

FLAREBOT_APP_URL="https://$(sec get FLAREBOT_DOMAIN)"
export FLAREBOT_APP_URL

google_services="$(sec get FLAREBOT_GOOGLE_SERVICES_JSON 2>/dev/null || true)"
if [ -n "$google_services" ]; then
  printf '%s' "$google_services" > android/app/google-services.json
fi

bun run build
bunx cap sync

if [ "$#" -gt 0 ]; then
  exec bunx cap "$@"
fi
