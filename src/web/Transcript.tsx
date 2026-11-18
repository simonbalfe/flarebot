import { Confirmation, ConfirmationAction, ConfirmationActions, ConfirmationLabel, ConfirmationTitle } from "@/components/ai-elements/confirmation";
import { Conversation, ConversationContent, ConversationEmptyState, ConversationScrollButton } from "@/components/ai-elements/conversation";
import { Message, MessageContent, MessageResponse } from "@/components/ai-elements/message";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { Tool, ToolContent, ToolHeader, ToolInput } from "@/components/ai-elements/tool";
import { ArrowBendUpRightIcon, ClockClockwiseIcon, HandPalmIcon, RobotIcon } from "@phosphor-icons/react";
import type { BotSummary, BotView, TranscriptItem } from "./api";
import { ApprovalCard, type Decision, SecretCard } from "./Approvals";
import { ConnectCard } from "./Apps";
import { Avatar, botMentions, colorOf, MentionChip, type MentionOption } from "./Avatar";
import { formatClock } from "./format";

const timeGapMs = 5 * 60 * 1000;
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
    <Message from="assistant">
      <MessageContent>
        <MessageResponse>{text}</MessageResponse>
      </MessageContent>
    </Message>
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
  return (
    <Message from="user">
      <MessageContent>{withMentions(text, mentions)}</MessageContent>
    </Message>
  );
}

function ToolCalls({ tools, live }: { tools: ToolItem[]; live: boolean }) {
  return (
    <Tool>
      <ToolHeader title={toolsLabel(tools)} state={live ? "running" : "done"} />
      <ToolContent>
        {tools.map((tool) => <ToolInput key={tool.id} name={tool.name} input={tool.detail} />)}
      </ToolContent>
    </Tool>
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
          <MessageResponse>{text}</MessageResponse>
        </div>
      </div>
    </div>
  );
}

function RoutineLine({ title, text }: { title: string; text: string }) {
  return (
    <div className={systemLine} title={text}>
      <ClockClockwiseIcon size={12} />
      {title}
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
    case "routine":
      return <RoutineLine title={row.title} text={row.text} />;
    case "notice":
      return <div className={systemLine}>{row.label} · {row.text}</div>;
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
      <Shimmer>Thinking</Shimmer>
    </div>
  );
}

export interface CardActions {
  onDecide: (approvalId: string, decision: Decision) => void;
  onSubmitSecret: (requestId: string, value: string) => Promise<boolean>;
  onDismissSecret: (requestId: string) => void;
  onConnect: (serverId: string, requestId: string) => void;
  onDismissConnection: (requestId: string) => void;
}

export function Transcript({ view, bots, pending, onTakeOver, cards }: { view: BotView; bots: BotSummary[]; pending: { key: string; text: string }[]; onTakeOver: () => void; cards: CardActions }) {
  const rows = groupTools(view.items);
  const botIndex = Math.max(bots.findIndex((bot) => bot.id === view.profile.id), 0);

  let previousAt = 0;
  const empty = rows.length === 0 && pending.length === 0 && !view.busy;
  return (
    <Conversation>
      <ConversationContent>
        {empty ? <ConversationEmptyState><Avatar index={botIndex} size={64} /></ConversationEmptyState> : null}
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
          <Confirmation>
            <ConfirmationLabel icon={<HandPalmIcon size={14} weight="fill" />}>Needs you</ConfirmationLabel>
            <ConfirmationTitle>{view.takeover.site}</ConfirmationTitle>
            <span>{view.takeover.reason}</span>
            <ConfirmationActions>
              <ConfirmationAction variant="action" onClick={onTakeOver}>Open computer</ConfirmationAction>
            </ConfirmationActions>
          </Confirmation>
        )}
        {view.approvals.map((approval) => <ApprovalCard key={approval.id} approval={approval} onDecide={(decision) => cards.onDecide(approval.id, decision)} />)}
        {view.secretRequests.map((request) => <SecretCard key={request.id} request={request} onSubmit={(value) => cards.onSubmitSecret(request.id, value)} onDismiss={() => cards.onDismissSecret(request.id)} />)}
        {view.connectionRequests.map((request) => <ConnectCard key={request.id} request={request} onConnect={() => cards.onConnect(request.serverId, request.id)} onDismiss={() => cards.onDismissConnection(request.id)} />)}
        {view.error === null ? null : <div className="px-3 text-xs leading-4 text-fb-danger-text [overflow-wrap:anywhere]">{view.error}</div>}
      </ConversationContent>
      <ConversationScrollButton />
    </Conversation>
  );
}
