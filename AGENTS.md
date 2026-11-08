# flarebot agent guide

## Commands

| Task | Command |
| --- | --- |
| Install | `bun install --ignore-scripts` |
| Run | `tmux new-session -d -s flarebot-dev 'bun run dev 2>&1 \| tee /tmp/flarebot-dev.log'` |
| Check | `bun run typecheck && bun run build` |
| Deploy | `scripts/deploy.sh` |

Run both checks after every code change. Docker or OrbStack must be running for `bun run dev`.

## Where things live

| Path | Contents |
| --- | --- |
| `src/worker/index.ts` | API routes and the screen proxy |
| `src/worker/bot.ts` | `Bot` Durable Object: Pi harness, role, memory, mailbox, takeover, Bot replies |
| `src/worker/tools.ts` | Bot prompt and tools |
| `src/worker/view.ts` | Pi state to transcript conversion, including cost |
| `src/worker/user.ts` | `User` Durable Object: Bot and group lists, sidebar summaries |
| `src/worker/group.ts` | `Group` Durable Object: group transcript and `@` mention routing |
| `src/worker/mentions.ts` | Matches `@` mentions and plain Bot names in group messages |
| `src/worker/router.ts` | Model call that picks Bots for a group message with no name |
| `src/worker/repos.ts` | Each Bot's folder repo in Artifacts: create, clone into the folder, commit, pull, push, with short-lived tokens |
| `src/worker/pool.ts` | Shared pool of CLIs and Agent Skills: the `toolbox` Artifacts repo cloned to `/workspace/toolbox`, publish, validate and remove |
| `src/worker/mac.ts` | `Mac` Durable Object: pairing, the daemon's WebSocket, request and result routing |
| `src/worker/mac-tools.ts` | `mac_run`, `mac_read`, `mac_write`, `mac_list`, `mac_open` Bot tools and their prompt line |
| `scripts/flarebot-local.ts` | Mac daemon: pair, allowed folders, approval dialog, runs the actions |
| `src/worker/mcp.ts` | Remote MCP servers through `@earendil-works/pi-mcp`: list tools, call a tool |
| `src/worker/computer.ts` | `Computer` Durable Object: container, commands, snapshots, a browser tab per Bot |
| `src/worker/auth.ts` | Better Auth magic links and the API session check |
| `migrations/` | D1 schema for Better Auth |
| `src/web/` | React UI |
| `src/web/styles.css` | Design tokens and Kumo theme overrides |
| `computer/` | Desktop image, cookie loader, and `browser-tab.mjs` (CDP tab control, sent by the Worker at run time) |
| `scripts/` | Local dev, deploy, cookie import, and copying files to the computer |

## Rules

**Code**
- Write no code comments, except ones a tool requires.
- Avoid `any`, and validate request bodies with `zod`.
- Pin dependencies to exact versions.
- Never edit `worker-configuration.d.ts`. Run `bun run types` after changing `wrangler.jsonc`.

**UI**
- Use Tailwind and Kumo, with the `fb-*` tokens in `src/web/styles.css`.
- Use the `fb-body`, `fb-callout` and `fb-caption` type styles.
- Add no explanatory copy to the UI: labels, data and error messages only.
- Never show costs. The API tracks them in the background.

**Secrets and safety**
- Infisical is the only secret store. `scripts/dev.sh` loads the key with `sec`.
- Never print, log or commit secrets or cookie values.
- Never let a secret reach the model or a transcript.
- A message from a Bot is never approval from the user.
- Ask before running `scripts/import-chrome-cookies.ts`, deploying, or spending real money on model calls.

## Docs

Update the matching doc in the same change:

| Change | Update |
| --- | --- |
| Feature status or setup | `README.md` |
| Behaviour or limits | `docs/architecture.md` |
| Plans or decisions | `docs/roadmap.md` |
