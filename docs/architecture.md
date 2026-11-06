# Architecture

The agent lives in a Durable Object. The computer is disposable.

## Parts

| Part | Runs on | Holds |
| --- | --- | --- |
| Worker | Cloudflare Worker | API, auth, web app, screen proxy |
| `User` | Durable Object | Bot list and sidebar summaries |
| `Bot` | Durable Object, one per Bot | Pi agent loop, transcript, memory, takeover state, replies owed |
| `Computer` | Durable Object and container, one per user | Linux desktop, Chrome, terminal, `/workspace` |
| Models | OpenRouter | Claude models, through `pi-ai` |

## Flows

### Sending a message

1. `POST /api/bots/:id/messages` submits to the Bot's Pi conversation and returns 202.
2. The UI polls `GET /api/bots/:id` every 800 ms while the Bot is busy.
3. A message sent during a turn steers it.

### Using the computer

1. A tool calls the `Computer` Durable Object.
2. `Computer` starts the container if it's off, restoring the latest snapshot.
3. Commands run with `container.exec()`, input with `xdotool`, and screenshots with `scrot`.

### Watching and taking over

1. The UI loads noVNC from `/api/computer/vnc/*`, which proxies to port 6080 in the container.
2. A Bot calls `request_takeover`, which shows a card, and ends its turn.
3. You take over, and **I'm done, continue** sends a message that resumes the Bot.

### Bots messaging each other

1. `message_bot` delivers a message to the other Bot as a follow-up.
2. When that Bot's turn ends, its final message returns to the sender automatically.
3. That returned reply doesn't trigger another one.
4. A chain stops after 6 messages, and resets when you next write to that Bot.

### Sleeping

1. An alarm checks for activity every minute.
2. After 10 idle minutes, `Computer` quits Chromium, saves a snapshot and destroys the container.
3. The next use restores files and the Chrome profile. Running processes and open tabs are lost.

## Cookie import

`scripts/import-chrome-cookies.ts` copies logins from local Chrome to the computer:

1. Copies Chrome's cookie database to a temporary folder.
2. Reads the key from the macOS Keychain, which asks for approval.
3. Decrypts the cookies and posts them to `/api/computer/cookies`.
4. `computer/import-cookies.mjs` loads them into Chromium through its debugging protocol.

| Flag | Purpose |
| --- | --- |
| `--domains a.com,b.com` | Import only these sites |
| `--profile Default` | Choose the Chrome profile |
| `--url` | Choose the target app |
| `--dry-run` | Count cookies without importing |

To wipe the computer, including imported logins: `curl -X POST http://127.0.0.1:8787/api/computer/reset`.

**Risk:** every Bot can use and read imported logins, because `run_command` has full access to the computer. No approvals exist yet, and snapshots contain the logins too.

**Limits:**
- Chromium caps its store near 3,300 cookies, so the import keeps 3,000, preferring `HttpOnly` then recently used.
- Partitioned cookies, localStorage, passkeys and saved passwords aren't copied.

## Known limits

| Area | Limit |
| --- | --- |
| Stop | Ends the turn, but a running command continues until its timeout |
| Snapshots | In public beta and expire after 30 days. An expired restore isn't handled |
| Paste | Local clipboard paste doesn't reach the desktop during takeover |
| Local image | `linux/amd64`, so it runs under emulation on Apple silicon |
| Updates | The UI polls instead of using a WebSocket |

## Deploying

Not done yet. It needs:

1. A Cloudflare Access application, with its tag in `ACCESS_AUD` in `wrangler.jsonc`. Without it, the API answers 503.
2. `OPENROUTER_API_KEY` set as a Worker secret.
