#!/usr/bin/env bun

import { spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync, unlinkSync, watchFile, writeFileSync } from "node:fs";
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

interface ModelTurn {
  type: "model-turn";
  id: string;
  body: string;
}

interface ModelCancel {
  type: "model-cancel";
  id: string;
}

type Incoming = Request | ModelTurn | ModelCancel;

interface Config {
  url: string;
  token: string | null;
  name: string;
  roots: string[];
  alwaysAllow: string[];
}

type LinkPoll = { status: "pending" } | { status: "expired" } | { status: "linked"; token: string };

const configDir = join(homedir(), ".config", "flarebot-local");
const configPath = join(configDir, "config.json");
const lockPath = join(configDir, "daemon.pid");
const commandTimeoutMs = 120_000;
const dialogTimeoutSeconds = 120;
const maxOutputChars = 30_000;
const maxReadBytes = 1_000_000;
const maxDialogChars = 600;
const reconnectBaseMs = 1_000;
const reconnectMaxMs = 60_000;
const linkPollMs = 2_000;
const configWatchMs = 2_000;
const blockedCommand = /(^|[\s;&|(])sudo\b/;
const unlinkedReasons = ["Unpaired", "Linked again"];
const homeDir = join(homedir(), ".flarebot-local");
const modelServerDir = join(homeDir, "model-server");
const modelServerFiles = ["server.ts", "package.json", "package-lock.json"];
const modelServerPort = 48789;
const modelServerStartMs = 30_000;
const modelServerRestartMs = 5_000;
const installTimeoutMs = 600_000;
const claudeCheckMs = 60_000;
const claudeStatusTimeoutMs = 15_000;
const healthTimeoutMs = 2_000;
const healthPollMs = 500;
const turnChunkChars = 200_000;
const modelServerSecrets = ["CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"];

const usage = `Usage:
  flarebot-local run [--url <app url>]
  flarebot-local add-folder
  flarebot-local allow <folder>
  flarebot-local disallow <folder>
  flarebot-local forget-always
  flarebot-local unlink
  flarebot-local status`;

const { positionals, values } = parseArgs({ allowPositionals: true, options: { url: { type: "string" } } });

let activeSocket: WebSocket | null = null;
const modelTurns = new Map<string, AbortController>();

const [command, argument] = positionals;
switch (command) {
  case "run":
    await runDaemon();
    break;
  case "add-folder": {
    const config = loadConfig();
    const folder = await pickFolder("Choose another folder flarebot can use on this Mac");
    if (folder !== null) saveConfig({ ...config, roots: [...new Set([...config.roots, folder])] });
    console.log(JSON.stringify(loadConfig().roots, null, 2));
    break;
  }
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
  case "unlink":
    saveConfig({ ...loadConfig(), token: null });
    console.log("Unlinked. The next run asks to connect again.");
    break;
  case "status": {
    const config = loadConfig();
    console.log(JSON.stringify({ url: config.url, name: config.name, linked: config.token !== null, roots: config.roots, alwaysAllow: config.alwaysAllow }, null, 2));
    break;
  }
  default:
    console.log(usage);
    process.exit(command === undefined ? 0 : 1);
}

function loadConfig(): Config {
  if (!existsSync(configPath)) throw new Error("Not set up yet. Start it with: flarebot-local run --url <app url>");
  const parsed: unknown = JSON.parse(readFileSync(configPath, "utf8"));
  if (typeof parsed !== "object" || parsed === null || !("url" in parsed) || typeof parsed.url !== "string") throw new Error(`Invalid config at ${configPath}`);
  const config = parsed as Partial<Config> & { url: string };
  return { url: config.url, token: config.token ?? null, name: config.name ?? hostname(), roots: config.roots ?? [], alwaysAllow: config.alwaysAllow ?? [] };
}

function saveConfig(config: Config): void {
  mkdirSync(configDir, { recursive: true, mode: 0o700 });
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  chmodSync(configPath, 0o600);
}

function startingConfig(): Config {
  const url = values.url?.replace(/\/+$/, "");
  if (existsSync(configPath)) {
    const config = loadConfig();
    if (url === undefined || url === config.url) return config;
    return { ...config, url, token: null };
  }
  if (url === undefined) throw new Error(usage);
  return { url, token: null, name: hostname(), roots: [], alwaysAllow: [] };
}

function validRoot(folder: string): string | null {
  const root = realpathSync(resolve(expandHome(folder)));
  if (!statSync(root).isDirectory() || root === "/" || root === homedir() || !root.startsWith(`${homedir()}/`)) return null;
  return root;
}

function changeRoots(folder: string | undefined, add: boolean): void {
  if (folder === undefined) throw new Error(usage);
  const config = loadConfig();
  const root = add ? validRoot(folder) : realpathSync(resolve(expandHome(folder)));
  if (root === null) throw new Error("Allow a folder inside your home folder, not your whole home folder");
  const roots = add ? [...new Set([...config.roots, root])] : config.roots.filter((current) => current !== root);
  saveConfig({ ...config, roots });
  console.log(JSON.stringify(roots, null, 2));
}

async function runDaemon(): Promise<void> {
  if (!acquireLock()) {
    console.log("flarebot-local is already running.");
    process.exit(0);
  }
  let config = startingConfig();
  saveConfig(config);
  config = await ensureFolder(config);
  config = await ensureLinked(config);
  watchFile(configPath, { interval: configWatchMs }, () => void sendHello(loadConfig()));
  setInterval(() => void sendHello(loadConfig()), claudeCheckMs);
  process.on("SIGTERM", () => process.exit(0));
  process.on("SIGINT", () => process.exit(0));
  void startModelServer(config);
  connect(config, 0);
}

async function modelServerHealthy(): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${modelServerPort}/health`, { signal: AbortSignal.timeout(healthTimeoutMs) });
    return response.ok && (await response.text()) === "ok";
  } catch {
    return false;
  }
}

async function claudeReady(): Promise<boolean> {
  if (!(await modelServerHealthy())) return false;
  const status = await runProcess("/bin/zsh", ["-l", "-c", "claude auth status"], undefined, claudeStatusTimeoutMs);
  return status.ok && /"loggedIn":\s*true/.test(status.output);
}

function succeeded(result: MacResult): boolean {
  return result.ok && result.output.startsWith("exit code: 0");
}

async function installModelServer(appUrl: string): Promise<void> {
  mkdirSync(modelServerDir, { recursive: true });
  let changed = !existsSync(join(modelServerDir, "node_modules"));
  for (const file of modelServerFiles) {
    const response = await fetch(`${appUrl}/mac/model-server/${file}`);
    if (!response.ok) throw new Error(`Could not download ${file}: HTTP ${response.status}`);
    const content = await response.text();
    const path = join(modelServerDir, file);
    if (existsSync(path) && readFileSync(path, "utf8") === content) continue;
    writeFileSync(path, content);
    if (file !== "server.ts") changed = true;
  }
  if (!changed) return;
  await notify("Installing the Claude relay for flarebot. This takes a minute.");
  const install = await runProcess("/bin/zsh", ["-l", "-c", "npm ci --ignore-scripts --no-audit --no-fund"], modelServerDir, installTimeoutMs);
  if (!succeeded(install)) throw new Error(install.ok ? install.output : install.error);
}

function spawnModelServer(): void {
  const env: Record<string, string | undefined> = { ...process.env, PORT: String(modelServerPort), HOST: "127.0.0.1", SESSIONS_DIR: join(homeDir, "sessions"), PI_CODING_AGENT_DIR: join(homeDir, "pi-agent") };
  for (const name of modelServerSecrets) delete env[name];
  const child = spawn("/bin/zsh", ["-l", "-c", "exec node --import tsx server.ts"], { cwd: modelServerDir, env, stdio: ["ignore", "inherit", "inherit"] });
  process.on("exit", () => child.kill());
  child.on("exit", (code, signal) => {
    console.log(`The Claude server stopped (${code ?? signal}). Restarting in ${modelServerRestartMs / 1000}s.`);
    setTimeout(spawnModelServer, modelServerRestartMs);
  });
}

async function waitForModelServer(): Promise<boolean> {
  const deadline = Date.now() + modelServerStartMs;
  while (Date.now() < deadline) {
    if (await modelServerHealthy()) return true;
    await Bun.sleep(healthPollMs);
  }
  return false;
}

async function startModelServer(config: Config): Promise<void> {
  try {
    await installModelServer(config.url);
    if (!(await modelServerHealthy())) spawnModelServer();
    if (!(await waitForModelServer())) throw new Error(`The Claude server did not start on port ${modelServerPort}. Another program may be using it.`);
    console.log("The Claude server is running.");
    await sendHello(loadConfig());
  } catch (error) {
    console.log(`The Claude relay is unavailable: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function splitTurnText(text: string): string[] {
  const parts: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + turnChunkChars, text.length);
    const last = text.charCodeAt(end - 1);
    if (end < text.length && last >= 0xd800 && last <= 0xdbff) end -= 1;
    parts.push(text.slice(start, end));
    start = end;
  }
  return parts;
}

async function relayModelTurn(socket: WebSocket, turn: ModelTurn): Promise<void> {
  const controller = new AbortController();
  modelTurns.set(turn.id, controller);
  const send = (message: object): void => {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
  };
  try {
    const response = await fetch(`http://127.0.0.1:${modelServerPort}/claude/turn`, { method: "POST", headers: { "content-type": "application/json" }, body: turn.body, signal: controller.signal });
    if (!response.ok || !response.body) throw new Error(`The Claude server answered ${response.status}`);
    const decoder = new TextDecoder();
    let buffer = "";
    for await (const chunk of response.body) {
      buffer += decoder.decode(chunk, { stream: true });
      const end = buffer.lastIndexOf("\n");
      if (end < 0) continue;
      for (const part of splitTurnText(buffer.slice(0, end + 1))) send({ type: "model-chunk", id: turn.id, data: part });
      buffer = buffer.slice(end + 1);
    }
    send({ type: "model-end", id: turn.id });
  } catch (error) {
    if (!controller.signal.aborted) send({ type: "model-end", id: turn.id, error: error instanceof Error ? error.message : String(error) });
  } finally {
    modelTurns.delete(turn.id);
  }
}

function acquireLock(): boolean {
  mkdirSync(configDir, { recursive: true, mode: 0o700 });
  if (existsSync(lockPath)) {
    const pid = Number(readFileSync(lockPath, "utf8"));
    if (Number.isInteger(pid) && pid !== process.pid && processAlive(pid)) return false;
  }
  writeFileSync(lockPath, String(process.pid));
  process.on("exit", () => {
    if (existsSync(lockPath) && readFileSync(lockPath, "utf8") === String(process.pid)) unlinkSync(lockPath);
  });
  return true;
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function ensureFolder(config: Config): Promise<Config> {
  if (config.roots.length > 0) return config;
  while (true) {
    const folder = await pickFolder("Choose a folder flarebot can use on this Mac. Bots can only touch files inside it, and you approve every action.");
    if (folder === null) {
      const choice = await osascript(
        ["activate", `set answer to display dialog "flarebot needs a folder on this Mac to work in." with title "flarebot" buttons {"Quit", "Choose folder"} default button "Choose folder"`, "return button returned of answer"],
        [],
      );
      if (choice === "Choose folder") continue;
      await notify("flarebot-local stopped because no folder was chosen. Run the installer again to set it up.");
      process.exit(0);
    }
    const root = validRoot(folder);
    if (root !== null) {
      const updated = { ...config, roots: [root] };
      saveConfig(updated);
      return updated;
    }
    await notify("Choose a folder inside your home folder, not your whole home folder.");
  }
}

async function ensureLinked(config: Config): Promise<Config> {
  if (config.token !== null && (await tokenState(config)) !== "rejected") return config;
  while (true) {
    const token = await link(config);
    if (token !== null) {
      const updated = { ...loadConfig(), token };
      saveConfig(updated);
      await notify(`This Mac is connected to flarebot as ${updated.name}.`);
      return updated;
    }
    const again = await osascript(
      ["activate", `set answer to display dialog "The connect request expired." with title "flarebot" buttons {"Quit", "Try again"} default button "Try again" giving up after ${dialogTimeoutSeconds}`, "return button returned of answer"],
      [],
    );
    if (again !== "Try again") process.exit(0);
  }
}

async function tokenState(config: Config): Promise<"valid" | "rejected" | "unknown"> {
  try {
    const response = await fetch(`${config.url}/api/mac/whoami`, { headers: { authorization: `Bearer ${config.token ?? ""}` } });
    if (response.status === 204) return "valid";
    return response.status === 401 ? "rejected" : "unknown";
  } catch {
    return "unknown";
  }
}

async function link(config: Config): Promise<string | null> {
  const response = await fetch(`${config.url}/api/mac/link`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: config.name }) });
  if (!response.ok) throw new Error(`Could not start connecting: HTTP ${response.status}`);
  const started = (await response.json()) as { deviceCode: string; userCode: string; verifyUrl: string };
  await runProcess("open", [started.verifyUrl], undefined);
  await notify(`Approve this Mac in your browser. Code: ${started.userCode}`);
  console.log(`Waiting for approval of ${started.userCode} at ${started.verifyUrl}`);
  while (true) {
    await Bun.sleep(linkPollMs);
    const poll = await fetch(`${config.url}/api/mac/link/poll`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ deviceCode: started.deviceCode }) })
      .then((result) => result.json() as Promise<LinkPoll>)
      .catch((): LinkPoll => ({ status: "pending" }));
    if (poll.status === "linked") return poll.token;
    if (poll.status === "expired") return null;
  }
}

async function unlinked(reason: string): Promise<never> {
  saveConfig({ ...loadConfig(), token: null });
  await notify(`This Mac was disconnected from flarebot (${reason}). Run the installer again to reconnect.`);
  process.exit(0);
}

async function sendHello(config: Config): Promise<void> {
  const socket = activeSocket;
  if (socket?.readyState !== WebSocket.OPEN) return;
  const claude = await claudeReady();
  if (socket.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify({ type: "hello", name: config.name, roots: config.roots, claude }));
}

function connect(config: Config, attempt: number): void {
  const url = `${config.url.replace(/^http/, "ws")}/api/mac/connect`;
  const socket = new WebSocket(url, { headers: { authorization: `Bearer ${config.token ?? ""}` } });
  activeSocket = socket;
  let queue: Promise<void> = Promise.resolve();
  let opened = false;

  socket.addEventListener("open", () => {
    opened = true;
    console.log(`Connected to ${config.url} with ${config.roots.length} allowed folders.`);
    void sendHello(config);
  });

  socket.addEventListener("message", (event) => {
    const request = parseIncoming(event.data);
    if (request === null) return;
    if (request.type === "model-turn") {
      void relayModelTurn(socket, request);
      return;
    }
    if (request.type === "model-cancel") {
      modelTurns.get(request.id)?.abort();
      return;
    }
    queue = queue.then(async () => {
      const result = await handle(loadConfig(), request).catch((error: unknown): MacResult => ({ ok: false, error: error instanceof Error ? error.message : String(error) }));
      console.log(`${new Date().toISOString()} ${request.bot.name} ${request.action.type}: ${result.ok ? "done" : result.error}`);
      socket.send(JSON.stringify({ type: "result", id: request.id, result }));
    });
  });

  socket.addEventListener("close", async (event) => {
    if (activeSocket === socket) activeSocket = null;
    for (const turn of modelTurns.values()) turn.abort();
    if (unlinkedReasons.includes(event.reason)) await unlinked(event.reason);
    if (!opened && (await tokenState(loadConfig())) === "rejected") await unlinked("the link was removed");
    const next = opened ? 0 : attempt + 1;
    const delay = Math.min(reconnectMaxMs, reconnectBaseMs * 2 ** next);
    console.log(`Disconnected (${event.code}${event.reason === "" ? "" : ` ${event.reason}`}). Reconnecting in ${Math.round(delay / 1000)}s.`);
    setTimeout(() => connect(loadConfig(), next), delay);
  });
}

async function pickFolder(prompt: string): Promise<string | null> {
  const chosen = await osascript(["activate", "try", "return POSIX path of (choose folder with prompt (item 1 of argv))", "on error", 'return ""', "end try"], [prompt]);
  return chosen === "" ? null : chosen.replace(/\/$/, "");
}

async function notify(message: string): Promise<void> {
  console.log(message);
  await osascript(['display notification (item 1 of argv) with title "flarebot"'], [message]);
}

function osascript(body: string[], args: string[]): Promise<string> {
  const lines = ["on run argv", ...body, "end run"];
  return new Promise((resolveOutput) => {
    const child = spawn("osascript", [...lines.flatMap((line) => ["-e", line]), ...args]);
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.on("close", () => resolveOutput(output.trim()));
    child.on("error", () => resolveOutput(""));
  });
}

function parseIncoming(data: unknown): Incoming | null {
  if (typeof data !== "string") return null;
  const parsed: unknown = JSON.parse(data);
  if (typeof parsed !== "object" || parsed === null || !("type" in parsed)) return null;
  return parsed.type === "request" || parsed.type === "model-turn" || parsed.type === "model-cancel" ? (parsed as Incoming) : null;
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

async function approve(botName: string, description: string): Promise<"allow" | "always" | "deny"> {
  const answer = await osascript(
    [
      "activate",
      `set answer to display dialog (item 1 of argv) with title "flarebot" buttons {"Deny", "Allow once", item 2 of argv} default button "Deny" cancel button "Deny" giving up after ${dialogTimeoutSeconds}`,
      'if gave up of answer then return "Deny"',
      "return button returned of answer",
    ],
    [`${botName} wants to ${description}`, `Always allow ${botName}`],
  );
  return answer === "Allow once" ? "allow" : answer.startsWith("Always allow") ? "always" : "deny";
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

function runProcess(file: string, args: string[], cwd: string | undefined, timeoutMs = commandTimeoutMs): Promise<MacResult> {
  return new Promise((resolveResult) => {
    const child = spawn(file, args, { cwd, timeout: timeoutMs, killSignal: "SIGKILL" });
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
