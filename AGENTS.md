# flarebot agent guide

## Commands

| Task | Command |
| --- | --- |
| Install | `bun install --ignore-scripts` |
| Run | `tmux new-session -d -s flarebot-dev 'bun run dev 2>&1 \| tee /tmp/flarebot-dev.log'` |
| Check | `bun run typecheck && bun run build` |

Run both checks after every code change. Docker or OrbStack must be running for `bun run dev`.

## Where things live

| Path | Contents |
| --- | --- |
| `src/worker/index.ts` | API routes and the screen proxy |
| `src/worker/bot.ts` | `Bot` Durable Object: Pi harness, memory, takeover, Bot replies |
| `src/worker/tools.ts` | Bot prompt and tools |
| `src/worker/view.ts` | Pi state to transcript conversion, including cost |
| `src/worker/user.ts` | `User` Durable Object: Bot list and sidebar summaries |
| `src/worker/computer.ts` | `Computer` Durable Object: container, commands, snapshots |
| `src/worker/auth.ts` | Cloudflare Access check |
| `src/web/` | React UI |
| `src/web/styles.css` | Design tokens and Kumo theme overrides |
| `computer/` | Desktop image and cookie loader |
| `scripts/` | Local dev and cookie import |

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
