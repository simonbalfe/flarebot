import type { ConversationId } from "@earendil-works/pi-durable";

export type ApprovalKind = "mcp" | "action" | "secret";
export type Decision = "once" | "always" | "deny";

export interface PendingApproval {
  id: string;
  kind: ApprovalKind;
  title: string;
  detail: string;
  origin: ConversationId;
  createdAt: number;
  grantKey: string;
  ruleKey: string | null;
  secret: string | null;
}

export interface ApprovalSummary {
  id: string;
  kind: ApprovalKind;
  title: string;
  detail: string;
  createdAt: number;
  canAlways: boolean;
}

export interface SecretRequest {
  id: string;
  name: string;
  purpose: string;
  site: string;
  origin: ConversationId;
  createdAt: number;
}

export type SecretRequestSummary = Omit<SecretRequest, "origin">;

export interface ConnectionRequest {
  id: string;
  serverId: string;
  name: string;
  reason: string;
  origin: ConversationId;
  createdAt: number;
}

export type ConnectionRequestSummary = Omit<ConnectionRequest, "origin">;
export type ConnectionAsk = { kind: "ready"; name: string } | { kind: "pending"; name: string } | { kind: "error"; error: string };

export function connectedMessage(name: string): string {
  return `[Connected]\n${name} is connected and switched on for you. Continue with mcp_list_tools.`;
}

export function connectionDismissedMessage(name: string): string {
  return `[Connection dismissed]\nThe user did not connect ${name}.`;
}

export interface ActionEntry {
  id: number;
  at: number;
  kind: string;
  summary: string;
  outcome: string;
}

export type GateInput = {
  kind: ApprovalKind;
  title: string;
  detail: string;
  grantKey: string;
  ruleKey: string | null;
  secret?: string;
  origin: ConversationId;
};

export type GateResult = "allowed" | "pending";

export const maxPendingApprovals = 20;
export const maxGrants = 50;
export const maxActions = 500;
export const shownActions = 30;
export const maxDetailChars = 1500;
export const secretNamePattern = /^[A-Z][A-Z0-9_]{0,39}$/;
const noticePattern = /^\[(Approval: [a-z ]+|Secret saved|Secret dismissed|Connected|Connection dismissed)\]\n?([\s\S]*)$/;

export const decisionLabels: Record<Decision, string> = { once: "allowed once", always: "always allowed", deny: "denied" };

export function approvalSummary(approval: PendingApproval): ApprovalSummary {
  return { id: approval.id, kind: approval.kind, title: approval.title, detail: approval.detail, createdAt: approval.createdAt, canAlways: approval.ruleKey !== null };
}

export function secretRequestSummary(request: SecretRequest): SecretRequestSummary {
  const { origin: _origin, ...rest } = request;
  return rest;
}

export function decisionMessage(decision: Decision, title: string): string {
  const next = decision === "deny" ? "Do not retry it. Tell the user what you will do instead." : "Repeat exactly the same call now.";
  return `[Approval: ${decisionLabels[decision]}]\n${title}\n${next}`;
}

export function secretSavedMessage(name: string): string {
  return `[Secret saved]\n${name} is ready. Continue with type_secret or run_linux secrets.`;
}

export function secretDismissedMessage(name: string): string {
  return `[Secret dismissed]\nThe user did not enter ${name}. Do not ask for it in chat.`;
}

export function parseNotice(text: string): { label: string; text: string } | null {
  const match = text.match(noticePattern);
  if (match === null) return null;
  return { label: match[1] ?? "", text: (match[2] ?? "").split("\n")[0] ?? "" };
}

export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export async function digest(value: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function clipDetail(value: string): string {
  return value.length > maxDetailChars ? `${value.slice(0, maxDetailChars)}…` : value;
}

export function redact(output: string, secrets: { name: string; value: string }[]): string {
  return secrets.reduce((text, secret) => (secret.value.length < 4 ? text : text.split(secret.value).join(`[secret ${secret.name}]`)), output);
}
