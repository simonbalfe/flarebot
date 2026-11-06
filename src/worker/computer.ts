import { DurableObject } from "cloudflare:workers";

const idleMs = 10 * 60 * 1000;
const idleCheckMs = 60 * 1000;
const inactivitySafetyMs = 60 * 60 * 1000;
const vncPort = 6080;
const readyAttempts = 120;
const readyDelayMs = 500;
const maxOutputChars = 30_000;
const browserQuitSeconds = 2;

export interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface ComputerStatus {
  running: boolean;
}

export class Computer extends DurableObject<Env> {
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

  async reset(): Promise<ComputerStatus> {
    const container = this.#container();
    if (container.running) await container.destroy();
    this.ctx.storage.kv.delete("snapshot");
    return { running: false };
  }

  async importCookies(cookies: unknown[]): Promise<unknown> {
    const container = await this.#ensureReady();
    const process = await container.exec(["node", "--experimental-websocket", "/usr/local/lib/import-cookies.mjs"], { stdin: "pipe" });
    const writer = process.stdin?.getWriter();
    if (writer === undefined) throw new Error("The cookie import has no stdin");
    await writer.write(new TextEncoder().encode(JSON.stringify(cookies)));
    await writer.close();
    const result = await process.output();
    this.#touch();
    const decoder = new TextDecoder();
    if (result.exitCode !== 0) throw new Error(decoder.decode(result.stderr).slice(-maxOutputChars));
    return JSON.parse(decoder.decode(result.stdout));
  }

  async exec(argv: string[], timeoutSeconds: number): Promise<ExecResult> {
    const container = await this.#ensureReady();
    const process = await container.exec(["timeout", "--kill-after=5", String(timeoutSeconds), ...argv], {
      cwd: "/workspace",
      env: { DISPLAY: ":1", HOME: "/home/bot" },
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

  async screenshot(): Promise<string> {
    const container = await this.#ensureReady();
    const process = await container.exec(["bash", "-c", "scrot -o /tmp/screen.png && base64 -w0 /tmp/screen.png"], {
      env: { DISPLAY: ":1" },
    });
    const result = await process.output();
    if (result.exitCode !== 0) throw new Error(new TextDecoder().decode(result.stderr));
    return new TextDecoder().decode(result.stdout);
  }

  override async fetch(request: Request): Promise<Response> {
    const container = await this.#ensureReady();
    return container.getTcpPort(vncPort).fetch(request);
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

  async #sleep(): Promise<void> {
    const container = this.#container();
    if (!container.running) return;
    const quit = await container.exec(["bash", "-c", `pkill -TERM chromium; sleep ${browserQuitSeconds}`]);
    await quit.output();
    const snapshot = await container.snapshotContainer();
    this.ctx.storage.kv.put("snapshot", snapshot);
    await container.destroy();
    await this.ctx.storage.deleteAlarm();
  }

  #boot(container: Container): void {
    const snapshot = this.ctx.storage.kv.get<ContainerSnapshot>("snapshot");
    container.start(snapshot === undefined ? { enableInternet: true } : { enableInternet: true, containerSnapshot: { id: snapshot.id } });
  }

  async #waitUntilReady(container: Container): Promise<boolean> {
    for (let attempt = 0; attempt < readyAttempts; attempt += 1) {
      try {
        const response = await container.getTcpPort(vncPort).fetch("http://computer/vnc.html");
        await response.body?.cancel();
        if (response.ok) return true;
      } catch {
        await scheduler.wait(readyDelayMs);
      }
    }
    return false;
  }

  async #ensureReady(): Promise<Container> {
    const container = this.#container();
    if (!container.running) this.#boot(container);
    await container.setInactivityTimeout(inactivitySafetyMs);
    if (!(await this.#waitUntilReady(container))) throw new Error("The computer did not start in time");
    this.#touch();
    if ((await this.ctx.storage.getAlarm()) === null) await this.ctx.storage.setAlarm(Date.now() + idleCheckMs);
    return container;
  }
}
