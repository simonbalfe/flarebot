import { CaretDownIcon, CheckCircleIcon, ClockIcon, WrenchIcon } from "@phosphor-icons/react";
import { cn } from "cn";
import type { ComponentProps, ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Shimmer } from "./shimmer";

export type ToolState = "running" | "done";

export type ToolProps = ComponentProps<typeof Collapsible>;

export const Tool = ({ className, ...props }: ToolProps) => (
  <Collapsible className={cn("group/tool fb-continuous my-0.5 w-full max-w-[min(76%,720px)] self-start rounded-[18px] bg-fb-bot max-md:max-w-[92%]", className)} {...props} />
);

const statusLabels: Record<ToolState, string> = { running: "Running", done: "Done" };

const statusIcons: Record<ToolState, ReactNode> = {
  running: <ClockIcon size={12} className="animate-pulse" />,
  done: <CheckCircleIcon size={12} weight="fill" className="text-fb-preview" />,
};

export const ToolStatus = ({ state }: { state: ToolState }) => (
  <Badge variant="secondary" className="fb-caption h-5 gap-1 rounded-full border-0 bg-fb-active px-1.5 text-fb-preview">
    {statusIcons[state]}
    {statusLabels[state]}
  </Badge>
);

export type ToolHeaderProps = { title: string; state: ToolState; className?: string };

export const ToolHeader = ({ className, title, state }: ToolHeaderProps) => (
  <CollapsibleTrigger className={cn("fb-callout flex w-full cursor-pointer items-center justify-between gap-3 px-3 py-2 text-left", className)}>
    <span className="flex min-w-0 items-center gap-2">
      <WrenchIcon size={14} className="shrink-0 text-fb-preview" />
      {state === "running" ? <Shimmer className="truncate font-medium">{title}</Shimmer> : <span className="truncate font-medium">{title}</span>}
      <ToolStatus state={state} />
    </span>
    <CaretDownIcon size={12} className="shrink-0 text-fb-preview transition-transform group-data-[state=open]/tool:rotate-180" />
  </CollapsibleTrigger>
);

export type ToolContentProps = ComponentProps<typeof CollapsibleContent>;

export const ToolContent = ({ className, ...props }: ToolContentProps) => (
  <CollapsibleContent className={cn("flex flex-col gap-1.5 px-3 pb-2.5", className)} {...props} />
);

export type ToolInputProps = ComponentProps<"div"> & { name: string; input: string };

export const ToolInput = ({ className, name, input, ...props }: ToolInputProps) => (
  <div className={cn("rounded-[10px] bg-fb-active px-2.5 py-1.5", className)} {...props}>
    <code className="font-mono text-xs break-all text-fb-preview">
      <span className="font-semibold text-fb-text">{name}</span> {input}
    </code>
  </div>
);
