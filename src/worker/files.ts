import { Workspace as FileWorkspace } from "@cloudflare/computer";
import { WorkerShellBackend, type WorkerShellLoader } from "@cloudflare/computer/backends/worker-shell";
import { createGitClient } from "@cloudflare/computer/git";
import curlModules from "@cloudflare/computer/shell/curl";
import htmlToMarkdownModules from "@cloudflare/computer/shell/html-to-markdown";
import jqModules from "@cloudflare/computer/shell/jq";
import yqModules from "@cloudflare/computer/shell/yq";
import type { Workspace } from "./bot";
import { computerName } from "./env";
import type { OwnSkill } from "./pool";
import { cloneState, commitAll, ensureClone, ensureRepo, errorMessage, mirrorClone, pushClone, type RepoBot, type RepoResult } from "./repos";

export type Files = FileWorkspace;

export interface GitAuthor {
  name: string;
  email: string;
}

export interface LocalState {
  exists: boolean;
  branch: string;
  dirty: boolean;
  unpushed: boolean;
}

export const shellBackendId = "shell";
const tokenTtlSeconds = 600;
const tokenRenewMs = 60_000;
const maxSkillDescriptionChars = 300;
const ownExcludes = "bin/\n/projects/\n";
const projectExcludes = "bin/\n";
const cloneMarker = "flarebot-cloned";

export function botAuthor(bot: RepoBot): GitAuthor {
  return { name: `${bot.name} (flarebot)`, email: `${bot.id}@flarebot.local` };
}

export function gitEnv(author: GitAuthor): Record<string, string> {
  return { GIT_AUTHOR_NAME: author.name, GIT_AUTHOR_EMAIL: author.email, GIT_COMMITTER_NAME: author.name, GIT_COMMITTER_EMAIL: author.email };
}

export function createFiles(ctx: DurableObjectState, env: Env, binding: string, allowedRepos: () => string[]): Files {
  const id = ctx.id.toString();
  return new FileWorkspace({
    storage: ctx.storage,
    sessionId: id,
    git: createGitClient({ fetch: artifactsFetch(env, allowedRepos) }),
    backends: [
      new WorkerShellBackend({
        id: shellBackendId,
        loader: shellLoader(env.LOADER),
        workspace: { binding, id },
        ctx,
        egress: { mode: "direct" },
        commands: [curlModules, jqModules, yqModules, htmlToMarkdownModules],
      }),
    ],
  });
}

function shellLoader(loader: WorkerLoader): WorkerShellLoader {
  return {
    get: (name, getCode) => {
      const stub = loader.get(name, async () => {
        const { globalOutbound, ...code } = await getCode();
        return globalOutbound === undefined ? code : { ...code, globalOutbound: globalOutbound as Fetcher | null };
      });
      return { getEntrypoint: (entrypoint?: string): unknown => stub.getEntrypoint(entrypoint) };
    },
  };
}

function artifactsFetch(env: Env, allowedRepos: () => string[]): typeof fetch {
  const remotes = new Map<string, string>();
  const tokens = new Map<string, { value: string; renewAt: number }>();

  const remoteOf = async (name: string): Promise<string> => {
    const known = remotes.get(name);
    if (known !== undefined) return known;
    const repo = await env.ARTIFACTS.get(name);
    const { remote } = await repo.info();
    remotes.set(name, remote);
    return remote;
  };

  const tokenFor = async (name: string, scope: "read" | "write"): Promise<string> => {
    const key = `${name}:${scope}`;
    const cached = tokens.get(key);
    if (cached !== undefined && cached.renewAt > Date.now()) return cached.value;
    const repo = await env.ARTIFACTS.get(name);
    const token = await repo.createToken(scope, tokenTtlSeconds);
    tokens.set(key, { value: token.plaintext, renewAt: Date.now() + tokenTtlSeconds * 1000 - tokenRenewMs });
    return token.plaintext;
  };

  const repoFor = async (url: string): Promise<string | null> => {
    for (const name of allowedRepos()) {
      const remote = await remoteOf(name).catch(() => null);
      if (remote !== null && (url === remote || url.startsWith(`${remote}/`))) return name;
    }
    return null;
  };

  return async (input, init) => {
    const request = new Request(input, init);
    const name = await repoFor(request.url);
    if (name === null) return fetch(request);
    const url = new URL(request.url);
    const writes = url.pathname.endsWith("/git-receive-pack") || url.searchParams.get("service") === "git-receive-pack";
    const headers = new Headers(request.headers);
    headers.set("Authorization", `Bearer ${await tokenFor(name, writes ? "write" : "read")}`);
    return fetch(new Request(request, { headers, redirect: "manual" }));
  };
}

async function exists(files: Files, path: string): Promise<boolean> {
  return files.fs.stat(path).then(
    () => true,
    () => false,
  );
}

async function revision(files: Files, dir: string, ref: string): Promise<string | null> {
  return files.git.revParse({ dir, ref }).catch(() => null);
}

async function statusText(files: Files, dir: string): Promise<string> {
  const result = await files.git.cli({ argv: ["status", "--short", "--branch"], cwd: dir });
  return result.stdout.trim() || "Done.";
}

async function cloneLocal(files: Files, env: Env, workspace: Workspace): Promise<void> {
  const repo = await env.ARTIFACTS.get(workspace.repo);
  const info = await repo.info();
  const dir = workspace.path;
  const target = workspace.branch ?? info.defaultBranch;
  await files.fs.mkdir(dir, { recursive: true });
  await files.git.init({ dir, defaultBranch: target });
  await files.git.remoteAdd({ dir, name: "origin", url: info.remote });
  await files.fs.writeFile(`${dir}/.git/info/exclude`, workspace.branch === null ? ownExcludes : projectExcludes);
  await files.git.fetch({ dir, remote: "origin" });
  const start = (await revision(files, dir, `refs/remotes/origin/${target}`)) !== null ? target : workspace.branch !== null && (await revision(files, dir, `refs/remotes/origin/${info.defaultBranch}`)) !== null ? info.defaultBranch : null;
  if (start === null) return;
  await files.git.branch({ dir, name: target, startPoint: `refs/remotes/origin/${start}`, force: true });
  await files.git.checkout({ dir, ref: target, force: true });
  if (start === target) await trackOrigin(files, dir, target);
}

async function trackOrigin(files: Files, dir: string, branch: string): Promise<void> {
  await files.git.configSet({ dir, path: `branch.${branch}.remote`, value: "origin" });
  await files.git.configSet({ dir, path: `branch.${branch}.merge`, value: `refs/heads/${branch}` });
}

async function saveComputerCopy(env: Env, workspace: Workspace, message: string): Promise<void> {
  try {
    if (!(await env.COMPUTER.getByName(computerName).status()).running) return;
    const state = await cloneState(env, workspace.path);
    if (!state.exists) return;
    if (state.dirty) {
      const committed = await commitAll(env, workspace.path, message);
      if (!committed.ok) throw new Error(committed.error);
    }
    if (state.dirty || state.unpushed > 0) {
      const pushed = await pushClone(env, workspace.repo, workspace.path);
      if (!pushed.ok) throw new Error(pushed.error);
    }
  } catch (error) {
    console.error(JSON.stringify({ event: "computer_copy_save_failed", repo: workspace.repo, branch: workspace.branch, error: errorMessage(error) }));
  }
}

export async function ensureLocalClone(files: Files, env: Env, bot: RepoBot, workspace: Workspace): Promise<RepoResult> {
  const marker = `${workspace.path}/.git/${cloneMarker}`;
  if (await exists(files, marker)) return { ok: true, message: workspace.path };
  await files.fs.rm(`${workspace.path}/.git`, { recursive: true, force: true }).catch(() => undefined);
  if (workspace.branch === null) {
    const repo = await ensureRepo(env, workspace.repo, `${bot.name}'s flarebot folder`);
    if (!repo.ok) return repo;
  }
  await saveComputerCopy(env, workspace, `flarebot: ${bot.name} save before moving to the Bot's files`);
  try {
    await cloneLocal(files, env, workspace);
    await files.fs.writeFile(marker, "");
    return { ok: true, message: await statusText(files, workspace.path) };
  } catch (error) {
    await files.fs.rm(`${workspace.path}/.git`, { recursive: true, force: true }).catch(() => undefined);
    return { ok: false, error: errorMessage(error) };
  }
}

export async function localState(files: Files, dir: string): Promise<LocalState> {
  if (!(await exists(files, `${dir}/.git`))) return { exists: false, branch: "", dirty: false, unpushed: false };
  const branch = (await files.git.currentBranch({ dir })) ?? "";
  const dirty = (await files.git.status({ dir })).length > 0;
  const head = await revision(files, dir, "HEAD");
  const upstream = branch === "" ? null : await revision(files, dir, `refs/remotes/origin/${branch}`);
  const behind = head !== null && upstream !== null && head !== upstream && (await files.git.log({ dir, ref: upstream })).some((commit) => commit.oid === head);
  return { exists: true, branch, dirty, unpushed: head !== null && head !== upstream && !behind };
}

export async function localCommitAll(files: Files, dir: string, message: string, author: GitAuthor): Promise<RepoResult> {
  try {
    if ((await files.git.status({ dir })).length === 0) return { ok: true, message: "Nothing to commit." };
    await files.git.add({ dir, paths: ["."], all: true });
    const { oid } = await files.git.commit({ dir, message, author, committer: author });
    return { ok: true, message: `Committed ${oid.slice(0, 7)}.` };
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
}

export async function localPush(files: Files, dir: string): Promise<RepoResult> {
  try {
    const branch = await files.git.currentBranch({ dir });
    if (branch === undefined) return { ok: false, error: "The folder is not on a branch." };
    if ((await revision(files, dir, "HEAD")) === null) return { ok: true, message: "Nothing to push." };
    const result = await files.git.push({ dir, remote: "origin", ref: branch });
    if (!result.ok) return { ok: false, error: result.error ?? `Could not push ${branch}.` };
    await trackOrigin(files, dir, branch);
    return { ok: true, message: `Pushed ${branch}.\n${await statusText(files, dir)}` };
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
}

export async function localPull(files: Files, dir: string, author: GitAuthor): Promise<RepoResult> {
  try {
    const branch = await files.git.currentBranch({ dir });
    if (branch === undefined) return { ok: false, error: "The folder is not on a branch." };
    await files.git.fetch({ dir, remote: "origin", prune: true });
    const upstream = `refs/remotes/origin/${branch}`;
    if ((await revision(files, dir, upstream)) === null) return { ok: true, message: await statusText(files, dir) };
    if ((await revision(files, dir, "HEAD")) === null) {
      await files.git.branch({ dir, name: branch, startPoint: upstream, force: true });
      await files.git.checkout({ dir, ref: branch, force: true });
    } else {
      await files.git.merge({ dir, theirs: upstream, message: `flarebot: merge origin/${branch}`, author, committer: author });
    }
    await trackOrigin(files, dir, branch);
    return { ok: true, message: await statusText(files, dir) };
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
}

export async function localSave(files: Files, dir: string, message: string, author: GitAuthor): Promise<RepoResult> {
  const state = await localState(files, dir);
  if (!state.exists) return { ok: true, message: "Nothing cloned." };
  if (state.dirty) {
    const committed = await localCommitAll(files, dir, message, author);
    if (!committed.ok) return committed;
  }
  if (!state.dirty && !state.unpushed) return { ok: true, message: "Already saved." };
  return localPush(files, dir);
}

export async function sendToComputer(files: Files, env: Env, bot: RepoBot, workspace: Workspace): Promise<RepoResult> {
  const local = await ensureLocalClone(files, env, bot, workspace);
  if (!local.ok) return local;
  const saved = await localSave(files, workspace.path, `flarebot: ${bot.name} sync to the computer`, botAuthor(bot));
  if (!saved.ok) return saved;
  const cloned = await ensureClone(env, bot, workspace.repo, workspace.path, workspace.branch);
  if (!cloned.ok) return cloned;
  return mirrorClone(env, workspace.repo, workspace.path);
}

export async function bringFromComputer(files: Files, env: Env, bot: RepoBot, workspace: Workspace): Promise<RepoResult> {
  try {
    const state = await cloneState(env, workspace.path);
    if (state.exists && state.dirty) {
      const committed = await commitAll(env, workspace.path, `flarebot: ${bot.name} sync from the computer`);
      if (!committed.ok) return committed;
    }
    if (state.exists && (state.dirty || state.unpushed > 0)) {
      const pushed = await pushClone(env, workspace.repo, workspace.path);
      if (!pushed.ok) return pushed;
    }
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
  return localPull(files, workspace.path, botAuthor(bot));
}

function skillDescription(text: string): string {
  const match = /^description:\s*(?:>-?|\|-?)?\s*((?:.*\n?)(?:[ \t]+.*\n?)*)/m.exec(text);
  const raw = match?.[1] ?? "";
  return raw.split(/\s+/).filter(Boolean).join(" ").replace(/^"|"$/g, "").slice(0, maxSkillDescriptionChars);
}

export async function scanLocalSkills(files: Files, dir: string): Promise<OwnSkill[]> {
  if (!(await exists(files, dir))) return [];
  const entries = (await files.fs.readdir(dir)).filter((entry) => entry.isDirectory).sort((a, b) => a.name.localeCompare(b.name));
  const skills: OwnSkill[] = [];
  for (const entry of entries) {
    const text = await files.fs.readFile(`${dir}/${entry.name}/SKILL.md`, "utf8").catch(() => null);
    if (text !== null) skills.push({ name: entry.name, description: skillDescription(text) });
  }
  return skills;
}

export async function readLocalFile(files: Files, path: string): Promise<string | null> {
  return files.fs.readFile(path, "utf8").catch(() => null);
}

export async function writeLocalFile(files: Files, path: string, contents: string): Promise<void> {
  await files.fs.mkdir(path.slice(0, path.lastIndexOf("/")), { recursive: true });
  await files.fs.writeFile(path, contents);
}
