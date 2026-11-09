import { mkdirSync } from "node:fs";
import { createServer, type ServerResponse } from "node:http";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AssistantMessageEvent, Message, SimpleStreamOptions } from "@earendil-works/pi-ai";
import extension, { type HostContext, type HostEvent, type HostHandler, type HostProvider } from "pi-claude-bridge/src/index.ts";
import { toBridgeContext } from "pi-claude-bridge/src/transcript.ts";
import { z } from "zod";

const port = Number(process.env.PORT ?? 8080);
const host = process.env.HOST ?? "0.0.0.0";
const turnPath = "/claude/turn";
const maxConcurrentTurns = 5;
const sessionsRoot = process.env.SESSIONS_DIR ?? join(homedir(), "sessions");

const turnRequestSchema = z.object({
  model: z.string(),
  effort: z.enum(["low", "medium", "high", "xhigh", "max"]),
  messages: z.array(z.custom<Message>((value) => typeof value === "object" && value !== null && "role" in value)),
  token: z.string().optional(),
  sessionId: z.string().optional(),
  oneShot: z.boolean().optional(),
});

type TurnRequest = z.infer<typeof turnRequestSchema>;
type StreamOptions = SimpleStreamOptions & { env: Record<string, string> };

const handlers = new Map<string, HostHandler[]>();
let provider: HostProvider | undefined;
let runningTurns = 0;
const waitingTurns: (() => void)[] = [];
const startedSessions = new Set<string>();

extension({
  on: (name, handler) => {
    handlers.set(name, [...(handlers.get(name) ?? []), handler]);
  },
  registerProvider: (_id, registered) => {
    provider = registered;
  },
  getAllTools: () => [],
});

function emitHostEvent(name: string, event: HostEvent, context: HostContext): void {
  for (const handler of handlers.get(name) ?? []) handler(event, context);
}

function hostContext(sessionId: string, cwd: string, systemPrompt: string | undefined): HostContext {
  return {
    cwd,
    ui: null,
    sessionManager: { getSessionId: () => sessionId },
    getSystemPrompt: () => systemPrompt,
    model: { provider: "claude-bridge" },
    modelRegistry: { getProvider: () => undefined },
  };
}

function sessionFolder(sessionId: string): string {
  const folder = join(sessionsRoot, encodeURIComponent(sessionId));
  mkdirSync(folder, { recursive: true });
  return folder;
}

function startSession(sessionId: string, cwd: string): void {
  if (startedSessions.has(sessionId)) return;
  startedSessions.add(sessionId);
  emitHostEvent("session_start", { reason: "new" }, hostContext(sessionId, cwd, undefined));
}

async function acquireTurnSlot(): Promise<void> {
  if (runningTurns < maxConcurrentTurns) {
    runningTurns += 1;
    return;
  }
  await new Promise<void>((resolve) => waitingTurns.push(resolve));
}

function releaseTurnSlot(): void {
  const next = waitingTurns.shift();
  if (next) next();
  else runningTurns -= 1;
}

async function runTurn(request: TurnRequest, signal: AbortSignal, send: (event: AssistantMessageEvent) => void): Promise<void> {
  const model = provider?.models.find((candidate) => candidate.id === request.model);
  if (!provider || !model) throw new Error(`Unknown model ${request.model}`);

  const context = { messages: request.messages };
  const options: StreamOptions = {
    signal,
    reasoning: request.effort,
    env: request.token ? { CLAUDE_CODE_OAUTH_TOKEN: request.token } : {},
    ...(request.oneShot ? { cacheRetention: "none" as const } : {}),
  };

  if (request.sessionId && !request.oneShot) {
    const cwd = sessionFolder(request.sessionId);
    startSession(request.sessionId, cwd);
    const systemPrompt = toBridgeContext(context).systemPrompt;
    emitHostEvent(
      "before_agent_start",
      { systemPrompt, systemPromptOptions: { customPrompt: systemPrompt, contextFiles: [], skills: [] } },
      hostContext(request.sessionId, cwd, systemPrompt),
    );
    options.sessionId = request.sessionId;
  }

  for await (const event of provider.streamSimple(model, context, options)) send(event);
}

function startStream(response: ServerResponse): (event: AssistantMessageEvent) => void {
  response.writeHead(200, { "content-type": "application/x-ndjson" });
  return (event) => response.write(`${JSON.stringify(event)}\n`);
}

function failureEvent(error: unknown): string {
  return JSON.stringify({ type: "failure", message: error instanceof Error ? error.message : String(error) });
}

createServer(async (request, response) => {
  if (request.method === "GET" && request.url === "/health") return response.writeHead(200).end("ok");
  if (request.method !== "POST" || request.url !== turnPath) return response.writeHead(404).end();

  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk);
  const parsed = turnRequestSchema.safeParse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
  if (!parsed.success) return response.writeHead(400).end(parsed.error.message);

  const cancelled = new AbortController();
  response.on("close", () => cancelled.abort());
  const send = startStream(response);
  await acquireTurnSlot();
  try {
    if (!cancelled.signal.aborted) await runTurn(parsed.data, cancelled.signal, send);
  } catch (error) {
    response.write(`${failureEvent(error)}\n`);
  } finally {
    releaseTurnSlot();
  }
  response.end();
}).listen(port, host);
