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
| `ModelContainer` | Durable Object and container, one per Bot, plus one named `shared` for group routing | `pi-claude-bridge` on the Claude Agent SDK and your Claude subscription, starts on a model call and sleeps after 10 idle minutes |

## Model calls

`src/worker/claude.ts` is the Pi provider. Each model turn goes to the Bot's own `ModelContainer`, where `model-container/server.ts` hosts the `pi-claude-bridge` extension and streams Pi's `AssistantMessageEvent`s back as NDJSON.

- `pi-claude-bridge` is installed from npm at an exact version. `server.ts` gives it a minimal Pi extension host: it captures the provider the extension registers and fires the `session_start` and `before_agent_start` events the extension expects.
- Pi still runs every tool inside the Bot. The bridge serves the tools to Claude Code through its own MCP server and parks the query until the next request delivers the tool result, so one Claude Code query spans the whole tool loop.
- A Bot's container keeps one Claude Code session per Bot, under `/home/node/sessions/<Bot id>`, and the bridge resumes it so the prompt cache carries across turns. After a sleep or deploy the bridge rebuilds the session from the transcript Pi sends.
- `ModelContainer` is separate from `Computer` because Bots run arbitrary commands on `Computer`. The token reaches the container only, never `Computer` or the model.
- The system prompt is Claude Code's own preset with the Bot prompt appended. The bridge rejects a prompt that contains Pi's built-in preamble.
- Group routing and other one-shot calls (`claudeText`) use the `shared` container with `oneShot` set, which the bridge runs as an isolated query with no session and no cache.
- The image runs as the `node` user, because Claude Code refuses to run with permissions bypassed as root.
- `wrangler.jsonc` allows 20 `ModelContainer` instances, one per active Bot.
- **Local Claude (dev only):** with `CLAUDE_LOCAL_URL` set, `claudeTransport` in `claude.ts` posts turns to that URL instead of a `ModelContainer`, and `claudeToken` sends no token. `bun run claude:local` runs the same `server.ts` natively on the Mac at `http://127.0.0.1:8788`, so Claude Code uses the Mac's own `claude auth login` session. `scripts/dev.sh` sets `CLAUDE_LOCAL_URL` to that address by default and refuses to start if it isn't up. Run `CLAUDE_LOCAL_URL= bun run dev` to use the Docker container and the `sec` token instead.
- The local run keeps its sessions in `~/.flarebot-local/sessions` and the bridge state in `~/.flarebot-local/pi-agent`. Claude Code also writes its own session files under `~/.claude`, so these Bot sessions appear in your Claude Code history.
- The deployed Worker can't reach your Mac, so production never sets `CLAUDE_LOCAL_URL` and keeps using containers with the Worker secret.
- Each Bot stores its own model and effort. A new effort applies from the next turn, and group routing always runs at low effort.

**Limits:**
- Only the 10 newest images are sent. Older screenshots become a text placeholder.
- Each container runs 5 turns at once. Later turns wait for a free slot.
- All Bots share the subscription's rate limits with your own Claude Code use.
- The subscription is for your own use, so `FLAREBOT_ALLOWED_EMAILS` should list only you.
- `Bot.#moveOffOpenRouter` and `claudeModelId` move existing Bots off stored OpenRouter model IDs. Both can go once every deployed Bot has woken once.

## Desktop app

`src-tauri/` is a Tauri 2 shell around the same React and Kumo UI. It adds no UI code, so the interface is identical to the web app.

- The window loads the deployed app URL, so `/api`, cookies, sign-in and the live browser view behave as they do in a browser, with no CORS or cookie changes.
- `bun run tauri:dev` opens a window on the dev server at `http://127.0.0.1:8787`. Start `bun run dev` first.
- `bun run tauri:build` reads `FLAREBOT_DOMAIN` with `sec`, builds the web app and bundles `Flarebot.app` with that URL. `scripts/tauri.sh` sets it through `TAURI_CONFIG`.
- The shell has no Rust commands and no capabilities yet. The Mac daemon sidecar, native approval dialogs and the streaming relay to a local Claude are not built.
- Web Push and the service worker are the browser's. They are not wired to the desktop window.

## Flows

### Sending a message

`POST /api/bots/:id/clear` stops the Bot and starts a new context for Main with Pi's `reset`. Memory, the folder, threads and group chats stay.

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
5. That returned reply doesn't trigger another one. Every `message_bot` is owed a reply; there is no opt-out, so the sender always sees the answer and relays it to you.
6. A request reaches the other Bot marked `[Message from Bot: name]`, and the answer comes back marked `[Reply from Bot: name]`, so each Bot knows whether its answer is routed back. The transcript shows both as messages from that Bot.
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

### Shared pool: CLIs and skills

One pool of CLIs and Agent Skills for all Bots. You or a Bot adds an item once, then you tick it for each Bot that should have it.

| Action | API |
| --- | --- |
| List the pool | `GET /api/clis`, `GET /api/skills` |
| Add or replace a CLI | `PUT /api/clis/:name?description=…` with the binary as the body, or `bun scripts/add-cli.ts --file <path> [--name] [--description]` |
| Add or replace a skill | `POST /api/skills` with a `SKILL.md` or a `.tar.gz` of the skill folder as the body, or `bun scripts/add-skill.ts --path <folder or SKILL.md>` |
| Remove an item from the pool and every Bot | `DELETE /api/clis/:name`, `DELETE /api/skills/:name` |
| Set a Bot's items | `PUT /api/bots/:id/clis` or `PUT /api/bots/:id/skills` with `{"names": [...]}` |

1. The pool is the Artifacts repo `toolbox`, cloned to `/workspace/toolbox`. A CLI is `clis/<name>/<name>`; a skill is the folder `skills/<name>/` with its `SKILL.md`, scripts and references. `src/worker/pool.ts` holds the logic.
2. Every add or remove commits and pushes `toolbox`, so the pool survives a computer reset. The next `run_command` or `load_skill` from a Bot with pool items clones it back.
3. The `User` storage holds the pool lists as `clis` and `skills`. Each Bot stores its ticked items under the same keys, and `GET /api/bots/:id` returns them.
4. **CLIs:** `run_command` puts the Bot's own `bin` first on `PATH`, then the folder of each ticked CLI. The prompt lists the ticked CLIs with their descriptions and tells the Bot to run `--help` first.
5. **Skills** follow the [Agent Skills specification](https://agentskills.io/specification), the format Pi implements:
   - `SKILL.md` starts with `name` and `description` frontmatter. The name is lowercase letters and numbers joined by single hyphens, up to 64 characters; the description is 1 to 1024 characters. Folded (`>`) and literal (`|`) descriptions work. The pool takes the name from the frontmatter and refuses a file that breaks these rules.
   - The prompt lists ticked skills in Pi's `<available_skills>` block with name, description and `SKILL.md` location, and never the full instructions.
   - `load_skill` returns the full `SKILL.md` and the skill's directory, so the Bot resolves relative paths against it. A Bot's own skill wins over a shared one of the same name. `list_skills` returns own and shared skills.
6. **Bot-made items:** a Bot writes a CLI or a skill folder, tests it, then calls `publish_cli` (name, path, description) or `publish_skill` (path). Paths are relative to the folder the chat works in, or absolute under the Bot's own folder. A CLI must start with `#!` or be a Linux binary; bash, python3 and node are on the computer, and a Bot downloads other toolchains into its own `bin`.
7. A published item records the Bot as `publishedBy` and is ticked for that Bot at once. A Bot can replace only items it published. You can replace or remove any item.
8. The Details panel's **CLIs** and **Skills** sections tick items, add one from a file, and remove one.
9. `save_skill` writes a private skill to the Bot's own `skills/` folder, not to the pool. The **Skills** section lists the Bot's private skills under the shared ones, with a lock icon and a publish button. `GET /api/bots/:id/own-skills` scans the folder when the computer is running and otherwise returns the last scan; `POST /api/bots/:id/own-skills/:name/publish` publishes one to the pool as that Bot's and ticks it.

**Limits:**
- 30 MB per upload, from the Durable Object call size limit.
- Ticking is enforced only through `PATH` and the prompt. A Bot can still read `/workspace/toolbox` directly.
- CLIs and skills get no secrets yet.
- Nothing reviews a Bot-made item before it enters the pool. It reaches another Bot only when you tick it there.
- Compiled toolchains such as Go, Rust and Bun aren't in the computer image, so a Bot downloads them again after a reset.
- `disable-model-invocation`, `allowed-tools` and `/skill:name` commands from the spec aren't supported.

**Risk:** the folders are separated by the prompt, not by permissions. `run_command` can still read or change another Bot's folder, and there is no version history or review.

**Limits:**
- A Bot's own `bin` lives only in snapshots, so a reset or an expired snapshot deletes it. Its own skills are saved in its repo.
- CLIs must be Linux `amd64` builds.

## Threads

A Bot has its main chat plus any threads you start. A thread is a new Pi conversation that works in the Bot's own folder or in a [project](#projects). The role, memory, skills and Chrome tab are the same in every thread.

| Action | API |
| --- | --- |
| Start a thread | `POST /api/bots/:id/threads` with `{"project": null}` for the own folder, or a project name |
| Read one | `GET /api/bots/:id/threads/:threadId` |
| Send to it | `POST /api/bots/:id/threads/:threadId/messages` |
| Stop its turn | `POST /api/bots/:id/threads/:threadId/stop` |
| Close it | `POST /api/bots/:id/threads/:threadId/close` |

1. `threads` in the `Bot` storage holds each thread's ID, title, conversation ID, last submission and whether it's closed. `GET /api/bots/:id` lists the open ones.
2. A thread's title is the first 40 characters of its first message.
3. The tab bar above the transcript switches between **Main** and the threads, and closes one with its **×**. **+** opens a menu of **Own folder** and each project. A project thread's tab shows the project name. Closing stops the thread's turn and auto-saves its folder.

**Limits:**
- Only the main chat can `message_bot`, so Bot replies and the mailbox always go to the main chat.
- Threads share one folder and one Chrome tab, so two threads working at once can clash.
- A thread can use `message_bot`. The reply comes back to that thread, or to Main if the thread has closed. The receiving Bot always answers from its Main.
- A closed thread can't be reopened from the UI.

## Folder repo

Each Bot's folder, `/workspace/bots/<Bot ID>`, is a git clone of the Bot's own Cloudflare Artifacts repo, in the `flarebot` namespace through the `ARTIFACTS` binding. The repo is named `<bot name>-<first 8 characters of the Bot ID>`, for example `jake-1a2b3c4d`. `src/worker/repos.ts` holds the git logic, and `GET /api/bots/:id` returns the path and repo as `workspace`.

1. The first `run_command`, `pull_repo` or `push_repo` creates the repo if it doesn't exist and clones it into the folder. Files already in the folder stay and are saved on the next auto-save; files missing locally are restored from the repo.
2. `bin/` and `projects/` are excluded from git, so downloaded CLIs and project clones aren't saved to the Bot's repo. Skills in `skills/` are saved.
3. **Auto-save:** when the Bot goes idle, and when a thread closes, any change in the folder is committed as `flarebot: <Bot> auto-save` and pushed to the default branch.
4. `push_repo` commits and pushes at once. `pull_repo` fetches and fast-forwards.
5. Each git call gets a repo-scoped token from the binding: `read` for clone and pull, `write` for push, 10 minutes, revoked when the call ends. The token reaches git only as an `http.extraHeader` in the command's environment, so it never enters a file, the transcript or the model.
6. Commits use the Bot's name as the author.
7. The Details panel shows the folder and the repo.

**Limits:**
- Work since the last auto-save lives only on the computer, so a reset mid-turn loses it.
- Local dev uses the remote Artifacts service, so `scripts/dev.sh` sets `CLOUDFLARE_ACCOUNT_ID` and needs `wrangler login`.

## Projects

A project is an existing repo in the `flarebot` Artifacts namespace that any Bot can work in from a thread. flarebot never creates a project repo. You push the repo to Artifacts yourself, then register its name.

| Action | API |
| --- | --- |
| List projects | `GET /api/projects` |
| Register one | `POST /api/projects` with `{"name": "<repo>"}`. Refused if no such repo exists |
| Unregister one | `DELETE /api/projects/:name`. The repo stays |

1. The `User` storage holds the list as `projects`. `GET /api/bots` returns it too.
2. A thread started in a project works in `/workspace/bots/<Bot ID>/projects/<name>`, a clone of the project repo. Every thread of that Bot in that project shares the clone.
3. Each Bot works on its own branch, `flarebot/<Bot repo name>`. The first clone checks out that branch if it exists on the remote, or creates it from the default branch.
4. Auto-save commits and pushes to the Bot's branch, never to the default branch. The prompt tells the Bot the same.
5. When the Bot goes idle, the own folder and every project with an open thread are auto-saved.

**Limits:**
- Merging a Bot's branch into the default branch is up to you.

## Editing and deleting

Right-click a Bot in the sidebar for **Edit** and **Delete**, or a group for **Rename** and **Delete**.

| Action | API |
| --- | --- |
| Edit a Bot's name and role | `PATCH /api/bots/:id` |
| Delete a Bot | `DELETE /api/bots/:id` |
| Rename a group | `PATCH /api/groups/:id` |
| Delete a group | `DELETE /api/groups/:id` |

1. Renaming a Bot keeps its repo name, so the folder repo doesn't change.
2. Deleting a Bot stops its conversations, removes it from every group, deletes a group left empty, and wipes the Bot's Durable Object storage.
3. Deleting a group wipes its transcript. The member Bots stay.

**Limits:**
- Deleting a Bot leaves its folder on the computer and its repo in Artifacts.

## Mac access

A Bot can use your own Mac through native tools. A small daemon, `scripts/flarebot-local.ts`, runs on the Mac and keeps one outbound WebSocket to the `Mac` Durable Object, so the Mac opens no port.

```
Bot tool mac_* ──▶ Mac Durable Object ──WebSocket──▶ flarebot-local on the Mac ──▶ approval dialog ──▶ action
```

### Connecting a Mac

1. Details → Mac → **+** shows `curl -fsSL <app url>/mac/install.sh | sh`. Run it once in Terminal.
2. `install.sh` (built by `src/worker/mac-install.ts` with the app's own URL) installs Bun if it's missing, downloads the daemon from `/mac/flarebot-local.ts` into `~/.flarebot-local`, and registers the LaunchAgent `com.flarebot.local`, which starts at login and restarts after a crash.
3. On its first run the daemon asks for a folder with the macOS folder picker. It must be inside the home folder and can't be the home folder itself.
4. It then starts a device link: `POST /api/mac/link` returns a secret device code and a short user code, and the daemon opens `<app url>/connect-mac?code=<user code>` in the browser with a notification showing the same code.
5. On that page, signed in, **Connect** approves the link. Details → Mac shows a pending link with the same **Connect** button.
6. The daemon polls `POST /api/mac/link/poll` every 2 seconds. Once approved it receives a device token, single use, and connects.

| Daemon command | Does |
| --- | --- |
| `run [--url]` | Start, setting up through popups when needed. Only one copy runs at a time |
| `add-folder` | Pick another allowed folder |
| `allow <folder>`, `disallow <folder>` | Change allowed folders. A running daemon sends the change within 2 seconds |
| `forget-always` | Clear every "Always allow" choice |
| `unlink`, `status` | Drop the token, or show the setup |

`curl -fsSL <app url>/mac/install.sh | sh -s uninstall` removes the LaunchAgent and `~/.flarebot-local`.

| Tool | Action |
| --- | --- |
| `mac_run` | A `zsh -l` command in an allowed folder, 120 second timeout |
| `mac_read` | A text file up to 1 MB |
| `mac_write` | Create or replace a text file |
| `mac_list` | A folder's entries, or the allowed folders with no path |
| `mac_open` | An http(s) URL, or a file or folder, with `open` |

1. **Link security:** the user code is 8 characters and the link lasts 10 minutes. Starting a new link replaces a pending one. The device code and the device token are random 256-bit values; the `Mac` Durable Object stores only their SHA-256 hashes. The daemon keeps the token in `~/.config/flarebot-local/config.json` with mode `0600`. Linking again replaces the old device.
2. **Routes:** `/mac/install.sh`, `/mac/flarebot-local.ts`, `POST /api/mac/link`, `POST /api/mac/link/poll`, `GET /api/mac/whoami` and `GET /api/mac/connect` sit outside the session check, because the daemon has no session. Approving (`POST /api/mac/link/approve`), status, unpair and the per-Bot switch need a session.
3. **Requests:** a tool call becomes `Mac.request`, which sends `{id, bot, action}` over the socket and waits up to 6 minutes for the result. Offline, unpaired and disconnected Macs fail at once with a clear error.
4. **The daemon decides:** before any dialog, it refuses relative paths, paths outside the allowed folders after resolving symlinks and `..`, any command containing `sudo`, and everything when no folder is allowed. Then it shows a macOS dialog: **Deny**, **Allow once** or **Always allow <Bot>**. The dialog denies after 120 seconds. Requests run one at a time.
5. **Always allow** is stored per Bot ID in the daemon config.
6. **Unpair:** the **×** in Details → Mac closes the socket. The daemon clears its token, shows a notification and exits; running the install command again reconnects.
7. The prompt describes the Mac tools only to a Bot whose **Access** is ticked. With it off, every Mac tool fails.

**Limits:**
- One Mac per account.
- Approval happens only on the Mac, so a Mac away from you denies by timeout.
- `mac_run` is a full shell inside the allowed folder once approved; the folder check covers its starting folder, not what the command touches.
- Like any device-code flow, anyone can start a link. Approve only a code your own Mac is showing.
- No screenshots or GUI control.

## MCP servers

Remote MCP servers are added once and switched on per Bot, so each Bot only sees the servers that fit its role. `src/worker/mcp.ts` wraps `@earendil-works/pi-mcp`, pi's MCP client, over Streamable HTTP.

| Action | API |
| --- | --- |
| List servers | `GET /api/mcp` |
| Add a server | `POST /api/mcp` with `name`, `url`, optional `description` and `token` |
| Remove a server | `DELETE /api/mcp/:id`, which also switches it off for every Bot |
| Choose a Bot's servers | `PUT /api/bots/:id/mcp` with `serverIds` |

1. Adding a server connects and lists its tools first, and refuses the server if that fails. The `User` storage keeps the server under `mcpServers`, with the token as an `authorization: Bearer` header.
2. The token never leaves the Worker: the API and the Bot's view show only `hasToken`, and the prompt shows only names and descriptions.
3. A Bot keeps its switched-on servers under `mcpServers` in its storage, and its prompt lists them.
4. `mcp_list_tools(server)` returns a server's tools with their input schemas, and `mcp_call(server, tool, arguments)` runs one. Each call opens a session, runs, and closes it, with no server-to-client stream.
5. Results go through `toLlmContent`, which keeps text and images and turns other content into short text. Text over 30,000 characters is cut.

The Details panel lists the servers with a checkbox for this Bot, adds one with **+** (name, URL, token), and removes one with its **×**.

**Limits:**
- Bearer tokens only. Servers that need an OAuth sign-in aren't supported yet, though `pi-mcp` has the OAuth client for it.
- Streamable HTTP only, no stdio servers.
- MCP tools are reached through the two generic tools rather than as one tool each.

## Known limits

| Area | Limit |
| --- | --- |
| Stop | Ends the turn, but a running command continues until its timeout |
| Snapshots | In public beta and expire after 30 days. An expired restore isn't handled |
| Paste | Local clipboard paste doesn't reach the desktop during takeover |
| Local image | `linux/amd64`, so it runs under emulation on Apple silicon |
| Updates | The UI polls instead of using a WebSocket |
| Poll errors | A failed poll shows no error until that poll has been failing for 15 seconds while the app is visible. The timer restarts when the app returns to the foreground, because phones cancel requests in flight when an app is suspended |
| Browser | Bots see and control only web pages. Chrome's own UI, its dialogs and other desktop apps aren't reachable by a Bot |
| Browser speed | Browser actions run one at a time across all Bots, each starting a short `node` process |

## Sign-in

`src/worker/auth.ts` protects every `/api/*` route except `/api/auth/*` with Better Auth email codes.

1. `POST /api/auth/email-otp/send-verification-otp` emails a 6-digit code through the `EMAIL` binding. An address not in `FLAREBOT_ALLOWED_EMAILS` gets the same response, but no email.
2. The code is stored hashed, expires after 10 minutes and allows 3 tries.
3. `POST /api/auth/sign-in/email-otp` with the code creates a 30-day session, stored in the `AUTH_DB` D1 database.
4. A code instead of a link because an installed web app keeps its own cookies: a link opened from the mail app would sign in the browser, not the app.

`FLAREBOT_LOCAL_DEV=1`, set by `scripts/dev.sh`, skips the check locally.

## Mobile app

flarebot installs as a web app (PWA) on Android and iPhone.

| Piece | Where |
| --- | --- |
| Manifest, icons | `public/manifest.webmanifest`, `public/icon-192.png`, `public/icon-512.png` (also the maskable icon), `public/apple-touch-icon.png`, `public/icon.svg` |
| Service worker | `public/sw.js`: caches the app shell so it opens offline. It handles only top-level page loads of the app, never `/api/` or `/mac/` and never iframes, so the live browser view (`/api/computer/vnc/vnc.html`) can't replace the cached app |
| Head tags | `index.html`: theme colours, Apple web-app tags, `interactive-widget=resizes-content` so Android resizes the layout for the keyboard |
| Visible-viewport height | `src/web/mobile.ts` sets `--fb-viewport-height` from `visualViewport`, so the composer stays above the iPhone keyboard |
| Updates | `src/web/main.tsx` checks for a new service worker whenever the app comes back to the foreground, and reloads once when a new one takes control. Bump `shellCache` in `public/sw.js` when the shell changes |

Below 768px wide the layout follows iOS Messages:

1. The chat list is the root screen, with a large title and search.
2. Tapping a chat pushes it with a back chevron and the Bot's avatar and name centred. Tapping the name opens Details.
3. Details and Computer open as full-screen sheets with **Done**.
4. Each step adds a browser history entry, so the Android back gesture and the browser back button go sheet → chat → list.
5. Long-press a row for Edit and Delete; inputs use 16px text so focusing them doesn't zoom; the composer doesn't grab focus on phones.
6. Take over opens full screen. While you're in control, noVNC's own control handle stays on the left edge, so its on-screen keyboard is reachable. The app isn't locked to portrait, so turning the phone sideways shows the desktop larger.

Install on Android: open the site in Chrome, then menu → **Install app**. On iPhone: Safari → Share → **Add to Home Screen**.

**Limits:**
- Chrome's **Desktop site** setting makes the page ignore the mobile viewport, so a phone shows the desktop layout until it's switched off.
- In portrait the live view is a landscape desktop fitted to a narrow screen; turn the phone sideways to take over.
- Push needs the installed app on iPhone (iOS 16.4+); Safari tabs can't subscribe. Push is off in `bun run dev`, which registers no service worker.

### Push notifications

The bell in the chat list footer turns push on for that device.

1. `src/web/push.ts` asks for permission, fetches the public key from `GET /api/push/key`, subscribes through the service worker and saves the subscription with `POST /api/push/subscriptions`. Turning it off calls `DELETE /api/push/subscriptions`.
2. `User` keeps the subscriptions and a VAPID key pair it generates on first use, both in its own storage.
3. `Bot` records each message you send to it or one of its threads. When that run settles, it sends the last answer, or the error, as a notification. Group replies notify as they're posted. Bot to Bot mailbox runs and stopped runs don't notify.
4. `src/worker/push.ts` encrypts the payload (RFC 8291, `aes128gcm`) and signs a VAPID JWT with Web Crypto. Endpoints that answer 404 or 410 are dropped.
5. `public/sw.js` shows the notification, tagged per Bot, thread or group so a newer one replaces the old. Tapping it focuses the app and opens that chat (`/?bot=`, `&thread=`, or `/?group=`).

## Deploying

`scripts/deploy.sh` builds, applies D1 migrations, deploys, then copies secrets from Infisical to the Worker.

| Infisical secret | Purpose |
| --- | --- |
| `CLAUDE_CODE_OAUTH_TOKEN` | Model calls on your Claude subscription, from `claude setup-token` |
| `CODEMODE_API_KEY` | The built-in `codemode` MCP server, on by default for every Bot until unticked in Details |
| `BETTER_AUTH_SECRET` | Signs sessions |
| `FLAREBOT_ALLOWED_EMAILS` | Comma-separated addresses that can sign in |
| `FLAREBOT_MAIL_FROM` | Sender, on a domain enabled for Cloudflare Email Sending |
| `FLAREBOT_DOMAIN` | Custom domain, also used for the app URL |
| `FLAREBOT_CLOUDFLARE_ACCOUNT_ID` | Target account |
| `LANGFUSE_HOST`, `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY` | Optional. Turns on [Langfuse tracing](#langfuse-tracing) when all three are set |

### Langfuse tracing

`src/worker/langfuse.ts` sends one trace per model turn to Langfuse's OTLP endpoint, from `claude.ts`, after the turn ends. With any of the three secrets missing it does nothing. A failed send is logged as `langfuse_failed` and never affects the turn.

- Every trace is named `flarebot` and tagged `flarebot` plus `bot` or `router`. The Langfuse user is the Bot's name, and the session is the conversation.
- Failed turns have level `ERROR` and the error as the status message. When Claude's tool input or a container line can't be parsed, the raw text is in the `error_detail` metadata.
- Traces hold conversation messages, tool arguments and output, so they include any client data in them. Each field is cut to its last 50,000 characters and images are replaced with `[image]`. The Claude token is never sent.
- Failed turns are also logged to Workers Logs as `model_turn_failed`, with or without Langfuse.

Local dev doesn't load these secrets, so it sends nothing.

**Limit:** `scripts/import-chrome-cookies.ts` and `scripts/install-on-computer.ts` send no session cookie, so they only work against local dev.
