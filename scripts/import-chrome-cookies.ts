#!/usr/bin/env bun
import { Database } from "bun:sqlite";
import { createDecipheriv, pbkdf2Sync } from "node:crypto";
import { copyFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

const chromiumEpochOffsetSeconds = 11_644_473_600;
const hashedHostMetaVersion = 24;
const hostHashBytes = 32;
const chromiumCookieLimit = 3000;
const sameSiteNames: Record<number, string> = { 0: "None", 1: "Lax", 2: "Strict" };

interface CookieRow {
  host_key: string;
  name: string;
  path: string;
  value: string;
  encrypted_value: Uint8Array;
  expires_utc: number;
  is_secure: number;
  is_httponly: number;
  samesite: number;
  last_access_utc: number;
}

interface CookieParam {
  name: string;
  value: string;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  domain?: string;
  url?: string;
  expires?: number;
  sameSite?: string;
}

function flagValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index === -1 ? undefined : process.argv[index + 1];
}

function readKeychainPassword(): string {
  const result = Bun.spawnSync(["security", "find-generic-password", "-w", "-s", "Chrome Safe Storage", "-a", "Chrome"]);
  if (!result.success) throw new Error("Could not read Chrome Safe Storage from the Keychain");
  return result.stdout.toString().trim();
}

function readCookieRows(profile: string): { rows: CookieRow[]; metaVersion: number } {
  const source = join(homedir(), "Library/Application Support/Google/Chrome", profile, "Cookies");
  const directory = mkdtempSync(join(tmpdir(), "flarebot-cookies-"));
  try {
    const copy = join(directory, "Cookies");
    copyFileSync(source, copy);
    if (existsSync(`${source}-wal`)) copyFileSync(`${source}-wal`, `${copy}-wal`);
    const database = new Database(copy);
    const rows = database.query<CookieRow, []>("SELECT host_key, name, path, value, encrypted_value, expires_utc, is_secure, is_httponly, samesite, last_access_utc FROM cookies WHERE top_frame_site_key = ''").all();
    const meta = database.query<{ value: string }, []>("SELECT value FROM meta WHERE key = 'version'").get();
    database.close();
    return { rows, metaVersion: Number(meta?.value ?? 0) };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function decryptValue(row: CookieRow, key: Buffer, metaVersion: number): string {
  if (row.encrypted_value.length === 0) return row.value;
  const decipher = createDecipheriv("aes-128-cbc", key, Buffer.alloc(16, " "));
  const plain = Buffer.concat([decipher.update(row.encrypted_value.subarray(3)), decipher.final()]);
  return (metaVersion >= hashedHostMetaVersion ? plain.subarray(hostHashBytes) : plain).toString("utf8");
}

function expiresSeconds(row: CookieRow): number | undefined {
  return row.expires_utc === 0 ? undefined : row.expires_utc / 1_000_000 - chromiumEpochOffsetSeconds;
}

function matchesDomains(host: string, domains: string[] | undefined): boolean {
  if (domains === undefined) return true;
  const bare = host.replace(/^\./, "");
  return domains.some((domain) => bare === domain || bare.endsWith(`.${domain}`));
}

function keepWithinLimit(rows: CookieRow[]): CookieRow[] {
  const byPriority = rows.toSorted((left, right) => right.is_httponly - left.is_httponly || right.last_access_utc - left.last_access_utc);
  return byPriority.slice(0, chromiumCookieLimit).reverse();
}

function toCookieParam(row: CookieRow, value: string): CookieParam {
  const secure = row.is_secure === 1;
  const hostOnly = !row.host_key.startsWith(".");
  const sameSite = sameSiteNames[row.samesite];
  return {
    name: row.name,
    value,
    path: row.path,
    secure,
    httpOnly: row.is_httponly === 1,
    ...(hostOnly ? { url: `${secure ? "https" : "http"}://${row.host_key}${row.path}` } : { domain: row.host_key }),
    ...(expiresSeconds(row) === undefined ? {} : { expires: expiresSeconds(row) }),
    ...(sameSite === undefined || (sameSite === "None" && !secure) ? {} : { sameSite }),
  };
}

async function upload(baseUrl: string, cookies: CookieParam[]): Promise<void> {
  const response = await fetch(`${baseUrl}/api/computer/cookies`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ cookies }),
  });
  if (!response.ok) throw new Error(`Import failed with HTTP ${response.status}: ${await response.text()}`);
  console.log(JSON.stringify(await response.json()));
}

const profile = flagValue("--profile") ?? "Default";
const domains = flagValue("--domains")?.split(",");
const baseUrl = flagValue("--url") ?? "http://127.0.0.1:8787";
const now = Date.now() / 1000;

const { rows, metaVersion } = readCookieRows(profile);
const selected = keepWithinLimit(rows.filter((row) => matchesDomains(row.host_key, domains) && (expiresSeconds(row) ?? Infinity) > now));
console.log(`${selected.length} of ${rows.length} cookies selected`);
if (process.argv.includes("--dry-run")) process.exit(0);

const key = pbkdf2Sync(readKeychainPassword(), "saltysalt", 1003, 16, "sha1");
await upload(baseUrl, selected.map((row) => toCookieParam(row, decryptValue(row, key, metaVersion))));
