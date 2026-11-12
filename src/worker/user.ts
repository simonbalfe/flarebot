import { DurableObject } from "cloudflare:workers";
import { claudeModelId, defaultEffort } from "./env";
import { codemodeServer, isBuiltInServer, listTools, type McpServerConfig, type McpServerSummary, serverSummary } from "./mcp";
import { addCli, type CliSummary, ensurePool, inspectSkill, type PoolKind, publishCli, publishSkill, removeItem, unpackUpload } from "./pool";
import { type PushDevice, sendDevicePush } from "./native-push";
import { createVapidKeys, type PushMessage, type PushSubscriptionInput, sendPush, type VapidKeys } from "./push";
import { projectExists } from "./repos";
import type { BotProfile } from "./tools";

export type PoolResult = { ok: true; name: string } | { ok: false; error: string };

type StoredItem = Omit<CliSummary, "publishedBy"> & { publishedBy?: string | null };

export type AddMcpResult = { ok: true; server: McpServerSummary; tools: number } | { ok: false; error: string };

export interface BotSummary extends Omit<BotProfile, "effort"> {
  typing: boolean;
  last: string;
  lastAt: number;
  cost: number;
  needsYou: boolean;
  primary: boolean;
}

export type BotSummaryPatch = Pick<BotSummary, "typing" | "last" | "lastAt" | "cost" | "needsYou">;

type StoredBotSummary = Omit<BotSummary, "role"> & { role?: string };

export interface GroupSummary {
  id: string;
  name: string;
  memberIds: string[];
  last: string;
  lastAt: number;
}

const defaultBotName = "Flare";
const maxErrorChars = 200;

export class User extends DurableObject<Env> {
  async list(): Promise<BotSummary[]> {
    if (this.#bots().length > 0) return this.#bots();
    return this.ctx.blockConcurrencyWhile(async () => {
      const bots = this.#bots();
      return bots.length > 0 ? bots : [await this.create({ name: defaultBotName, primary: true })];
    });
  }

  has(id: string): boolean {
    return this.#bots().some((bot) => bot.id === id);
  }

  async create(input: { name: string; role?: string; primary?: boolean }): Promise<BotSummary> {
    const bot: BotSummary = {
      id: crypto.randomUUID(),
      name: input.name,
      role: input.role ?? "",
      model: this.env.DEFAULT_MODEL,
      typing: false,
      last: "",
      lastAt: Date.now(),
      cost: 0,
      needsYou: false,
      primary: input.primary ?? false,
    };
    await this.env.BOT.getByName(bot.id).init({ id: bot.id, name: bot.name, role: bot.role, model: bot.model, effort: defaultEffort });
    this.ctx.storage.kv.put("bots", [...this.#bots(), bot]);
    return bot;
  }

  async editBot(id: string, input: { name: string; role: string }): Promise<void> {
    const bot = this.env.BOT.getByName(id);
    await bot.setName(input.name);
    await bot.setRole(input.role);
    this.updateBot(id, input);
  }

  async deleteBot(id: string): Promise<void> {
    this.ctx.storage.kv.put("bots", this.#bots().filter((bot) => bot.id !== id));
    for (const group of this.groups().filter((candidate) => candidate.memberIds.includes(id))) {
      const memberIds = group.memberIds.filter((member) => member !== id);
      if (memberIds.length === 0) await this.deleteGroup(group.id);
      else this.ctx.storage.kv.put("groups", this.groups().map((candidate) => (candidate.id === group.id ? { ...candidate, memberIds } : candidate)));
    }
    await this.env.BOT.getByName(id).destroy();
  }

  async renameGroup(id: string, name: string): Promise<void> {
    await this.env.GROUP.getByName(id).setName(name);
    this.ctx.storage.kv.put("groups", this.groups().map((group) => (group.id === id ? { ...group, name } : group)));
  }

  async deleteGroup(id: string): Promise<void> {
    this.ctx.storage.kv.put("groups", this.groups().filter((group) => group.id !== id));
    await this.env.GROUP.getByName(id).destroy();
  }

  updateBot(id: string, patch: Partial<BotSummaryPatch> & { model?: string; role?: string; name?: string }): void {
    this.ctx.storage.kv.put("bots", this.#bots().map((bot) => (bot.id === id ? { ...bot, ...patch } : bot)));
  }

  groups(): GroupSummary[] {
    return this.ctx.storage.kv.get<GroupSummary[]>("groups") ?? [];
  }

  hasGroup(id: string): boolean {
    return this.groups().some((group) => group.id === id);
  }

  async createGroup(input: { name: string; memberIds: string[] }): Promise<GroupSummary> {
    const known = this.#bots().filter((bot) => input.memberIds.includes(bot.id));
    if (known.length !== input.memberIds.length) throw new Error("A group member does not exist");
    const name = input.name === "" ? known.map((bot) => bot.name).join(", ") : input.name;
    const group: GroupSummary = { id: crypto.randomUUID(), name, memberIds: input.memberIds, last: "", lastAt: Date.now() };
    await this.env.GROUP.getByName(group.id).init({ id: group.id, name, memberIds: input.memberIds });
    this.ctx.storage.kv.put("groups", [...this.groups(), group]);
    return group;
  }

  updateGroup(id: string, patch: Pick<GroupSummary, "last" | "lastAt">): void {
    this.ctx.storage.kv.put("groups", this.groups().map((group) => (group.id === id ? { ...group, ...patch } : group)));
  }

  projects(): string[] {
    return this.ctx.storage.kv.get<string[]>("projects") ?? [];
  }

  async addProject(name: string): Promise<{ ok: true } | { ok: false; error: string }> {
    if (this.projects().includes(name)) return { ok: true };
    if (!(await projectExists(this.env, name))) return { ok: false, error: `No Artifacts repo named ${name}` };
    this.ctx.storage.kv.put("projects", [...this.projects(), name]);
    return { ok: true };
  }

  removeProject(name: string): void {
    this.ctx.storage.kv.put("projects", this.projects().filter((project) => project !== name));
  }

  poolItems(kind: PoolKind): CliSummary[] {
    return (this.ctx.storage.kv.get<StoredItem[]>(kind) ?? []).map((item) => ({ ...item, publishedBy: item.publishedBy ?? null }));
  }

  async addCli(input: { name: string; description: string }, contents: Uint8Array): Promise<PoolResult> {
    const saved = await addCli(this.env, input.name, contents);
    if (!saved.ok) return saved;
    await this.#storeItem("clis", { ...input, publishedBy: null });
    return { ok: true, name: input.name };
  }

  async publishCli(botId: string, input: { name: string; description: string; source: string }): Promise<PoolResult> {
    const bot = this.#bots().find((candidate) => candidate.id === botId);
    if (bot === undefined) return { ok: false, error: "Unknown Bot" };
    const blocked = this.#blocked("clis", input.name, botId);
    if (blocked !== null) return blocked;
    const saved = await publishCli(this.env, input.name, input.source, bot.name);
    if (!saved.ok) return saved;
    await this.#storeItem("clis", { name: input.name, description: input.description, publishedBy: botId });
    return { ok: true, name: input.name };
  }

  async addSkill(contents: Uint8Array): Promise<PoolResult> {
    const upload = await unpackUpload(this.env, contents).catch((error: unknown) => (error instanceof Error ? error : new Error(String(error))));
    if (upload instanceof Error) return { ok: false, error: upload.message };
    try {
      return await this.#publishSkillFrom(upload.source, null, "flarebot");
    } finally {
      await upload.cleanup();
    }
  }

  async publishSkill(botId: string, source: string): Promise<PoolResult> {
    const bot = this.#bots().find((candidate) => candidate.id === botId);
    if (bot === undefined) return { ok: false, error: "Unknown Bot" };
    return this.#publishSkillFrom(source, botId, bot.name);
  }

  async removeItem(kind: PoolKind, name: string): Promise<PoolResult> {
    const removed = await removeItem(this.env, kind, name);
    if (!removed.ok) return removed;
    this.ctx.storage.kv.put(kind, this.poolItems(kind).filter((item) => item.name !== name));
    await Promise.allSettled(this.#bots().map((bot) => this.env.BOT.getByName(bot.id).disablePoolItem(kind, name)));
    return { ok: true, name };
  }

  async #publishSkillFrom(source: string, botId: string | null, author: string): Promise<PoolResult> {
    const ready = await ensurePool(this.env);
    if (!ready.ok) return ready;
    const skill = await inspectSkill(this.env, source);
    if (!skill.ok) return skill;
    if (botId !== null) {
      const blocked = this.#blocked("skills", skill.name, botId);
      if (blocked !== null) return blocked;
    }
    const saved = await publishSkill(this.env, skill.name, source, author);
    if (!saved.ok) return saved;
    await this.#storeItem("skills", { name: skill.name, description: skill.description, publishedBy: botId });
    return { ok: true, name: skill.name };
  }

  #blocked(kind: PoolKind, name: string, botId: string): PoolResult | null {
    const existing = this.poolItems(kind).find((item) => item.name === name);
    if (existing === undefined || existing.publishedBy === botId) return null;
    return { ok: false, error: `The pool already has ${kind === "clis" ? "a CLI" : "a skill"} named ${name} that isn't yours. Pick another name.` };
  }

  async #storeItem(kind: PoolKind, item: CliSummary): Promise<void> {
    this.ctx.storage.kv.put(kind, [...this.poolItems(kind).filter((current) => current.name !== item.name), item].sort((a, b) => a.name.localeCompare(b.name)));
    await Promise.allSettled(this.#bots().map((bot) => this.env.BOT.getByName(bot.id).refreshPoolItem(kind, item)));
  }

  mcpServers(): McpServerSummary[] {
    return this.#mcpServers().map(serverSummary);
  }

  mcpServer(id: string): McpServerConfig | null {
    return this.#mcpServers().find((server) => server.id === id) ?? null;
  }

  async addMcpServer(input: { name: string; url: string; description: string; token: string }): Promise<AddMcpResult> {
    if (this.#mcpServers().some((server) => server.name.toLowerCase() === input.name.toLowerCase())) return { ok: false, error: `An MCP server named ${input.name} already exists` };
    const server: McpServerConfig = {
      id: crypto.randomUUID(),
      name: input.name,
      url: input.url,
      description: input.description,
      headers: input.token === "" ? {} : { authorization: `Bearer ${input.token}` },
    };
    try {
      const tools = await listTools(server);
      this.ctx.storage.kv.put("mcpServers", [...this.#storedMcpServers(), server]);
      return { ok: true, server: serverSummary(server), tools: tools.length };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, error: `Could not connect: ${message.length > maxErrorChars ? `${message.slice(0, maxErrorChars)}…` : message}` };
    }
  }

  async removeMcpServer(id: string): Promise<void> {
    if (isBuiltInServer(id)) return;
    this.ctx.storage.kv.put("mcpServers", this.#storedMcpServers().filter((server) => server.id !== id));
    await Promise.allSettled(this.#bots().map((bot) => this.env.BOT.getByName(bot.id).disableMcpServer(id)));
  }

  async pushPublicKey(): Promise<string> {
    return (await this.#vapidKeys()).publicKey;
  }

  addPushSubscription(subscription: PushSubscriptionInput): void {
    this.ctx.storage.kv.put("pushSubscriptions", [...this.#pushSubscriptions().filter((current) => current.endpoint !== subscription.endpoint), subscription]);
  }

  removePushSubscription(endpoint: string): void {
    this.ctx.storage.kv.put("pushSubscriptions", this.#pushSubscriptions().filter((current) => current.endpoint !== endpoint));
  }

  addPushDevice(device: PushDevice): void {
    this.ctx.storage.kv.put("pushDevices", [...this.#pushDevices().filter((current) => current.token !== device.token), device]);
  }

  removePushDevice(token: string): void {
    this.ctx.storage.kv.put("pushDevices", this.#pushDevices().filter((current) => current.token !== token));
  }

  async notify(message: PushMessage): Promise<void> {
    await Promise.all([this.#notifyBrowsers(message), this.#notifyDevices(message)]);
  }

  async #notifyDevices(message: PushMessage): Promise<void> {
    const devices = this.#pushDevices();
    if (devices.length === 0) return;
    const outcomes = await Promise.all(devices.map((device) => sendDevicePush(this.env, device, message).catch((error: unknown) => {
      console.error(JSON.stringify({ event: "push_failed", platform: device.platform, error: String(error) }));
      return "failed" as const;
    })));
    const gone = devices.filter((_, index) => outcomes[index] === "gone").map((device) => device.token);
    if (gone.length > 0) this.ctx.storage.kv.put("pushDevices", this.#pushDevices().filter((current) => !gone.includes(current.token)));
  }

  #pushDevices(): PushDevice[] {
    return this.ctx.storage.kv.get<PushDevice[]>("pushDevices") ?? [];
  }

  async #notifyBrowsers(message: PushMessage): Promise<void> {
    const subscriptions = this.#pushSubscriptions();
    if (subscriptions.length === 0) return;
    const keys = await this.#vapidKeys();
    const outcomes = await Promise.all(subscriptions.map((subscription) => sendPush(keys, this.env.FLAREBOT_APP_URL, subscription, message).catch((error: unknown) => {
      console.error(JSON.stringify({ event: "push_failed", error: String(error) }));
      return "failed" as const;
    })));
    const gone = subscriptions.filter((_, index) => outcomes[index] === "gone").map((subscription) => subscription.endpoint);
    if (gone.length > 0) this.ctx.storage.kv.put("pushSubscriptions", this.#pushSubscriptions().filter((current) => !gone.includes(current.endpoint)));
  }

  #pushSubscriptions(): PushSubscriptionInput[] {
    return this.ctx.storage.kv.get<PushSubscriptionInput[]>("pushSubscriptions") ?? [];
  }

  async #vapidKeys(): Promise<VapidKeys> {
    const stored = this.ctx.storage.kv.get<VapidKeys>("vapidKeys");
    if (stored !== undefined) return stored;
    return this.ctx.blockConcurrencyWhile(async () => {
      const existing = this.ctx.storage.kv.get<VapidKeys>("vapidKeys");
      if (existing !== undefined) return existing;
      const created = await createVapidKeys();
      this.ctx.storage.kv.put("vapidKeys", created);
      return created;
    });
  }

  #mcpServers(): McpServerConfig[] {
    return [codemodeServer(this.env), ...this.#storedMcpServers()];
  }

  #storedMcpServers(): McpServerConfig[] {
    return this.ctx.storage.kv.get<McpServerConfig[]>("mcpServers") ?? [];
  }

  #bots(): BotSummary[] {
    return (this.ctx.storage.kv.get<StoredBotSummary[]>("bots") ?? []).map((bot) => ({ ...bot, role: bot.role ?? "", model: claudeModelId(bot.model) }));
  }
}
