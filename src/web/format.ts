export function formatClock(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function formatListTime(at: number): string {
  const date = new Date(at);
  if (date.toDateString() === new Date().toDateString()) return formatClock(at);
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}
