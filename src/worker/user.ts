import { DurableObject } from "cloudflare:workers";
import { listTools, type McpServerConfig, type McpServerSummary, serverSummary } from "./mcp";
import type { BotProfile } from "./tools";

export type AddMcpResult = { ok: true; server: McpServerSummary; tools: number } | { ok: false; error: string };

export interface BotSummary extends BotProfile {
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
    await this.env.BOT.getByName(bot.id).init({ id: bot.id, name: bot.name, role: bot.role, model: bot.model });
    this.ctx.storage.kv.put("bots", [...this.#bots(), bot]);
    return bot;
  }

  updateBot(id: string, patch: Partial<BotSummaryPatch> & { model?: string; role?: string }): void {
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
      this.ctx.storage.kv.put("mcpServers", [...this.#mcpServers(), server]);
      return { ok: true, server: serverSummary(server), tools: tools.length };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, error: `Could not connect: ${message.length > maxErrorChars ? `${message.slice(0, maxErrorChars)}…` : message}` };
    }
  }

  async removeMcpServer(id: string): Promise<void> {
    this.ctx.storage.kv.put("mcpServers", this.#mcpServers().filter((server) => server.id !== id));
    await Promise.allSettled(this.#bots().map((bot) => this.env.BOT.getByName(bot.id).disableMcpServer(id)));
  }

  #mcpServers(): McpServerConfig[] {
    return this.ctx.storage.kv.get<McpServerConfig[]>("mcpServers") ?? [];
  }

  #bots(): BotSummary[] {
    return (this.ctx.storage.kv.get<StoredBotSummary[]>("bots") ?? []).map((bot) => ({ ...bot, role: bot.role ?? "" }));
  }
}
