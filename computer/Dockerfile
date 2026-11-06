FROM debian:trixie-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
  ca-certificates chromium curl dbus-x11 fluxbox fonts-liberation fonts-noto-color-emoji git \
  jq nodejs novnc procps python3 python3-websockify scrot websockify x11vnc xdotool xterm xvfb \
  && rm -rf /var/lib/apt/lists/*
RUN useradd --create-home --shell /bin/bash bot && mkdir -p /workspace && chown bot:bot /workspace
COPY start.sh /usr/local/bin/start-computer
COPY browser.sh /usr/local/bin/browser
COPY import-cookies.mjs /usr/local/lib/import-cookies.mjs
RUN chmod +x /usr/local/bin/start-computer /usr/local/bin/browser
USER bot
WORKDIR /workspace
ENV DISPLAY=:1
EXPOSE 6080
ENTRYPOINT ["/usr/local/bin/start-computer"]
