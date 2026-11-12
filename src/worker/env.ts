export type AppEnv = { Bindings: Env; Variables: { apiKey: boolean } };

export const userName = "me";
export const computerName = "me";
export const macName = "me";
export const modelContainerName = "shared";
export const models = ["claude-sonnet-5-5", "claude-opus-5-5", "claude-haiku-5-5"] as const;
export const modelLabels: Record<(typeof models)[number], string> = {
  "claude-sonnet-5-5": "Sonnet 5.5",
  "claude-opus-5-5": "Opus 5.5",
  "claude-haiku-5-5": "Haiku 5.5",
};

export const efforts = ["low", "medium", "high", "xhigh", "max"] as const;
export type Effort = (typeof efforts)[number];
export const effortLabels: Record<Effort, string> = { low: "Low", medium: "Medium", high: "High", xhigh: "Extra high", max: "Max" };
export const defaultEffort: Effort = "high";
export const routerEffort: Effort = "low";

export function claudeModelId(model: string): string {
  return model.replace(/^anthropic\//, "").replaceAll(".", "-");
}
