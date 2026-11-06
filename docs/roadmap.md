# Roadmap

## Stages

| Stage | Result | Status |
| --- | --- | --- |
| 0. Computer | Desktop streams through a Worker and survives restarts | Works locally, not tested on Cloudflare |
| 1. Chat | Bots, live transcript, steering, tool activity | Done |
| 2. Computer panel | Preview, take over, hand back | Done |
| 3. Trust | Approval cards, permissions, Secure Form, action log | Next |
| 4. Reuse | Skills, routines, test, dry run, run history | Planned |
| 5. Many Bots | Pinning, per-Bot browser profiles, group chats | Bot messaging done |
| 6. Everywhere | Push, dictation, email and webhook triggers, voice | Planned |

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
| Connectors and MCP | Connected once in `User`, enabled per Bot |
| Control of your Mac | `flarebot-local` daemon on an outbound WebSocket, asking every time by default |
| Durable files | R2 |
| Model routing | AI Gateway, for cost logs and limits |
| Push | Web Push from a PWA |

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
| Login isolation | One browser profile per Bot |
| Models for a product | Choose a provider whose terms allow it |
