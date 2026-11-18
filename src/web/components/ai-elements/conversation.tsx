import { ArrowDownIcon } from "@phosphor-icons/react";
import { cn } from "cn";
import type { ComponentProps } from "react";
import { StickToBottom, useStickToBottomContext } from "use-stick-to-bottom";
import { Button } from "@/components/ui/button";

export type ConversationProps = ComponentProps<typeof StickToBottom>;

export const Conversation = ({ className, ...props }: ConversationProps) => (
  <StickToBottom className={cn("relative min-h-0 flex-1 overflow-y-hidden", className)} initial="instant" resize="smooth" role="log" {...props} />
);

export type ConversationContentProps = ComponentProps<typeof StickToBottom.Content>;

export const ConversationContent = ({ className, scrollClassName, ...props }: ConversationContentProps) => (
  <StickToBottom.Content
    scrollClassName={cn("[scrollbar-width:none]", scrollClassName)}
    className={cn("flex min-h-full w-full flex-col gap-1.5 px-3 py-4 md:px-5", className)}
    {...props}
  />
);

export type ConversationEmptyStateProps = ComponentProps<"div">;

export const ConversationEmptyState = ({ className, ...props }: ConversationEmptyStateProps) => (
  <div className={cn("grid flex-1 place-items-center", className)} {...props} />
);

export type ConversationScrollButtonProps = ComponentProps<typeof Button>;

export const ConversationScrollButton = ({ className, ...props }: ConversationScrollButtonProps) => {
  const { isAtBottom, scrollToBottom } = useStickToBottomContext();
  if (isAtBottom) return null;
  return (
    <Button
      aria-label="Scroll to latest"
      className={cn("absolute bottom-3 left-1/2 size-8 -translate-x-1/2 p-0 shadow-md", className)}
      onClick={() => void scrollToBottom()}
      size="icon"
      type="button"
      variant="secondary"
      {...props}
    >
      <ArrowDownIcon size={14} weight="bold" />
    </Button>
  );
};
