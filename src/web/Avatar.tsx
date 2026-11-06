import { CloudflareLogo } from "@cloudflare/kumo";
import type { CSSProperties } from "react";

const palette = [
  { main: "#ff5e1f", accent: "#ff9911" },
  { main: "#2fa88f", accent: "#6fd3bd" },
  { main: "#5b5ff0", accent: "#9395f7" },
  { main: "#2f7bf0", accent: "#7fb2f8" },
  { main: "#8b5cf6", accent: "#bda3fb" },
  { main: "#e0528a", accent: "#f08fb5" },
];

function colorsOf(index: number) {
  return palette[index % palette.length] ?? { main: "#ff5e1f", accent: "#ff9911" };
}

export function colorOf(index: number): string {
  return colorsOf(index).main;
}

export function Avatar({ index, size = 32 }: { index: number; size?: number }) {
  const { main, accent } = colorsOf(index);
  const colors = { "--bot-main": main, "--bot-accent": accent } as CSSProperties;
  return (
    <span style={{ ...colors, width: size, height: size }} className="grid shrink-0 place-items-center">
      <CloudflareLogo variant="glyph" aria-hidden="true" width={size} className="h-auto [&_path:first-of-type]:fill-(--bot-main) [&_path:last-of-type]:fill-(--bot-accent)" />
    </span>
  );
}
