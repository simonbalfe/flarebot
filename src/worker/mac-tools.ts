import { Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-durable";
import { macName } from "./env";
import type { MacAction } from "./mac";
import type { BotStore } from "./tools";

function text(value: string) {
  return { output: [{ type: "text" as const, text: value }] };
}

export const macPrompt =
  "You can use the user's own Mac with mac_run, mac_read, mac_write, mac_list and mac_open. The user approves every action in a dialog on the Mac, and only folders the user allowed work; mac_list with no path shows them. Use the Mac only when the task needs the user's own machine, files, repos or apps, and prefer the shared computer otherwise. A denied action is final: tell the user and never retry it another way. Never read or print secrets, keys or credentials from the Mac.";

export function macTools(env: Env, store: Pick<BotStore, "profile" | "macAccess">) {
  const ask = async (action: MacAction) => {
    if (!store.macAccess()) return text("Failed: Mac access is off for you. The user can switch it on in your Details.");
    const profile = store.profile();
    const result = await env.MAC.getByName(macName).request({ id: profile.id, name: profile.name }, action);
    return text(result.ok ? result.output : `Failed: ${result.error}`);
  };

  return [
    defineTool({
      name: "mac_run",
      description: "Run a shell command on the user's Mac after they approve it. cwd must be inside an allowed folder and defaults to the first one. Times out after 120 seconds.",
      parameters: Type.Object({ command: Type.String(), cwd: Type.Optional(Type.String()) }),
      replay: "unsafe",
      execute: ({ command, cwd }) => ask({ type: "run", command, cwd: cwd ?? null }),
    }),
    defineTool({
      name: "mac_read",
      description: "Read a text file on the user's Mac, inside an allowed folder, after they approve it.",
      parameters: Type.Object({ path: Type.String() }),
      replay: "unsafe",
      execute: ({ path }) => ask({ type: "read", path }),
    }),
    defineTool({
      name: "mac_write",
      description: "Create or replace a text file on the user's Mac, inside an allowed folder, after they approve it.",
      parameters: Type.Object({ path: Type.String(), content: Type.String() }),
      replay: "unsafe",
      execute: ({ path, content }) => ask({ type: "write", path, content }),
    }),
    defineTool({
      name: "mac_list",
      description: "List a folder on the user's Mac, inside an allowed folder, after they approve it. With no path, list the allowed folders.",
      parameters: Type.Object({ path: Type.Optional(Type.String()) }),
      replay: "unsafe",
      execute: ({ path }) => ask({ type: "list", path: path ?? "" }),
    }),
    defineTool({
      name: "mac_open",
      description: "Open an http(s) URL in the Mac's default browser, or a file or folder inside an allowed folder, after the user approves it.",
      parameters: Type.Object({ target: Type.String() }),
      replay: "unsafe",
      execute: ({ target }) => ask({ type: "open", target }),
    }),
  ];
}
