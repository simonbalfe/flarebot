#!/usr/bin/env bash
set -euo pipefail
rm -f /tmp/.X1-lock /tmp/.X11-unix/X1 /workspace/.chrome/Singleton*
Xvfb :1 -screen 0 1280x800x24 -nolisten tcp &
until [ -e /tmp/.X11-unix/X1 ]; do sleep 0.1; done
fluxbox >/dev/null 2>&1 &
x11vnc -display :1 -forever -shared -nopw -localhost -rfbport 5900 -quiet >/dev/null 2>&1 &
if [ "${FLAREBOT_RESTORE:-}" = "1" ]; then
  (until [ -e /tmp/flarebot-restored ]; do sleep 0.2; done; exec browser about:blank) &
else
  browser about:blank &
fi
exec websockify --web /usr/share/novnc 6080 localhost:5900
