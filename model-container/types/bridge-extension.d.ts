import type { AssistantMessageEventStream, Context, Model, SimpleStreamOptions } from "@earendil-works/pi-ai";

export type HostEvent = Record<string, unknown>;

export interface HostContext {
  cwd: string;
  ui: null;
  sessionManager: { getSessionId(): string };
  getSystemPrompt(): string | undefined;
  model: { provider: string };
  modelRegistry: { getProvider(id: string): unknown };
}

export type HostHandler = (event: HostEvent, context: HostContext) => void;

export interface HostProvider {
  models: Model<string>[];
  streamSimple(model: Model<string>, context: Context, options?: SimpleStreamOptions): AssistantMessageEventStream;
}

export interface HostApi {
  on(event: string, handler: HostHandler): void;
  registerProvider(id: string, provider: HostProvider): void;
  getAllTools(): { name: string }[];
}

declare const extension: (host: HostApi) => void;
export default extension;
