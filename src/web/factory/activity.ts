import type { BotSummary, BotView } from "../api";

export type Station = "home" | "model" | "computer" | "mac" | "artifacts" | "toolbox" | "mcp" | "you";

export interface BotActivity {
  station: Station;
  label: string;
  alert: boolean;
}

const toolStations: Record<string, Station> = {
  bash: "computer",
  run_linux: "computer",
  publish_cli: "computer",
  screenshot: "computer",
  click: "computer",
  type_text: "computer",
  press_key: "computer",
  scroll: "computer",
  open_url: "computer",
  mac_run: "mac",
  mac_read: "mac",
  mac_write: "mac",
  mac_list: "mac",
  mac_open: "mac",
  pull_repo: "artifacts",
  push_repo: "artifacts",
  list_skills: "toolbox",
  load_skill: "toolbox",
  save_skill: "toolbox",
  publish_skill: "toolbox",
  mcp_list_tools: "mcp",
  mcp_call: "mcp",
};

const thinking: BotActivity = { station: "model", label: "thinking", alert: false };

export function activityOf(bot: BotSummary, view: BotView | undefined): BotActivity {
  if (bot.needsYou) return { station: "you", label: "", alert: true };
  if (!bot.typing) return { station: "home", label: "", alert: false };
  if (view === undefined || !view.busy || view.partial !== null) return thinking;
  const last = view.items.findLast((item) => item.kind !== "cost" && !item.id.startsWith("queued:"));
  if (last?.kind === "tool") return { station: toolStations[last.name] ?? "model", label: last.name, alert: false };
  if (last?.kind === "handoff") return { station: "model", label: "message_bot", alert: false };
  return thinking;
}
