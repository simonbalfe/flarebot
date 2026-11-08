import { DurableObject } from "cloudflare:workers";
import type { BotProfile } from "./tools";

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

  #bots(): BotSummary[] {
    return (this.ctx.storage.kv.get<StoredBotSummary[]>("bots") ?? []).map((bot) => ({ ...bot, role: bot.role ?? "" }));
  }
}
