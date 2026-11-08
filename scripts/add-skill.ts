#!/usr/bin/env bun

import { statSync } from "node:fs";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    path: { type: "string" },
    url: { type: "string", default: "http://127.0.0.1:8787" },
  },
});
if (values.path === undefined) {
  throw new Error("Usage: add-skill.ts --path <skill folder or SKILL.md> [--url <app url>]");
}

const body = statSync(values.path).isDirectory() ? await tarFolder(values.path) : Bun.file(values.path);
const response = await fetch(`${values.url}/api/skills`, { method: "POST", body });
if (!response.ok) throw new Error(`Adding the skill failed with HTTP ${response.status}: ${await response.text()}`);
console.log(JSON.stringify(await response.json()));

async function tarFolder(folder: string): Promise<Uint8Array> {
  const tar = Bun.spawn(["tar", "-czf", "-", "--exclude", ".git", "-C", folder, "."], { stdout: "pipe", stderr: "inherit", env: { ...process.env, COPYFILE_DISABLE: "1" } });
  const archive = new Uint8Array(await new Response(tar.stdout).arrayBuffer());
  if ((await tar.exited) !== 0) throw new Error(`tar failed for ${folder}`);
  return archive;
}
