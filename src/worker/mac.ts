import { DurableObject } from "cloudflare:workers";
import { z } from "zod";

export type MacAction =
  | { type: "run"; command: string; cwd: string | null }
  | { type: "read"; path: string }
  | { type: "write"; path: string; content: string }
  | { type: "list"; path: string }
  | { type: "open"; target: string };

export type MacResult = { ok: true; output: string } | { ok: false; error: string };

export interface MacStatus {
  paired: boolean;
  connected: boolean;
  claude: boolean;
  name: string | null;
  roots: string[];
  pendingLink: { userCode: string; name: string } | null;
}

export type LinkPoll = { status: "pending" } | { status: "expired" } | { status: "linked"; token: string };

interface Device {
  name: string;
  tokenHash: string;
}

interface Link {
  deviceCodeHash: string;
  userCode: string;
  name: string;
  expiresAt: number;
  approved: boolean;
}

const linkTtlMs = 10 * 60 * 1000;
const requestTimeoutMs = 6 * 60 * 1000;
const codeAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const codeLength = 8;

const incomingSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("hello"), name: z.string().max(100), roots: z.array(z.string().max(1000)).max(50), claude: z.boolean().default(false) }),
  z.object({
    type: z.literal("result"),
    id: z.string(),
    result: z.discriminatedUnion("ok", [z.object({ ok: z.literal(true), output: z.string() }), z.object({ ok: z.literal(false), error: z.string() })]),
  }),
  z.object({ type: z.literal("model-chunk"), id: z.string(), data: z.string() }),
  z.object({ type: z.literal("model-end"), id: z.string(), error: z.string().optional() }),
]);

const encoder = new TextEncoder();

function failureLine(message: string): Uint8Array {
  return encoder.encode(`\n${JSON.stringify({ type: "failure", message })}\n`);
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function randomCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(codeLength));
  return [...bytes].map((byte) => codeAlphabet[byte % codeAlphabet.length]).join("");
}

function randomToken(): string {
  return [...crypto.getRandomValues(new Uint8Array(32))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export class Mac extends DurableObject<Env> {
  #pending = new Map<string, (result: MacResult) => void>();
  #turns = new Map<string, ReadableStreamDefaultController<Uint8Array>>();

  status(): MacStatus {
    const device = this.#device();
    const link = this.#link();
    return {
      paired: device !== null,
      connected: this.ctx.getWebSockets().length > 0,
      claude: this.claudeReady(),
      name: device?.name ?? null,
      roots: this.ctx.storage.kv.get<string[]>("roots") ?? [],
      pendingLink: link === null || link.approved ? null : { userCode: link.userCode, name: link.name },
    };
  }

  async startLink(name: string): Promise<{ deviceCode: string; userCode: string }> {
    const deviceCode = randomToken();
    const userCode = randomCode();
    this.ctx.storage.kv.put("link", { deviceCodeHash: await sha256(deviceCode), userCode, name, expiresAt: Date.now() + linkTtlMs, approved: false } satisfies Link);
    return { deviceCode, userCode };
  }

  approveLink(userCode: string): boolean {
    const link = this.#link();
    if (link === null || link.approved || link.userCode !== userCode.trim().toUpperCase()) return false;
    this.ctx.storage.kv.put("link", { ...link, approved: true } satisfies Link);
    return true;
  }

  async pollLink(deviceCode: string): Promise<LinkPoll> {
    const link = this.#link();
    if (link === null || (await sha256(deviceCode)) !== link.deviceCodeHash) return { status: "expired" };
    if (!link.approved) return { status: "pending" };
    const token = randomToken();
    this.#closeSockets("Linked again");
    this.ctx.storage.kv.put("device", { name: link.name, tokenHash: await sha256(token) } satisfies Device);
    this.ctx.storage.kv.delete("link");
    this.ctx.storage.kv.delete("roots");
    return { status: "linked", token };
  }

  async checkToken(token: string): Promise<boolean> {
    const device = this.#device();
    return device !== null && token !== "" && (await sha256(token)) === device.tokenHash;
  }

  unpair(): void {
    this.#closeSockets("Unpaired");
    this.ctx.storage.kv.delete("device");
    this.ctx.storage.kv.delete("link");
    this.ctx.storage.kv.delete("roots");
    this.ctx.storage.kv.delete("claude");
  }

  claudeReady(): boolean {
    return this.ctx.getWebSockets().length > 0 && this.ctx.storage.kv.get<boolean>("claude") === true;
  }

  modelTurn(body: string): ReadableStream<Uint8Array> | null {
    const socket = this.ctx.getWebSockets()[0];
    if (socket === undefined || !this.claudeReady()) return null;
    const id = crypto.randomUUID();
    return new ReadableStream<Uint8Array>({
      start: (controller) => {
        this.#turns.set(id, controller);
        socket.send(JSON.stringify({ type: "model-turn", id, body }));
      },
      cancel: () => {
        if (!this.#turns.delete(id) || socket.readyState !== WebSocket.OPEN) return;
        socket.send(JSON.stringify({ type: "model-cancel", id }));
      },
    });
  }

  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") return new Response("Expected a WebSocket", { status: 426 });
    const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
    if (!(await this.checkToken(token))) return new Response("Unauthorized", { status: 401 });
    this.#closeSockets("Replaced by a new connection");
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1]);
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  override webSocketMessage(_socket: WebSocket, message: string | ArrayBuffer): void {
    if (typeof message !== "string") return;
    let json: unknown;
    try {
      json = JSON.parse(message);
    } catch {
      return;
    }
    const parsed = incomingSchema.safeParse(json);
    if (!parsed.success) return;
    if (parsed.data.type === "hello") {
      this.ctx.storage.kv.put("roots", parsed.data.roots);
      this.ctx.storage.kv.put("claude", parsed.data.claude);
      const device = this.#device();
      if (device !== null) this.ctx.storage.kv.put("device", { ...device, name: parsed.data.name });
      return;
    }
    if (parsed.data.type === "model-chunk") {
      this.#turns.get(parsed.data.id)?.enqueue(encoder.encode(parsed.data.data));
      return;
    }
    if (parsed.data.type === "model-end") {
      const controller = this.#turns.get(parsed.data.id);
      if (controller === undefined) return;
      this.#turns.delete(parsed.data.id);
      if (parsed.data.error !== undefined) controller.enqueue(failureLine(parsed.data.error));
      controller.close();
      return;
    }
    const resolve = this.#pending.get(parsed.data.id);
    if (resolve === undefined) return;
    this.#pending.delete(parsed.data.id);
    resolve(parsed.data.result);
  }

  override webSocketClose(): void {
    this.#failPending("The Mac disconnected");
  }

  override webSocketError(): void {
    this.#failPending("The Mac connection failed");
  }

  async request(bot: { id: string; name: string }, action: MacAction): Promise<MacResult> {
    const socket = this.ctx.getWebSockets()[0];
    if (socket === undefined) return { ok: false, error: this.#device() === null ? "No Mac is paired" : "The Mac is offline" };
    const id = crypto.randomUUID();
    const result = new Promise<MacResult>((resolve) => {
      this.#pending.set(id, resolve);
      setTimeout(() => {
        if (!this.#pending.delete(id)) return;
        resolve({ ok: false, error: "No answer from the Mac in time" });
      }, requestTimeoutMs);
    });
    socket.send(JSON.stringify({ type: "request", id, bot, action }));
    return result;
  }

  #device(): Device | null {
    return this.ctx.storage.kv.get<Device>("device") ?? null;
  }

  #link(): Link | null {
    const link = this.ctx.storage.kv.get<Link>("link");
    if (link === undefined) return null;
    if (link.expiresAt > Date.now()) return link;
    this.ctx.storage.kv.delete("link");
    return null;
  }

  #closeSockets(reason: string): void {
    for (const socket of this.ctx.getWebSockets()) socket.close(1000, reason);
    this.#failPending(reason);
  }

  #failPending(error: string): void {
    for (const resolve of this.#pending.values()) resolve({ ok: false, error });
    this.#pending.clear();
    for (const controller of this.#turns.values()) {
      controller.enqueue(failureLine(error));
      controller.close();
    }
    this.#turns.clear();
  }
}
