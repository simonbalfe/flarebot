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

const defaultBotName = "Flare";

export class User extends DurableObject<Env> {
  async list(): Promise<BotSummary[]> {
    const bots = this.#bots();
    if (bots.length > 0) return bots;
    return [await this.create({ name: defaultBotName, primary: true })];
  }

  has(id: string): boolean {
    return this.#bots().some((bot) => bot.id === id);
  }

  async create(input: { name: string; primary?: boolean }): Promise<BotSummary> {
    const bot: BotSummary = {
      id: crypto.randomUUID(),
      name: input.name,
      model: this.env.DEFAULT_MODEL,
      typing: false,
      last: "",
      lastAt: Date.now(),
      cost: 0,
      needsYou: false,
      primary: input.primary ?? false,
    };
    await this.env.BOT.getByName(bot.id).init({ id: bot.id, name: bot.name, model: bot.model });
    this.ctx.storage.kv.put("bots", [...this.#bots(), bot]);
    return bot;
  }

  updateBot(id: string, patch: Partial<BotSummaryPatch> & { model?: string }): void {
    this.ctx.storage.kv.put("bots", this.#bots().map((bot) => (bot.id === id ? { ...bot, ...patch } : bot)));
  }

  #bots(): BotSummary[] {
    return this.ctx.storage.kv.get<BotSummary[]>("bots") ?? [];
  }
}
