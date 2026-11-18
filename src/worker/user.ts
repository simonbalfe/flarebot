import { authorizeMcp, type McpOAuthState } from "@earendil-works/pi-mcp/oauth";
import { DurableObject } from "cloudflare:workers";
import { catalogEntry, clientEnvPrefix } from "./catalog";
import { clientMetadataPath, codemodeOAuth, mcpCallbackPath, mcpOAuth, type OAuthClient } from "./codemode-auth";
import { claudeModelId, defaultEffort } from "./env";
import { codemodeServer, isBuiltInServer, listTools, type McpServerConfig, type McpServerSummary, serverSummary } from "./mcp";
import { addCli, type CliSummary, ensurePool, inspectSkill, type PoolKind, publishCli, publishSkill, removeItem, unpackUpload } from "./pool";
import { type PushDevice, sendDevicePush } from "./native-push";
import { createVapidKeys, type PushMessage, type PushSubscriptionInput, sendPush, type VapidKeys } from "./push";
import { projectExists } from "./repos";
import type { BotProfile } from "./tools";
import { type SealedSecret, seal, type SecretSummary, secretSummary, unseal } from "./vault";

export type PoolResult = { ok: true; name: string } | { ok: false; error: string };

type StoredItem = Omit<CliSummary, "publishedBy"> & { publishedBy?: string | null };

export type ConnectRequest = { botId: string; requestId: string };
export type FinishedConnection = { serverId: string; name: string; request: ConnectRequest | null };

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
const tokenRefreshMarginMs = 60_000;

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
    this.ctx.storage.kv.put("vault", this.#secrets().map((secret) => ({ ...secret, botIds: secret.botIds.filter((botId) => botId !== id) })));
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
    const connected = this.#codemodeState()?.tokens !== undefined;
    return this.#mcpServers().map((server) => {
      if (isBuiltInServer(server.id)) return { ...serverSummary(server), hasToken: connected };
      if (server.auth === "oauth") return { ...serverSummary(server), hasToken: this.#oauthState(server.id)?.tokens !== undefined };
      return serverSummary(server);
    });
  }

  async addOAuthServer(input: { name: string; url: string; description: string; catalogId: string }): Promise<AddMcpResult> {
    const existing = this.#storedMcpServers().find((server) => server.catalogId === input.catalogId || server.url === input.url);
    if (existing !== undefined) return { ok: true, server: this.mcpServers().find((server) => server.id === existing.id) ?? serverSummary(existing), tools: 0 };
    if (this.#mcpServers().some((server) => server.name.toLowerCase() === input.name.toLowerCase())) return { ok: false, error: `An MCP server named ${input.name} already exists` };
    const server: McpServerConfig = { id: crypto.randomUUID(), name: input.name, url: input.url, description: input.description, headers: {}, auth: "oauth", catalogId: input.catalogId };
    this.ctx.storage.kv.put("mcpServers", [...this.#storedMcpServers(), server]);
    return { ok: true, server: serverSummary(server), tools: 0 };
  }

  async connectServer(id: string, origin: string, request: ConnectRequest | null): Promise<string> {
    const server = this.#storedMcpServers().find((candidate) => candidate.id === id && candidate.auth === "oauth");
    if (server === undefined) throw new Error("No app with that id");
    this.ctx.storage.kv.put("oauthOrigin", origin);
    this.ctx.storage.kv.delete(`oauth:${id}`);
    this.ctx.storage.kv.put("oauthRequests", { ...this.#oauthRequests(), [id]: request });
    let target: URL | undefined;
    const result = await authorizeMcp(this.#serverProvider(server, (url) => { target = url; }), this.#flowOptions(server));
    if (result === "AUTHORIZED") return `${origin}/`;
    if (target === undefined) throw new Error(`${server.name} did not ask for a sign-in`);
    for (const [key, value] of Object.entries(catalogEntry(server.catalogId)?.authParams ?? {})) target.searchParams.set(key, value);
    return target.toString();
  }

  async finishServerAuth(input: { code: string; state: string; iss?: string }): Promise<FinishedConnection> {
    const server = this.#storedMcpServers().find((candidate) => candidate.auth === "oauth" && this.#oauthState(candidate.id)?.oauthState === input.state);
    if (server === undefined) throw new Error("Sign-in state does not match");
    await authorizeMcp(this.#serverProvider(server, () => undefined), { ...this.#flowOptions(server), authorizationCode: input.code, ...(input.iss === undefined ? {} : { iss: input.iss }) });
    const request = this.#oauthRequests()[server.id] ?? null;
    const { [server.id]: _done, ...rest } = this.#oauthRequests();
    this.ctx.storage.kv.put("oauthRequests", rest);
    return { serverId: server.id, name: server.name, request };
  }

  serverToken(id: string, refresh: boolean): Promise<string | null> {
    return this.ctx.blockConcurrencyWhile(async () => {
      const server = this.#storedMcpServers().find((candidate) => candidate.id === id && candidate.auth === "oauth");
      const state = this.#oauthState(id);
      if (server === undefined || state?.tokens === undefined) return null;
      const fresh = state.tokensExpireAt === undefined || state.tokensExpireAt - tokenRefreshMarginMs > Date.now();
      if (fresh && !refresh) return state.tokens.access_token;
      const provider = this.#serverProvider(server, () => undefined);
      const result = await authorizeMcp(provider, this.#flowOptions(server)).catch(() => "REDIRECT" as const);
      return result === "AUTHORIZED" ? ((await provider.tokens())?.access_token ?? null) : null;
    });
  }

  disconnectServer(id: string): void {
    this.ctx.storage.kv.delete(`oauth:${id}`);
  }

  #oauthState(id: string): McpOAuthState | undefined {
    return this.ctx.storage.kv.get<McpOAuthState>(`oauth:${id}`);
  }

  #oauthRequests(): Record<string, ConnectRequest | null> {
    return this.ctx.storage.kv.get<Record<string, ConnectRequest | null>>("oauthRequests") ?? {};
  }

  #flowOptions(server: McpServerConfig): { serverUrl: string; scope?: string } {
    const scope = catalogEntry(server.catalogId)?.scope;
    return scope === undefined ? { serverUrl: server.url } : { serverUrl: server.url, scope };
  }

  #oauthClient(catalogId: string | undefined): OAuthClient | undefined {
    const entry = catalogEntry(catalogId);
    if (entry?.auth !== "client") return undefined;
    const prefix = clientEnvPrefix(entry.id);
    const clientId: unknown = Reflect.get(this.env, `${prefix}_CLIENT_ID`);
    const clientSecret: unknown = Reflect.get(this.env, `${prefix}_CLIENT_SECRET`);
    if (typeof clientId !== "string" || clientId === "") throw new Error(`${entry.name} needs ${prefix}_CLIENT_ID and ${prefix}_CLIENT_SECRET in Infisical`);
    return typeof clientSecret === "string" && clientSecret !== "" ? { clientId, clientSecret } : { clientId };
  }

  #serverProvider(server: McpServerConfig, onRedirect: (url: URL) => void) {
    const origin = this.ctx.storage.kv.get<string>("oauthOrigin") ?? this.env.FLAREBOT_APP_URL;
    const cimd = catalogEntry(server.catalogId)?.auth === "cimd" && origin.startsWith("https://") ? { url: `${origin}${clientMetadataPath}`, redirectUrl: `${origin}${mcpCallbackPath}` } : undefined;
    return mcpOAuth({ serverUrl: server.url, redirectUrl: `${origin}${mcpCallbackPath}`, store: { load: () => this.#oauthState(server.id), save: (state) => this.ctx.storage.kv.put(`oauth:${server.id}`, state) }, onRedirect, client: this.#oauthClient(server.catalogId), cimd });
  }

  mcpServer(id: string): McpServerConfig | null {
    return this.#storedMcpServers().find((server) => server.id === id) ?? null;
  }

  async connectCodemode(origin: string): Promise<string> {
    this.ctx.storage.kv.put("codemodeOrigin", origin);
    this.ctx.storage.kv.delete("codemodeOAuth");
    let target: URL | undefined;
    const result = await authorizeMcp(this.#codemodeProvider((url) => { target = url; }), { serverUrl: this.env.CODEMODE_MCP_URL });
    if (result !== "REDIRECT" || target === undefined) throw new Error("codemode did not ask for a sign-in");
    return target.toString();
  }

  async finishCodemode(input: { code: string; state: string; iss?: string }): Promise<void> {
    const provider = this.#codemodeProvider(() => undefined);
    if (this.#codemodeState()?.oauthState !== input.state) throw new Error("codemode sign-in state does not match");
    await authorizeMcp(provider, { serverUrl: this.env.CODEMODE_MCP_URL, authorizationCode: input.code, ...(input.iss === undefined ? {} : { iss: input.iss }) });
  }

  disconnectCodemode(): void {
    this.ctx.storage.kv.delete("codemodeOAuth");
  }

  codemodeToken(refresh: boolean): Promise<string | null> {
    return this.ctx.blockConcurrencyWhile(async () => {
      const state = this.#codemodeState();
      if (state?.tokens === undefined) return null;
      const fresh = state.tokensExpireAt === undefined || state.tokensExpireAt - tokenRefreshMarginMs > Date.now();
      if (fresh && !refresh) return state.tokens.access_token;
      const provider = this.#codemodeProvider(() => undefined);
      const result = await authorizeMcp(provider, { serverUrl: this.env.CODEMODE_MCP_URL }).catch(() => "REDIRECT" as const);
      return result === "AUTHORIZED" ? ((await provider.tokens())?.access_token ?? null) : null;
    });
  }

  #codemodeState(): McpOAuthState | undefined {
    return this.ctx.storage.kv.get<McpOAuthState>("codemodeOAuth");
  }

  #codemodeProvider(onRedirect: (url: URL) => void) {
    const origin = this.ctx.storage.kv.get<string>("codemodeOrigin") ?? this.env.FLAREBOT_APP_URL;
    return codemodeOAuth(this.env, origin, { load: () => this.#codemodeState(), save: (state) => this.ctx.storage.kv.put("codemodeOAuth", state) }, onRedirect);
  }

  async addMcpServer(input: { name: string; url: string; description: string; token: string; catalogId?: string }): Promise<AddMcpResult> {
    if (this.#mcpServers().some((server) => server.name.toLowerCase() === input.name.toLowerCase())) return { ok: false, error: `An MCP server named ${input.name} already exists` };
    const server: McpServerConfig = {
      id: crypto.randomUUID(),
      name: input.name,
      url: input.url,
      description: input.description,
      headers: input.token === "" ? {} : { authorization: `Bearer ${input.token}` },
      ...(input.catalogId === undefined ? {} : { catalogId: input.catalogId }),
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
    this.ctx.storage.kv.delete(`oauth:${id}`);
    await Promise.allSettled(this.#bots().map((bot) => this.env.BOT.getByName(bot.id).disableMcpServer(id)));
  }

  secrets(): SecretSummary[] {
    return this.#secrets().map(secretSummary);
  }

  secretNames(botId: string): string[] {
    return this.#secrets().filter((secret) => secret.botIds.includes(botId)).map((secret) => secret.name);
  }

  hasSecret(name: string): boolean {
    return this.#secrets().some((secret) => secret.name === name);
  }

  async storeSecret(name: string, value: string, botId: string): Promise<void> {
    const existing = this.#secrets().find((secret) => secret.name === name);
    const sealed: SealedSecret = { name, botIds: [...new Set([...(existing?.botIds ?? []), botId])], createdAt: Date.now(), ...(await seal(this.env, name, value)) };
    this.ctx.storage.kv.put("vault", [...this.#secrets().filter((secret) => secret.name !== name), sealed].sort((a, b) => a.name.localeCompare(b.name)));
  }

  setSecretAccess(name: string, botId: string, allowed: boolean): boolean {
    const existing = this.#secrets().find((secret) => secret.name === name);
    if (existing === undefined) return false;
    const botIds = allowed ? [...new Set([...existing.botIds, botId])] : existing.botIds.filter((id) => id !== botId);
    this.ctx.storage.kv.put("vault", this.#secrets().map((secret) => (secret.name === name ? { ...secret, botIds } : secret)));
    return true;
  }

  deleteSecret(name: string): void {
    this.ctx.storage.kv.put("vault", this.#secrets().filter((secret) => secret.name !== name));
  }

  async revealSecret(name: string, botId: string): Promise<string | null> {
    const secret = this.#secrets().find((candidate) => candidate.name === name && candidate.botIds.includes(botId));
    return secret === undefined ? null : unseal(this.env, secret);
  }

  #secrets(): SealedSecret[] {
    return this.ctx.storage.kv.get<SealedSecret[]>("vault") ?? [];
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
