import type { AssistantMessage, Message } from "@earendil-works/pi-ai";
import { type ConversationView, type LiveState, ResetEntry, type SubmissionRecord } from "@earendil-works/pi-durable";

export type TranscriptItem =
  | { kind: "user"; id: string; text: string; at: number }
  | { kind: "assistant"; id: string; text: string; at: number }
  | { kind: "peer"; id: string; from: string; text: string; at: number }
  | { kind: "handoff"; id: string; to: string; text: string; at: number }
  | { kind: "tool"; id: string; name: string; detail: string; at: number }
  | { kind: "cost"; id: string; cost: number; tools: number; at: number };

export interface TranscriptView {
  busy: boolean;
  items: TranscriptItem[];
  partial: string | null;
  error: string | null;
  totalCost: number;
}

const detailLimit = 200;
const botMessagePattern = /^\[(?:Message|Reply) from Bot: ([^\]]+)\]\n([\s\S]*)$/;

export function groupMessage(group: string, from: string, text: string, context: string): string {
  return `[Message in group: ${group} from: ${from}]\n${text}\n[Recent group messages]\n${context}`;
}

export function botMessage(from: string, text: string): string {
  return `[Message from Bot: ${from}]\n${text}`;
}

export function botReply(from: string, text: string): string {
  return `[Reply from Bot: ${from}]\n${text}`;
}

function handoffOf(args: Record<string, unknown>): { to: string; text: string } {
  return { to: String(args.to ?? ""), text: String(args.message ?? "") };
}

function textOf(content: Message["content"]): string {
  if (typeof content === "string") return content;
  return content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("");
}

function failureOf(last: SubmissionRecord | undefined): string | null {
  if (last?.status !== "unanswered" || last.reason === "aborted") return null;
  const detail = typeof last.detail === "string" ? last.detail : JSON.stringify(last.detail ?? "");
  return `${last.reason}: ${detail}`.slice(0, 400);
}

function transcriptItems(messages: { id: string; message: Message }[]): { items: TranscriptItem[]; totalCost: number } {
  const items: TranscriptItem[] = [];
  let totalCost = 0;
  let turnCost = 0;
  let turnTools = 0;
  let turnAt = 0;
  const closeTurn = (id: string) => {
    if (turnCost > 0) items.push({ kind: "cost", id: `${id}:cost`, cost: turnCost, tools: turnTools, at: turnAt });
    turnCost = 0;
    turnTools = 0;
  };
  for (const { id, message } of messages) {
    if (message.role === "user") {
      closeTurn(id);
      const text = textOf(message.content);
      const peer = text.match(botMessagePattern);
      if (peer === null) items.push({ kind: "user", id, text, at: message.timestamp });
      else items.push({ kind: "peer", id, from: peer[1] ?? "", text: peer[2] ?? "", at: message.timestamp });
    }
    if (message.role === "assistant") {
      const cost = message.usage?.cost?.total ?? 0;
      totalCost += cost;
      turnCost += cost;
      turnAt = message.timestamp;
      const text = textOf(message.content);
      if (text) items.push({ kind: "assistant", id, text, at: message.timestamp });
      message.content.forEach((block, index) => {
        if (block.type !== "toolCall") return;
        turnTools += 1;
        if (block.name === "message_bot") {
          items.push({ kind: "handoff", id: `${id}:${index}`, ...handoffOf(block.arguments), at: message.timestamp });
          return;
        }
        items.push({ kind: "tool", id: `${id}:${index}`, name: block.name, detail: JSON.stringify(block.arguments).slice(0, detailLimit), at: message.timestamp });
      });
    }
  }
  closeTurn("end");
  return { items, totalCost };
}

export function toTranscriptView(view: ConversationView, last: SubmissionRecord | undefined): TranscriptView {
  const live = view.docs["pi.live"] as LiveState | undefined;
  const partial = live?.generation?.message as AssistantMessage | undefined;
  const start = view.entries.findLastIndex((entry) => ResetEntry.is(entry)) + 1;
  const messages = view.entries.slice(start).flatMap((entry) => (entry.model ?? []).map((message) => ({ id: String(entry.id), message })));
  return {
    busy: live?.run !== undefined || last?.status === "queued" || last?.status === "placed",
    ...transcriptItems(messages),
    partial: partial ? textOf(partial.content) || null : null,
    error: live?.generation?.retry?.error ?? failureOf(last),
  };
}
