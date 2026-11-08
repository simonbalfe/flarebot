import { useCallback, useEffect, useRef, useState } from "react";
import { api, type BotSummary, type GroupSummary, type GroupView } from "./api";
import { Avatar, type MentionOption } from "./Avatar";
import { Composer } from "./Composer";
import { formatClock } from "./format";
import { useIsMobile } from "./mobile";
import { BotBubble, MyBubble, Thinking } from "./Transcript";

const busyPollMs = 800;
const idlePollMs = 3000;
const timeGapMs = 5 * 60 * 1000;
const systemSender = "system";

export function GroupAvatars({ memberIds, bots }: { memberIds: string[]; bots: BotSummary[] }) {
  const indexes = memberIds.slice(0, 2).map((id) => bots.findIndex((bot) => bot.id === id));
  return (
    <span className="relative block size-8 shrink-0">
      {indexes.map((index, position) => (
        <span key={index} className={position === 0 ? "absolute top-0 left-0" : "absolute right-0 bottom-0"}>
          <Avatar index={Math.max(index, 0)} size={20} />
        </span>
      ))}
    </span>
  );
}

export function GroupPane({ group, bots, onError }: { group: GroupSummary; bots: BotSummary[]; onError: (error: unknown) => void }) {
  const mobile = useIsMobile();
  const [view, setView] = useState<GroupView | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const members = group.memberIds.flatMap((id) => bots.filter((bot) => bot.id === id));
  const typing = members.filter((bot) => view?.typingIds.includes(bot.id));
  const mentions: MentionOption[] = [...members.map((bot) => ({ name: bot.name, index: bots.indexOf(bot) })), { name: "everyone", index: null }];
  const messageCount = view?.messages.length ?? 0;

  const load = useCallback(async () => {
    try {
      setView(await api.group(group.id));
    } catch (error) {
      onError(error);
    }
  }, [group.id, onError]);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), typing.length > 0 ? busyPollMs : idlePollMs);
    return () => clearInterval(timer);
  }, [load, typing.length]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [messageCount, pending, typing.length]);

  const send = async (text: string) => {
    setPending(text);
    try {
      await api.sendGroup(group.id, text);
      await load();
    } catch (error) {
      onError(error);
    }
    setPending(null);
  };

  const stop = async () => {
    try {
      await api.stopGroup(group.id);
    } catch (error) {
      onError(error);
    }
  };

  let previousAt = 0;
  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-width:none]">
        <div className="flex min-h-full w-full flex-col gap-1.5 px-3 py-4 md:px-5">
          {view?.messages.map((message) => {
            const showTime = message.at - previousAt > timeGapMs;
            previousAt = message.at;
            const index = bots.findIndex((bot) => bot.id === message.senderId);
            return (
              <div key={message.id} className="contents">
                {showTime ? <div className="py-1 text-center text-xs leading-4 text-fb-time">{formatClock(message.at)}</div> : null}
                {message.senderId === null ? <MyBubble text={message.text} mentions={mentions} /> : null}
                {message.senderId === systemSender ? <div className="fb-caption py-1 text-center text-fb-time">{message.text}</div> : null}
                {index === -1 ? null : (
                  <>
                    <div className="fb-caption mt-1 flex items-center gap-1.5 text-fb-preview">
                      <Avatar index={index} size={16} />
                      {bots[index]?.name}
                    </div>
                    <BotBubble text={message.text} />
                  </>
                )}
              </div>
            );
          })}
          {pending === null ? null : <MyBubble text={pending} mentions={mentions} />}
          {typing.map((bot) => <Thinking key={bot.id} index={bots.indexOf(bot)} />)}
          <div ref={bottom} />
        </div>
      </div>
      <Composer key={group.id} name={group.name} busy={typing.length > 0} autoFocus={!mobile} mentions={mentions} onSend={(text) => void send(text)} onStop={() => void stop()} />
    </>
  );
}
