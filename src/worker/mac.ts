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
  name: string | null;
  roots: string[];
  pairingCode: string | null;
}

interface Device {
  name: string;
  tokenHash: string;
}

interface Pairing {
  code: string;
  expiresAt: number;
  attempts: number;
}

const pairingTtlMs = 10 * 60 * 1000;
const maxPairingAttempts = 5;
const requestTimeoutMs = 6 * 60 * 1000;
const codeAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const codeLength = 8;

const incomingSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("hello"), name: z.string().max(100), roots: z.array(z.string().max(1000)).max(50) }),
  z.object({
    type: z.literal("result"),
    id: z.string(),
    result: z.discriminatedUnion("ok", [z.object({ ok: z.literal(true), output: z.string() }), z.object({ ok: z.literal(false), error: z.string() })]),
  }),
]);

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

  status(): MacStatus {
    const device = this.#device();
    const pairing = this.#pairing();
    return {
      paired: device !== null,
      connected: this.ctx.getWebSockets().length > 0,
      name: device?.name ?? null,
      roots: this.ctx.storage.kv.get<string[]>("roots") ?? [],
      pairingCode: pairing === null ? null : pairing.code,
    };
  }

  createPairingCode(): string {
    const code = randomCode();
    this.ctx.storage.kv.put("pairing", { code, expiresAt: Date.now() + pairingTtlMs, attempts: 0 } satisfies Pairing);
    return code;
  }

  async pair(code: string, name: string): Promise<string | null> {
    const pairing = this.#pairing();
    if (pairing === null) return null;
    if (pairing.code !== code.trim().toUpperCase()) {
      const attempts = pairing.attempts + 1;
      if (attempts >= maxPairingAttempts) this.ctx.storage.kv.delete("pairing");
      else this.ctx.storage.kv.put("pairing", { ...pairing, attempts });
      return null;
    }
    const token = randomToken();
    this.#closeSockets("Paired again");
    this.ctx.storage.kv.put("device", { name, tokenHash: await sha256(token) } satisfies Device);
    this.ctx.storage.kv.delete("pairing");
    this.ctx.storage.kv.delete("roots");
    return token;
  }

  unpair(): void {
    this.#closeSockets("Unpaired");
    this.ctx.storage.kv.delete("device");
    this.ctx.storage.kv.delete("pairing");
    this.ctx.storage.kv.delete("roots");
  }

  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") return new Response("Expected a WebSocket", { status: 426 });
    const device = this.#device();
    const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
    if (device === null || token === "" || (await sha256(token)) !== device.tokenHash) return new Response("Unauthorized", { status: 401 });
    this.#closeSockets("Replaced by a new connection");
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1]);
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  override webSocketMessage(_socket: WebSocket, message: string | ArrayBuffer): void {
    if (typeof message !== "string") return;
    const parsed = incomingSchema.safeParse(JSON.parse(message));
    if (!parsed.success) return;
    if (parsed.data.type === "hello") {
      this.ctx.storage.kv.put("roots", parsed.data.roots);
      const device = this.#device();
      if (device !== null) this.ctx.storage.kv.put("device", { ...device, name: parsed.data.name });
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

  #pairing(): Pairing | null {
    const pairing = this.ctx.storage.kv.get<Pairing>("pairing");
    if (pairing === undefined) return null;
    if (pairing.expiresAt > Date.now()) return pairing;
    this.ctx.storage.kv.delete("pairing");
    return null;
  }

  #closeSockets(reason: string): void {
    for (const socket of this.ctx.getWebSockets()) socket.close(1000, reason);
    this.#failPending(reason);
  }

  #failPending(error: string): void {
    for (const resolve of this.#pending.values()) resolve({ ok: false, error });
    this.#pending.clear();
  }
}
