import { computerName } from "./env";
import { commitAll, ensureClone, pushClone, type RepoResult } from "./repos";

export interface CliSummary {
  name: string;
  description: string;
  publishedBy: string | null;
}

export type SkillSummary = CliSummary;

export type PoolKind = "clis" | "skills";

export type SkillInspection = { ok: true; name: string; description: string } | { ok: false; error: string };

export const cliNamePattern = /^[a-z0-9][a-z0-9._-]{0,39}$/;
export const skillNamePattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const maxSkillNameChars = 64;
export const poolPath = "/workspace/toolbox";
const poolRepo = "toolbox";
const poolAuthor = { id: "toolbox", name: "flarebot" };
const copyTimeoutSeconds = 60;

const publishCliScript = `
set -e
src="$1"; dest="$2"; name="$3"
if [ ! -e "$src" ]; then echo "Nothing at $src"; exit 1; fi
rm -rf "$dest"
mkdir -p "$dest"
if [ -d "$src" ]; then cp -R "$src/." "$dest/"; rm -rf "$dest/.git"; else cp "$src" "$dest/$name"; fi
if [ ! -f "$dest/$name" ]; then rm -rf "$dest"; echo "$src has no file named $name"; exit 1; fi
if [ "$(head -c 2 "$dest/$name")" != "#!" ] && [ "$(head -c 4 "$dest/$name" | tail -c 3)" != "ELF" ]; then rm -rf "$dest"; echo "$name must start with a #! line or be a Linux binary"; exit 1; fi
chmod +x "$dest/$name"
`;

const inspectSkillScript = `
import json, os, re, sys

def fail(message):
    print(json.dumps({"ok": False, "error": message}))
    sys.exit(0)

def scalar(value):
    value = value.strip()
    if value.startswith('"'):
        try:
            return json.loads(value)
        except ValueError:
            return value.strip('"')
    return value.strip("'")

src = sys.argv[1]
path = os.path.join(src, "SKILL.md") if os.path.isdir(src) else src
if not os.path.isfile(path):
    fail(f"No SKILL.md at {src}")
text = open(path, encoding="utf-8").read()
match = re.match(r"^---[ \\t]*\\n(.*?)\\n---[ \\t]*(?:\\n|$)", text, re.S)
if match is None:
    fail("SKILL.md must start with --- frontmatter ---")
fields = {}
lines = match.group(1).splitlines()
index = 0
while index < len(lines):
    found = re.match(r"^([A-Za-z][\\w-]*):[ \\t]*(.*)$", lines[index])
    index += 1
    if found is None:
        continue
    key, value = found.group(1), found.group(2).strip()
    if value in (">", "|", ">-", "|-", ">+", "|+"):
        block = []
        while index < len(lines) and (lines[index].startswith((" ", "\\t")) or lines[index].strip() == ""):
            block.append(lines[index].strip())
            index += 1
        fields[key] = (" " if value.startswith(">") else "\\n").join(part for part in block if part)
    else:
        fields[key] = scalar(value)
name = str(fields.get("name", "")).strip()
description = " ".join(str(fields.get("description", "")).split())
if not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", name) or len(name) > ${maxSkillNameChars}:
    fail("Frontmatter name must be lowercase letters, numbers and single hyphens, up to ${maxSkillNameChars} characters")
if description == "" or len(description) > 1024:
    fail("Frontmatter description must be 1 to 1024 characters")
print(json.dumps({"ok": True, "name": name, "description": description}))
`;

const copySkillScript = `
set -e
src="$1"; dest="$2"
rm -rf "$dest"
mkdir -p "$dest"
if [ -d "$src" ]; then cp -R "$src/." "$dest/"; rm -rf "$dest/.git"; else cp "$src" "$dest/SKILL.md"; fi
`;

const unpackSkillScript = `
set -e
upload="$1"; out="$2"
mkdir -p "$out"
if [ "$(head -c 2 "$upload" | od -An -tx1 | tr -d ' \\n')" = "1f8b" ]; then
  tar -xzf "$upload" -C "$out" --no-same-owner --no-same-permissions
  if [ ! -f "$out/SKILL.md" ]; then
    found="$(find "$out" -mindepth 2 -maxdepth 2 -name SKILL.md | head -1)"
    if [ -n "$found" ]; then echo "$(dirname "$found")"; exit 0; fi
  fi
else
  cp "$upload" "$out/SKILL.md"
fi
echo "$out"
`;

const scanSkillsScript = `
import glob, json, os, re, sys
skills = []
for path in sorted(glob.glob(os.path.join(sys.argv[1], "*", "SKILL.md"))):
    text = open(path, encoding="utf-8").read()
    match = re.search(r"^description:\\s*(?:>-?|\\|-?)?\\s*((?:.*\\n?)(?:[ \\t]+.*\\n?)*)", text, re.M)
    description = " ".join(match.group(1).split()).strip('"') if match else ""
    skills.append({"name": os.path.basename(os.path.dirname(path)), "description": description[:300]})
print(json.dumps(skills))
`;

export interface OwnSkill {
  name: string;
  description: string;
}

export function ownSkillsDir(botId: string): string {
  return `/workspace/bots/${botId}/skills`;
}

export async function scanSkills(env: Env, dir: string): Promise<OwnSkill[]> {
  const result = await computer(env).exec(["python3", "-c", scanSkillsScript, dir], copyTimeoutSeconds);
  if (result.exitCode !== 0) throw new Error(result.stderr.trim() || `exit code ${result.exitCode}`);
  const parsed: unknown = JSON.parse(result.stdout);
  if (!Array.isArray(parsed)) throw new Error("Could not list skills");
  return parsed.flatMap((item: unknown) => (typeof item === "object" && item !== null && "name" in item && "description" in item ? [{ name: String(item.name), description: String(item.description) }] : []));
}

export function itemDir(kind: PoolKind, name: string): string {
  return `${poolPath}/${kind}/${name}`;
}

export function ensurePool(env: Env): Promise<RepoResult> {
  return ensureClone(env, poolAuthor, poolRepo, poolPath, null, "flarebot shared CLIs and skills");
}

function computer(env: Env) {
  return env.COMPUTER.getByName(computerName);
}

function failure(result: { stdout: string; stderr: string }, fallback: string): RepoResult {
  return { ok: false, error: [result.stdout.trim(), result.stderr.trim()].filter(Boolean).join("\n") || fallback };
}

export async function addCli(env: Env, name: string, contents: Uint8Array): Promise<RepoResult> {
  const ready = await ensurePool(env);
  if (!ready.ok) return ready;
  await computer(env).writeFile(`${itemDir("clis", name)}/${name}`, contents, true);
  return savePool(env, `flarebot: add CLI ${name}`);
}

export async function publishCli(env: Env, name: string, source: string, author: string): Promise<RepoResult> {
  const ready = await ensurePool(env);
  if (!ready.ok) return ready;
  const copied = await computer(env).exec(["bash", "-c", publishCliScript, "publish", source, itemDir("clis", name), name], copyTimeoutSeconds);
  if (copied.exitCode !== 0) return failure(copied, "Copy failed");
  return savePool(env, `${author}: publish CLI ${name}`);
}

export async function inspectSkill(env: Env, source: string): Promise<SkillInspection> {
  const result = await computer(env).exec(["python3", "-c", inspectSkillScript, source], copyTimeoutSeconds);
  if (result.exitCode !== 0) return { ok: false, error: result.stderr.trim() || "Could not read SKILL.md" };
  const parsed: unknown = JSON.parse(result.stdout);
  if (typeof parsed !== "object" || parsed === null || !("ok" in parsed)) return { ok: false, error: "Could not read SKILL.md" };
  if (parsed.ok === true && "name" in parsed && "description" in parsed) return { ok: true, name: String(parsed.name), description: String(parsed.description) };
  return { ok: false, error: "error" in parsed ? String(parsed.error) : "Invalid SKILL.md" };
}

export async function publishSkill(env: Env, name: string, source: string, author: string): Promise<RepoResult> {
  const ready = await ensurePool(env);
  if (!ready.ok) return ready;
  const copied = await computer(env).exec(["bash", "-c", copySkillScript, "publish", source, itemDir("skills", name)], copyTimeoutSeconds);
  if (copied.exitCode !== 0) return failure(copied, "Copy failed");
  return savePool(env, `${author}: publish skill ${name}`);
}

export async function unpackUpload(env: Env, contents: Uint8Array): Promise<{ source: string; cleanup: () => Promise<void> }> {
  const staging = `/tmp/flarebot-skill-${crypto.randomUUID()}`;
  const upload = `${staging}/upload`;
  await computer(env).writeFile(upload, contents, false);
  const cleanup = async () => {
    await computer(env).exec(["rm", "-rf", staging], copyTimeoutSeconds);
  };
  const unpacked = await computer(env).exec(["bash", "-c", unpackSkillScript, "unpack", upload, `${staging}/skill`], copyTimeoutSeconds);
  if (unpacked.exitCode !== 0) {
    await cleanup();
    throw new Error([unpacked.stdout.trim(), unpacked.stderr.trim()].filter(Boolean).join("\n") || "Could not unpack the upload");
  }
  return { source: unpacked.stdout.trim().split("\n").at(-1) ?? `${staging}/skill`, cleanup };
}

export async function removeItem(env: Env, kind: PoolKind, name: string): Promise<RepoResult> {
  const ready = await ensurePool(env);
  if (!ready.ok) return ready;
  await computer(env).exec(["rm", "-rf", itemDir(kind, name)], copyTimeoutSeconds);
  return savePool(env, `flarebot: remove ${kind === "clis" ? "CLI" : "skill"} ${name}`);
}

async function savePool(env: Env, message: string): Promise<RepoResult> {
  const committed = await commitAll(env, poolPath, message);
  if (!committed.ok) return committed;
  return pushClone(env, poolRepo, poolPath);
}
