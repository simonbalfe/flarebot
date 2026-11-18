import { cn } from "cn";
import { type HTMLAttributes, memo } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

const remarkPlugins = [remarkGfm];

export type MessageRole = "user" | "assistant";

export type MessageProps = HTMLAttributes<HTMLDivElement> & {
  from: MessageRole;
};

export const Message = ({ className, from, ...props }: MessageProps) => (
  <div className={cn("group flex w-full flex-col", from === "user" ? "is-user items-end" : "is-assistant items-start", className)} {...props} />
);

export type MessageContentProps = HTMLAttributes<HTMLDivElement>;

export const MessageContent = ({ className, ...props }: MessageContentProps) => (
  <div
    className={cn(
      "fb-bubble fb-prose",
      "group-[.is-user]:whitespace-pre-wrap group-[.is-user]:bg-fb-me group-[.is-user]:text-fb-me-text",
      "group-[.is-assistant]:bg-fb-bot group-[.is-assistant]:text-fb-text",
      className,
    )}
    {...props}
  />
);

export type MessageResponseProps = { children: string };

export const MessageResponse = memo(({ children }: MessageResponseProps) => <Markdown remarkPlugins={remarkPlugins}>{children}</Markdown>);

MessageResponse.displayName = "MessageResponse";
