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
| Browser tab | One Chrome window per Bot, its target ID in the `SharedComputer` storage under `tabs` | No |
| Files, skills | `/workspace/bots/<Bot ID>` in the Bot's own Durable Object | No |
| CLIs | `/workspace/bots/<Bot ID>/bin` on the shared computer | By convention only |
| Folder repo | The Bot's folder is a clone of its own Artifacts repo | No |
| Chrome profile and logins | `/workspace/.chrome` | Yes |
| Computer | One container, the `SharedComputer` named `me` | Yes |

Bubbles cross only through messages: `message_bot`, the replies it triggers, and group posts. A Bot that needs another Bot's skill or knowledge asks for it in a message.

## Parts

| Part | Runs on | Holds |
| --- | --- | --- |
| Worker | Cloudflare Worker | API, auth, web app, screen proxy |
| `User` | Durable Object | Bot list with roles, and sidebar summaries |
| `Bot` | Durable Object, one per Bot | Pi agent loop, role, transcript, memory, mailbox, takeover state, replies owed |
| `SharedComputer` | Durable Object and container, one per user, on the `durable_object` scheduling policy with the `desktop` image and a `standard-2` instance chosen in `start()` | Linux desktop, one Chrome with a tab per Bot, terminal, `/workspace` |
| `FILES` | R2 bucket `flarebot-files` | Backups of each Bot's `bin` and the Chrome profile |
| `ModelContainer` | Durable Object and container, one per Bot, plus one named `shared` for group routing | `pi-claude-bridge` on the Claude Agent SDK and your Claude subscription, starts on a model call and sleeps after 10 idle minutes |

## Model calls

`src/worker/claude.ts` is the Pi provider. Each model turn goes to the Bot's own `ModelContainer`, where `model-container/server.ts` hosts the `pi-claude-bridge` extension and streams Pi's `AssistantMessageEvent`s back as NDJSON.

- `pi-claude-bridge` is installed from npm at an exact version. `server.ts` gives it a minimal Pi extension host: it captures the provider the extension registers and fires the `session_start` and `before_agent_start` events the extension expects.
- Pi still runs every tool inside the Bot. The bridge serves the tools to Claude Code through its own MCP server and parks the query until the next request delivers the tool result, so one Claude Code query spans the whole tool loop.
- A Bot's container keeps one Claude Code session per Bot, under `/home/node/sessions/<Bot id>`, and the bridge resumes it so the prompt cache carries across turns. After a sleep or deploy the bridge rebuilds the session from the transcript Pi sends.
- `ModelContainer` is separate from `SharedComputer` because Bots run arbitrary commands on `SharedComputer`. The token reaches the container only, never `SharedComputer` or the model.
- The system prompt is Claude Code's own preset with the Bot prompt appended. The bridge rejects a prompt that contains Pi's built-in preamble.
- Group routing and other one-shot calls (`claudeText`) use the `shared` container with `oneShot` set, which the bridge runs as an isolated query with no session and no cache.
- The image runs as the `node` user, because Claude Code refuses to run with permissions bypassed as root.
- `wrangler.jsonc` allows 20 `ModelContainer` instances, one per active Bot.
- **Local Claude (dev only):** with `CLAUDE_LOCAL_URL` set, `claudeTransport` in `claude.ts` posts turns to that URL instead of a `ModelContainer`, and `claudeToken` sends no token. `bun run claude:local` runs the same `server.ts` natively on the Mac at `http://127.0.0.1:8788`, so Claude Code uses the Mac's own `claude auth login` session. `scripts/dev.sh` sets `CLAUDE_LOCAL_URL` to that address by default and refuses to start if it isn't up. Run `CLAUDE_LOCAL_URL= bun run dev` to use the Docker container and the `sec` token instead.
- The local run keeps its sessions in `~/.flarebot-local/sessions` and the bridge state in `~/.flarebot-local/pi-agent`. Claude Code also writes its own session files under `~/.claude`, so these Bot sessions appear in your Claude Code history.
- **Mac relay (live):** the deployed Worker can't reach your Mac, so production never sets `CLAUDE_LOCAL_URL`. Instead `claudeTransport` first calls `Mac.modelTurn`, which sends `{type: "model-turn", id, body}` down the daemon's WebSocket and streams the NDJSON back as `model-chunk` and `model-end` messages. The Worker strips `token` from the body first, so the Mac only ever uses its own `claude auth login` session. If no Mac is connected, or its last `hello` said `claude: false`, the turn goes to the Bot's `ModelContainer` with the Worker secret as before.
- **Mac relay fallback:** `macTurn` waits up to 90 seconds for the first chunk. If the Mac sends nothing, ends empty, errors, or its first line is a `failure`, the Mac turn is cancelled and the same turn runs on the Bot's `ModelContainer`. A model turn runs no tools, so running it twice is safe, but it can cost twice.
- **Mac relay limits:** the choice is made per turn, so a Bot can move between the Mac and the container between turns. A turn that fails after its first chunk is not moved to the container, though Pi retries errors that look transient. Every turn, on the Mac or the container, fails with a `timeout` error after 180 seconds with no data. Sessions on the Mac live under `~/.flarebot-local/sessions`, separate from the container's.
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
- `bun run tauri:dev` opens a window on the deployed app, so it shows the live Bots, memory and Mac link. No local dev server is needed. Worker changes reach it only after `scripts/deploy.sh`, because local dev can't bind Durable Objects or containers to the deployed ones.
- `bun run tauri:build` reads `FLAREBOT_DOMAIN` with `sec`, builds the web app and bundles `Flarebot.app` with that URL. `scripts/tauri.sh` sets it through `TAURI_CONFIG`.
- On launch the shell starts `flarebot-local` (bundled as the resource `daemon/flarebot-local.ts`) with `~/.bun/bin/bun run --url <app url>`, and stops it with SIGTERM on quit. `FLAREBOT_APP_URL` is read at compile time, defaulting to `http://127.0.0.1:8787`; `scripts/tauri.sh` sets it to the deployed URL for both `dev` and `build`. If the LaunchAgent daemon is already running, the second copy exits on the lock and the app uses the running one.
- Closing the window hides it and keeps the daemon running. Clicking the Dock icon shows it again, and Quit stops the daemon.
- The shell has no Rust commands, tray icon or login item yet. Native approval dialogs are still the daemon's `osascript` dialogs. Bun must be installed at `~/.bun/bin/bun`, and `node`, `npm` and `claude` must be on the login shell's `PATH`.
- Web Push and the service worker are the browser's. They are not wired to the desktop window.
- `window.confirm` returns false without showing anything in the desktop window, because wry's macOS WebView delegate has no JavaScript dialog handlers. The web UI uses `ConfirmDialog` instead.

Tauri builds the Mac app only. `src-tauri/tauri.macos.conf.json` holds the `app` and `dmg` targets and the bundled daemon.

## Phone apps

The Android and iPhone apps are [Capacitor](https://capacitorjs.com) shells around the same UI, chosen over Tauri's mobile targets for the official push plugin and native projects that are committed and never regenerated.

- `capacitor.config.ts`: app ID `com.flarebot.app`, `webDir` `dist/client`, and `server.url` set to the deployed app when `FLAREBOT_APP_URL` is in the environment. The phones load the deployed app like the Mac window does, so cookies and sign-in work unchanged and a web deploy updates them. Capacitor injects its native bridge into that page, so plugins work on it.
- `android/` and `ios/` are committed and edited by hand. The copied web build and the generated `capacitor.config.json` in each are gitignored, so the deployed URL never reaches the repo.
- `scripts/cap.sh [cap args]`: sets `FLAREBOT_APP_URL` from `FLAREBOT_DOMAIN`, writes `android/app/google-services.json` from `FLAREBOT_GOOGLE_SERVICES_JSON` when that secret exists (the file is gitignored), uses Homebrew's `openjdk@21` when installed, builds the web app, runs `cap sync`, then any `cap` command passed. `bun run cap:android` runs it on a connected phone, `bun run cap:ios` opens Xcode.
- Android needs `ANDROID_HOME` and JDK 21. Gradle 8.14 in the Capacitor template can't run on JDK 26. A debug APK: `scripts/cap.sh`, then `./gradlew assembleDebug` in `android/` (about 6 MB).
- `scripts/android-release.sh` (`bun run android:release`): builds the unsigned release APK with Gradle, then aligns and signs it with the SDK's `zipalign` and `apksigner`, writing `android/app/build/outputs/apk/release/flarebot.apk`. The keystore is `FLAREBOT_ANDROID_KEYSTORE_B64` (base64 PKCS12, alias `flarebot`) and `FLAREBOT_ANDROID_KEYSTORE_PASSWORD` in Infisical, the same key the Tauri APK used, decoded to a temp folder only while signing. Every future version must be signed with that key, or Android refuses to update the installed app.
- `versionCode` is 2000 in `android/app/build.gradle`, above the Tauri APK's 1000, so the Capacitor APK installs as an update over it. Raise it for every release.
- Install with `adb install -r <apk>`, or send the APK to the phone and open it after allowing that app to install unknown apps. A debug build and a release build have different signatures, so switching between them needs an uninstall, which also signs you out.
- iOS needs full Xcode, an Apple developer team set in Xcode's Signing & Capabilities, and the Push Notifications capability on the App ID. `ios/App/App/App.entitlements` sets `aps-environment` and `AppDelegate.swift` forwards the APNs token to Capacitor. Xcode isn't installed on the build Mac yet, so the iOS project has never been built.
- App icons come from `public/icon.svg` (iOS, 1024px with no alpha, which the App Store requires) and the Tauri Android icons. The splash images are plain `#fcfcfc`.
- The Mac section works from a phone, because it talks to the paired Mac through the Worker.

## Flows

### Sending a message

`POST /api/bots/:id/clear` stops the Bot and starts a new context for Main with Pi's `reset`. Memory, the folder, threads and group chats stay.

1. `POST /api/bots/:id/messages` submits to the Bot's Pi conversation and returns 202.
2. The UI polls `GET /api/bots/:id` every 800 ms while the Bot is busy.
3. A message sent during a turn steers it. Pi holds it in the conversation's `pi.inbox` doc until the current tool round ends. `toTranscriptView` in `src/worker/view.ts` shows inbox items at the end of the transcript with `queued:<submission id>` IDs, and moves them into place once Pi does.
4. The UI shows each sent message as a pending bubble until the POST and the next view load finish. It hides a pending bubble as soon as the view holds more matching user messages than before the send, so a message never shows twice. A view response older than one already applied is dropped. A failed send puts the text back in the composer.

### Using the computer

1. A tool calls the `SharedComputer` Durable Object.
2. `SharedComputer` starts the container if it's off, restoring the latest snapshot, or a fresh image plus the R2 backups when there is none. See [Backups](#backups).
3. `run_linux` syncs the Bot's folder to the computer, then runs with `container.exec()`, starting in the Bot's folder with its `bin` on `PATH`. See [Folder repo](#folder-repo).

File tools and `bash` do not use the computer.

### Using the browser

Chromium runs once, with its debugging port on 9222. Every Bot drives its own window through the Chrome DevTools Protocol, so Bots never move each other's page.

1. `open_url`, `screenshot`, `click`, `type_text`, `press_key` and `scroll` call `Computer.browser(botId, action)`.
2. `SharedComputer` runs browser actions one at a time. It passes the Bot's saved target ID and the action to `computer/browser-tab.mjs`, which the Worker sends to `node -e`, so the script doesn't depend on the image or a snapshot.
3. The script opens a maximized window for the Bot if its target is gone, brings it to the front, attaches, and runs the action: `Page.navigate`, `Page.captureScreenshot` (JPEG at quality 70, to keep the output small), `Input.dispatchMouseEvent`, `Input.insertText` or `Input.dispatchKeyEvent`. Navigation, clicks and keys wait for the page to load.
4. It returns the target ID, the tab's URL and title, and the screenshot when asked. `SharedComputer` saves the target ID under `tabs`.

`tabs` is cleared when the computer sleeps or resets, so each Bot gets a new window on the next use.

### Watching and taking over

1. The UI loads noVNC from `/api/computer/vnc/*`, which proxies to port 6080 in the container.
2. A Bot calls `request_takeover`, which shows a card, brings the Bot's window to the front, and ends its turn.
3. Opening the computer from a Bot's chat calls `POST /api/bots/:id/tab/show`, which also brings that Bot's window to the front.
4. You take over, and **I'm done, continue** sends a message that resumes the Bot.

### Bots messaging each other

Your own messages go straight into a Bot's chat and steer the current turn. Everything from another Bot or a group goes through the receiving Bot's mailbox.

1. `message_bot` writes an envelope to the sending Bot's own `flarebot_outbox` table and returns. The envelope ID is `<conversation id>:<tool call id>`, so a replayed call writes the same row. The envelope holds an ID, sender, text, chain count, who is owed a reply, and the group, if any.
2. The sender drains its outbox at once, after each alarm, and after a restart. It calls the target's `enqueue()` and deletes the row on success. A failed call retries after 5 seconds, doubling up to 5 minutes, and is abandoned after 24 hours with an `outbox_abandoned` log line.
3. The receiving Bot's `enqueue()` inserts the envelope into its `flarebot_mailbox` table, ignoring an ID it already has. It drains the mailbox at once, after each alarm, and after a restart, submits each envelope as a follow-up using the envelope ID as the request ID, and marks it `delivered`.
4. A failed submit retries 5 times, waiting 5, 10, 20 and 40 seconds. After the last attempt the envelope is marked `failed`. If it was a request that is owed a reply, the sender gets a message through its outbox saying it was not delivered. A reply or notice that fails does not generate another notice.
5. Each owed reply is stored with the submission that will answer it. When that submission is done or unanswered, the answer from the conversation it ran in goes back through the outbox with the ID `reply:<envelope id>`, and the owed entry is deleted afterwards. A reply to a request that was stopped says it could not finish.
6. A mailbox message that is not a request, such as a reply or an undelivered notice, queues a push notification when its turn ends.
7. Delivered and failed mailbox rows older than 7 days are deleted.
8. That returned reply doesn't trigger another one. Every `message_bot` is owed a reply; there is no opt-out, so the sender always sees the answer and relays it to you.
9. A request reaches the other Bot marked `[Message from Bot: name]`, and the answer comes back marked `[Reply from Bot: name]`, so each Bot knows whether its answer is routed back. The transcript shows both as messages from that Bot.
10. A chain stops after 6 messages, and resets when you next write to that Bot.

`GET /api/bots/:id` returns `mailbox.queued` and `mailbox.failed`.

### Sleeping

1. An alarm checks for activity every minute.
2. After 10 idle minutes, `SharedComputer` quits Chromium, backs up to R2, saves a snapshot and destroys the container.
3. The next use restores files and the Chrome profile. Running processes and open tabs are lost.

A snapshot restores the whole container filesystem, including files from an older image. Files changed in `computer/` reach a computer that already has a snapshot only after a reset.

Snapshots need the `durable_object` scheduling policy, and an existing container app can't change policy. The `v5` migration in `wrangler.jsonc` replaced the old `Computer` class and its `default` policy app with `SharedComputer`. Removing the old entry doesn't delete the old app: after the first deploy, find it with `wrangler containers list` and delete it with `wrangler containers delete <id>`.

### Backups

Snapshots are a cache. Everything a Bot needs to keep is also outside the container: its folder and projects in Artifacts, and the rest in the R2 bucket `flarebot-files`.

| R2 key | Contents |
| --- | --- |
| `bots/<Bot ID>/bin.tar.gz` | The Bot's `bin`, with file modes |
| `computer/chrome.tar.gz` | `/workspace/.chrome` without caches and `Singleton*` locks |

1. **Backup:** `#sleep` in `src/worker/computer.ts` calls `backupComputer` in `src/worker/backups.ts` after Chromium quits. It streams `tar -czf -` from the container into an R2 multipart upload in 16 MiB parts, through the Worker binding, so no R2 keys reach the container. A part that fails or a `tar` exit code above 1 aborts the upload and keeps the previous backup.
2. **Fresh boot:** with no snapshot, or when a snapshot doesn't start within the ready timeout, `SharedComputer` drops the snapshot, starts the image with `FLAREBOT_RESTORE=1`, and streams each backup from R2 into `tar -xzf -`. `computer/start.sh` holds Chromium back until `SharedComputer` creates `/tmp/flarebot-restored`, so Chrome never opens a half-restored profile.
3. **Failed Chrome restore:** `SharedComputer` sets `chromeRestoreFailed` and stops backing up the profile, so an empty profile never replaces a good backup. The next reset clears it.

`POST /api/computer/reset` drops the snapshot and boots a fresh image with the backups, which is how changes to `computer/` reach a running computer. `?wipe=true` also deletes every R2 backup.

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

To wipe the computer, including imported logins: `curl -X POST 'http://127.0.0.1:8787/api/computer/reset?wipe=true'`. Without `wipe=true`, the logins come back from the R2 backup.

**Risk:** every Bot can use and read imported logins, because they share one Chrome profile and `run_linux` has full access to the computer. No approvals exist yet, and snapshots and the R2 backup contain the logins too. The bucket is private and encrypted at rest, but the backup itself isn't encrypted by flarebot.

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
| `/workspace/bots/<Bot ID>` | The Bot's folder, where `bash` and `run_linux` start in every thread. A clone of its repo, as [Folder repo](#folder-repo) shows |
| `/workspace/bots/<Bot ID>/bin` | The Bot's CLIs, on the computer, on `PATH` for its `run_linux` |
| `/workspace/bots/<Bot ID>/skills/<name>/SKILL.md` | The Bot's skill instructions, plus any scripts beside them |

| Tool | Purpose |
| --- | --- |
| `list_skills` | Names and descriptions of the Bot's skills |
| `load_skill` | Full instructions for one of its skills |
| `save_skill` | Create or replace one of its skills |
| `run_linux` | Download or build a CLI into its `bin` |

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

1. The pool is the Artifacts repo `toolbox`, cloned to `/workspace/toolbox` on the computer. Shared skills are read from the `toolbox` Artifacts repo directly; their scripts still run on the computer. A CLI is `clis/<name>/<name>`; a skill is the folder `skills/<name>/` with its `SKILL.md`, scripts and references. `src/worker/pool.ts` holds the logic.
2. Every add or remove commits and pushes `toolbox`, so the pool survives a computer reset. The next `run_linux` or `load_skill` from a Bot with pool items clones it back.
3. The `User` storage holds the pool lists as `clis` and `skills`. Each Bot stores its ticked items under the same keys, and `GET /api/bots/:id` returns them.
4. **CLIs:** `run_linux` puts the Bot's own `bin` first on `PATH`, then the folder of each ticked CLI. The prompt lists the ticked CLIs with their descriptions and tells the Bot to run `--help` first.
5. **Skills** follow the [Agent Skills specification](https://agentskills.io/specification), the format Pi implements:
   - `SKILL.md` starts with `name` and `description` frontmatter. The name is lowercase letters and numbers joined by single hyphens, up to 64 characters; the description is 1 to 1024 characters. Folded (`>`) and literal (`|`) descriptions work. The pool takes the name from the frontmatter and refuses a file that breaks these rules.
   - The prompt lists ticked skills in Pi's `<available_skills>` block with name, description and `SKILL.md` location, and never the full instructions.
   - `load_skill` returns the full `SKILL.md` and the skill's directory, so the Bot resolves relative paths against it. A Bot's own skill wins over a shared one of the same name. `list_skills` returns own and shared skills.
6. **Bot-made items:** a Bot writes a CLI or a skill folder, tests it, then calls `publish_cli` (name, path, description) or `publish_skill` (path). Paths are relative to the folder the chat works in, or absolute under the Bot's own folder. A CLI must start with `#!` or be a Linux binary; bash, python3 and node are on the computer, and a Bot downloads other toolchains into its own `bin`.
7. A published item records the Bot as `publishedBy` and is ticked for that Bot at once. A Bot can replace only items it published. You can replace or remove any item.
8. The Details panel's **CLIs** and **Skills** sections tick items, add one from a file, and remove one.
9. `save_skill` writes a private skill to the Bot's own `skills/` folder, not to the pool. The **Skills** section lists the Bot's private skills under the shared ones, with a lock icon and a publish button. `GET /api/bots/:id/own-skills` scans the folder in the Bot's Durable Object, and publishing first sends the folder to the computer; `POST /api/bots/:id/own-skills/:name/publish` publishes one to the pool as that Bot's and ticks it.

**Limits:**
- 30 MB per upload, from the Durable Object call size limit.
- Ticking is enforced only through `PATH` and the prompt. A Bot can still read `/workspace/toolbox` directly.
- CLIs and skills get no secrets yet.
- Nothing reviews a Bot-made item before it enters the pool. It reaches another Bot only when you tick it there.
- Compiled toolchains such as Go, Rust and Bun aren't in the computer image. A Bot downloads them into its own `bin`, which comes back from R2 after a reset.
- `disable-model-invocation`, `allowed-tools` and `/skill:name` commands from the spec aren't supported.

**Risk:** the folders are separated by the prompt, not by permissions. `run_linux` can still read or change another Bot's `bin` and the pool, and there is no version history or review.

**Limits:**
- A Bot's own `bin` is backed up to R2 only when the computer sleeps, so a crash loses changes since the last sleep. Its own skills are saved in its repo.
- Deleting a Bot leaves its `bin` backup in R2.
- CLIs must be Linux `amd64` builds.

## Threads

A Bot has its main chat plus any threads you start. A thread is a new Pi conversation that works in the Bot's own folder or in a [project](#projects). The role, memory, skills and Chrome tab are the same in every thread.

| Action | API |
| --- | --- |
| Start a thread | `POST /api/bots/:id/threads` with `{"project": null}` for the own folder, or a project name |
| Read one | `GET /api/bots/:id/threads/:threadId` |
| Rename it | `PATCH /api/bots/:id/threads/:threadId` with `{"title": "..."}`, 1 to 60 characters |
| Send to it | `POST /api/bots/:id/threads/:threadId/messages` |
| Stop its turn | `POST /api/bots/:id/threads/:threadId/stop` |
| Close it | `POST /api/bots/:id/threads/:threadId/close` |

1. `threads` in the `Bot` storage holds each thread's ID, title, conversation ID, last submission and whether it's closed. `GET /api/bots/:id` lists the open ones.
2. A thread's title is the first 40 characters of its first message, unless it has already been renamed.
3. The tab bar above the transcript switches between **Main** and the threads, and closes one with its **×**. Double-clicking a thread's title, right-clicking its tab or long-pressing it on a phone renames it. **Main** keeps its name. **+** opens a menu of **Own folder** and each project. A project thread's tab shows the project name. Closing stops the thread's turn and auto-saves its folder.

**Limits:**
- Only the main chat can `message_bot`, so Bot replies and the mailbox always go to the main chat.
- Threads share one folder and one Chrome tab, so two threads working at once can clash.
- A thread can use `message_bot`. The reply comes back to that thread, or to Main if the thread has closed. The receiving Bot always answers from its Main.
- A closed thread can't be reopened from the UI.

## Folder repo

Each Bot's folder, `/workspace/bots/<Bot ID>`, is a git clone of the Bot's own Cloudflare Artifacts repo, in the `flarebot` namespace through the `ARTIFACTS` binding. The repo is named `<bot name>-<first 8 characters of the Bot ID>`, for example `jake-1a2b3c4d`. `GET /api/bots/:id` returns the path and repo as `workspace`.

`src/worker/files.ts` holds the folder logic. `src/worker/repos.ts` holds the computer-side clone scripts.

### Files in the Bot's Durable Object

1. The Bot's `Workspace` from `@cloudflare/computer` stores files in SQLite in the `Bot` Durable Object. Paths are kept identical to the computer: `/workspace/bots/<Bot ID>`.
2. The `shell` backend runs just-bash in a Dynamic Worker through the `LOADER` binding. `@cloudflare/computer`'s `WorkspaceServiceProxy`, exported from `src/worker/index.ts` and minted through `ctx.exports`, reaches the Workspace by calling `__getWorkspaceStub()` on the `Bot` Durable Object.
3. File tools come from `@cloudflare/computer/tools/pi-ai`.
4. Git runs through isomorphic-git. A host fetch wrapper adds a repo-scoped token to each request to Artifacts: minted per repo and scope (`read` for clone, fetch and pull, `write` for push), valid 10 minutes and cached until a minute before expiry. Tokens are minted only for the Bot's own repo and the repos of its open project threads. The token never enters a file, the transcript or the model.
5. Commits use the Bot's name as the author.
6. **Clone:** the first use creates the repo if it doesn't exist and clones it into the Durable Object. `bin/` and `projects/` are excluded from git, so downloaded CLIs and project clones aren't saved to the Bot's repo. Skills in `skills/` are saved.
7. **Migration:** the first clone into the Durable Object first saves the computer's copy of the folder if the computer is running.
8. **Auto-save:** when the Bot goes idle, and when a thread closes, any change in the folder is committed as `flarebot: <Bot> auto-save` and pushed to the default branch, from the Durable Object.
9. `push_repo` commits and pushes at once. `pull_repo` fetches and merges; a merge conflict is reported, not resolved.
10. The Details panel shows the folder and the repo.

### Running on the computer

`run_linux` copies the folder to the computer through git, runs the command, and brings the result back.

1. The Durable Object commits and pushes the folder.
2. The computer clone is reset to the pushed branch.
3. The command runs.
4. The computer commits and pushes.
5. The Durable Object pulls.

Git-ignored files and `bin` stay on the computer. The computer's own git calls use the same repo-scoped tokens, passed as an `http.extraHeader` in the command's environment.

**Limits:**
- The worker shell backend is experimental in `@cloudflare/computer`.
- `bash` has no native binaries. Use `run_linux` for them, for npm and for compilers.
- isomorphic-git has no rebase, cherry-pick, submodules or ssh.
- Each Bot Durable Object holds one workspace of about 10 GB, with no R2 spillover.
- Merge conflicts on pull are reported, not resolved.
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
2. **Routes:** `/mac/install.sh`, `/mac/flarebot-local.ts`, `/mac/model-server/<file>`, `POST /api/mac/link`, `POST /api/mac/link/poll`, `GET /api/mac/whoami` and `GET /api/mac/connect` sit outside the session check, because the daemon has no session. Approving (`POST /api/mac/link/approve`), status, unpair and the per-Bot switch need a session.
3. **Requests:** a tool call becomes `Mac.request`, which sends `{id, bot, action}` over the socket and waits up to 6 minutes for the result. Offline, unpaired and disconnected Macs fail at once with a clear error.
4. **The daemon decides:** before any dialog, it refuses relative paths, paths outside the allowed folders after resolving symlinks and `..`, any command containing `sudo`, and everything when no folder is allowed. Then it shows a macOS dialog: **Deny**, **Allow once** or **Always allow <Bot>**. The dialog denies after 120 seconds. Requests run one at a time.
5. **Always allow** is stored per Bot ID in the daemon config.
6. **Unpair:** the **×** in Details → Mac closes the socket. The daemon clears its token, shows a notification and exits; running the install command again reconnects.
7. The prompt describes the Mac tools only to a Bot whose **Access** is ticked. With it off, every Mac tool fails.
8. **Claude relay:** on start the daemon downloads `server.ts`, `package.json` and `package-lock.json` from `/mac/model-server/` into `~/.flarebot-local/model-server`, runs `npm ci --ignore-scripts` when the lockfile changed, and starts `server.ts` on `127.0.0.1:48789` with the three Claude token variables removed from its environment. It then sends `hello` with `claude: true` when `/health` answers with exactly `ok` (so another program on that port is not mistaken for it) and `claude auth status` reports `loggedIn`, and repeats the check every minute. Model turns are not queued behind approval dialogs, run up to 5 at a time, and are cancelled by `model-cancel` or when the socket closes.

**Limits:**
- One Mac per account.
- The Claude relay uses the Mac's Claude Code login with no approval dialog, so any Bot's model turn runs there. Its sessions also appear in your Claude Code history under `~/.claude`.
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
| Snapshots | In public beta. Each one expires 30 days after it was made or last restored, and restores only on the image version that made it, so the first wake after a `computer/` change uses the fallback. The fallback is a fresh image plus the R2 backups, losing files outside Bot `bin` folders, the Chrome profile and the Artifacts repos |
| Computer count | `max_instances` isn't available on the `durable_object` policy. There is one computer, named `me`, and running containers count toward the account limit |
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
5. Bubbles widen to 92% of the screen, and Markdown tables keep whole words and scroll sideways instead of squeezing columns.
6. Long-press a row for Edit and Delete; inputs use 16px text so focusing them doesn't zoom; the composer doesn't grab focus on phones.
7. Take over opens full screen. While you're in control, noVNC's own control handle stays on the left edge, so its on-screen keyboard is reachable. The app isn't locked to portrait, so turning the phone sideways shows the desktop larger.

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

**Phone apps** use native push instead of the service worker:

1. In the Capacitor apps the bell calls `@capacitor/push-notifications`: permission, then `register()`, which returns an APNs device token on iPhone and an FCM token on Android. `POST /api/push/devices` saves `{platform, token}` and the token is kept in `localStorage`. On launch the app registers again and replaces the token if it changed. Turning it off calls `DELETE /api/push/devices` and `unregister()`.
2. `User` keeps the devices next to the browser subscriptions, and `notify` sends to both.
3. `src/worker/native-push.ts` sends to APNs with an ES256 JWT from the `.p8` key, cached for 50 minutes. It tries production first and the sandbox on `BadDeviceToken`, so Xcode debug builds work too. Android goes through FCM HTTP v1 with an OAuth token from the service account. Tokens APNs answers 410 for, or FCM marks `UNREGISTERED`, are dropped.
4. Tapping a notification fires `pushNotificationActionPerformed`, and the app opens the `url` from its data like the service worker does.

APNs only accepts HTTP/2. Deployed Workers reach it through Cloudflare's proxy, but local `workerd` speaks HTTP/1.1, so iPhone push works only from the deployed Worker. A platform whose secrets are missing logs `push_unconfigured` and is skipped.

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
| `FLAREBOT_LANGFUSE_HOST` | Optional. Public Langfuse URL the deployed Worker sends to instead of `LANGFUSE_HOST`, which is a tailnet address the Worker can't reach |
| `FLAREBOT_APNS_KEY_P8`, `FLAREBOT_APNS_KEY_ID`, `FLAREBOT_APNS_TEAM_ID` | Optional. iPhone push: the APNs auth key (`.p8` contents), its key ID and the Apple team ID. Deployed as `APNS_KEY_P8`, `APNS_KEY_ID`, `APNS_TEAM_ID` |
| `FLAREBOT_FCM_SERVICE_ACCOUNT` | Optional. Android push: the Firebase service account JSON with the `firebase.messaging` role. Deployed as `FCM_SERVICE_ACCOUNT` |
| `FLAREBOT_GOOGLE_SERVICES_JSON` | Optional. The Firebase Android app's `google-services.json`, written into `android/app/` by `scripts/cap.sh`. Without it the Android build has no FCM and registration fails |
| `FLAREBOT_ANDROID_KEYSTORE_B64`, `FLAREBOT_ANDROID_KEYSTORE_PASSWORD` | Android release signing key, used by `scripts/android-release.sh` |

### Langfuse tracing

`src/worker/langfuse.ts` sends every Bot run to Langfuse's OTLP endpoint, one span at a time, as each model turn or tool call ends. With any of the three secrets missing it does nothing. A failed send is logged as `langfuse_failed` and never affects the turn.

- **Run:** one trace per user message. Its ID comes from the conversation's provider session and that message, so every model turn of the run lands in it. The trace input is the user message.
- **Model turn:** a `GENERATION` with the full context as input, the reply and tool calls as output, the model and token usage.
- **Tool call:** `botExtension` wraps every tool, so each call is a `TOOL` nested under the model turn that asked for it, matched by the provider's tool call ID. `mcp_call` spans are named `mcp_call <server>.<tool>`. A call that throws, returns `isError`, or whose output starts with `Failed` or `exit code` other than 0, or says `reported an error:`, has level `ERROR`.
- Every trace is named `flarebot` and tagged `flarebot`, `bot` or `router`, and the Bot's name. The Langfuse user is the Bot's name, and the session is the conversation.
- The deployed Worker sends to `FLAREBOT_LANGFUSE_HOST`, currently `https://leads.simonbalfe.com`, which simon-vps's Caddy routes to Langfuse. Traces land in the `agent-traces` project beside the Mac agents.
- Failed turns have level `ERROR` and the error as the status message. When Claude's tool input or a container line can't be parsed, the raw text is in the `error_detail` metadata.
- Traces hold conversation messages, tool arguments and output, so they include any client data in them. Each field is cut to its last 50,000 characters and images are replaced with `[image]`. The Claude token is never sent.
- Failed turns are also logged to Workers Logs as `model_turn_failed`, with or without Langfuse.

Local dev doesn't load these secrets, so it sends nothing.

**Limit:** `scripts/import-chrome-cookies.ts` and `scripts/install-on-computer.ts` send no session cookie, so they only work against local dev.
