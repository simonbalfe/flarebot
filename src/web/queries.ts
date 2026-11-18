import { QueryCache, QueryClient, queryOptions } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, type BotView, type GroupView } from "./api";

const busyPollMs = 800;
const idlePollMs = 3000;
const macPollMs = 5000;
const factoryPollMs = 1500;
const repeatErrorMs = 10_000;
const pollErrorGraceMs = 15_000;

declare module "@tanstack/react-query" {
  interface Register {
    queryMeta: { poll?: boolean };
  }
}

let lastError = { message: "", at: 0 };

export function showError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  const now = Date.now();
  if (message === lastError.message && now - lastError.at < repeatErrorMs) return;
  lastError = { message, at: now };
  toast.error("Something went wrong", { description: message });
}

const failingSince = new Map<string, number>();

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") failingSince.clear();
});

export const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onSuccess: (_data, query) => {
      failingSince.delete(query.queryHash);
    },
    onError: (error, query) => {
      if (query.meta?.poll !== true) {
        showError(error);
        return;
      }
      const now = Date.now();
      const since = failingSince.get(query.queryHash) ?? now;
      failingSince.set(query.queryHash, since);
      if (document.visibilityState === "visible" && now - since >= pollErrorGraceMs) showError(error);
    },
  }),
  defaultOptions: {
    queries: { retry: false },
  },
});

export const keys = {
  bots: ["bots"] as const,
  view: (botId: string, threadId: string | null) => ["view", botId, threadId ?? "main"] as const,
  group: (groupId: string) => ["group", groupId] as const,
  computer: ["computer"] as const,
  mac: ["mac"] as const,
  mcp: ["mcp"] as const,
  clis: ["clis"] as const,
  skills: ["skills"] as const,
  ownSkills: (botId: string) => ["own-skills", botId] as const,
  secrets: ["secrets"] as const,
  apps: ["apps"] as const,
};

const poll = { poll: true };

export const botsQuery = queryOptions({ queryKey: keys.bots, queryFn: api.bots, refetchInterval: idlePollMs, meta: poll });

export function viewQuery(botId: string, threadId: string | null) {
  return queryOptions({
    queryKey: keys.view(botId, threadId),
    queryFn: (): Promise<BotView> => (threadId === null ? api.bot(botId) : api.thread(botId, threadId)),
    refetchInterval: (query) => (query.state.data?.busy === true ? busyPollMs : idlePollMs),
    meta: poll,
  });
}

export function factoryViewQuery(botId: string) {
  return queryOptions({ queryKey: keys.view(botId, null), queryFn: () => api.bot(botId), refetchInterval: factoryPollMs, meta: poll });
}

export function groupQuery(groupId: string) {
  return queryOptions({
    queryKey: keys.group(groupId),
    queryFn: (): Promise<GroupView> => api.group(groupId),
    refetchInterval: (query) => ((query.state.data?.typingIds.length ?? 0) > 0 ? busyPollMs : idlePollMs),
    meta: poll,
  });
}

export const computerQuery = queryOptions({ queryKey: keys.computer, queryFn: api.computer, refetchInterval: idlePollMs, meta: poll });
export const macQuery = queryOptions({ queryKey: keys.mac, queryFn: api.mac, refetchInterval: macPollMs, meta: poll });
export const mcpQuery = queryOptions({ queryKey: keys.mcp, queryFn: api.mcpServers });
export const clisQuery = queryOptions({ queryKey: keys.clis, queryFn: api.clis });
export const skillsQuery = queryOptions({ queryKey: keys.skills, queryFn: api.skills });
export const secretsQuery = queryOptions({ queryKey: keys.secrets, queryFn: api.secrets });
export const appsQuery = queryOptions({ queryKey: keys.apps, queryFn: api.apps });

export function ownSkillsQuery(botId: string) {
  return queryOptions({ queryKey: keys.ownSkills(botId), queryFn: () => api.ownSkills(botId) });
}
