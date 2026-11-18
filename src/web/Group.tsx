import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Conversation, ConversationContent, ConversationScrollButton } from "@/components/ai-elements/conversation";
import { api, type BotSummary, type GroupSummary } from "./api";
import { Avatar, type MentionOption } from "./Avatar";
import { Composer } from "./Composer";
import { formatClock } from "./format";
import { useIsMobile } from "./mobile";
import { groupQuery, keys, showError } from "./queries";
import { BotBubble, MyBubble, Thinking } from "./Transcript";

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

export function GroupPane({ group, bots }: { group: GroupSummary; bots: BotSummary[] }) {
  const mobile = useIsMobile();
  const queries = useQueryClient();
  const view = useQuery(groupQuery(group.id)).data ?? null;
  const [pending, setPending] = useState<string | null>(null);
  const members = group.memberIds.flatMap((id) => bots.filter((bot) => bot.id === id));
  const typing = members.filter((bot) => view?.typingIds.includes(bot.id));
  const mentions: MentionOption[] = [...members.map((bot) => ({ name: bot.name, index: bots.indexOf(bot) })), { name: "everyone", index: null }];

  const load = () => queries.invalidateQueries({ queryKey: keys.group(group.id) });

  const send = async (text: string) => {
    setPending(text);
    try {
      await api.sendGroup(group.id, text);
      await load();
    } catch (error) {
      showError(error);
    }
    setPending(null);
  };

  const stop = async () => {
    try {
      await api.stopGroup(group.id);
    } catch (error) {
      showError(error);
    }
  };

  let previousAt = 0;
  return (
    <>
      <Conversation key={group.id}>
        <ConversationContent>
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
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>
      <Composer key={group.id} name={group.name} busy={typing.length > 0} autoFocus={!mobile} mentions={mentions} onSend={(text) => void send(text)} onStop={() => void stop()} />
    </>
  );
}
