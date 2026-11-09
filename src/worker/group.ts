import { DurableObject } from "cloudflare:workers";
import { claudeToken, claudeTransport } from "./claude";
import { modelContainerName, userName } from "./env";
import { recordTurns } from "./langfuse";
import { atMentioned, namedInText } from "./mentions";
import { chooseBots } from "./router";
import type { BotSummary } from "./user";
import { groupMessage } from "./view";

const maxGroupHops = 6;
const contextMessages = 10;
const contextCharsPerMessage = 1000;
const viewMessages = 500;
export const systemSender = "system";

export interface GroupProfile {
  id: string;
  name: string;
  memberIds: string[];
}

export interface GroupMessage {
  id: string;
  senderId: string | null;
  text: string;
  at: number;
}

export interface GroupView {
  profile: GroupProfile;
  messages: GroupMessage[];
  typingIds: string[];
}

type MessageRow = { id: string; sender: string | null; text: string; at: number };

export class Group extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, sender TEXT, text TEXT NOT NULL, at INTEGER NOT NULL)");
  }

  init(profile: GroupProfile): void {
    this.ctx.storage.kv.put("profile", profile);
  }

  setName(name: string): void {
    this.ctx.storage.kv.put("profile", { ...this.#profile(), name });
  }

  async destroy(): Promise<void> {
    await this.ctx.storage.deleteAll();
  }

  async view(): Promise<GroupView> {
    const rows = this.ctx.storage.sql.exec<MessageRow>("SELECT id, sender, text, at FROM messages ORDER BY rowid DESC LIMIT ?", viewMessages).toArray();
    const profile = this.#profile();
    const busy = await Promise.all(profile.memberIds.map((id) => this.env.BOT.getByName(id).isBusyIn(profile.id)));
    return {
      profile,
      messages: rows.reverse().map((row) => ({ id: row.id, senderId: row.sender, text: row.text, at: row.at })),
      typingIds: profile.memberIds.filter((_, index) => busy[index]),
    };
  }

  async send(text: string): Promise<void> {
    this.ctx.storage.kv.put("hops", 0);
    this.#insert(null, text);
    const bots = await this.#members();
    const mentioned = atMentioned(text, bots);
    const named = mentioned.length > 0 ? mentioned : namedInText(text, bots);
    const targets = named.length > 0 ? named : await this.#routedTargets(text, bots);
    await this.#deliver(targets, "You", text, bots);
  }

  async post(botId: string, text: string): Promise<void> {
    if (!this.#profile().memberIds.includes(botId)) throw new Error("This Bot is not in the group");
    const hops = (this.ctx.storage.kv.get<number>("hops") ?? 0) + 1;
    this.ctx.storage.kv.put("hops", hops);
    this.#insert(botId, text);
    if (hops > maxGroupHops) return;
    const bots = await this.#members();
    const others = bots.filter((bot) => bot.id !== botId);
    const sender = bots.find((bot) => bot.id === botId)?.name ?? "A Bot";
    await this.#deliver(atMentioned(text, others), sender, text, bots);
  }

  async stop(): Promise<void> {
    const profile = this.#profile();
    await Promise.allSettled(profile.memberIds.map((id) => this.env.BOT.getByName(id).stopGroup(profile.id)));
  }

  #profile(): GroupProfile {
    const profile = this.ctx.storage.kv.get<GroupProfile>("profile");
    if (profile === undefined) throw new Error("Group has no profile");
    return profile;
  }

  async #members(): Promise<BotSummary[]> {
    const memberIds = this.#profile().memberIds;
    const bots = await this.env.USER.getByName(userName).list();
    return bots.filter((bot) => memberIds.includes(bot.id));
  }

  async #routedTargets(text: string, bots: BotSummary[]): Promise<BotSummary[]> {
    if (bots.length < 2) return bots;
    try {
      const members = await Promise.all(bots.map(async (bot) => ({ name: bot.name, role: bot.role, memory: await this.env.BOT.getByName(bot.id).memory() })));
      const recordTurn = recordTurns(this.env, (work) => this.ctx.waitUntil(work), () => ({ kind: "router", id: this.#profile().id, name: this.#profile().name }));
      const connection = { session: () => ({ send: claudeTransport(this.env, modelContainerName), id: undefined }), token: claudeToken(this.env), recordTurn };
      const names = await chooseBots({ connection, model: this.env.ROUTER_MODEL, members, recent: this.#recentContext(bots), message: text });
      const chosen = bots.filter((bot) => names.includes(bot.name));
      return chosen.length > 0 ? chosen : this.#defaultTarget(bots);
    } catch (error) {
      console.error(String(error));
      return this.#defaultTarget(bots);
    }
  }

  #defaultTarget(bots: BotSummary[]): BotSummary[] {
    const rows = this.ctx.storage.sql.exec<Pick<MessageRow, "sender">>("SELECT sender FROM messages WHERE sender IS NOT NULL AND sender != ? ORDER BY rowid DESC LIMIT 1", systemSender).toArray();
    const target = bots.find((bot) => bot.id === rows[0]?.sender) ?? bots[0];
    return target === undefined ? [] : [target];
  }

  #insert(sender: string | null, text: string): void {
    this.ctx.storage.sql.exec("INSERT INTO messages (id, sender, text, at) VALUES (?, ?, ?, ?)", crypto.randomUUID(), sender, text, Date.now());
  }

  #recentContext(bots: BotSummary[]): string {
    const rows = this.ctx.storage.sql.exec<MessageRow>("SELECT id, sender, text, at FROM messages WHERE sender IS NULL OR sender != ? ORDER BY rowid DESC LIMIT ?", systemSender, contextMessages).toArray();
    const lines = rows.reverse().map((row) => {
      const sender = row.sender === null ? "You" : (bots.find((bot) => bot.id === row.sender)?.name ?? "A Bot");
      return `${sender}: ${row.text.slice(0, contextCharsPerMessage)}`;
    });
    return `Members: ${bots.map((bot) => bot.name).join(", ")}\n${lines.join("\n")}`;
  }

  async #deliver(targets: BotSummary[], sender: string, text: string, bots: BotSummary[]): Promise<void> {
    const profile = this.#profile();
    const context = this.#recentContext(bots);
    const results = await Promise.allSettled(
      targets.map((bot) =>
        this.env.BOT.getByName(bot.id).enqueue({
          id: crypto.randomUUID(),
          senderId: profile.id,
          text: groupMessage(profile.name, sender, text, context),
          hops: 0,
          replyTo: null,
          groupId: profile.id,
        }),
      ),
    );
    results.forEach((result, index) => {
      if (result.status === "fulfilled") return;
      console.error(String(result.reason));
      this.#insert(systemSender, `Couldn't reach ${targets[index]?.name ?? "a Bot"}`);
    });
    const last = this.ctx.storage.sql.exec<Pick<MessageRow, "text" | "at">>("SELECT text, at FROM messages ORDER BY rowid DESC LIMIT 1").toArray()[0];
    if (last !== undefined) {
      await this.env.USER.getByName(userName).updateGroup(profile.id, { last: last.text.replaceAll("**", "").replace(/\s+/g, " ").slice(0, 160), lastAt: last.at });
    }
  }
}
