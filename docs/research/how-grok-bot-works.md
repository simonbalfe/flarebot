# How Grok Bot works

## Concepts

| Concept | Behaviour | Source |
| --- | --- | --- |
| Bot | Name, job, conversations and memory | Docs |
| Computer | One persistent Linux VM per user with browser, files and terminal. All Bots share it | Docs |
| Screen | One per Bot, with one computer-use task at a time | Docs |
| `/workspace` | Durable files. `node_modules` and virtualenvs are not saved | Docs |
| Conversations | Stored outside the computer, so they survive **Recover** and **Reset** | Docs |
| Memory | Stable preferences, role context and work summaries per Bot, plus a few shared user facts | Docs |
| Connector | Preferred when available. Otherwise the Bot uses the browser | Docs |
| Vault | Logins, cards and contacts that every Bot can use without seeing raw values | Docs, Flavio Copes |
| Routine | Schedule or event trigger running in the cloud. Limits: 50 per Bot, 5-minute spacing, 300 runs an hour | Docs |

## Observed architecture

From `dev/playground/grokbot-replay/API.md`. Purposes marked inferred there remain inferred.

```text
Desktop app
  ├─ api2.cursor.sh           account, sandbox lifecycle, usage (Protobuf RPC)
  ├─ <sandbox>-1340 ...       agent runtime: JSON API plus /events SSE
  └─ <sandbox>-6081 ...       noVNC desktop over websockify

Cloud VM (*.us10.cursorvm.com)
  ├─ agents, transcripts, workflows, skills
  ├─ desktop windows, one VNC URL per window
  └─ approval streams: WebAuthn, cookie origin

Local computer
  └─ poll or watch commands → execute → submit results
```

## Send and receive

1. The client sends `POST /api/sendPrompt` with `prompt`, `agentId`, `clientNonce` and `richText`.
2. The server answers `{ "accepted": true }`. This is not the reply.
3. The client follows `/events` and reads `/api/getAgentTranscriptTail`.
4. Agent summaries include `currentActivity`, `lastMessageId`, `snapshotEpoch` and `snapshotSeq`.

**Why it matters:** sending is separated from working. That is what makes steering, reconnecting and multiple devices work.

## Computer lifecycle

- `EnsureSandBox` returns the sandbox addresses.
- `ensureForeverBox` and `getForeverBoxStatus` return state, windows, VNC URLs, update flags and `handoff`.
- `handoff` appears in machine status, which suggests takeover is a first-class state. The capture saw it as `null`, so its shape is unknown.

## Not established

- The agent loop implementation and how context is assembled.
- How memory is stored, summarised or retrieved.
- Which model handles each task. The docs and reviews agree there is no picker.
- The hypervisor and the internal VNC server.
