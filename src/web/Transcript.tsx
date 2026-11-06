import { Button, Collapsible } from "@cloudflare/kumo";
import { CaretRightIcon, HandPalmIcon } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { BotSummary, BotView, TranscriptItem } from "./api";
import { Avatar, colorOf } from "./Avatar";
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

function BotBubble({ text }: { text: string }) {
  return (
    <div className="fb-bubble fb-prose self-start bg-fb-bot text-fb-text">
      <Markdown remarkPlugins={remarkPlugins}>{text}</Markdown>
    </div>
  );
}

function MyBubble({ text }: { text: string }) {
  return <div className="fb-bubble self-end whitespace-pre-wrap bg-fb-me text-fb-me-text">{text}</div>;
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

function BotLine({ label, name, bots }: { label: string; name: string; bots: BotSummary[] }) {
  const index = bots.findIndex((candidate) => candidate.name.toLowerCase() === name.toLowerCase());
  return (
    <div className={`${systemLine} pt-2`}>
      {label}
      {index === -1 ? null : <Avatar index={index} size={16} />}
      <span className="text-fb-text">{bots[index]?.name ?? name}</span>
    </div>
  );
}

function RowView({ row, live, bots }: { row: Row; live: boolean; bots: BotSummary[] }) {
  switch (row.kind) {
    case "user":
      return <MyBubble text={row.text} />;
    case "assistant":
      return <BotBubble text={row.text} />;
    case "peer":
      return (
        <>
          <BotLine label="Message from" name={row.from} bots={bots} />
          <BotBubble text={row.text} />
        </>
      );
    case "handoff":
      return (
        <>
          <BotLine label="Message to" name={row.to} bots={bots} />
          <BotBubble text={row.text} />
        </>
      );
    case "tools":
      return <ToolCalls tools={row.tools} live={live} />;
    case "cost":
    case "tool":
      return null;
  }
}

function Thinking({ index }: { index: number }) {
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

export function Transcript({ view, bots, pending, onTakeOver }: { view: BotView; bots: BotSummary[]; pending: string | null; onTakeOver: () => void }) {
  const bottom = useRef<HTMLDivElement>(null);
  const rows = groupTools(view.items);
  const botIndex = Math.max(bots.findIndex((bot) => bot.id === view.profile.id), 0);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [rows.length, view.partial, pending, view.takeover, view.busy]);

  let previousAt = 0;
  const empty = rows.length === 0 && pending === null && !view.busy;
  return (
    <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-width:none]">
      <div className="flex min-h-full w-full flex-col gap-1.5 px-5 py-4">
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
        {pending === null ? null : <MyBubble text={pending} />}
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
