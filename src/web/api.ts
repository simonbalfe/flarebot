import type { BotView, ThreadSummary } from "../worker/bot";
import type { ComputerStatus } from "../worker/computer";
import type { GroupView } from "../worker/group";
import type { McpServerSummary } from "../worker/mcp";
import type { BotSummary, GroupSummary } from "../worker/user";

export type { BotSummary, BotView, ComputerStatus, GroupSummary, GroupView, McpServerSummary, ThreadSummary };
export type { TranscriptItem } from "../worker/view";

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init,
    headers: init?.body === undefined ? undefined : { "content-type": "application/json" },
  });
  if (response.status === 401) window.location.reload();
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    const message = typeof body === "object" && body !== null && "error" in body && typeof body.error === "string" ? body.error : `HTTP ${response.status}`;
    throw new Error(message);
  }
  if (response.status === 202 || response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

const botPath = (id: string) => `/bots/${encodeURIComponent(id)}`;
const threadPath = (id: string, threadId: string) => `${botPath(id)}/threads/${encodeURIComponent(threadId)}`;

export const api = {
  bots: () => call<{ bots: BotSummary[]; groups: GroupSummary[]; models: string[] }>("/bots"),
  createBot: (input: { name: string; role: string }) => call<BotSummary>("/bots", { method: "POST", body: JSON.stringify(input) }),
  setRole: (id: string, role: string) => call<void>(`${botPath(id)}/role`, { method: "PUT", body: JSON.stringify({ role }) }),
  bot: (id: string) => call<BotView>(botPath(id)),
  send: (id: string, text: string) => call<void>(`${botPath(id)}/messages`, { method: "POST", body: JSON.stringify({ text }) }),
  finishTakeover: (id: string) => call<void>(`${botPath(id)}/takeover/done`, { method: "POST" }),
  stop: (id: string) => call<void>(`${botPath(id)}/stop`, { method: "POST" }),
  setModel: (id: string, model: string) => call<void>(`${botPath(id)}/model`, { method: "PUT", body: JSON.stringify({ model }) }),
  forget: (id: string, index: number) => call<void>(`${botPath(id)}/memory/${index}`, { method: "DELETE" }),
  createGroup: (input: { name: string; botIds: string[] }) => call<GroupSummary>("/groups", { method: "POST", body: JSON.stringify(input) }),
  group: (id: string) => call<GroupView>(`/groups/${encodeURIComponent(id)}`),
  sendGroup: (id: string, text: string) => call<void>(`/groups/${encodeURIComponent(id)}/messages`, { method: "POST", body: JSON.stringify({ text }) }),
  stopGroup: (id: string) => call<void>(`/groups/${encodeURIComponent(id)}/stop`, { method: "POST" }),
  mcpServers: () => call<{ servers: McpServerSummary[] }>("/mcp"),
  addMcpServer: (input: { name: string; url: string; token: string }) => call<{ server: McpServerSummary; tools: number }>("/mcp", { method: "POST", body: JSON.stringify(input) }),
  removeMcpServer: (serverId: string) => call<void>(`/mcp/${encodeURIComponent(serverId)}`, { method: "DELETE" }),
  setBotMcp: (id: string, serverIds: string[]) => call<{ servers: McpServerSummary[] }>(`${botPath(id)}/mcp`, { method: "PUT", body: JSON.stringify({ serverIds }) }),
  startThread: (id: string) => call<ThreadSummary>(`${botPath(id)}/threads`, { method: "POST" }),
  thread: (id: string, threadId: string) => call<BotView>(threadPath(id, threadId)),
  sendThread: (id: string, threadId: string, text: string) => call<void>(`${threadPath(id, threadId)}/messages`, { method: "POST", body: JSON.stringify({ text }) }),
  stopThread: (id: string, threadId: string) => call<void>(`${threadPath(id, threadId)}/stop`, { method: "POST" }),
  closeThread: (id: string, threadId: string) => call<void>(`${threadPath(id, threadId)}/close`, { method: "POST" }),
  showTab: (id: string) => call<void>(`${botPath(id)}/tab/show`, { method: "POST" }),
  computer: () => call<ComputerStatus>("/computer"),
  startComputer: () => call<ComputerStatus>("/computer/start", { method: "POST" }),
  stopComputer: () => call<ComputerStatus>("/computer/stop", { method: "POST" }),
};

export async function isSignedIn(): Promise<boolean> {
  const response = await fetch("/api/session");
  return response.ok;
}

export function screenUrl(viewOnly: boolean): string {
  const params = new URLSearchParams({ autoconnect: "1", reconnect: "1", resize: "scale", path: "websockify", view_only: viewOnly ? "1" : "0" });
  return `/api/computer/vnc/vnc.html?${params}`;
}
