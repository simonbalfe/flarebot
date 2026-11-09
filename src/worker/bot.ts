import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { createModels } from "@earendil-works/pi-ai/models";
import { type Conversation, type ConversationId, createRegistry, Harness, type SubmissionId, type SubmissionRecord, type Wake } from "@earendil-works/pi-durable";
import { openDurableObjectSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/cloudflare";
import { DurableObject } from "cloudflare:workers";
import { claudeProvider, claudeProviderId } from "./claude";
import { claudeModelId, computerName, defaultEffort, type Effort, userName } from "./env";
import { recordTurns } from "./langfuse";
import { type CliSummary, type OwnSkill, ownSkillsDir, type PoolKind, type SkillSummary, scanSkills } from "./pool";
import type { PoolResult } from "./user";
import { codemodeServer, type McpServerSummary, serverSummary } from "./mcp";
import { type PushMessage, pushBody } from "./push";
import { cloneState, commitAll, defaultRepoName, errorMessage, pushClone, type RepoResult } from "./repos";
import { botExtension, type BotProfile, maxBotHops, type Takeover } from "./tools";
import { botReply, toTranscriptView, type TranscriptView } from "./view";

const context = BACKGROUND_CONTEXT;
const heartbeatMs = 60_000;
const provider = claudeProviderId;
const takeoverDoneMessage = "I'm done, continue.";
const unfinishedMessage = "I could not finish that.";
const maxDeliveryAttempts = 5;
const retryBaseMs = 5_000;
const threadTitleChars = 40;
interface PendingNotice {
  submissionId: SubmissionId;
  threadId: string | null;
}

interface GroupReply {
  groupId: string;
  submissionId: SubmissionId;
}

export interface Envelope {
  id: string;
  senderId: string;
  text: string;
  hops: number;
  replyTo: string | null;
  groupId: string | null;
  threadId?: string | null;
  replyThreadId?: string | null;
}

interface ReplyTarget {
  botId: string;
  threadId: string | null;
}

export interface MailboxCounts {
  queued: number;
  failed: number;
}

type StoredProfile = Omit<BotProfile, "role" | "effort"> & { role?: string; effort?: Effort };

type MailRow = {
  id: string;
  sender_id: string;
  text: string;
  hops: number;
  reply_to: string | null;
  group_id: string | null;
  thread_id: string | null;
  reply_thread_id: string | null;
  attempts: number;
};

export interface ThreadSummary {
  id: string;
  title: string;
  createdAt: number;
  project: string | null;
}

type StoredThread = Omit<ThreadSummary, "project"> & {
  project?: string | null;
  conversationId: ConversationId;
  lastSubmission: SubmissionId | null;
  closed: boolean;
};

export interface Workspace {
  path: string;
  repo: string;
  branch: string | null;
  project: string | null;
}

function summaryOf(thread: StoredThread): ThreadSummary {
  return { id: thread.id, title: thread.title, createdAt: thread.createdAt, project: thread.project ?? null };
}

export interface BotView extends TranscriptView {
  profile: BotProfile;
  memory: string[];
  takeover: Takeover | null;
  mailbox: MailboxCounts;
  workspace: Workspace;
  mcpServers: McpServerSummary[];
  clis: CliSummary[];
  skills: SkillSummary[];
  macAccess: boolean;
  threads: ThreadSummary[];
}

export class Bot extends DurableObject<Env> {
  #harness!: Harness;
  #root!: Conversation;
  #wasActive = false;
  #groupConversations = new Map<string, Promise<Conversation>>();
  #threadConversations = new Map<string, Promise<Conversation>>();
  #settlingGroupReplies: Promise<void> = Promise.resolve();
  #draining: Promise<void> = Promise.resolve();
  #saving: Promise<void> = Promise.resolve();
  #noticing: Promise<void> = Promise.resolve();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS flarebot_mailbox (id TEXT PRIMARY KEY, sender_id TEXT NOT NULL, text TEXT NOT NULL, hops INTEGER NOT NULL, reply_to TEXT, group_id TEXT, status TEXT NOT NULL, attempts INTEGER NOT NULL, next_at INTEGER NOT NULL, created_at INTEGER NOT NULL, delivered_at INTEGER, error TEXT)",
    );
    const mailboxColumns = ctx.storage.sql.exec<{ name: string }>("PRAGMA table_info(flarebot_mailbox)").toArray().map((column) => column.name);
    for (const column of ["thread_id", "reply_thread_id"]) {
      if (!mailboxColumns.includes(column)) ctx.storage.sql.exec(`ALTER TABLE flarebot_mailbox ADD COLUMN ${column} TEXT`);
    }
    void ctx.blockConcurrencyWhile(async () => {
      const fallback = Date.now() + heartbeatMs;
      const alarm = await ctx.storage.getAlarm();
      if (alarm === null || alarm > fallback) await ctx.storage.setAlarm(fallback);

      const models = createModels({ credentials: new InMemoryCredentialStore() });
      const recordTurn = recordTurns(env, (work) => ctx.waitUntil(work), () => ({ kind: "bot", id: this.#profile().id, name: this.#profile().name }));
      models.setProvider(claudeProvider({ session: () => ({ container: env.MODELS.getByName(this.#profile().id), id: this.#profile().id }), token: env.CLAUDE_CODE_OAUTH_TOKEN, recordTurn }, () => this.#profile().effort));

      const registry = createRegistry();
      registry.install(
        botExtension(env, {
          profile: () => this.#profile(),
          memory: () => this.#memory(),
          setMemory: (items) => ctx.storage.kv.put("memory", items),
          setTakeover: (takeover) => ctx.storage.kv.put("takeover", takeover),
          workspace: (conversationId) => this.#workspaceFor(conversationId),
          ownRepo: () => this.#repoName(),
          mcpServers: () => this.#mcpServers(),
          ticked: (kind) => this.#ticked(kind),
          ownSkills: () => this.#ownSkills(),
          macAccess: () => this.#macAccess(),
          setOwnSkills: (skills) => ctx.storage.kv.put("ownSkills", skills),
          tick: (kind, item) => this.ctx.storage.kv.put(kind, [...this.#ticked(kind).filter((current) => current.name !== item.name), item]),
          mcpServer: async (name) => {
            const summary = this.#mcpServers().find((server) => server.name.toLowerCase() === name.toLowerCase());
            return summary === undefined ? null : this.env.USER.getByName(userName).mcpServer(summary.id);
          },
          botHops: () => ctx.storage.kv.get<number>("botHops") ?? 0,
          isRoot: (conversationId) => conversationId === this.#root.id,
          owesReplyTo: (botId) => this.#replyTo().some((target) => target.botId === botId),
          threadOf: (conversationId) => {
            const thread = this.#storedThreads().find((candidate) => candidate.conversationId === conversationId);
            return thread === undefined ? null : summaryOf(thread);
          },
        }),
      );

      this.#harness = await Harness.open(
        await openDurableObjectSqliteStorage(ctx.storage),
        {
          models,
          registry,
          identity: { attribution: { name: "flarebot", url: "https://example.com" } },
          onWake: (wake) => void this.#onWake(wake).catch(() => ctx.abort("Alarm write failed")),
          onReport: (error, info) => console.error(JSON.stringify({ event: "agent_report", ...info, error: String(error) })),
        },
        context,
      );
      this.#root = await this.#harness.root(context);
      await this.#moveOffOpenRouter();
      await this.#arm(this.#harness.wake());
      this.#harness.resume();
      this.#queueGroupSettle();
      this.#queueDrain();
    });
  }

  override async alarm(): Promise<void> {
    await this.#arm({ ...this.#harness.wake(), active: true });
    this.#harness.resume();
    this.#queueGroupSettle();
    this.#queueDrain();
  }

  async init(profile: BotProfile): Promise<void> {
    this.ctx.storage.kv.put("profile", profile);
    await this.#root.configure({ model: { provider, modelId: profile.model } }, context);
  }

  async send(text: string): Promise<void> {
    this.ctx.storage.kv.delete("takeover");
    this.ctx.storage.kv.put("botHops", 0);
    await this.#arm({ ...this.#harness.wake(), active: true });
    const submission = await this.#root.submit({ type: "input", content: text, requestId: crypto.randomUUID(), whenBusy: "steer" }, context);
    this.ctx.storage.kv.put("lastSubmission", submission.id);
    this.#awaitNotice({ submissionId: submission.id, threadId: null });
    this.ctx.waitUntil(submission.wait(context).then(() => this.#queueNotices()));
    await this.#report(true);
  }

  enqueue(envelope: Envelope): void {
    const now = Date.now();
    this.ctx.storage.sql.exec(
      "INSERT OR IGNORE INTO flarebot_mailbox (id, sender_id, text, hops, reply_to, group_id, thread_id, reply_thread_id, status, attempts, next_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'queued', 0, ?, ?)",
      envelope.id,
      envelope.senderId,
      envelope.text,
      envelope.hops,
      envelope.replyTo,
      envelope.groupId,
      envelope.threadId ?? null,
      envelope.replyThreadId ?? null,
      now,
      now,
    );
    this.#queueDrain();
  }

  async startThread(project: string | null): Promise<ThreadSummary> {
    if (project !== null && !(await this.env.USER.getByName(userName).projects()).includes(project)) throw new Error(`No project named ${project}`);
    const conversation = await this.#harness.createConversation({ ownership: { kind: "ownerless" }, agent: { model: { provider, modelId: this.#profile().model } } }, context);
    const thread: StoredThread = { id: crypto.randomUUID(), title: "", createdAt: Date.now(), project, conversationId: conversation.id, lastSubmission: null, closed: false };
    this.ctx.storage.kv.put("threads", [...this.#storedThreads(), thread]);
    this.#threadConversations.set(thread.id, Promise.resolve(conversation));
    return summaryOf(thread);
  }

  hasThread(threadId: string): boolean {
    return this.#openThread(threadId) !== undefined;
  }

  async sendToThread(threadId: string, text: string): Promise<void> {
    const thread = this.#openThread(threadId);
    if (thread === undefined) throw new Error("Thread not found");
    const conversation = await this.#threadConversation(thread);
    this.ctx.storage.kv.delete("takeover");
    this.ctx.storage.kv.put("botHops", 0);
    await this.#arm({ ...this.#harness.wake(), active: true });
    const submission = await conversation.submit({ type: "input", content: text, requestId: crypto.randomUUID(), whenBusy: "steer" }, context);
    const title = thread.title === "" ? text.replace(/\s+/g, " ").trim().slice(0, threadTitleChars) : thread.title;
    this.#updateThread(threadId, { lastSubmission: submission.id, title });
    this.#awaitNotice({ submissionId: submission.id, threadId });
    this.ctx.waitUntil(submission.wait(context).then(() => this.#queueNotices()));
  }

  async stopThread(threadId: string): Promise<void> {
    const thread = this.#openThread(threadId);
    if (thread === undefined) return;
    await (await this.#threadConversation(thread)).abort(context);
  }

  async setMcpServers(ids: string[]): Promise<McpServerSummary[]> {
    const available = await this.env.USER.getByName(userName).mcpServers();
    const enabled = available.filter((server) => ids.includes(server.id));
    this.ctx.storage.kv.put("mcpServers", enabled);
    return enabled;
  }

  disableMcpServer(id: string): void {
    this.ctx.storage.kv.put("mcpServers", this.#mcpServers().filter((server) => server.id !== id));
  }

  async setPoolItems(kind: PoolKind, names: string[]): Promise<CliSummary[]> {
    const available = await this.env.USER.getByName(userName).poolItems(kind);
    const enabled = available.filter((item) => names.includes(item.name));
    this.ctx.storage.kv.put(kind, enabled);
    return enabled;
  }

  refreshPoolItem(kind: PoolKind, item: CliSummary): void {
    this.ctx.storage.kv.put(kind, this.#ticked(kind).map((current) => (current.name === item.name ? item : current)));
  }

  setMacAccess(enabled: boolean): void {
    this.ctx.storage.kv.put("macAccess", enabled);
  }

  async ownSkills(): Promise<OwnSkill[]> {
    if (!(await this.env.COMPUTER.getByName(computerName).status()).running) return this.#ownSkills();
    const skills = await scanSkills(this.env, ownSkillsDir(this.#profile().id));
    this.ctx.storage.kv.put("ownSkills", skills);
    return skills;
  }

  async publishOwnSkill(name: string): Promise<PoolResult> {
    if (!this.#ownSkills().some((skill) => skill.name === name)) return { ok: false, error: `No skill named ${name} in this Bot's folder` };
    const user = this.env.USER.getByName(userName);
    const result = await user.publishSkill(this.#profile().id, `${ownSkillsDir(this.#profile().id)}/${name}`);
    if (!result.ok) return result;
    const published = (await user.poolItems("skills")).find((skill) => skill.name === result.name);
    if (published !== undefined) this.ctx.storage.kv.put("skills", [...this.#ticked("skills").filter((skill) => skill.name !== published.name), published]);
    return result;
  }

  disablePoolItem(kind: PoolKind, name: string): void {
    this.ctx.storage.kv.put(kind, this.#ticked(kind).filter((item) => item.name !== name));
  }

  async closeThread(threadId: string): Promise<void> {
    const thread = this.#openThread(threadId);
    if (thread === undefined) return;
    await (await this.#threadConversation(thread)).abort(context);
    this.#updateThread(threadId, { closed: true });
    this.#threadConversations.delete(threadId);
    this.#queueAutoSave();
  }

  async threadView(threadId: string): Promise<BotView> {
    const thread = this.#openThread(threadId);
    if (thread === undefined) throw new Error("Thread not found");
    return this.#viewOf(await this.#threadConversation(thread), thread.lastSubmission ?? undefined);
  }

  async finishTakeover(): Promise<void> {
    const origin = this.ctx.storage.kv.get<Takeover>("takeover")?.origin;
    const thread = this.#storedThreads().find((candidate) => candidate.conversationId === origin && !candidate.closed);
    if (thread !== undefined) {
      await this.sendToThread(thread.id, takeoverDoneMessage);
      return;
    }
    const groupId = Object.entries(this.#conversationIds()).find(([, id]) => id === origin)?.[0];
    if (groupId === undefined) {
      await this.send(takeoverDoneMessage);
      return;
    }
    this.ctx.storage.kv.delete("takeover");
    await this.#submitToGroup(groupId, takeoverDoneMessage, "steer", crypto.randomUUID());
    await this.#report(true);
  }

  isBusyIn(groupId: string): boolean {
    return this.#pendingGroupReplies().some((reply) => reply.groupId === groupId);
  }

  async stopGroup(groupId: string): Promise<void> {
    if (this.#conversationIds()[groupId] === undefined) return;
    const conversation = await this.#groupConversation(groupId);
    await conversation.abort(context);
    this.#queueGroupSettle();
  }

  async stop(): Promise<void> {
    await this.#root.abort(context);
    await this.#report(false);
  }

  async clearMain(): Promise<void> {
    this.ctx.storage.kv.delete("replyTo");
    this.ctx.storage.kv.delete("lastSubmission");
    this.ctx.storage.kv.delete("takeover");
    this.ctx.storage.kv.put("botHops", 0);
    await this.#root.abort(context);
    await this.#root.reset(undefined, context);
    await this.#report(false);
  }

  setRole(role: string): void {
    this.ctx.storage.kv.put("profile", { ...this.#profile(), role });
  }

  setName(name: string): void {
    this.#repoName();
    this.ctx.storage.kv.put("profile", { ...this.#profile(), name });
  }

  async destroy(): Promise<void> {
    await this.#root.abort(context).catch(() => undefined);
    for (const thread of this.#storedThreads().filter((candidate) => !candidate.closed)) {
      await (await this.#threadConversation(thread)).abort(context).catch(() => undefined);
    }
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
  }

  async #moveOffOpenRouter(): Promise<void> {
    const model = this.ctx.storage.kv.get<StoredProfile>("profile")?.model;
    if (model === undefined || model === claudeModelId(model)) return;
    await this.setModel(claudeModelId(model));
  }

  async setModel(model: string): Promise<void> {
    const change = { model: { provider, modelId: model } };
    await this.#root.configure(change, context);
    for (const groupId of Object.keys(this.#conversationIds())) {
      const conversation = await this.#groupConversation(groupId);
      await conversation.configure(change, context);
    }
    for (const thread of this.#storedThreads().filter((candidate) => !candidate.closed)) {
      await (await this.#threadConversation(thread)).configure(change, context);
    }
    this.ctx.storage.kv.put("profile", { ...this.#profile(), model });
  }

  setEffort(effort: Effort): void {
    this.ctx.storage.kv.put("profile", { ...this.#profile(), effort });
  }

  memory(): string[] {
    return this.#memory();
  }

  forget(index: number): void {
    this.ctx.storage.kv.put("memory", this.#memory().filter((_, position) => position !== index));
  }

  view(): Promise<BotView> {
    return this.#viewOf(this.#root, this.ctx.storage.kv.get<SubmissionId>("lastSubmission"));
  }

  async #viewOf(conversation: Conversation, lastId: SubmissionId | undefined): Promise<BotView> {
    const last = lastId === undefined ? undefined : await this.#harness.submission(lastId, context);
    const state = await conversation.viewState(context);
    try {
      return {
        ...toTranscriptView(state.value, await last?.status(context)),
        profile: this.#profile(),
        memory: this.#memory(),
        takeover: this.ctx.storage.kv.get<Takeover>("takeover") ?? null,
        mailbox: this.#mailboxCounts(),
        workspace: this.#workspace(),
        mcpServers: this.#mcpServers(),
        clis: this.#ticked("clis"),
        skills: this.#ticked("skills"),
        macAccess: this.#macAccess(),
        threads: this.#storedThreads()
          .filter((thread) => !thread.closed)
          .map(summaryOf),
      };
    } finally {
      state.dispose();
    }
  }

  #macAccess(): boolean {
    return this.ctx.storage.kv.get<boolean>("macAccess") ?? false;
  }

  #ownSkills(): OwnSkill[] {
    return this.ctx.storage.kv.get<OwnSkill[]>("ownSkills") ?? [];
  }

  #ticked(kind: PoolKind): CliSummary[] {
    return this.ctx.storage.kv.get<CliSummary[]>(kind) ?? [];
  }

  #mcpServers(): McpServerSummary[] {
    return this.ctx.storage.kv.get<McpServerSummary[]>("mcpServers") ?? [serverSummary(codemodeServer(this.env))];
  }

  #workspace(): Workspace {
    const profile = this.#profile();
    return { path: `/workspace/bots/${profile.id}`, repo: this.#repoName(), branch: null, project: null };
  }

  #projectWorkspace(project: string): Workspace {
    const profile = this.#profile();
    return { path: `/workspace/bots/${profile.id}/projects/${project}`, repo: project, branch: `flarebot/${this.#repoName()}`, project };
  }

  #repoName(): string {
    const stored = this.ctx.storage.kv.get<string>("repo");
    if (stored !== undefined) return stored;
    const name = defaultRepoName(this.#profile());
    this.ctx.storage.kv.put("repo", name);
    return name;
  }

  #workspaceFor(conversationId: ConversationId): Workspace {
    const project = this.#storedThreads().find((thread) => thread.conversationId === conversationId && !thread.closed)?.project ?? null;
    return project === null ? this.#workspace() : this.#projectWorkspace(project);
  }

  #activeWorkspaces(): Workspace[] {
    const projects = new Set(this.#storedThreads().flatMap((thread) => (!thread.closed && thread.project != null ? [thread.project] : [])));
    return [this.#workspace(), ...[...projects].map((project) => this.#projectWorkspace(project))];
  }

  async #autoSave(workspace: Workspace): Promise<RepoResult> {
    try {
      const state = await cloneState(this.env, workspace.path);
      if (!state.exists) return { ok: true, message: "Nothing cloned." };
      if (state.dirty) {
        const committed = await commitAll(this.env, workspace.path, `flarebot: ${this.#profile().name} auto-save`);
        if (!committed.ok) return committed;
      }
      if (!state.dirty && state.unpushed === 0) return { ok: true, message: "Already saved." };
      return await pushClone(this.env, workspace.repo, workspace.path);
    } catch (error) {
      return { ok: false, error: errorMessage(error) };
    }
  }

  #queueAutoSave(): void {
    this.#saving = this.#saving
      .then(async () => {
        for (const workspace of this.#activeWorkspaces()) {
          const saved = await this.#autoSave(workspace);
          if (!saved.ok) console.error(JSON.stringify({ event: "auto_save_failed", repo: workspace.repo, branch: workspace.branch, error: saved.error }));
        }
      })
      .catch((error: unknown) => console.error(String(error)));
    this.ctx.waitUntil(this.#saving);
  }

  #storedThreads(): StoredThread[] {
    return this.ctx.storage.kv.get<StoredThread[]>("threads") ?? [];
  }

  #openThread(threadId: string): StoredThread | undefined {
    return this.#storedThreads().find((thread) => thread.id === threadId && !thread.closed);
  }

  #updateThread(threadId: string, patch: Partial<Pick<StoredThread, "title" | "lastSubmission" | "closed">>): void {
    this.ctx.storage.kv.put("threads", this.#storedThreads().map((thread) => (thread.id === threadId ? { ...thread, ...patch } : thread)));
  }

  #threadConversation(thread: StoredThread): Promise<Conversation> {
    const existing = this.#threadConversations.get(thread.id);
    if (existing !== undefined) return existing;
    const opened = this.#harness.conversation(thread.conversationId, context).then((found) => {
      if (found === undefined) throw new Error("Thread conversation is missing");
      return found;
    });
    this.#threadConversations.set(thread.id, opened);
    opened.catch(() => this.#threadConversations.delete(thread.id));
    return opened;
  }

  #profile(): BotProfile {
    const profile = this.ctx.storage.kv.get<StoredProfile>("profile");
    if (profile === undefined) throw new Error("Bot has no profile");
    return { ...profile, role: profile.role ?? "", effort: profile.effort ?? defaultEffort };
  }

  #mailboxCounts(): MailboxCounts {
    const rows = this.ctx.storage.sql.exec<{ status: string; count: number }>("SELECT status, COUNT(*) AS count FROM flarebot_mailbox WHERE status != 'delivered' GROUP BY status").toArray();
    return {
      queued: rows.find((row) => row.status === "queued")?.count ?? 0,
      failed: rows.find((row) => row.status === "failed")?.count ?? 0,
    };
  }

  #queueDrain(): void {
    this.#draining = this.#draining.then(() => this.#drain()).catch((error: unknown) => console.error(String(error)));
    this.ctx.waitUntil(this.#draining);
  }

  async #drain(): Promise<void> {
    const due = this.ctx.storage.sql
      .exec<MailRow>("SELECT id, sender_id, text, hops, reply_to, group_id, thread_id, reply_thread_id, attempts FROM flarebot_mailbox WHERE status = 'queued' AND next_at <= ? ORDER BY created_at, rowid", Date.now())
      .toArray();
    let delivered = 0;
    for (const row of due) {
      try {
        await this.#deliver(row);
        this.ctx.storage.sql.exec("UPDATE flarebot_mailbox SET status = 'delivered', delivered_at = ?, error = NULL WHERE id = ?", Date.now(), row.id);
        delivered += 1;
      } catch (error) {
        await this.#deliveryFailed(row, error instanceof Error ? error.message : String(error));
      }
    }
    if (delivered > 0) await this.#report(true);
    await this.#arm(this.#harness.wake());
  }

  async #deliver(row: MailRow): Promise<void> {
    if (row.group_id !== null) {
      await this.#submitToGroup(row.group_id, row.text, "followUp", row.id);
      return;
    }
    this.ctx.storage.kv.put("botHops", row.hops);
    if (row.reply_to !== null) this.#oweReply({ botId: row.reply_to, threadId: row.reply_thread_id });
    await this.#arm({ ...this.#harness.wake(), active: true });
    const thread = row.thread_id === null ? undefined : this.#openThread(row.thread_id);
    if (thread !== undefined) {
      const threadSubmission = await (await this.#threadConversation(thread)).submit({ type: "input", content: row.text, requestId: row.id, whenBusy: "followUp" }, context);
      this.#updateThread(thread.id, { lastSubmission: threadSubmission.id });
      return;
    }
    const submission = await this.#root.submit({ type: "input", content: row.text, requestId: row.id, whenBusy: "followUp" }, context);
    this.ctx.storage.kv.put("lastSubmission", submission.id);
  }

  async #deliveryFailed(row: MailRow, error: string): Promise<void> {
    const attempts = row.attempts + 1;
    if (attempts < maxDeliveryAttempts) {
      const nextAt = Date.now() + retryBaseMs * 2 ** row.attempts;
      this.ctx.storage.sql.exec("UPDATE flarebot_mailbox SET attempts = ?, next_at = ?, error = ? WHERE id = ?", attempts, nextAt, error, row.id);
      return;
    }
    this.ctx.storage.sql.exec("UPDATE flarebot_mailbox SET status = 'failed', attempts = ?, error = ? WHERE id = ?", attempts, error, row.id);
    console.error(JSON.stringify({ event: "mailbox_failed", messageId: row.id, error }));
    const profile = this.#profile();
    if (row.group_id !== null || row.sender_id === profile.id) return;
    try {
      await this.env.BOT.getByName(row.sender_id).enqueue({
        id: `${row.id}:undelivered`,
        senderId: profile.id,
        text: botReply(profile.name, `Your message could not be delivered: ${error}`),
        hops: maxBotHops,
        replyTo: null,
        groupId: null,
        threadId: row.reply_thread_id,
      });
    } catch (notifyError) {
      console.error(String(notifyError));
    }
  }

  #nextRetryAt(): number | undefined {
    const row = this.ctx.storage.sql.exec<{ next_at: number | null }>("SELECT MIN(next_at) AS next_at FROM flarebot_mailbox WHERE status = 'queued'").toArray()[0];
    return row?.next_at ?? undefined;
  }

  #memory(): string[] {
    return this.ctx.storage.kv.get<string[]>("memory") ?? [];
  }

  async #onWake(wake: Wake): Promise<void> {
    await this.#arm(wake);
    if (this.#wasActive && !wake.active && this.#root !== undefined) {
      this.ctx.waitUntil(this.#settle().catch((error: unknown) => console.error(String(error))));
      this.#queueAutoSave();
    }
    this.#wasActive = wake.active;
  }

  #replyTo(): ReplyTarget[] {
    const stored = this.ctx.storage.kv.get<(ReplyTarget | string)[]>("replyTo") ?? [];
    return stored.map((target) => (typeof target === "string" ? { botId: target, threadId: null } : target));
  }

  #oweReply(target: ReplyTarget): void {
    if (this.#replyTo().some((owed) => owed.botId === target.botId && owed.threadId === target.threadId)) return;
    this.ctx.storage.kv.put("replyTo", [...this.#replyTo(), target]);
  }

  #conversationIds(): Record<string, ConversationId> {
    return this.ctx.storage.kv.get<Record<string, ConversationId>>("groupConversations") ?? {};
  }

  #pendingGroupReplies(): GroupReply[] {
    return this.ctx.storage.kv.get<GroupReply[]>("pendingGroupReplies") ?? [];
  }

  #groupConversation(groupId: string): Promise<Conversation> {
    const existing = this.#groupConversations.get(groupId);
    if (existing !== undefined) return existing;
    const opened = this.#openGroupConversation(groupId);
    this.#groupConversations.set(groupId, opened);
    opened.catch(() => this.#groupConversations.delete(groupId));
    return opened;
  }

  async #openGroupConversation(groupId: string): Promise<Conversation> {
    const stored = this.#conversationIds()[groupId];
    const found = stored === undefined ? undefined : await this.#harness.conversation(stored, context);
    if (found !== undefined) return found;
    const created = await this.#harness.createConversation({ ownership: { kind: "ownerless" }, agent: { model: { provider, modelId: this.#profile().model } } }, context);
    this.ctx.storage.kv.put("groupConversations", { ...this.#conversationIds(), [groupId]: created.id });
    return created;
  }

  async #submitToGroup(groupId: string, text: string, whenBusy: "steer" | "followUp", requestId: string): Promise<void> {
    const conversation = await this.#groupConversation(groupId);
    await this.#arm({ ...this.#harness.wake(), active: true });
    const submission = await conversation.submit({ type: "input", content: text, requestId, whenBusy }, context);
    this.ctx.storage.kv.put("pendingGroupReplies", [...this.#pendingGroupReplies(), { groupId, submissionId: submission.id }]);
    this.ctx.waitUntil(submission.wait(context).then(() => this.#queueGroupSettle()));
  }

  #queueGroupSettle(): void {
    this.#settlingGroupReplies = this.#settlingGroupReplies.then(() => this.#settleGroupReplies()).catch((error: unknown) => console.error(String(error)));
    this.ctx.waitUntil(this.#settlingGroupReplies);
  }

  async #settleGroupReplies(): Promise<void> {
    const settled = new Map<string, { replies: GroupReply[]; last: SubmissionRecord }>();
    for (const reply of this.#pendingGroupReplies()) {
      const submission = await this.#harness.submission(reply.submissionId, context);
      const status = await submission?.status(context);
      if (status !== undefined && status.status !== "done" && status.status !== "unanswered") continue;
      if (status === undefined) {
        this.ctx.storage.kv.put("pendingGroupReplies", this.#pendingGroupReplies().filter((pending) => pending.submissionId !== reply.submissionId));
        continue;
      }
      settled.set(reply.groupId, { replies: [...(settled.get(reply.groupId)?.replies ?? []), reply], last: status });
    }
    for (const [groupId, { replies, last }] of settled) {
      const text = await this.#groupAnswer(groupId, last);
      if (text !== null) {
        await this.env.GROUP.getByName(groupId).post(this.#profile().id, text);
        await this.#pushGroupNotice(groupId, text);
      }
      const finished = replies.map((reply) => reply.submissionId);
      this.ctx.storage.kv.put("pendingGroupReplies", this.#pendingGroupReplies().filter((pending) => !finished.includes(pending.submissionId)));
    }
    if (settled.size > 0) await this.#report(false);
  }

  async #groupAnswer(groupId: string, last: SubmissionRecord): Promise<string | null> {
    if (last.status === "unanswered" && last.reason === "aborted") return null;
    const conversation = await this.#groupConversation(groupId);
    const state = await conversation.viewState(context);
    try {
      const view = toTranscriptView(state.value, last);
      const answer = view.items.findLast((item) => item.kind === "assistant");
      if (last.status === "unanswered") return view.error ?? unfinishedMessage;
      return answer?.kind === "assistant" ? answer.text : unfinishedMessage;
    } finally {
      state.dispose();
    }
  }

  #pendingNotices(): PendingNotice[] {
    return this.ctx.storage.kv.get<PendingNotice[]>("pendingNotices") ?? [];
  }

  #awaitNotice(notice: PendingNotice): void {
    this.ctx.storage.kv.put("pendingNotices", [...this.#pendingNotices(), notice]);
  }

  #queueNotices(): void {
    this.#noticing = this.#noticing.then(() => this.#sendNotices()).catch((error: unknown) => console.error(JSON.stringify({ event: "push_failed", error: String(error) })));
    this.ctx.waitUntil(this.#noticing);
  }

  async #sendNotices(): Promise<void> {
    const finished = new Map<string, PendingNotice>();
    const settledIds: SubmissionId[] = [];
    for (const notice of this.#pendingNotices()) {
      const status = await (await this.#harness.submission(notice.submissionId, context))?.status(context);
      if (status !== undefined && status.status !== "done" && status.status !== "unanswered") continue;
      settledIds.push(notice.submissionId);
      if (status === undefined || (status.status === "unanswered" && status.reason === "aborted")) continue;
      finished.set(notice.threadId ?? "", notice);
    }
    if (settledIds.length === 0) return;
    this.ctx.storage.kv.put("pendingNotices", this.#pendingNotices().filter((notice) => !settledIds.includes(notice.submissionId)));
    for (const notice of finished.values()) {
      const message = await this.#noticeFor(notice);
      if (message !== null) await this.env.USER.getByName(userName).notify(message);
    }
  }

  async #noticeFor(notice: PendingNotice): Promise<PushMessage | null> {
    const profile = this.#profile();
    const thread = notice.threadId === null ? undefined : this.#openThread(notice.threadId);
    if (notice.threadId !== null && thread === undefined) return null;
    const view = thread === undefined ? await this.view() : await this.threadView(thread.id);
    if (view.busy) return null;
    const answer = view.items.findLast((item) => item.kind === "assistant");
    const text = answer?.kind === "assistant" ? answer.text : (view.error ?? unfinishedMessage);
    const query = new URLSearchParams({ bot: profile.id, ...(thread === undefined ? {} : { thread: thread.id }) });
    return {
      title: thread === undefined || thread.title === "" ? profile.name : `${profile.name} · ${thread.title}`,
      body: pushBody(text),
      tag: thread === undefined ? profile.id : thread.id,
      url: `/?${query}`,
    };
  }

  async #pushGroupNotice(groupId: string, text: string): Promise<void> {
    try {
      const user = this.env.USER.getByName(userName);
      const group = (await user.groups()).find((candidate) => candidate.id === groupId);
      const profile = this.#profile();
      await user.notify({ title: group === undefined ? profile.name : `${profile.name} in ${group.name}`, body: pushBody(text), tag: groupId, url: `/?${new URLSearchParams({ group: groupId })}` });
    } catch (error) {
      console.error(JSON.stringify({ event: "push_failed", error: String(error) }));
    }
  }

  async #settle(): Promise<void> {
    await this.#report(false);
    this.#queueNotices();
    const recipients = this.#replyTo();
    if (recipients.length === 0) return;
    this.ctx.storage.kv.delete("replyTo");
    const view = await this.view();
    const turnStart = view.items.findLastIndex((item) => item.kind === "user" || item.kind === "peer");
    const answer = view.items.slice(turnStart + 1).findLast((item) => item.kind === "assistant");
    const text = answer?.kind === "assistant" ? answer.text : (view.error ?? unfinishedMessage);
    const hops = (this.ctx.storage.kv.get<number>("botHops") ?? 0) + 1;
    const profile = this.#profile();
    const undelivered: ReplyTarget[] = [];
    for (const target of recipients) {
      try {
        await this.env.BOT.getByName(target.botId).enqueue({ id: crypto.randomUUID(), senderId: profile.id, text: botReply(profile.name, text), hops, replyTo: null, groupId: null, threadId: target.threadId });
      } catch (error) {
        console.error(String(error));
        undelivered.push(target);
      }
    }
    if (undelivered.length > 0) this.ctx.storage.kv.put("replyTo", [...this.#replyTo(), ...undelivered]);
  }

  async #report(typing: boolean): Promise<void> {
    if (this.ctx.storage.kv.get("profile") === undefined) return;
    const view = await this.view();
    const lastText = view.items.findLast((item) => item.kind === "assistant" || item.kind === "user" || item.kind === "peer");
    await this.env.USER.getByName(userName).updateBot(this.#profile().id, {
      typing: typing || view.busy || this.#pendingGroupReplies().length > 0,
      last: lastText !== undefined && "text" in lastText ? lastText.text.replaceAll("**", "").replace(/\s+/g, " ").slice(0, 160) : "",
      lastAt: lastText?.at ?? Date.now(),
      cost: view.totalCost,
      needsYou: view.takeover !== null,
    });
  }

  async #arm(wake: Wake): Promise<void> {
    const heartbeat = wake.active ? Date.now() + heartbeatMs : undefined;
    const candidates = [heartbeat, wake.at, this.#nextRetryAt()].filter((at) => at !== undefined);
    if (candidates.length === 0) await this.ctx.storage.deleteAlarm();
    else await this.ctx.storage.setAlarm(Math.min(...candidates));
  }
}
