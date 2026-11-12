import { CloudflareLogo } from "@cloudflare/kumo";
import type { CSSProperties } from "react";

export const palette = [
  { main: "#ff5e1f", accent: "#ff9911" },
  { main: "#2fa88f", accent: "#6fd3bd" },
  { main: "#5b5ff0", accent: "#9395f7" },
  { main: "#2f7bf0", accent: "#7fb2f8" },
  { main: "#8b5cf6", accent: "#bda3fb" },
  { main: "#e0528a", accent: "#f08fb5" },
];

export function botColors(index: number): { main: string; accent: string } {
  return palette[index % palette.length] ?? { main: "#ff5e1f", accent: "#ff9911" };
}

export function colorOf(index: number): string {
  return botColors(index).main;
}

export interface MentionOption {
  name: string;
  index: number | null;
}

export function botMentions(bots: { name: string }[]): MentionOption[] {
  return bots.map((bot, index) => ({ name: bot.name, index }));
}

export function Avatar({ index, size = 32 }: { index: number; size?: number }) {
  const { main, accent } = botColors(index);
  const colors = { "--bot-main": main, "--bot-accent": accent } as CSSProperties;
  return (
    <span style={{ ...colors, width: size, height: size }} className="grid shrink-0 place-items-center">
      <CloudflareLogo variant="glyph" aria-hidden="true" width={size} className="h-auto [&_path:first-of-type]:fill-(--bot-main) [&_path:last-of-type]:fill-(--bot-accent)" />
    </span>
  );
}

export function MentionChip({ mention }: { mention: MentionOption }) {
  if (mention.index === null) {
    return <span className="inline-flex items-center rounded-full bg-fb-pane px-1.5 align-baseline font-semibold text-fb-text">@{mention.name}</span>;
  }
  return (
    <span style={{ color: colorOf(mention.index) }} className="inline-flex items-center gap-1 rounded-full bg-fb-pane px-1.5 align-baseline font-semibold">
      <Avatar index={mention.index} size={16} />
      {mention.name}
    </span>
  );
}
