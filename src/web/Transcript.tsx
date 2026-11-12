import { Button, Collapsible } from "@cloudflare/kumo";
import { ArrowBendUpRightIcon, CaretRightIcon, HandPalmIcon, RobotIcon } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { BotSummary, BotView, TranscriptItem } from "./api";
import { Avatar, botMentions, colorOf, MentionChip, type MentionOption } from "./Avatar";
import { formatClock } from "./format";

const timeGapMs = 5 * 60 * 1000;
const remarkPlugins = [remarkGfm];
const systemLine = "fb-caption flex items-center justify-center gap-1.5 py-1 text-fb-time";

type ToolItem = Extract<TranscriptItem, { kind: "tool" }>;
type Row = TranscriptItem | { kind: "tools"; id: string; at: number; tools: ToolItem[] };

function groupTools(items: TranscriptItem[]): Row[] {
  const rows: Row[] = [];
  for (const item of items) {
    const previous = rows.at(-1);
    if (item.kind === "tool" && previous?.kind === "tools") previous.tools.push(item);
    else if (item.kind === "tool") rows.push({ kind: "tools", id: item.id, at: item.at, tools: [item] });
    else rows.push(item);
  }
  return rows;
}

function toolsLabel(tools: ToolItem[]): string {
  const names = [...new Set(tools.map((tool) => tool.name))];
  if (names.length > 1) return `Used ${names.length} tools`;
  return tools.length > 1 ? `Used ${names[0]} ${tools.length} times` : `Used ${names[0]}`;
}

export function BotBubble({ text }: { text: string }) {
  return (
    <div className="fb-bubble fb-prose self-start bg-fb-bot text-fb-text">
      <Markdown remarkPlugins={remarkPlugins}>{text}</Markdown>
    </div>
  );
}

function withMentions(text: string, mentions: MentionOption[]) {
  if (mentions.length === 0) return text;
  const names = mentions.map((mention) => mention.name).sort((a, b) => b.length - a.length).map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return text.split(new RegExp(`(@(?:${names.join("|")})(?![\\w-]))`, "gi")).map((part, index) => {
    const mention = index % 2 === 1 ? mentions.find((candidate) => `@${candidate.name}`.toLowerCase() === part.toLowerCase()) : undefined;
    return mention === undefined ? part : <MentionChip key={index} mention={mention} />;
  });
}

export function MyBubble({ text, mentions = [] }: { text: string; mentions?: MentionOption[] }) {
  return <div className="fb-bubble self-end whitespace-pre-wrap bg-fb-me text-fb-me-text">{withMentions(text, mentions)}</div>;
}

function ToolCalls({ tools, live }: { tools: ToolItem[]; live: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible.Root open={open} onOpenChange={setOpen} className="flex flex-col items-center">
      <Collapsible.Trigger className={`${systemLine} cursor-pointer hover:text-fb-text ${live ? "animate-pulse" : ""}`}>
        {toolsLabel(tools)}
        <CaretRightIcon size={10} className={open ? "rotate-90 transition-transform" : "transition-transform"} />
      </Collapsible.Trigger>
      <Collapsible.Panel className="mb-1 flex max-w-full flex-col gap-1 rounded-[10px] bg-fb-bot px-3 py-2">
        {tools.map((tool) => (
          <code key={tool.id} className="break-all font-mono text-xs text-fb-preview">{tool.name} {tool.detail}</code>
        ))}
      </Collapsible.Panel>
    </Collapsible.Root>
  );
}

function PeerMessage({ direction, name, text, bots }: { direction: "from" | "to"; name: string; text: string; bots: BotSummary[] }) {
  const index = bots.findIndex((candidate) => candidate.name.toLowerCase() === name.toLowerCase());
  const color = index === -1 ? "var(--color-fb-time)" : colorOf(index);
  const shown = bots[index]?.name ?? name;
  const frame = { borderColor: color, background: `color-mix(in srgb, ${color} 9%, transparent)` };
  const incoming = direction === "from";
  return (
    <div className={`flex w-full items-start gap-2 pt-2 ${incoming ? "flex-row-reverse" : ""}`}>
      <span className="mt-[18px] grid size-6 shrink-0 place-items-center">
        {!incoming ? <ArrowBendUpRightIcon size={16} className="text-fb-time" /> : index === -1 ? <RobotIcon size={18} style={{ color }} /> : <Avatar index={index} size={24} />}
      </span>
      <div className={`flex min-w-0 flex-1 flex-col gap-1 ${incoming ? "items-end" : "items-start"}`}>
        <span className="fb-caption flex items-center gap-1 font-semibold" style={{ color }}>
          {direction === "to" ? "To" : null}
          {direction === "to" && index !== -1 ? <Avatar index={index} size={14} /> : null}
          {shown}
        </span>
        <div className={`fb-bubble fb-prose border text-fb-text ${direction === "to" ? "border-dashed" : ""}`} style={frame}>
          <Markdown remarkPlugins={remarkPlugins}>{text}</Markdown>
        </div>
      </div>
    </div>
  );
}

function RowView({ row, live, bots }: { row: Row; live: boolean; bots: BotSummary[] }) {
  switch (row.kind) {
    case "user":
      return <MyBubble text={row.text} mentions={botMentions(bots)} />;
    case "assistant":
      return <BotBubble text={row.text} />;
    case "peer":
      return <PeerMessage direction="from" name={row.from} text={row.text} bots={bots} />;
    case "handoff":
      return <PeerMessage direction="to" name={row.to} text={row.text} bots={bots} />;
    case "tools":
      return <ToolCalls tools={row.tools} live={live} />;
    case "cost":
    case "tool":
      return null;
  }
}

export function Thinking({ index }: { index: number }) {
  const style = { background: colorOf(index) };
  return (
    <div className="flex items-center gap-1 px-3 py-2 text-xs text-fb-time">
      <i className="fb-dot" style={style} />
      <i className="fb-dot [animation-delay:200ms]" style={style} />
      <i className="fb-dot mr-1 [animation-delay:400ms]" style={style} />
      Thinking
    </div>
  );
}

export function Transcript({ view, bots, pending, onTakeOver }: { view: BotView; bots: BotSummary[]; pending: { key: string; text: string }[]; onTakeOver: () => void }) {
  const bottom = useRef<HTMLDivElement>(null);
  const rows = groupTools(view.items);
  const botIndex = Math.max(bots.findIndex((bot) => bot.id === view.profile.id), 0);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [rows.length, view.partial, pending.length, view.takeover, view.busy]);

  let previousAt = 0;
  const empty = rows.length === 0 && pending.length === 0 && !view.busy;
  return (
    <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-width:none]">
      <div className="flex min-h-full w-full flex-col gap-1.5 px-3 py-4 md:px-5">
        {empty ? <div className="grid flex-1 place-items-center"><Avatar index={botIndex} size={64} /></div> : null}
        {rows.map((row, index) => {
          const showTime = row.at - previousAt > timeGapMs;
          previousAt = row.at;
          return (
            <div key={row.id} className="contents">
              {showTime ? <div className="py-1 text-center text-xs leading-4 text-fb-time">{formatClock(row.at)}</div> : null}
              <RowView row={row} live={view.busy && index === rows.length - 1} bots={bots} />
            </div>
          );
        })}
        {pending.map((message) => <MyBubble key={message.key} text={message.text} mentions={botMentions(bots)} />)}
        {view.partial === null ? null : <BotBubble text={view.partial} />}
        {view.busy && view.partial === null ? <Thinking index={botIndex} /> : null}
        {view.takeover === null ? null : (
          <div className="fb-bubble my-1 flex flex-col gap-2 self-start bg-fb-control p-4 text-fb-text ring-1 ring-fb-action/50">
            <span className="fb-caption flex items-center gap-1.5 font-semibold text-fb-control-text">
              <HandPalmIcon size={14} weight="fill" />
              Needs you
            </span>
            <span className="text-[15px] font-semibold leading-5">{view.takeover.site}</span>
            <span>{view.takeover.reason}</span>
            <Button size="sm" className="mt-1 w-fit rounded-full! bg-fb-action! font-semibold! text-fb-action-text!" onClick={onTakeOver}>Open computer</Button>
          </div>
        )}
        {view.error === null ? null : <div className="px-3 text-xs leading-4 text-kumo-danger [overflow-wrap:anywhere]">{view.error}</div>}
        <div ref={bottom} />
      </div>
    </div>
  );
}
