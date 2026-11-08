# flarebot

Always-on AI teammates that run on Cloudflare. You message a Bot like a coworker, and it works in its own Chrome tab on a shared Linux computer that you can watch and take over.

Each Bot is a separate bubble: its own role, tab, folder, skills, CLIs, memory and model. All Bots share one computer and one Chrome, so logins are shared. Bots share knowledge only by messages, which go through a durable queue in each Bot.

Inspired by the UX of [Grok Bot](https://docs.x.ai/grok-bot/overview).

**Status:** deployed. The sign-in protection is tested live, but Bots and the computer are only tested locally.

## Features

| Feature | Status |
| --- | --- |
| Named Bots with a role, chat, steering and stop | Built |
| Memory managed through chat, and a model picker | Built |
| One shared computer and Chrome, with a window and folder per Bot | Built, tab control tested locally |
| Threads per Bot: start, switch, stop and close, each with its own folder | Built, start and close tested locally |
| Each Bot's folder is a clone of its own Cloudflare Artifacts repo, shared by all its threads and auto-saved when the Bot goes idle | Built, clone and auto-save tested locally |
| Bots messaging each other through a durable queue, with retries and automatic replies | Built, not yet run with a model |
| Group chats of 2 to 6 Bots, with `@` mentions and `@everyone` | Built, not yet run with a model |
| Commands, plus screenshots, clicks, typing, keys and scrolling in the Bot's tab | Built |
| Live preview, take over, hand back | Built |
| Sleep when idle, restore from a snapshot | Built |
| Import cookies from local Chrome | Built |
| Magic link sign-in for allowed emails | Built |
| Approvals, permissions, Secure Form, action log | Planned |
| Skills and CLIs that each Bot creates and downloads for itself | Built, not yet run by a Bot |
| Routines, dry run | Planned |
| Connected apps, MCP, Vault, control of your Mac | Planned |
| Push notifications, voice | Planned |

## Quick start

You need [Bun](https://bun.sh), Docker or OrbStack, `sec` access to Infisical, and `wrangler login` for the remote Artifacts binding.

```sh
bun install --ignore-scripts
bun run dev
```

Open http://127.0.0.1:8787. The first run builds the computer image, which takes a few minutes.

## Commands

| Command | What it does |
| --- | --- |
| `bun run dev` | Start the app and computer locally |
| `bun run typecheck` | Check types |
| `bun run build` | Build for production |
| `scripts/deploy.sh` | Deploy, including migrations and secrets |
| `bun scripts/import-chrome-cookies.ts` | Copy local Chrome logins to the computer |
| `bun scripts/install-on-computer.ts --file <path> --to /workspace/bots/<id>/<path>` | Copy a CLI or skill to a Bot's folder. Add `--executable` for a CLI |

Read [Cookie import](docs/architecture.md#cookie-import) before importing. Every Bot can use imported logins.

## How it fits together

```mermaid
flowchart LR
  you(["You"])
  mac["Local Chrome<br/>cookie import"]

  subgraph cf["Cloudflare, emulated locally for now"]
    worker["Worker<br/>API, auth, web app"]
    user["User<br/>Bot list"]
    bot["Bot<br/>role, Pi agent, transcript,<br/>memory, mailbox"]
    others["Other Bots<br/>each with its own mailbox"]
    computer["Computer<br/>one Chrome, a tab per Bot,<br/>a folder per Bot, terminal<br/>sleeps when idle"]
  end

  models["OpenRouter<br/>models"]
  sites["Websites"]

  you -->|"chat"| worker
  you -.->|"watch, take over"| worker
  mac -->|"cookies"| worker
  worker --> user
  worker --> bot
  worker -.->|"screen"| computer
  bot <-->|"queued messages"| others
  bot -->|"own tab and folder"| computer
  others -->|"own tabs and folders"| computer
  bot --> models
  computer --> sites
```

- **Bot:** holds the role, conversation, memory and mailbox, and runs the agent loop.
- **Computer:** a disposable Linux container shared by all Bots, with one Chrome window per Bot, that sleeps when idle.
- **User:** holds the Bot list.

## Docs

| Doc | Read it for |
| --- | --- |
| [Architecture](docs/architecture.md) | How it works, and known limits |
| [Roadmap](docs/roadmap.md) | What's next, costs, open decisions |
| [Grok Bot UX](docs/research/grok-bot-ux.md) | The experience flarebot is based on |
| [How Grok Bot works](docs/research/how-grok-bot-works.md) | Grok Bot's internals, from docs and captured traffic |
| [Architecture diagram](docs/architecture.html) | The system, with CDP browser control and one tab per Bot marked as new |
| [Target diagram](docs/overview.html) | The planned system, including parts not built yet |
| [UI mock](docs/research/ui-mock.html) | The planned features, in an earlier visual style |
| [AGENTS.md](AGENTS.md) | Instructions for coding agents |
