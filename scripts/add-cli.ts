#!/usr/bin/env bun

import { basename } from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    file: { type: "string" },
    name: { type: "string" },
    description: { type: "string", default: "" },
    url: { type: "string", default: "http://127.0.0.1:8787" },
  },
});
if (values.file === undefined) {
  throw new Error("Usage: add-cli.ts --file <linux amd64 binary> [--name <name>] [--description <text>] [--url <app url>]");
}

const name = values.name ?? basename(values.file).toLowerCase();
const query = new URLSearchParams({ description: values.description });
const response = await fetch(`${values.url}/api/clis/${encodeURIComponent(name)}?${query}`, { method: "PUT", body: Bun.file(values.file) });
if (!response.ok) throw new Error(`Adding ${name} failed with HTTP ${response.status}: ${await response.text()}`);
console.log(JSON.stringify(await response.json()));
