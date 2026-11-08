const everyonePattern = /@everyone(?![\w-])/i;

function escaped(name: string): string {
  return name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function atMentioned<T extends { name: string }>(text: string, bots: T[]): T[] {
  if (everyonePattern.test(text)) return bots;
  return bots.filter((bot) => new RegExp(`@${escaped(bot.name)}(?![\\w-])`, "i").test(text));
}

export function namedInText<T extends { name: string }>(text: string, bots: T[]): T[] {
  return bots.filter((bot) => new RegExp(`(?<![\\w-])${escaped(bot.name)}(?![\\w@-])`, "i").test(text));
}
