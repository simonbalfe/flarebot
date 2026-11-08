# Architecture

The agent lives in a Durable Object. The computer is disposable.

## Bubbles

Each Bot is a bubble scoped to one job. All Bots share one computer and one Chrome, so the logins are shared, but each Bot's knowledge and work stay its own.

| Scope | Where it lives | Shared |
| --- | --- | --- |
| Role | `profile.role` in the `Bot` storage, also in the `User` Bot list | No |
| Memory | `memory` in the `Bot` storage | No |
| Model | `profile.model` in the `Bot` storage | No |
| Inbox | `flarebot_mailbox` table in the `Bot` storage | No |
| Browser tab | One Chrome window per Bot, its target ID in the `Computer` storage under `tabs` | No |
| Files, skills, CLIs | `/workspace/bots/<Bot ID>` on the shared computer | By convention only |
| Folder repo | The Bot's folder is a clone of its own Artifacts repo | No |
| Chrome profile and logins | `/workspace/.chrome` | Yes |
| Computer | One container, the `Computer` named `me` | Yes |

Bubbles cross only through messages: `message_bot`, the replies it triggers, and group posts. A Bot that needs another Bot's skill or knowledge asks for it in a message.

## Parts

| Part | Runs on | Holds |
| --- | --- | --- |
| Worker | Cloudflare Worker | API, auth, web app, screen proxy |
| `User` | Durable Object | Bot list with roles, and sidebar summaries |
| `Bot` | Durable Object, one per Bot | Pi agent loop, role, transcript, memory, mailbox, takeover state, replies owed |
| `Computer` | Durable Object and container, one per user | Linux desktop, one Chrome with a tab per Bot, terminal, `/workspace` |
| Models | OpenRouter | Claude models, through `pi-ai` |

## Flows

### Sending a message

1. `POST /api/bots/:id/messages` submits to the Bot's Pi conversation and returns 202.
2. The UI polls `GET /api/bots/:id` every 800 ms while the Bot is busy.
3. A message sent during a turn steers it.

### Using the computer

1. A tool calls the `Computer` Durable Object.
2. `Computer` starts the container if it's off, restoring the latest snapshot.
3. `run_command` runs with `container.exec()`, starting in the Bot's folder with its `bin` on `PATH`.

### Using the browser

Chromium runs once, with its debugging port on 9222. Every Bot drives its own window through the Chrome DevTools Protocol, so Bots never move each other's page.

1. `open_url`, `screenshot`, `click`, `type_text`, `press_key` and `scroll` call `Computer.browser(botId, action)`.
2. `Computer` runs browser actions one at a time. It passes the Bot's saved target ID and the action to `computer/browser-tab.mjs`, which the Worker sends to `node -e`, so the script doesn't depend on the image or a snapshot.
3. The script opens a maximized window for the Bot if its target is gone, brings it to the front, attaches, and runs the action: `Page.navigate`, `Page.captureScreenshot` (JPEG at quality 70, to keep the output small), `Input.dispatchMouseEvent`, `Input.insertText` or `Input.dispatchKeyEvent`. Navigation, clicks and keys wait for the page to load.
4. It returns the target ID, the tab's URL and title, and the screenshot when asked. `Computer` saves the target ID under `tabs`.

`tabs` is cleared when the computer sleeps or resets, so each Bot gets a new window on the next use.

### Watching and taking over

1. The UI loads noVNC from `/api/computer/vnc/*`, which proxies to port 6080 in the container.
2. A Bot calls `request_takeover`, which shows a card, brings the Bot's window to the front, and ends its turn.
3. Opening the computer from a Bot's chat calls `POST /api/bots/:id/tab/show`, which also brings that Bot's window to the front.
4. You take over, and **I'm done, continue** sends a message that resumes the Bot.

### Bots messaging each other

Your own messages go straight into a Bot's chat and steer the current turn. Everything from another Bot or a group goes through the receiving Bot's mailbox.

1. `message_bot` writes an envelope to the other Bot's `flarebot_mailbox` table and returns. The envelope holds an ID, sender, text, chain count, who is owed a reply, and the group, if any.
2. The receiving Bot drains its mailbox at once, after each alarm, and after a restart. It submits each envelope as a follow-up, using the envelope ID as the request ID, and marks it `delivered`.
3. A failed delivery retries 5 times, waiting 5, 10, 20 and 40 seconds. The alarm is set for the next retry. After the last attempt the envelope is marked `failed`, and the sender gets a message saying it was not delivered.
4. When that Bot's turn ends, its final message goes back to the sender's mailbox. A reply that can't be queued stays owed and is sent at the next settle.
5. That returned reply doesn't trigger another one.
6. A chain stops after 6 messages, and resets when you next write to that Bot.

`GET /api/bots/:id` returns `mailbox.queued` and `mailbox.failed`.

### Sleeping

1. An alarm checks for activity every minute.
2. After 10 idle minutes, `Computer` quits Chromium, saves a snapshot and destroys the container.
3. The next use restores files and the Chrome profile. Running processes and open tabs are lost.

A snapshot restores the whole container filesystem, including files from an older image. Files changed in `computer/` reach a computer that already has a snapshot only after a reset.

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

**Risk:** every Bot can use and read imported logins, because they share one Chrome profile and `run_command` has full access to the computer. No approvals exist yet, and snapshots contain the logins too.

**Limits:**
- Chromium caps its store near 3,300 cookies, so the import keeps 3,000, preferring `HttpOnly` then recently used.
- Partitioned cookies, localStorage, passkeys and saved passwords aren't copied.

## Group chats

`Group` is a Durable Object holding one group's transcript and member list. Each Bot has one Pi conversation for its chat with you, plus one per group. A group message goes into each chosen Bot's mailbox, and from there only to that group's conversation, marked with the group's name and the last 10 messages, so it never appears in the Bot's own chat. A Bot's memory is in the prompt of all its own conversations, and no other Bot's.

| You write | Who gets it |
| --- | --- |
| `@Name` | Each Bot named |
| `@everyone` | Every member |
| A Bot's name without `@` | Each Bot named |
| No name | The Bots chosen by the router |

1. `Bot.#submitToGroup` records each group message in `pendingGroupReplies`.
2. When it settles, `Bot.#settleGroupReplies` posts the final answer to the group. The list is rechecked on every start and alarm, so a restart doesn't lose the reply.
3. A post with `@Name` hands work to that Bot. A group allows 6 Bot posts after each message from you, and later posts stay in the transcript without routing.

`src/worker/mentions.ts` matches names, ignoring case. Plain names count only in your messages, because a Bot naming another Bot in passing must not start work. An `@` mention takes priority, so `@Throng ask Vivek` goes only to Throng.

`src/worker/router.ts` makes one `ROUTER_MODEL` call for each message with no name, using member names, roles and memories, the last 10 messages and the new message. It usually picks one Bot. If the call fails or picks nobody, the message goes to the last Bot that spoke, or else the first member.

**Limits:**
- A Bot with no role, a vague name and no memory is hard to route to.
- Replies, reactions and threads aren't built.
- A group's members and name can't be changed after creation.
- A Bot works in several conversations at once, but they share that Bot's one tab and can clash on it.
- `message_bot` replies only reach a Bot's own chat, so it's refused inside a group.
- A reply owed through `message_bot` waits until all of that Bot's conversations are idle.

## Skills and CLIs

Each Bot keeps its skills and CLIs in its own folder. To pass a process to another Bot, it sends the steps with `message_bot`.

| Path | Contents |
| --- | --- |
| `/workspace/bots/<Bot ID>` | The Bot's folder, where `run_command` starts in every thread. A clone of its repo, as [Folder repo](#folder-repo) shows |
| `/workspace/bots/<Bot ID>/bin` | The Bot's CLIs, on `PATH` for its `run_command` |
| `/workspace/bots/<Bot ID>/skills/<name>/SKILL.md` | The Bot's skill instructions, plus any scripts beside them |

| Tool | Purpose |
| --- | --- |
| `list_skills` | Names and descriptions of the Bot's skills |
| `load_skill` | Full instructions for one of its skills |
| `save_skill` | Create or replace one of its skills |
| `run_command` | Download or build a CLI into its `bin` |

`PUT /api/computer/files` and `scripts/install-on-computer.ts` copy files in from outside. Paths must be under `/workspace`; use `/workspace/bots/<Bot ID>/...` to give one Bot a file.

**Risk:** the folders are separated by the prompt, not by permissions. `run_command` can still read or change another Bot's folder, and there is no version history or review.

**Limits:**
- Skills and CLIs live in snapshots, so a reset or an expired snapshot deletes them.
- CLIs must be Linux `amd64` builds.

## Threads

A Bot has its main chat plus any threads you start. A thread is only a new Pi conversation: the folder, files, role, memory, skills and Chrome tab are the same in every thread.

| Action | API |
| --- | --- |
| Start a thread | `POST /api/bots/:id/threads` |
| Read one | `GET /api/bots/:id/threads/:threadId` |
| Send to it | `POST /api/bots/:id/threads/:threadId/messages` |
| Stop its turn | `POST /api/bots/:id/threads/:threadId/stop` |
| Close it | `POST /api/bots/:id/threads/:threadId/close` |

1. `threads` in the `Bot` storage holds each thread's ID, title, conversation ID, last submission and whether it's closed. `GET /api/bots/:id` lists the open ones.
2. A thread's title is the first 40 characters of its first message.
3. The tab bar above the transcript switches between **Main** and the threads, starts one with **+**, and closes one with its **×**. Closing stops the thread's turn and auto-saves the folder.

**Limits:**
- Only the main chat can `message_bot`, so Bot replies and the mailbox always go to the main chat.
- Threads share one folder and one Chrome tab, so two threads working at once can clash.
- A closed thread can't be reopened from the UI.

## Folder repo

Each Bot's folder, `/workspace/bots/<Bot ID>`, is a git clone of the Bot's own Cloudflare Artifacts repo, in the `flarebot` namespace through the `ARTIFACTS` binding. The repo is named `<bot name>-<first 8 characters of the Bot ID>`, for example `jake-1a2b3c4d`. `src/worker/repos.ts` holds the git logic, and `GET /api/bots/:id` returns the path and repo as `workspace`.

1. The first `run_command`, `pull_repo` or `push_repo` creates the repo if it doesn't exist and clones it into the folder. Files already in the folder stay and are saved on the next auto-save; files missing locally are restored from the repo.
2. `bin/` is excluded from git, so downloaded CLIs aren't saved. Skills in `skills/` are saved.
3. **Auto-save:** when the Bot goes idle, and when a thread closes, any change in the folder is committed as `flarebot: <Bot> auto-save` and pushed to the default branch.
4. `push_repo` commits and pushes at once. `pull_repo` fetches and fast-forwards.
5. Each git call gets a repo-scoped token from the binding: `read` for clone and pull, `write` for push, 10 minutes, revoked when the call ends. The token reaches git only as an `http.extraHeader` in the command's environment, so it never enters a file, the transcript or the model.
6. Commits use the Bot's name as the author.
7. The Details panel shows the folder and the repo.

**Limits:**
- One repo per Bot. A Bot can't switch to another repo yet.
- Work since the last auto-save lives only on the computer, so a reset mid-turn loses it.
- Local dev uses the remote Artifacts service, so `scripts/dev.sh` sets `CLOUDFLARE_ACCOUNT_ID` and needs `wrangler login`.

## Known limits

| Area | Limit |
| --- | --- |
| Stop | Ends the turn, but a running command continues until its timeout |
| Snapshots | In public beta and expire after 30 days. An expired restore isn't handled |
| Paste | Local clipboard paste doesn't reach the desktop during takeover |
| Local image | `linux/amd64`, so it runs under emulation on Apple silicon |
| Updates | The UI polls instead of using a WebSocket |
| Browser | Bots see and control only web pages. Chrome's own UI, its dialogs and other desktop apps aren't reachable by a Bot |
| Browser speed | Browser actions run one at a time across all Bots, each starting a short `node` process |

## Sign-in

`src/worker/auth.ts` protects every `/api/*` route except `/api/auth/*` with Better Auth magic links.

1. `POST /api/auth/sign-in/magic-link` emails a link through the `EMAIL` binding. An address not in `FLAREBOT_ALLOWED_EMAILS` gets the same response, but no email.
2. The link works once and expires after 10 minutes.
3. Opening an expired or used link returns to the sign-in screen with an error.
4. Opening a valid link creates a 30-day session, stored in the `AUTH_DB` D1 database.

`FLAREBOT_LOCAL_DEV=1`, set by `scripts/dev.sh`, skips the check locally.

## Deploying

`scripts/deploy.sh` builds, applies D1 migrations, deploys, then copies secrets from Infisical to the Worker.

| Infisical secret | Purpose |
| --- | --- |
| `OPENROUTER_API_KEY` | Model calls |
| `BETTER_AUTH_SECRET` | Signs sessions |
| `FLAREBOT_ALLOWED_EMAILS` | Comma-separated addresses that can sign in |
| `FLAREBOT_MAIL_FROM` | Sender, on a domain enabled for Cloudflare Email Sending |
| `FLAREBOT_DOMAIN` | Custom domain, also used for the app URL |
| `FLAREBOT_CLOUDFLARE_ACCOUNT_ID` | Target account |

**Limit:** `scripts/import-chrome-cookies.ts` and `scripts/install-on-computer.ts` send no session cookie, so they only work against local dev.
