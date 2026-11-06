#!/usr/bin/env bash
exec chromium --no-sandbox --test-type --no-first-run --no-default-browser-check --disable-dev-shm-usage \
  --password-store=basic --remote-debugging-address=127.0.0.1 --remote-debugging-port=9222 \
  --user-data-dir=/workspace/.chrome --start-maximized "$@" >/dev/null 2>&1
