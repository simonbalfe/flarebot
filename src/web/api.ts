import type { BotView } from "../worker/bot";
import type { ComputerStatus } from "../worker/computer";
import type { BotSummary } from "../worker/user";

export type { BotSummary, BotView, ComputerStatus };
export type { TranscriptItem } from "../worker/view";

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init,
    headers: init?.body === undefined ? undefined : { "content-type": "application/json" },
  });
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    const message = typeof body === "object" && body !== null && "error" in body && typeof body.error === "string" ? body.error : `HTTP ${response.status}`;
    throw new Error(message);
  }
  if (response.status === 202 || response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

const botPath = (id: string) => `/bots/${encodeURIComponent(id)}`;

export const api = {
  bots: () => call<{ bots: BotSummary[]; models: string[] }>("/bots"),
  createBot: (input: { name: string }) => call<BotSummary>("/bots", { method: "POST", body: JSON.stringify(input) }),
  bot: (id: string) => call<BotView>(botPath(id)),
  send: (id: string, text: string) => call<void>(`${botPath(id)}/messages`, { method: "POST", body: JSON.stringify({ text }) }),
  stop: (id: string) => call<void>(`${botPath(id)}/stop`, { method: "POST" }),
  setModel: (id: string, model: string) => call<void>(`${botPath(id)}/model`, { method: "PUT", body: JSON.stringify({ model }) }),
  forget: (id: string, index: number) => call<void>(`${botPath(id)}/memory/${index}`, { method: "DELETE" }),
  computer: () => call<ComputerStatus>("/computer"),
  startComputer: () => call<ComputerStatus>("/computer/start", { method: "POST" }),
  stopComputer: () => call<ComputerStatus>("/computer/stop", { method: "POST" }),
};

export function screenUrl(viewOnly: boolean): string {
  const params = new URLSearchParams({ autoconnect: "1", reconnect: "1", resize: "scale", path: "websockify", view_only: viewOnly ? "1" : "0" });
  return `/api/computer/vnc/vnc.html?${params}`;
}
