# Roadmap

## Stages

| Stage | Result | Status |
| --- | --- | --- |
| 0. Computer | Desktop streams through a Worker and survives restarts | Works locally, not tested on Cloudflare |
| 1. Chat | Bots, live transcript, steering, tool activity | Done |
| 2. Computer panel | Preview, take over, hand back | Done |
| 3. Trust | Approval cards, permissions, Secure Form, action log | Next |
| 4. Reuse | Skills, routines, test, dry run, run history | Per-Bot skills built |
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
| Routines | Durable Object alarms, with triggers through Worker webhooks |
| Approvals | Pending rows in Durable Object storage |
| Vault and Secure Form | Encrypted store, filled by a tool outside the model |
| Connectors and MCP OAuth | MCP servers with bearer tokens are built. OAuth sign-in through `@earendil-works/pi-mcp/oauth`, with tokens in `User` |
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
| Harness and files outside the container; the container only for Chrome and heavy work | Files, git and a shell run in the Bot's Durable Object, so most turns never start the computer |

## Next steps

1. Browser Run for public pages, so Chrome on the computer is needed only for logged-in sites.
2. Code mode over the Bot's tools.
3. A `computerd` container backend in place of git sync for `run_linux`.
