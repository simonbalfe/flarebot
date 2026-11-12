import type { Message } from "@earendil-works/pi-ai";

type AttributeValue = { stringValue: string } | { arrayValue: { values: { stringValue: string }[] } };
type Attribute = { key: string; value: AttributeValue };
type LangfuseConfig = { endpoint: string; authorization: string };

export interface TurnUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface TurnError {
  message: string;
  detail: string | undefined;
}

export interface TurnOwner {
  kind: "bot" | "router";
  id: string;
  name: string;
}

export interface ModelTurn {
  model: string;
  startedAt: number;
  sessionId: string | undefined;
  input: Message[];
  output: unknown;
  usage: TurnUsage | null;
  stopReason: string;
  error: TurnError | null;
}

export interface ToolCallRecord {
  callId: string;
  name: string;
  input: unknown;
  output: unknown;
  startedAt: number;
  failed: boolean;
}

export type RecordTurn = (turn: ModelTurn) => void;
export type RecordTool = (call: ToolCallRecord) => void;

export interface Tracer {
  recordTurn: RecordTurn;
  recordTool: RecordTool;
}

interface RunLink {
  traceId: string;
  parentSpanId: string;
  sessionId: string | undefined;
  runInput: unknown;
}

interface Span {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  startedAt: number;
  attributes: Attribute[];
  error: string | null;
}

const source = "flarebot";
const maxFieldChars = 50_000;
const maxOpenCalls = 500;
const fnvOffset = 0x811c9dc5;
const fnvPrime = 0x01000193;

function langfuseConfig(env: Env): LangfuseConfig | null {
  const { LANGFUSE_HOST: host, LANGFUSE_PUBLIC_KEY: publicKey, LANGFUSE_SECRET_KEY: secretKey } = env;
  if (!host || !publicKey || !secretKey) return null;
  return { endpoint: `${host.replace(/\/$/, "")}/api/public/otel/v1/traces`, authorization: `Basic ${btoa(`${publicKey}:${secretKey}`)}` };
}

function withoutImageData(_key: string, value: unknown): unknown {
  return typeof value === "object" && value !== null && "type" in value && value.type === "image" ? "[image]" : value;
}

function serialize(value: unknown): string {
  const text = typeof value === "string" ? value : JSON.stringify(value, withoutImageData);
  if (text.length <= maxFieldChars) return text;
  return `[first ${text.length - maxFieldChars} chars dropped]\n${text.slice(-maxFieldChars)}`;
}

function attribute(key: string, value: unknown): Attribute[] {
  if (value === undefined || value === null) return [];
  return [{ key, value: { stringValue: serialize(value) } }];
}

function tagsAttribute(tags: string[]): Attribute {
  return { key: "langfuse.trace.tags", value: { arrayValue: { values: tags.map((tag) => ({ stringValue: tag })) } } };
}

function usageDetails(usage: TurnUsage | null): Record<string, number> | null {
  if (usage === null) return null;
  return { input: usage.input, output: usage.output, input_cache_read: usage.cacheRead, input_cache_creation: usage.cacheWrite };
}

function randomHex(length: number): string {
  return crypto.randomUUID().replaceAll("-", "").slice(0, length);
}

function stableHex(text: string, length: number): string {
  let hex = "";
  for (let seed = 0; hex.length < length; seed++) {
    let hash = (fnvOffset ^ seed) >>> 0;
    for (let index = 0; index < text.length; index++) {
      hash = Math.imul(hash ^ text.charCodeAt(index), fnvPrime) >>> 0;
    }
    hex += hash.toString(16).padStart(8, "0");
  }
  return hex.slice(0, length);
}

function lastUserIndex(input: Message[]): number {
  for (let index = input.length - 1; index >= 0; index--) {
    if (input[index]?.role === "user") return index;
  }
  return -1;
}

function runOf(turn: ModelTurn): { traceId: string; input: unknown } {
  const index = lastUserIndex(turn.input);
  const user = turn.input[index];
  if (user === undefined) return { traceId: randomHex(32), input: null };
  return { traceId: stableHex(`${turn.sessionId ?? ""}:${index}:${user.timestamp}`, 32), input: user.content };
}

function toolCallIds(output: unknown): string[] {
  if (!Array.isArray(output)) return [];
  return output.flatMap((block: unknown) =>
    typeof block === "object" && block !== null && "type" in block && block.type === "toolCall" && "id" in block && typeof block.id === "string" ? [block.id] : [],
  );
}

function traceAttributes(owner: TurnOwner, sessionId: string | undefined, runInput: unknown): Attribute[] {
  return [
    ...attribute("langfuse.trace.name", source),
    tagsAttribute([source, owner.kind, owner.name]),
    ...attribute("langfuse.user.id", owner.name),
    ...attribute("langfuse.session.id", sessionId),
    ...attribute("langfuse.trace.metadata.source", source),
    ...attribute("langfuse.trace.metadata.owner_id", owner.id),
    ...attribute("langfuse.trace.input", runInput),
  ];
}

function turnAttributes(owner: TurnOwner, turn: ModelTurn, runInput: unknown): Attribute[] {
  return [
    ...attribute("langfuse.observation.type", "generation"),
    ...traceAttributes(owner, turn.sessionId, runInput),
    ...attribute("langfuse.trace.output", turn.output),
    ...attribute("langfuse.observation.input", turn.input),
    ...attribute("langfuse.observation.output", turn.output),
    ...attribute("langfuse.observation.model.name", turn.model),
    ...attribute("gen_ai.request.model", turn.model),
    ...attribute("langfuse.observation.usage_details", usageDetails(turn.usage)),
    ...attribute("langfuse.observation.metadata.stop_reason", turn.stopReason),
    ...attribute("langfuse.observation.metadata.error_detail", turn.error?.detail),
    ...(turn.error === null ? [] : attribute("langfuse.observation.level", "ERROR")),
    ...attribute("langfuse.observation.status_message", turn.error?.message),
  ];
}

function toolAttributes(owner: TurnOwner, call: ToolCallRecord, link: RunLink | undefined): Attribute[] {
  return [
    ...attribute("langfuse.observation.type", "tool"),
    ...traceAttributes(owner, link?.sessionId, link?.runInput),
    ...attribute("langfuse.observation.input", call.input),
    ...attribute("langfuse.observation.output", call.output),
    ...attribute("langfuse.observation.metadata.call_id", call.callId),
    ...(call.failed ? attribute("langfuse.observation.level", "ERROR") : []),
  ];
}

function otlpSpan(span: Span): object {
  return {
    traceId: span.traceId,
    spanId: span.spanId,
    ...(span.parentSpanId === undefined ? {} : { parentSpanId: span.parentSpanId }),
    name: span.name,
    kind: 1,
    startTimeUnixNano: `${span.startedAt}000000`,
    endTimeUnixNano: `${Date.now()}000000`,
    attributes: span.attributes,
    status: span.error === null ? { code: 1 } : { code: 2, message: serialize(span.error) },
  };
}

async function sendSpan(config: LangfuseConfig, span: Span): Promise<void> {
  const response = await fetch(config.endpoint, {
    method: "POST",
    headers: { authorization: config.authorization, "content-type": "application/json" },
    body: JSON.stringify({
      resourceSpans: [{ resource: { attributes: attribute("service.name", source) }, scopeSpans: [{ scope: { name: source }, spans: [otlpSpan(span)] }] }],
    }),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Langfuse answered ${response.status}: ${text.slice(0, 500)}`);
  if (text.includes("rejectedSpans") && !text.includes('"rejectedSpans":0') && !text.includes('"rejectedSpans":"0"')) throw new Error(`Langfuse rejected the span: ${text.slice(0, 500)}`);
}

function callRoot(callId: string): string {
  return callId.split("/")[0] ?? callId;
}

function toolSpanName(call: ToolCallRecord): string {
  const input = call.input;
  if (typeof input === "object" && input !== null && "server" in input && "tool" in input && typeof input.server === "string" && typeof input.tool === "string") {
    return `${call.name} ${input.server}.${input.tool}`;
  }
  return call.name;
}

export function createTracer(env: Env, waitUntil: (work: Promise<unknown>) => void, owner: () => TurnOwner): Tracer {
  const config = langfuseConfig(env);
  if (config === null) return { recordTurn: () => undefined, recordTool: () => undefined };
  const openCalls = new Map<string, RunLink>();
  const send = (span: Span) => waitUntil(sendSpan(config, span).catch((error: unknown) => console.error(JSON.stringify({ event: "langfuse_failed", error: String(error) }))));

  const remember = (callId: string, link: RunLink) => {
    openCalls.set(callId, link);
    const oldest = openCalls.keys().next();
    if (openCalls.size > maxOpenCalls && !oldest.done) openCalls.delete(oldest.value);
  };

  return {
    recordTurn: (turn) => {
      const who = owner();
      const run = runOf(turn);
      const spanId = randomHex(16);
      for (const callId of toolCallIds(turn.output)) {
        remember(callId, { traceId: run.traceId, parentSpanId: spanId, sessionId: turn.sessionId, runInput: run.input });
      }
      send({ traceId: run.traceId, spanId, name: `${who.kind} ${who.name}`, startedAt: turn.startedAt, attributes: turnAttributes(who, turn, run.input), error: turn.error?.message ?? null });
    },
    recordTool: (call) => {
      const root = callRoot(call.callId);
      const link = openCalls.get(root);
      if (root === call.callId) openCalls.delete(root);
      send({
        traceId: link?.traceId ?? randomHex(32),
        spanId: randomHex(16),
        ...(link === undefined ? {} : { parentSpanId: link.parentSpanId }),
        name: toolSpanName(call),
        startedAt: call.startedAt,
        attributes: toolAttributes(owner(), call, link),
        error: call.failed ? "The tool call failed" : null,
      });
    },
  };
}
