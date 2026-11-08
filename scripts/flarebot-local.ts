#!/usr/bin/env bun

import { spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { homedir, hostname } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { parseArgs } from "node:util";

type MacAction =
  | { type: "run"; command: string; cwd: string | null }
  | { type: "read"; path: string }
  | { type: "write"; path: string; content: string }
  | { type: "list"; path: string }
  | { type: "open"; target: string };

type MacResult = { ok: true; output: string } | { ok: false; error: string };

interface Request {
  type: "request";
  id: string;
  bot: { id: string; name: string };
  action: MacAction;
}

interface Config {
  url: string;
  token: string;
  name: string;
  roots: string[];
  alwaysAllow: string[];
}

const configDir = join(homedir(), ".config", "flarebot-local");
const configPath = join(configDir, "config.json");
const commandTimeoutMs = 120_000;
const dialogTimeoutSeconds = 120;
const maxOutputChars = 30_000;
const maxReadBytes = 1_000_000;
const maxDialogChars = 600;
const reconnectBaseMs = 1_000;
const reconnectMaxMs = 60_000;
const blockedCommand = /(^|[\s;&|(])sudo\b/;

const usage = `Usage:
  bun scripts/flarebot-local.ts pair --url <app url> --code <pairing code> [--name <name>]
  bun scripts/flarebot-local.ts allow <folder>
  bun scripts/flarebot-local.ts disallow <folder>
  bun scripts/flarebot-local.ts forget-always
  bun scripts/flarebot-local.ts status
  bun scripts/flarebot-local.ts run`;

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { url: { type: "string" }, code: { type: "string" }, name: { type: "string" } },
});

const [command, argument] = positionals;
switch (command) {
  case "pair":
    await pair();
    break;
  case "allow":
    changeRoots(argument, true);
    break;
  case "disallow":
    changeRoots(argument, false);
    break;
  case "forget-always":
    saveConfig({ ...loadConfig(), alwaysAllow: [] });
    console.log("Every Bot needs approval again.");
    break;
  case "status": {
    const config = loadConfig();
    console.log(JSON.stringify({ url: config.url, name: config.name, roots: config.roots, alwaysAllow: config.alwaysAllow }, null, 2));
    break;
  }
  case "run":
    connect(loadConfig(), 0);
    break;
  default:
    console.log(usage);
    process.exit(command === undefined ? 0 : 1);
}

function loadConfig(): Config {
  if (!existsSync(configPath)) throw new Error("Not paired. Run the pair command first.");
  const parsed: unknown = JSON.parse(readFileSync(configPath, "utf8"));
  if (typeof parsed !== "object" || parsed === null || !("url" in parsed) || !("token" in parsed)) throw new Error(`Invalid config at ${configPath}`);
  const config = parsed as Partial<Config> & { url: string; token: string };
  return { url: config.url, token: config.token, name: config.name ?? hostname(), roots: config.roots ?? [], alwaysAllow: config.alwaysAllow ?? [] };
}

function saveConfig(config: Config): void {
  mkdirSync(configDir, { recursive: true, mode: 0o700 });
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  chmodSync(configPath, 0o600);
}

async function pair(): Promise<void> {
  if (values.url === undefined || values.code === undefined) throw new Error(usage);
  const url = values.url.replace(/\/+$/, "");
  const name = values.name ?? hostname();
  const response = await fetch(`${url}/api/mac/pair`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: values.code, name }) });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok || typeof body !== "object" || body === null || !("token" in body) || typeof body.token !== "string") {
    throw new Error(`Pairing failed with HTTP ${response.status}: ${JSON.stringify(body)}`);
  }
  const previous = existsSync(configPath) ? loadConfig() : null;
  saveConfig({ url, token: body.token, name, roots: previous?.roots ?? [], alwaysAllow: [] });
  console.log(`Paired as ${name}. Allow a folder with the allow command, then start the run command.`);
}

function changeRoots(folder: string | undefined, add: boolean): void {
  if (folder === undefined) throw new Error(usage);
  const config = loadConfig();
  const root = realpathSync(resolve(expandHome(folder)));
  if (add && !statSync(root).isDirectory()) throw new Error(`${root} is not a folder`);
  if (add && root === homedir()) throw new Error("Allow a folder inside your home folder, not all of it");
  const roots = add ? [...new Set([...config.roots, root])] : config.roots.filter((current) => current !== root);
  saveConfig({ ...config, roots });
  console.log(JSON.stringify(roots, null, 2));
}

function connect(config: Config, attempt: number): void {
  const url = `${config.url.replace(/^http/, "ws")}/api/mac/connect`;
  const socket = new WebSocket(url, { headers: { authorization: `Bearer ${config.token}` } });
  let queue: Promise<void> = Promise.resolve();
  let opened = false;

  socket.addEventListener("open", () => {
    opened = true;
    console.log(`Connected to ${config.url} with ${config.roots.length} allowed folders.`);
    socket.send(JSON.stringify({ type: "hello", name: config.name, roots: config.roots }));
  });

  socket.addEventListener("message", (event) => {
    const request = parseRequest(event.data);
    if (request === null) return;
    queue = queue.then(async () => {
      const result = await handle(loadConfig(), request).catch((error: unknown): MacResult => ({ ok: false, error: error instanceof Error ? error.message : String(error) }));
      console.log(`${new Date().toISOString()} ${request.bot.name} ${request.action.type}: ${result.ok ? "done" : result.error}`);
      socket.send(JSON.stringify({ type: "result", id: request.id, result }));
    });
  });

  socket.addEventListener("close", (event) => {
    const next = opened ? 0 : attempt + 1;
    const delay = Math.min(reconnectMaxMs, reconnectBaseMs * 2 ** next);
    console.log(`Disconnected (${event.code}${event.reason === "" ? "" : ` ${event.reason}`}). Reconnecting in ${Math.round(delay / 1000)}s.`);
    setTimeout(() => connect(loadConfig(), next), delay);
  });
}

function parseRequest(data: unknown): Request | null {
  if (typeof data !== "string") return null;
  const parsed: unknown = JSON.parse(data);
  if (typeof parsed !== "object" || parsed === null || !("type" in parsed) || parsed.type !== "request") return null;
  return parsed as Request;
}

async function handle(config: Config, request: Request): Promise<MacResult> {
  const { action, bot } = request;
  if (action.type === "run" && blockedCommand.test(action.command)) return { ok: false, error: "sudo is never allowed" };
  if (config.roots.length === 0) return { ok: false, error: "No folders are allowed on this Mac yet" };
  const checked = checkAction(config, action);
  if (!checked.ok) return checked;
  const decision = config.alwaysAllow.includes(bot.id) ? "allow" : await approve(bot.name, describe(action));
  if (decision === "deny") return { ok: false, error: "The user denied this on the Mac" };
  if (decision === "always") saveConfig({ ...config, alwaysAllow: [...new Set([...config.alwaysAllow, bot.id])] });
  return execute(config, action);
}

function checkAction(config: Config, action: MacAction): MacResult {
  try {
    if (action.type === "run") inRoot(config, action.cwd ?? config.roots[0] ?? "", false);
    if (action.type === "read") inRoot(config, action.path, false);
    if (action.type === "write") inRoot(config, action.path, true);
    if (action.type === "list" && action.path !== "") inRoot(config, action.path, false);
    if (action.type === "open" && !/^https?:\/\//.test(action.target)) inRoot(config, action.target, false);
    return { ok: true, output: "" };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function expandHome(path: string): string {
  return path === "~" ? homedir() : path.startsWith("~/") ? join(homedir(), path.slice(2)) : path;
}

function inRoot(config: Config, path: string, forWrite: boolean): string {
  const expanded = expandHome(path);
  if (!isAbsolute(expanded)) throw new Error(`Use an absolute path. Allowed folders: ${config.roots.join(", ")}`);
  const target = resolve(expanded);
  const existing = forWrite && !existsSync(target) ? join(realpathSync(nearestExisting(dirname(target))), target.slice(nearestExisting(dirname(target)).length)) : realpathSync(target);
  if (!config.roots.some((root) => existing === root || existing.startsWith(`${root}/`))) throw new Error(`${path} is outside the allowed folders: ${config.roots.join(", ")}`);
  return existing;
}

function nearestExisting(path: string): string {
  let current = path;
  while (!existsSync(current)) current = dirname(current);
  return current;
}

function describe(action: MacAction): string {
  const clip = (value: string) => (value.length > maxDialogChars ? `${value.slice(0, maxDialogChars)}…` : value);
  switch (action.type) {
    case "run":
      return `run in ${action.cwd ?? "the first allowed folder"}:\n\n${clip(action.command)}`;
    case "read":
      return `read ${action.path}`;
    case "write":
      return `write ${action.content.length} characters to ${action.path}`;
    case "list":
      return action.path === "" ? "list the allowed folders" : `list ${action.path}`;
    case "open":
      return `open ${clip(action.target)}`;
  }
}

function approve(botName: string, description: string): Promise<"allow" | "always" | "deny"> {
  const script = [
    "on run argv",
    `set answer to display dialog (item 1 of argv) with title "flarebot" buttons {"Deny", "Allow once", item 2 of argv} default button "Deny" cancel button "Deny" giving up after ${dialogTimeoutSeconds}`,
    "if gave up of answer then return \"Deny\"",
    "return button returned of answer",
    "end run",
  ];
  const args = script.flatMap((line) => ["-e", line]);
  return new Promise((resolveDecision) => {
    const child = spawn("osascript", [...args, `${botName} wants to ${description}`, `Always allow ${botName}`]);
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.on("close", () => {
      const answer = output.trim();
      resolveDecision(answer === "Allow once" ? "allow" : answer.startsWith("Always allow") ? "always" : "deny");
    });
    child.on("error", () => resolveDecision("deny"));
  });
}

async function execute(config: Config, action: MacAction): Promise<MacResult> {
  switch (action.type) {
    case "run":
      return runCommand(action.command, inRoot(config, action.cwd ?? config.roots[0] ?? "", false));
    case "read": {
      const path = inRoot(config, action.path, false);
      if (statSync(path).size > maxReadBytes) return { ok: false, error: `${action.path} is over ${maxReadBytes} bytes` };
      return { ok: true, output: clip(readFileSync(path, "utf8")) };
    }
    case "write": {
      const path = inRoot(config, action.path, true);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, action.content);
      return { ok: true, output: `Wrote ${action.content.length} characters to ${path}` };
    }
    case "list": {
      if (action.path === "") return { ok: true, output: config.roots.join("\n") };
      const path = inRoot(config, action.path, false);
      const entries = readdirSync(path, { withFileTypes: true }).map((entry) => `${entry.isDirectory() ? "dir " : "file"} ${entry.name}`);
      return { ok: true, output: clip(entries.join("\n") || "(empty)") };
    }
    case "open": {
      const target = /^https?:\/\//.test(action.target) ? action.target : inRoot(config, action.target, false);
      return runProcess("open", [target], undefined);
    }
  }
}

function runCommand(command: string, cwd: string): Promise<MacResult> {
  return runProcess("/bin/zsh", ["-l", "-c", command], cwd);
}

function runProcess(file: string, args: string[], cwd: string | undefined): Promise<MacResult> {
  return new Promise((resolveResult) => {
    const child = spawn(file, args, { cwd, timeout: commandTimeoutMs, killSignal: "SIGKILL" });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => resolveResult({ ok: false, error: error.message }));
    child.on("close", (code, signal) => {
      const parts = [`exit code: ${code ?? signal ?? "unknown"}`, stdout.trim() && `stdout:\n${clip(stdout)}`, stderr.trim() && `stderr:\n${clip(stderr)}`];
      resolveResult({ ok: true, output: parts.filter(Boolean).join("\n") });
    });
  });
}

function clip(value: string): string {
  return value.length > maxOutputChars ? `${value.slice(0, maxOutputChars)}\n… clipped` : value;
}
