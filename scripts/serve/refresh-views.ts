#!/usr/bin/env bun
// prose serve — refresh the HTML views after a tick, so the site always shows
// the current state.
//
// The views are derived projections, never truth: index.html (Today), the talk
// hubs, themes and people pages (render-pages.ts, from the filesystem, the
// intake truth and receipts) and site/index.html (the schedule, from
// the schedule truth). Re-rendering them is cheap and deterministic, so a tick
// that changed anything simply re-renders both. A view that fails to render is
// reported and left as it was; it never fails the tick.
//
// Usage: bun scripts/serve/refresh-views.ts [--root <dir>]

import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const i = argv.indexOf("--root");
const root = resolve(i >= 0 ? argv[i + 1]! : join(HERE, "..", ".."));

const views: Array<[string, string]> = [
  ["pages (index.html, site/talks, themes, people)", "scripts/render-pages.ts"],
  ["schedule (site/index.html)", "scripts/render-site.ts"],
];
const results = views.map(([name, script]) => {
  const run = Bun.spawnSync({ cmd: ["bun", join(root, script)], cwd: root, stdout: "pipe", stderr: "pipe" });
  const line = (run.exitCode === 0 ? run.stdout : run.stderr).toString().trim().split("\n").at(-1) ?? "";
  return { name, ok: run.exitCode === 0, line };
});
for (const r of results) console.log(`${r.ok ? "✓" : "✗"} ${r.name}: ${r.line}`);
