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

export type RecordTurn = (turn: ModelTurn) => void;

const source = "flarebot";
const maxFieldChars = 50_000;

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

function turnAttributes(owner: TurnOwner, turn: ModelTurn): Attribute[] {
  return [
    ...attribute("langfuse.observation.type", "generation"),
    ...attribute("langfuse.trace.name", source),
    tagsAttribute([source, owner.kind]),
    ...attribute("langfuse.user.id", owner.name),
    ...attribute("langfuse.session.id", turn.sessionId),
    ...attribute("langfuse.trace.metadata.source", source),
    ...attribute("langfuse.trace.metadata.owner_id", owner.id),
    ...attribute("langfuse.trace.input", turn.input),
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

function randomHex(length: number): string {
  return crypto.randomUUID().replaceAll("-", "").slice(0, length);
}

function turnSpan(owner: TurnOwner, turn: ModelTurn): object {
  return {
    traceId: randomHex(32),
    spanId: randomHex(16),
    name: `${owner.kind} ${owner.name}`,
    kind: 1,
    startTimeUnixNano: `${turn.startedAt}000000`,
    endTimeUnixNano: `${Date.now()}000000`,
    attributes: turnAttributes(owner, turn),
    status: turn.error === null ? { code: 1 } : { code: 2, message: serialize(turn.error.message) },
  };
}

async function sendTurn(config: LangfuseConfig, owner: () => TurnOwner, turn: ModelTurn): Promise<void> {
  const response = await fetch(config.endpoint, {
    method: "POST",
    headers: { authorization: config.authorization, "content-type": "application/json" },
    body: JSON.stringify({
      resourceSpans: [{ resource: { attributes: attribute("service.name", source) }, scopeSpans: [{ scope: { name: source }, spans: [turnSpan(owner(), turn)] }] }],
    }),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Langfuse answered ${response.status}: ${text.slice(0, 500)}`);
  if (text.includes("rejectedSpans") && !text.includes('"rejectedSpans":0') && !text.includes('"rejectedSpans":"0"')) throw new Error(`Langfuse rejected the turn: ${text.slice(0, 500)}`);
}

export function recordTurns(env: Env, waitUntil: (work: Promise<unknown>) => void, owner: () => TurnOwner): RecordTurn {
  const config = langfuseConfig(env);
  if (config === null) return () => undefined;
  return (turn) => waitUntil(sendTurn(config, owner, turn).catch((error: unknown) => console.error(JSON.stringify({ event: "langfuse_failed", error: String(error) }))));
}
