import { DurableObject } from "cloudflare:workers";
import { z } from "zod";
import browserTabScript from "../../computer/browser-tab.mjs?raw";
import { backupComputer, chromeBackup, deleteBackups, restoreComputer, restoredMarker } from "./backups";
import { errorMessage } from "./repos";

const imageName = "desktop";
const instanceType = "standard-2";
const idleMs = 10 * 60 * 1000;
const idleCheckMs = 60 * 1000;
const inactivitySafetyMs = 60 * 60 * 1000;
const vncPort = 6080;
const readyAttempts = 120;
const readyDelayMs = 500;
const maxOutputChars = 30_000;
const browserQuitSeconds = 2;
const browserActionSeconds = 60;

export interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface ComputerStatus {
  running: boolean;
}

export type BrowserAction =
  | { type: "show" }
  | { type: "navigate"; url: string }
  | { type: "screenshot" }
  | { type: "click"; x: number; y: number }
  | { type: "type"; text: string }
  | { type: "key"; key: string }
  | { type: "scroll"; x: number; y: number; deltaY: number };

const browserOutputSchema = z.object({
  targetId: z.string().min(1),
  image: z.string().optional(),
  page: z.object({ url: z.string(), title: z.string() }),
});

export type BrowserResult = Omit<z.infer<typeof browserOutputSchema>, "targetId">;

const tabListSchema = z.object({ tabs: z.array(z.object({ targetId: z.string(), url: z.string(), title: z.string() })) });

export interface BotTab {
  botId: string;
  url: string;
  title: string;
}

export class Computer extends DurableObject<Env> {}

export class SharedComputer extends DurableObject<Env> {
  #browserQueue: Promise<unknown> = Promise.resolve();

  status(): ComputerStatus {
    const running = this.#container().running;
    if (running) this.#touch();
    return { running };
  }

  async start(): Promise<ComputerStatus> {
    await this.#ensureReady();
    return this.status();
  }

  async stop(): Promise<ComputerStatus> {
    await this.#sleep();
    return { running: false };
  }

  async reset(wipe: boolean): Promise<ComputerStatus> {
    const container = this.#container();
    if (container.running) await container.destroy();
    this.ctx.storage.kv.delete("snapshot");
    this.ctx.storage.kv.delete("tabs");
    this.ctx.storage.kv.delete("chromeRestoreFailed");
    if (wipe) await deleteBackups(this.env.FILES);
    return { running: false };
  }

  async importCookies(cookies: unknown[]): Promise<unknown> {
    const stdout = await this.#runWithInput(["node", "--experimental-websocket", "/usr/local/lib/import-cookies.mjs"], new TextEncoder().encode(JSON.stringify(cookies)));
    return JSON.parse(stdout);
  }

  async writeFile(path: string, contents: Uint8Array, executable: boolean): Promise<void> {
    const script = 'mkdir -p "$(dirname "$1")" && cat > "$1" && if [ "$2" = "1" ]; then chmod +x "$1"; fi';
    await this.#runWithInput(["sh", "-c", script, "write-file", path, executable ? "1" : "0"], contents);
  }

  browser(botId: string, action: BrowserAction): Promise<BrowserResult> {
    const run = this.#browserQueue.then(() => this.#runBrowserAction(botId, action));
    this.#browserQueue = run.catch(() => undefined);
    return run;
  }

  tabs(): Promise<BotTab[]> {
    if (!this.#container().running) return Promise.resolve([]);
    const run = this.#browserQueue.then(() => this.#listTabs());
    this.#browserQueue = run.catch(() => undefined);
    return run;
  }

  async showTab(botId: string): Promise<void> {
    if (!this.#container().running) return;
    await this.browser(botId, { type: "show" });
  }

  async exec(argv: string[], timeoutSeconds: number, env: Record<string, string> = {}): Promise<ExecResult> {
    const container = await this.#ensureReady();
    const process = await container.exec(["timeout", "--kill-after=5", String(timeoutSeconds), ...argv], {
      cwd: "/workspace",
      env: { ...env, DISPLAY: ":1", HOME: "/home/bot" },
    });
    const result = await process.output();
    this.#touch();
    const decoder = new TextDecoder();
    return {
      exitCode: result.exitCode,
      stdout: decoder.decode(result.stdout).slice(-maxOutputChars),
      stderr: decoder.decode(result.stderr).slice(-maxOutputChars),
    };
  }

  override async fetch(request: Request): Promise<Response> {
    const container = await this.#ensureReady();
    const url = new URL(request.url);
    url.protocol = "http:";
    return container.getTcpPort(vncPort).fetch(new Request(url, request));
  }

  override async alarm(): Promise<void> {
    if (!this.#container().running) return;
    const lastActive = this.ctx.storage.kv.get<number>("lastActive") ?? 0;
    if (Date.now() - lastActive >= idleMs) {
      await this.#sleep();
      return;
    }
    await this.ctx.storage.setAlarm(Date.now() + idleCheckMs);
  }

  #container(): Container {
    const container = this.ctx.container;
    if (container === undefined) throw new Error("The container binding is not configured");
    return container;
  }

  #touch(): void {
    this.ctx.storage.kv.put("lastActive", Date.now());
  }

  #tabs(): Record<string, string> {
    return this.ctx.storage.kv.get<Record<string, string>>("tabs") ?? {};
  }

  async #runBrowserAction(botId: string, action: BrowserAction): Promise<BrowserResult> {
    const stdout = await this.#runBrowserScript({ targetId: this.#tabs()[botId] ?? null, action });
    const { targetId, ...result } = browserOutputSchema.parse(JSON.parse(stdout));
    this.ctx.storage.kv.put("tabs", { ...this.#tabs(), [botId]: targetId });
    return result;
  }

  async #listTabs(): Promise<BotTab[]> {
    const open = tabListSchema.parse(JSON.parse(await this.#runBrowserScript({ list: true }))).tabs;
    return Object.entries(this.#tabs()).flatMap(([botId, targetId]) => {
      const tab = open.find((candidate) => candidate.targetId === targetId);
      return tab === undefined ? [] : [{ botId, url: tab.url, title: tab.title }];
    });
  }

  #runBrowserScript(request: unknown): Promise<string> {
    return this.#runWithInput(
      ["timeout", "--kill-after=5", String(browserActionSeconds), "node", "--experimental-websocket", "--input-type=module", "-e", browserTabScript],
      new TextEncoder().encode(JSON.stringify(request)),
    );
  }

  async #runWithInput(argv: string[], input: Uint8Array): Promise<string> {
    const container = await this.#ensureReady();
    const process = await container.exec(argv, { stdin: "pipe" });
    const writer = process.stdin?.getWriter();
    if (writer === undefined) throw new Error(`${argv[0] ?? "The command"} has no stdin`);
    await writer.write(input);
    await writer.close();
    const result = await process.output();
    this.#touch();
    const decoder = new TextDecoder();
    if (result.exitCode !== 0) throw new Error(decoder.decode(result.stderr).slice(-maxOutputChars) || `exit code ${result.exitCode}`);
    return decoder.decode(result.stdout);
  }

  async #sleep(): Promise<void> {
    const container = this.#container();
    if (!container.running) return;
    const quit = await container.exec(["bash", "-c", `pkill -TERM chromium; sleep ${browserQuitSeconds}`]);
    await quit.output();
    await backupComputer(container, this.env.FILES, this.ctx.storage.kv.get<boolean>("chromeRestoreFailed") !== true);
    const snapshot = await container.snapshotContainer();
    this.ctx.storage.kv.put("snapshot", snapshot);
    this.ctx.storage.kv.delete("tabs");
    await container.destroy();
    await this.ctx.storage.deleteAlarm();
  }

  async #boot(container: Container): Promise<void> {
    const snapshot = this.ctx.storage.kv.get<ContainerSnapshot>("snapshot");
    if (snapshot !== undefined) {
      try {
        container.start({ containerSnapshot: { id: snapshot.id }, instance: instanceType, enableInternet: true });
        await container.setInactivityTimeout(inactivitySafetyMs);
        if (await this.#waitUntilReady(container)) return;
        console.error(JSON.stringify({ event: "snapshot_restore_failed", snapshot: snapshot.id, error: "not ready in time" }));
      } catch (error) {
        console.error(JSON.stringify({ event: "snapshot_restore_failed", snapshot: snapshot.id, error: errorMessage(error) }));
      }
      if (container.running) await container.destroy();
      this.ctx.storage.kv.delete("snapshot");
    }
    await this.#bootFresh(container);
  }

  async #bootFresh(container: Container): Promise<void> {
    const image = container.images[imageName];
    if (image === undefined) throw new Error(`The ${imageName} image is not configured`);
    container.start({ image, instance: instanceType, enableInternet: true, env: { FLAREBOT_RESTORE: "1" } });
    await container.setInactivityTimeout(inactivitySafetyMs);
    if (!(await this.#waitUntilReady(container))) throw new Error("The computer did not start in time");
    try {
      const failed = await restoreComputer(container, this.env.FILES);
      if (failed.includes(chromeBackup.key)) this.ctx.storage.kv.put("chromeRestoreFailed", true);
      else this.ctx.storage.kv.delete("chromeRestoreFailed");
    } finally {
      const marker = await container.exec(["touch", restoredMarker]);
      await marker.output();
    }
  }

  async #waitUntilReady(container: Container): Promise<boolean> {
    for (let attempt = 0; attempt < readyAttempts; attempt += 1) {
      try {
        const response = await container.getTcpPort(vncPort).fetch("http://computer/vnc.html");
        await response.body?.cancel();
        if (response.ok) return true;
      } catch {}
      await scheduler.wait(readyDelayMs);
    }
    return false;
  }

  async #ensureReady(): Promise<Container> {
    const container = this.#container();
    if (!container.running) await this.#boot(container);
    await container.setInactivityTimeout(inactivitySafetyMs);
    if (!(await this.#waitUntilReady(container))) throw new Error("The computer did not start in time");
    this.#touch();
    if ((await this.ctx.storage.getAlarm()) === null) await this.ctx.storage.setAlarm(Date.now() + idleCheckMs);
    return container;
  }
}
