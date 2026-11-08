export function macInstallScript(appUrl: string): string {
  return `#!/bin/sh
set -eu

APP_URL="${appUrl}"
LABEL="com.flarebot.local"
DIR="$HOME/.flarebot-local"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
DOMAIN="gui/$(id -u)"

if [ "$(uname)" != "Darwin" ]; then
  echo "flarebot-local runs on macOS only."
  exit 1
fi

if [ "\${1:-}" = "uninstall" ]; then
  launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
  rm -f "$PLIST"
  rm -rf "$DIR"
  echo "flarebot-local is removed. Unpair this Mac in flarebot too."
  exit 0
fi

BUN="$(command -v bun || true)"
if [ -z "$BUN" ] && [ -x "$HOME/.bun/bin/bun" ]; then BUN="$HOME/.bun/bin/bun"; fi
if [ -z "$BUN" ]; then
  echo "Installing Bun, which runs flarebot-local..."
  curl -fsSL https://bun.sh/install | bash >/dev/null
  BUN="$HOME/.bun/bin/bun"
fi

mkdir -p "$DIR" "$HOME/Library/LaunchAgents"
curl -fsSL "$APP_URL/mac/flarebot-local.ts" -o "$DIR/flarebot-local.ts"

cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$BUN</string>
    <string>$DIR/flarebot-local.ts</string>
    <string>run</string>
    <string>--url</string>
    <string>$APP_URL</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>StandardOutPath</key><string>$DIR/daemon.log</string>
  <key>StandardErrorPath</key><string>$DIR/daemon.log</string>
</dict>
</plist>
PLIST

launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
launchctl bootstrap "$DOMAIN" "$PLIST"
echo "flarebot-local is running and starts at login. Follow the popups to pick a folder and connect."
`;
}
