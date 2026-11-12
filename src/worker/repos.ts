import { computerName } from "./env";

const repoNamePattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const tokenTtlSeconds = 600;
const gitTimeoutSeconds = 300;

export interface RepoBot {
  id: string;
  name: string;
}

export interface CloneState {
  exists: boolean;
  branch: string;
  dirty: boolean;
  unpushed: number;
}

export type RepoResult = { ok: true; message: string } | { ok: false; error: string };

const cloneScript = `
set -e
path="$1"; remote="$2"; name="$3"; email="$4"; branch="$5"
tmp="$(mktemp -d)"
git clone -q --no-checkout "$remote" "$tmp/repo"
mkdir -p "$path"
mv "$tmp/repo/.git" "$path/.git"
rm -rf "$tmp"
cd "$path"
git config user.name "$name"
git config user.email "$email"
printf 'bin/\\n' >> .git/info/exclude
if [ -z "$branch" ]; then printf '/projects/\\n' >> .git/info/exclude; fi
if [ -n "$branch" ]; then
  if git rev-parse -q --verify "refs/remotes/origin/$branch" >/dev/null; then
    git branch -f "$branch" "origin/$branch"
    git symbolic-ref HEAD "refs/heads/$branch"
    git branch -q -u "origin/$branch" "$branch"
  elif git rev-parse -q --verify HEAD >/dev/null; then
    git branch -f "$branch" HEAD
    git symbolic-ref HEAD "refs/heads/$branch"
  else
    git symbolic-ref HEAD "refs/heads/$branch"
  fi
fi
if git rev-parse -q --verify HEAD >/dev/null; then
  git reset -q
  git ls-files -d -z | xargs -0 -r git checkout --
fi
git status --short --branch
`;

const pullScript = `
set -e
path="$1"; remote="$2"
git -C "$path" remote set-url origin "$remote"
git -C "$path" fetch --prune origin
if git -C "$path" rev-parse --abbrev-ref --symbolic-full-name '@{u}' >/dev/null 2>&1; then git -C "$path" merge --ff-only '@{u}'; fi
git -C "$path" status --short --branch
`;

const pushScript = `
set -e
path="$1"; remote="$2"
git -C "$path" remote set-url origin "$remote"
git -C "$path" push -u origin HEAD 2>&1
`;

const mirrorScript = `
set -e
path="$1"; remote="$2"
git -C "$path" remote set-url origin "$remote"
git -C "$path" fetch --prune origin
branch="$(git -C "$path" symbolic-ref --short HEAD)"
if git -C "$path" rev-parse -q --verify "refs/remotes/origin/$branch" >/dev/null; then
  git -C "$path" reset -q --hard "origin/$branch"
  git -C "$path" branch -q -u "origin/$branch" "$branch"
fi
git -C "$path" status --short --branch
`;

const stateScript = `
path="$1"
if [ ! -d "$path/.git" ]; then echo '{"exists":false,"branch":"","dirty":false,"unpushed":0}'; exit 0; fi
branch="$(git -C "$path" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")"
dirty=false; [ -n "$(git -C "$path" status --porcelain)" ] && dirty=true
if git -C "$path" rev-parse '@{u}' >/dev/null 2>&1; then unpushed="$(git -C "$path" rev-list --count '@{u}..HEAD')"; else unpushed="$(git -C "$path" rev-list --count HEAD --not --remotes 2>/dev/null || echo 0)"; fi
printf '{"exists":true,"branch":"%s","dirty":%s,"unpushed":%s}\n' "$branch" "$dirty" "$unpushed"
`;

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function computer(env: Env) {
  return env.COMPUTER.getByName(computerName);
}

function bearerEnv(token: string): Record<string, string> {
  return { GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "http.extraHeader", GIT_CONFIG_VALUE_0: `Authorization: Bearer ${token}`, GIT_TERMINAL_PROMPT: "0" };
}

async function withToken<T>(env: Env, name: string, scope: "read" | "write", work: (remote: string, gitEnv: Record<string, string>) => Promise<T>): Promise<T> {
  const repo = await env.ARTIFACTS.get(name);
  const token = await repo.createToken(scope, tokenTtlSeconds);
  try {
    const { remote } = await repo.info();
    return await work(remote, bearerEnv(token.plaintext));
  } finally {
    await repo.revokeToken(token.id).catch((error: unknown) => console.error(errorMessage(error)));
  }
}

function gitOutput(result: { exitCode: number; stdout: string; stderr: string }): string {
  return [result.stdout.trim(), result.stderr.trim()].filter(Boolean).join("\n");
}

async function runGit(env: Env, name: string, scope: "read" | "write", script: string, args: (remote: string) => string[]): Promise<RepoResult> {
  try {
    return await withToken(env, name, scope, async (remote, gitEnv) => {
      const result = await computer(env).exec(["bash", "-c", script, "git", ...args(remote)], gitTimeoutSeconds, gitEnv);
      if (result.exitCode !== 0) return { ok: false, error: gitOutput(result) || `git exited with ${result.exitCode}` };
      return { ok: true, message: gitOutput(result) || "Done." };
    });
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
}

async function repoExists(env: Env, name: string): Promise<boolean> {
  try {
    await env.ARTIFACTS.get(name);
    return true;
  } catch {
    return false;
  }
}

export function defaultRepoName(bot: RepoBot): string {
  const slug = bot.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "bot";
  return `${slug}-${bot.id.slice(0, 8)}`;
}

export async function ensureRepo(env: Env, name: string, description: string): Promise<RepoResult> {
  if (await repoExists(env, name)) return { ok: true, message: name };
  const created = await createRepo(env, name, description);
  if (created.ok || (await repoExists(env, name))) return { ok: true, message: name };
  return created;
}

async function createRepo(env: Env, name: string, description: string): Promise<RepoResult> {
  if (!repoNamePattern.test(name)) return { ok: false, error: `Invalid repo name: ${name}` };
  try {
    const created = await env.ARTIFACTS.create(name, { description });
    await env.ARTIFACTS.get(name).then((repo) => repo.revokeToken(created.token)).catch((error: unknown) => console.error(errorMessage(error)));
    return { ok: true, message: `Created ${name}.` };
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
}

export async function ensureClone(env: Env, bot: RepoBot, name: string, path: string, branch: string | null, description = `${bot.name}'s flarebot folder`): Promise<RepoResult> {
  const check = await computer(env).exec(["test", "-d", `${path}/.git`], gitTimeoutSeconds);
  if (check.exitCode === 0) return { ok: true, message: path };
  if (branch === null) {
    const repo = await ensureRepo(env, name, description);
    if (!repo.ok) return repo;
  }
  return runGit(env, name, "read", cloneScript, (remote) => [path, remote, `${bot.name} (flarebot)`, `${bot.id}@flarebot.local`, branch ?? ""]);
}

export async function projectExists(env: Env, name: string): Promise<boolean> {
  return repoNamePattern.test(name) && (await repoExists(env, name));
}

export function pullClone(env: Env, name: string, path: string): Promise<RepoResult> {
  return runGit(env, name, "read", pullScript, (remote) => [path, remote]);
}

export function mirrorClone(env: Env, name: string, path: string): Promise<RepoResult> {
  return runGit(env, name, "read", mirrorScript, (remote) => [path, remote]);
}

export function pushClone(env: Env, name: string, path: string): Promise<RepoResult> {
  return runGit(env, name, "write", pushScript, (remote) => [path, remote]);
}

export async function commitAll(env: Env, path: string, message: string): Promise<RepoResult> {
  const result = await computer(env).exec(["bash", "-c", 'git -C "$1" add -A && { git -C "$1" diff --cached --quiet || git -C "$1" commit -q -m "$2"; }', "commit", path, message], gitTimeoutSeconds);
  if (result.exitCode !== 0) return { ok: false, error: gitOutput(result) || `git exited with ${result.exitCode}` };
  return { ok: true, message: "Committed." };
}

export async function cloneState(env: Env, path: string): Promise<CloneState> {
  const result = await computer(env).exec(["bash", "-c", stateScript, "state", path], gitTimeoutSeconds);
  if (result.exitCode !== 0) throw new Error(gitOutput(result));
  const parsed: unknown = JSON.parse(result.stdout);
  if (typeof parsed !== "object" || parsed === null || !("exists" in parsed) || !("dirty" in parsed) || !("unpushed" in parsed) || !("branch" in parsed)) {
    throw new Error("Could not read the clone state");
  }
  return { exists: parsed.exists === true, branch: String(parsed.branch), dirty: parsed.dirty === true, unpushed: Number(parsed.unpushed) };
}
