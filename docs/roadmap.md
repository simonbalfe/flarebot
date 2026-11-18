# Roadmap

## Stages

| Stage | Result | Status |
| --- | --- | --- |
| 0. Computer | Desktop streams through a Worker and survives restarts | Works locally, not tested on Cloudflare |
| 1. Chat | Bots, live transcript, steering, tool activity | Done |
| 2. Computer panel | Preview, take over, hand back | Done |
| 3. Trust | Approval cards, permissions, Secure Form, action log | Built, not yet run by a Bot |
| 4. Reuse | Skills, routines, test, dry run, run history | Skills, routines with run now and run history built. Dry run next |
| 5. Many Bots | Pinning, a tab and folder per Bot, roles, group chats | Tab and folder per Bot, roles, queued Bot messaging and group chats built |
| 6. Everywhere | Push, dictation, email and webhook triggers, voice | Web Push built; phone apps moved from Tauri to Capacitor with native push built, waiting on APNs and Firebase credentials. Move the phones to Expo only if voice or phone-only features become central |

## Test on real Cloudflare

1. noVNC input lag is acceptable on desktop and phone.
2. A site login survives a stop and restart.
3. Cold start to a usable screen takes under 30 seconds.
4. Gmail, GitHub and a Cloudflare-protected site work from a container IP.
5. Idle sleep and wake leave no orphaned container.

## Planned design

| Capability | Approach |
| --- | --- |
| Dry run | Turn writes into draft cards instead of doing them |
| Email triggers | Cloudflare Email Routing to a per-routine address |
| Google and Slack sign-in | Register a Google Web OAuth client (Workspace Developer Preview) and an internal Slack app, then add `MCP_<APP>_CLIENT_ID` and `MCP_<APP>_CLIENT_SECRET` to Infisical and `scripts/deploy.sh` |
| Mac follow-ups | Approvals in the flarebot UI as well as the Mac dialog, screenshots, a menu bar app, a signed binary instead of Bun |
| Durable files | One Cloudflare Artifacts repo per Bot, cloned into the Bot's Durable Object and pushed on auto-save |
| Container scope | The harness and each Bot's files stay outside the container. The container is only for Chrome and heavy work |
| Model routing | AI Gateway, for cost logs and limits |

## Cost estimate

For one user over a 30-day month, from [Containers pricing](https://developers.cloudflare.com/containers/platform/pricing/). Excludes model usage, the Workers plan and included allowances.

| Computer | Total |
| --- | --- |
| `standard-2`, 2 hours a day at 30% CPU | About $5 |
| `standard-1`, always on at 10% CPU | About $30 |
| `standard-3`, always on at 10% CPU | About $65 |

## Open decisions

| Decision | Recommendation |
| --- | --- |
| Personal tool or product | Personal first, keeping one computer per user |
| Login isolation | Shared logins in one Chrome profile, with a window per Bot |
| Durable Bot files | One Cloudflare Artifacts repo per Bot for its folder. Each Bot's `bin` and the Chrome profile are backed up to the R2 bucket `flarebot-files` on sleep, through the Worker binding rather than an `S3Mount`, because a mount loses file modes. Snapshots are a cache |
| Models for a product | Choose a provider whose terms allow it |

## Decisions

| Decision | Reason |
| --- | --- |
| Routines run in the Bot's main chat, on the Bot's own alarm | One alarm already wakes the Bot for its queue, so routines need no new part, and results land where the user reads them |
| An approval ends the Bot's turn and the decision arrives as a message, instead of a tool call that waits | A turn can sleep for hours without holding a request open, and it matches how takeover already works |
| Allow once is a one-time grant for the exact call, keyed by a hash of its arguments | The Bot repeats the same call to use it, so an approval can never cover a different call |
| Vault values are encrypted with AES-GCM under a key derived from `BETTER_AUTH_SECRET` with HKDF | No new secret to manage. Rotating that secret makes stored values unreadable, so they must be entered again |
| The app library is a fixed list of servers checked on 2026-11-18, not a live registry | The MCP registry was too noisy to use, and each entry was probed for sign-in support |
| Harness and files outside the container; the container only for Chrome and heavy work | Files, git and a shell run in the Bot's Durable Object, so most turns never start the computer |
| The API uses one bearer key, and the OpenAPI spec is built from the routes | The app and outside callers share one set of routes, so nothing drifts. Mac pairing and per-Bot Mac access stay in the app, because a Bot can reach the API through the codemode gateway and must not grant itself the Mac |
| 3D view in plain three.js, loaded with one `lazy` import | One dependency instead of three with react-three-fiber, the render loop stays outside React, and about 146 KB gzipped stays out of the main bundle for the PWA and phone apps |
| 3D view reads the existing API in its first version | No Worker change. Later: an `activity` field reported by the `Bot` Durable Object so one `/api/bots` poll carries every Bot's station, then bloom, a dusk sky for dark mode and a group table |

## Next steps

1. Browser Run for public pages, so Chrome on the computer is needed only for logged-in sites.
2. Code mode over the Bot's tools.
3. A `computerd` container backend in place of git sync for `run_linux`.
