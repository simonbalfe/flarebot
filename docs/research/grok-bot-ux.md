# Grok Bot UX

## The core idea

Grok Bot feels like texting coworkers who have their own computers, not like configuring an agent.

Five decisions create that feeling:

1. **A Bot is a contact.** It has a name, picture and chat thread, in an iMessage-style list.
2. **Chat is the settings page.** Personal Bots have no description field, settings page or memory screen. You tell the Bot what to change.
3. **The transcript is the whole product.** Tool activity, files, questions, approvals and voice memos all appear inline.
4. **The computer is visible and shared with you.** You can watch it, take over one step, then hand it back.
5. **Work outlives the app.** Closing the laptop changes nothing, and results come to you as notifications.

## Screen map

```text
+-------------+--------------------------------+------------------+
| Sidebar     | Chat with one Bot              | Right panel      |
|             |                                |                  |
| + New       | Name and label (opens details) | Computer preview |
| Pinned Bots |                                | (click to watch) |
| Sections    | Messages, tool activity, cards |                  |
| Primary *   | Questions and approvals inline | Files, details   |
| Groups      |                                | Routines, runs   |
| Connect apps| Composer: @ / attach voice     |                  |
| Hidden Bots |                                |                  |
+-------------+--------------------------------+------------------+
```

The layout above is a summary of the docs and reviews, not a copy of a screenshot.

## First run

| Step | What happens | Why it works |
| --- | --- | --- |
| Install, click **Sign in** | Browser auth, back to the app | Standard and quick |
| Intro | "Meet a future teammate" while the computer starts | Turns a cold start into a welcome ([DataCamp](https://www.datacamp.com/tutorial/grok-bot-tutorial)) |
| First Bot | Created for you and named **Grok Bot**, chat opens | No blank form |
| First task | Outcome, sources, constraints, deliverable, where to pause | The first message doubles as configuration |
| First login | Vault, then 1Password, then a Secure Form | Access is requested when needed, not up front |
| Blocked step | **Open computer**, do the step, return control | The failure becomes a handoff |
| Reuse | Save a stable process as a skill or routine | Automation comes after a real success |

The suggested setup message is the whole Bot definition: "Your job is [area]. Investigate [type of question] using [tools]. [Output rules]. Never [restricted action]. Remember this for future work."

## Interaction patterns

### Bots as contacts

- **Create:** press **+** or `Cmd/Ctrl+N`, enter a name, pick a shape and colour, click **Create**.
- **Avatar:** choose a character, generate one or upload one.
- **Rename:** click the name, or double-click it in the sidebar.
- **Organise:** pin, sections, **Hide from sidebar**. Hidden Bots keep running their routines.
- **Primary Bot:** a starred default that also receives tasks tagged on X.

### Composer

- `@` addresses a Bot or attaches an app, routine or group.
- `/` runs a saved skill.
- Paste text, links and images, attach files, dictate (`Cmd/Ctrl+D`), or start voice chat from an empty composer.
- Reply to a specific message or react to it.

### Steering

- A new message takes priority over background work and can redirect the turn.
- "Stop now" ends work, but does not undo finished actions.
- There is no separate control panel: you interrupt the way you would interrupt a person.

### Inline cards

| Card | Controls |
| --- | --- |
| Email or Slack draft | **Needs approval**, **Send**, **Discard**, **Disable drafts for Bot** |
| Connect app | Provider sign-in in place |
| Secure Form or secret | Masked input the model never sees |
| Reconnect | Appears when a routine meets a signed-out app, at most daily per [Flavio Copes](https://flaviocopes.com/grok-bot/) |
| Phone permission | Bot waits up to five minutes for an answer |
| Phone call | Shows who will be called, with **Cancel** and **Call** |
| Purchase | Merchant, items and total, with nothing charged on decline |
| Shopping or shipment | Photo carousel, carrier and stage |
| Slack prompt for shared Bots | **Allow once**, **Skip**, **Always allow**, **Allow for this channel** |

Each card makes one decision easy to take from a phone. This is the most reusable pattern in the product.

### Computer takeover

1. The Bot reaches SSO, a passkey, a CAPTCHA, device approval or card verification.
2. It hands you the computer.
3. You do only that step. On a phone you finish with **I'm done**.
4. The Bot continues.

Watching and leaving never stop the work. Each Bot has one screen and one computer-use task at a time, and the browser types and moves like a person per the changelog cited by Flavio Copes.

### Skills and routines

The trust ladder is: do it once → correct it → save a skill → test it → schedule it.

- **Skill:** ask the Bot to save what just worked, including inputs, steps, validation and approval points.
- **Teach a task:** record up to 10 minutes of the computer screen with no audio. The result is a draft skill.
- **Routine:** ask in chat. Confirm the schedule, time zone, input, result, approval boundary and missing-source behaviour.
- **Triggers:** schedule, Slack, GitHub, Linear, Sentry, PagerDuty, email to the Bot's address, and webhook.
- **Test:** **Test** does real work and spends usage. Results land in the Bot's chat.
- **History:** **Running**, **Succeeded** or **Failed** with a reason, last 20 runs.
- **Absence:** the app may ask whether to continue after a long absence, then pause routines.

### Multi-Bot work

- Group chats take two to six Bots. Bots self-route unless you use `@`, **Reply** or `@everyone`.
- Bot-to-Bot messages are asynchronous and visible.
- Wright Mode describes a manager Bot that runs helpers in their own group and pings the owner only when finished.
- Approvals, logins and drafts never appear in groups. They stay in one-to-one chats.

### Surfaces

| Surface | Role |
| --- | --- |
| Desktop | Full control, including Test, Teach a task and computer recovery |
| Phone | Chat, voice, watching, takeover, routines inspection, Search and Library |
| iPhone extras | Share sheet, Siri, Shortcuts, Action Button, Live Activities |
| Voice | One call at a time, with transcript saved as a card |
| X | Tag `@bot`, get a short public confirmation, results stay in the app. **Unavailable for UK accounts** |
| Slack, email, webhook | Triggers and shared Bot access |
| Pages | Private reports or dashboards, shareable by choice |

## What people like

- **Setup speed.** "Setting up a new bot is incredibly simple" ([Claire Vo, ChatPRD](https://www.chatprd.ai/how-i-ai/how-i-ai-my-hands-on-review-of-grokbot-cursor-origin-and-the-grok-46-model)).
- **Multi-account connectors.** The same review connected four Gmail accounts and seven Slacks.
- **Masked secrets.** Flavio Copes quotes users who prefer this to Codex and Claude flows.
- **Less maintenance and good mobile access** compared with self-hosting, per Reddit threads in the volt note `wiki/vendors/ai/agent_runtime_landscape.md`.

## What people dislike

| Problem | Evidence | Do instead |
| --- | --- | --- |
| Usage runs out without warning | [Cursor forum](https://forum.cursor.com/t/grok-bot-weekly-usage-meter-flips-between-77-and-100-in-real-time/176909.md?page=8), [IBTimes](https://www.ibtimes.co.uk/grok-bot-users-say-limits-hit-100-overnight-musk-says-costs-were-unsustainably-high-1829767) | Show cost per turn and per routine run, with budgets |
| Memory cannot be inspected on screen | Official Bots page, [Wright Mode](https://www.wrightmode.com/blog/grok-bot-setup-guide) | Keep chat-first editing and add a readable memory view |
| No rehearsal: a test does real work | Official docs, [eesel](https://www.eesel.ai/blog/grok-bot-review) | Add a dry run that turns writes into draft cards |
| All Bots share logins and files | Official docs | Use a browser profile and allowed logins per Bot |
| Prompt rules are weak safety boundaries | eesel, Wright Mode | Enforce per-tool permissions outside the model |
| Group chats get noisy and spend usage | Flavio Copes, official docs | One owner by default, with visible reply cost |
| No model choice and a flat personality | ChatPRD | Offer a model picker and an editable personality |
| Default notifications are too loud | Wright Mode | Notify on questions and failures, with results as a quiet default |
| No team-wide action audit | eesel | Keep an append-only action log from the start |
| Failed runs are not retried | Official docs | Offer retry with idempotency guidance |
| Browser flows break on CAPTCHAs and layout changes | Flavio Copes, official docs | Treat this as normal: hand off and report clearly |

## Conflicts in the sources

- **Tool toggles:** Wright Mode shows per-tool switches such as "31 of 31". The official computer page does not describe them.
- **Platforms:** eesel's launch-week review excludes Linux and Android. Current official docs include both.
- **Notification delay:** Flavio Copes reports about three minutes before a phone alert. The official mobile page gives no delay.
- **Skills:** DataCamp says to invoke them with `/`. The current official page says to ask by name.

## What to copy first

1. Bots as contacts, with the first Bot already created.
2. One transcript with inline decision cards.
3. Live computer preview with take over and hand back.
4. Secure Form that keeps secrets away from the model.
5. Instant steering by sending a message.
6. Do, save, test, schedule.

## Sources

- [Overview](https://docs.x.ai/grok-bot/overview), [Get started](https://docs.x.ai/grok-bot/get-started), [Bots](https://docs.x.ai/grok-bot/bots), [Chat and collaboration](https://docs.x.ai/grok-bot/chat-and-collaboration), [Computer and apps](https://docs.x.ai/grok-bot/computer-and-apps), [Skills, routines and automations](https://docs.x.ai/grok-bot/skills-routines-and-automations), [Mobile](https://docs.x.ai/grok-bot/mobile), [Tag on X](https://docs.x.ai/grok-bot/tag-on-x)
- [Flavio Copes](https://flaviocopes.com/grok-bot/), [ChatPRD](https://www.chatprd.ai/how-i-ai/how-i-ai-my-hands-on-review-of-grokbot-cursor-origin-and-the-grok-46-model), [eesel](https://www.eesel.ai/blog/grok-bot-review), [DataCamp](https://www.datacamp.com/tutorial/grok-bot-tutorial), [Wright Mode](https://www.wrightmode.com/blog/grok-bot-setup-guide)
