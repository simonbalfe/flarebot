import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { createModels, type Provider } from "@earendil-works/pi-ai/models";
import { openrouterProvider } from "@earendil-works/pi-ai/providers/openrouter";
import { type Conversation, createRegistry, Harness, type SubmissionId, type Wake } from "@earendil-works/pi-durable";
import { openDurableObjectSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/cloudflare";
import { DurableObject } from "cloudflare:workers";
import { userName } from "./env";
import { botExtension, type BotProfile, type Takeover } from "./tools";
import { botMessage, toTranscriptView, type TranscriptView } from "./view";

const context = BACKGROUND_CONTEXT;
const heartbeatMs = 60_000;
const provider = "openrouter";
const maxOutputTokens = 8000;

function cappedOpenRouter(): Provider {
  const base = openrouterProvider();
  return {
    ...base,
    getModels: () => base.getModels().map((model) => ({ ...model, maxTokens: Math.min(model.maxTokens, maxOutputTokens) })),
    getAllModels: undefined,
  };
}

export interface BotView extends TranscriptView {
  profile: BotProfile;
  memory: string[];
  takeover: Takeover | null;
}

export class Bot extends DurableObject<Env> {
  #harness!: Harness;
  #root!: Conversation;
  #wasActive = false;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    void ctx.blockConcurrencyWhile(async () => {
      const fallback = Date.now() + heartbeatMs;
      const alarm = await ctx.storage.getAlarm();
      if (alarm === null || alarm > fallback) await ctx.storage.setAlarm(fallback);

      const credentials = new InMemoryCredentialStore();
      await credentials.modify(provider, async () => ({ type: "api_key", key: env.OPENROUTER_API_KEY }));
      const models = createModels({ credentials });
      models.setProvider(cappedOpenRouter());

      const registry = createRegistry();
      registry.install(
        botExtension(env, {
          profile: () => this.#profile(),
          memory: () => this.#memory(),
          setMemory: (items) => ctx.storage.kv.put("memory", items),
          setTakeover: (takeover) => ctx.storage.kv.put("takeover", takeover),
          botHops: () => ctx.storage.kv.get<number>("botHops") ?? 0,
        }),
      );

      this.#harness = await Harness.open(
        await openDurableObjectSqliteStorage(ctx.storage),
        {
          models,
          registry,
          identity: { attribution: { name: "flarebot", url: "https://simonbalfe.com" } },
          onWake: (wake) => void this.#onWake(wake).catch(() => ctx.abort("Alarm write failed")),
          onReport: (error, info) => console.error(JSON.stringify({ event: "agent_report", ...info, error: String(error) })),
        },
        context,
      );
      this.#root = await this.#harness.root(context);
      await this.#arm(this.#harness.wake());
      this.#harness.resume();
    });
  }

  override async alarm(): Promise<void> {
    await this.#arm({ ...this.#harness.wake(), active: true });
    this.#harness.resume();
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
    await this.#report(true);
  }

  async receiveFromBot(text: string, hops: number, replyTo: string | null): Promise<void> {
    this.ctx.storage.kv.put("botHops", hops);
    if (replyTo !== null) this.ctx.storage.kv.put("replyTo", [...this.#replyTo(), replyTo]);
    await this.#arm({ ...this.#harness.wake(), active: true });
    const submission = await this.#root.submit({ type: "input", content: text, requestId: crypto.randomUUID(), whenBusy: "followUp" }, context);
    this.ctx.storage.kv.put("lastSubmission", submission.id);
    await this.#report(true);
  }

  async stop(): Promise<void> {
    await this.#root.abort(context);
    await this.#report(false);
  }

  async setModel(model: string): Promise<void> {
    this.ctx.storage.kv.put("profile", { ...this.#profile(), model });
    await this.#root.configure({ model: { provider, modelId: model } }, context);
  }

  forget(index: number): void {
    this.ctx.storage.kv.put("memory", this.#memory().filter((_, position) => position !== index));
  }

  async view(): Promise<BotView> {
    const lastId = this.ctx.storage.kv.get<SubmissionId>("lastSubmission");
    const last = lastId === undefined ? undefined : await this.#harness.submission(lastId, context);
    const state = await this.#root.viewState(context);
    try {
      return {
        ...toTranscriptView(state.value, await last?.status(context)),
        profile: this.#profile(),
        memory: this.#memory(),
        takeover: this.ctx.storage.kv.get<Takeover>("takeover") ?? null,
      };
    } finally {
      state.dispose();
    }
  }

  #profile(): BotProfile {
    const profile = this.ctx.storage.kv.get<BotProfile>("profile");
    if (profile === undefined) throw new Error("Bot has no profile");
    return profile;
  }

  #memory(): string[] {
    return this.ctx.storage.kv.get<string[]>("memory") ?? [];
  }

  async #onWake(wake: Wake): Promise<void> {
    await this.#arm(wake);
    if (this.#wasActive && !wake.active && this.#root !== undefined) {
      this.ctx.waitUntil(this.#settle().catch((error: unknown) => console.error(String(error))));
    }
    this.#wasActive = wake.active;
  }

  #replyTo(): string[] {
    return this.ctx.storage.kv.get<string[]>("replyTo") ?? [];
  }

  async #settle(): Promise<void> {
    await this.#report(false);
    const recipients = this.#replyTo();
    if (recipients.length === 0) return;
    this.ctx.storage.kv.delete("replyTo");
    const view = await this.view();
    const answer = view.items.at(-1)?.kind === "cost" ? view.items.findLast((item) => item.kind === "assistant") : undefined;
    const text = answer?.kind === "assistant" ? answer.text : (view.error ?? "I could not finish that.");
    const hops = (this.ctx.storage.kv.get<number>("botHops") ?? 0) + 1;
    await Promise.all(
      [...new Set(recipients)].map((id) => this.env.BOT.getByName(id).receiveFromBot(botMessage(this.#profile().name, text), hops, null)),
    );
  }

  async #report(typing: boolean): Promise<void> {
    if (this.ctx.storage.kv.get("profile") === undefined) return;
    const view = await this.view();
    const lastText = view.items.findLast((item) => item.kind === "assistant" || item.kind === "user" || item.kind === "peer");
    await this.env.USER.getByName(userName).updateBot(this.#profile().id, {
      typing: typing || view.busy,
      last: lastText !== undefined && "text" in lastText ? lastText.text.replaceAll("**", "").replace(/\s+/g, " ").slice(0, 160) : "",
      lastAt: lastText?.at ?? Date.now(),
      cost: view.totalCost,
      needsYou: view.takeover !== null,
    });
  }

  async #arm(wake: Wake): Promise<void> {
    const heartbeat = wake.active ? Date.now() + heartbeatMs : undefined;
    const at = heartbeat === undefined || wake.at === undefined ? (heartbeat ?? wake.at) : Math.min(heartbeat, wake.at);
    if (at === undefined) await this.ctx.storage.deleteAlarm();
    else await this.ctx.storage.setAlarm(at);
  }
}
