#!/usr/bin/env bun

import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    file: { type: "string" },
    to: { type: "string" },
    executable: { type: "boolean", default: false },
    url: { type: "string", default: "http://127.0.0.1:8787" },
  },
});
if (values.file === undefined || values.to === undefined) {
  throw new Error("Usage: install-on-computer.ts --file <local path> --to </workspace/path> [--executable] [--url <app url>]");
}

const query = new URLSearchParams({ path: values.to, executable: values.executable ? "1" : "0" });
const response = await fetch(`${values.url}/api/computer/files?${query}`, { method: "PUT", body: Bun.file(values.file) });
if (!response.ok) throw new Error(`Install failed with HTTP ${response.status}: ${await response.text()}`);
console.log(JSON.stringify(await response.json()));
