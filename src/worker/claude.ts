import { type AssistantMessage, type AssistantMessageEvent, createAssistantMessageEventStream, type Message, type Model, type ProviderStreams } from "@earendil-works/pi-ai";
import { createProvider, type Provider } from "@earendil-works/pi-ai/models";
import { z } from "zod";
import { type Effort, models } from "./env";
import type { RecordTurn, TurnError, TurnUsage } from "./langfuse";

export const claudeProviderId = "claude-container";

const contextWindow = 200_000;
const maxOutputTokens = 32_000;

const modelEventTypes = new Set(["start", "text_start", "text_delta", "text_end", "thinking_start", "thinking_delta", "thinking_end", "toolcall_start", "toolcall_delta", "toolcall_end", "done", "error"]);

const turnEventSchema = z.union([
  z.object({ type: z.literal("failure"), message: z.string() }),
  z.custom<AssistantMessageEvent>((value) => typeof value === "object" && value !== null && "type" in value && typeof value.type === "string" && modelEventTypes.has(value.type)),
]);

type TurnEvent = z.infer<typeof turnEventSchema>;

export interface ClaudeSession {
  send(init: RequestInit): Promise<Response>;
  id: string | undefined;
}

export interface ClaudeConnection {
  session(): ClaudeSession;
  token: string | undefined;
  recordTurn: RecordTurn;
}

export function claudeTransport(env: Env, containerName: string): ClaudeSession["send"] {
  const localUrl = env.CLAUDE_LOCAL_URL;
  if (localUrl) return (init) => fetch(`${localUrl}/claude/turn`, init);
  return (init) => env.MODELS.getByName(containerName).fetch("http://container/claude/turn", init);
}

export function claudeToken(env: Env): string | undefined {
  return env.CLAUDE_LOCAL_URL ? undefined : env.CLAUDE_CODE_OAUTH_TOKEN;
}

class ModelTurnError extends Error {
  readonly detail: string | undefined;

  constructor(message: string, detail: string | undefined) {
    super(message);
    this.detail = detail;
  }
}

function errorMessageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function turnErrorOf(error: unknown): TurnError {
  return { message: errorMessageOf(error), detail: error instanceof ModelTurnError ? error.detail : undefined };
}

function parseTurnEvent(line: string): TurnEvent {
  try {
    return turnEventSchema.parse(JSON.parse(line));
  } catch (error) {
    throw new ModelTurnError(errorMessageOf(error), line);
  }
}

interface TurnRequest {
  connection: ClaudeConnection;
  model: string;
  effort: Effort;
  messages: Message[];
  oneShot: boolean;
  signal?: AbortSignal | undefined;
}

async function openTurn(request: TurnRequest): Promise<ReadableStream<Uint8Array>> {
  const session = request.connection.session();
  const response = await session.send({
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: request.model,
      effort: request.effort,
      messages: request.messages,
      token: request.connection.token,
      sessionId: session.id,
      oneShot: request.oneShot,
    }),
    signal: request.signal ?? null,
  });
  if (!response.ok || !response.body) throw new Error(`The model container answered ${response.status}`);
  return response.body;
}

async function* turnEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<TurnEvent> {
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of body) {
    buffer += decoder.decode(chunk, { stream: true });
    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line) yield parseTurnEvent(line);
      newline = buffer.indexOf("\n");
    }
  }
}

function failedMessage(model: Model<string>, stopReason: "error" | "aborted", errorMessage: string): AssistantMessage {
  return {
    role: "assistant",
    content: [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason,
    errorMessage,
    timestamp: Date.now(),
  };
}

function usageOf(message: AssistantMessage): TurnUsage {
  return { input: message.usage.input, output: message.usage.output, cacheRead: message.usage.cacheRead, cacheWrite: message.usage.cacheWrite };
}

function claudeStreams(connection: ClaudeConnection, effort: () => Effort): ProviderStreams {
  const run: ProviderStreams["stream"] = (model, context, options) => {
    const stream = createAssistantMessageEventStream();
    const startedAt = Date.now();
    let final: AssistantMessage | null = null;
    let turnError: TurnError | null = null;

    void (async () => {
      try {
        const body = await openTurn({ connection, model: model.id, effort: effort(), messages: context.messages, oneShot: false, signal: options?.signal });
        for await (const event of turnEvents(body)) {
          if (event.type === "failure") throw new ModelTurnError(event.message, undefined);
          stream.push(event);
          if (event.type === "done") final = event.message;
          if (event.type === "error") {
            final = event.error;
            turnError = { message: event.error.errorMessage ?? "The model turn failed", detail: undefined };
          }
        }
        if (!final) throw new Error("The model container closed the turn early");
      } catch (error) {
        const aborted = options?.signal?.aborted === true;
        final = failedMessage(model, aborted ? "aborted" : "error", errorMessageOf(error));
        if (!aborted) {
          turnError = turnErrorOf(error);
          console.error(JSON.stringify({ event: "model_turn_failed", model: model.id, error: final.errorMessage }));
        }
        stream.push({ type: "error", reason: final.stopReason === "aborted" ? "aborted" : "error", error: final });
      } finally {
        const message: AssistantMessage | null = final;
        connection.recordTurn({
          model: model.id,
          startedAt,
          sessionId: options?.sessionId,
          input: context.messages,
          output: message?.content ?? [],
          usage: message ? usageOf(message) : null,
          stopReason: message?.stopReason ?? "error",
          error: turnError,
        });
        stream.end();
      }
    })();

    return stream;
  };
  return { stream: run, streamSimple: run };
}

function claudeModel(id: string): Model<string> {
  return {
    id,
    name: id,
    api: claudeProviderId,
    provider: claudeProviderId,
    baseUrl: "http://container",
    reasoning: false,
    input: ["text", "image"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow,
    maxTokens: maxOutputTokens,
  };
}

export function claudeProvider(connection: ClaudeConnection, effort: () => Effort): Provider {
  return createProvider({
    id: claudeProviderId,
    name: "Claude",
    auth: { apiKey: { name: "Claude", resolve: async () => ({ auth: {} }) } },
    models: models.map(claudeModel),
    api: claudeStreams(connection, effort),
  });
}

export async function claudeText(request: { connection: ClaudeConnection; model: string; effort: Effort; system: string; user: string; signal: AbortSignal }): Promise<string> {
  const timestamp = Date.now();
  const messages: Message[] = [
    { role: "system", content: request.system, timestamp },
    { role: "user", content: request.user, timestamp },
  ];
  const turn = { model: request.model, startedAt: timestamp, sessionId: undefined, input: messages };
  let text = "";
  let usage: TurnUsage | null = null;
  try {
    const body = await openTurn({ connection: request.connection, model: request.model, effort: request.effort, messages, oneShot: true, signal: request.signal });
    for await (const event of turnEvents(body)) {
      if (event.type === "failure") throw new ModelTurnError(event.message, undefined);
      if (event.type === "done") {
        usage = usageOf(event.message);
        text = event.message.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("");
      }
      if (event.type === "error") throw new ModelTurnError(event.error.errorMessage ?? "The model turn failed", undefined);
    }
  } catch (error) {
    console.error(JSON.stringify({ event: "model_turn_failed", model: request.model, error: errorMessageOf(error) }));
    request.connection.recordTurn({ ...turn, output: text, usage, stopReason: "error", error: turnErrorOf(error) });
    throw error;
  }
  request.connection.recordTurn({ ...turn, output: text, usage, stopReason: "stop", error: null });
  return text;
}
