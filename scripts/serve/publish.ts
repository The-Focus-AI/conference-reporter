#!/usr/bin/env bun
// prose serve — publish the build's data and rendered pages to GitHub Pages.
//
// Run after the views are refreshed (tick procedure step 8). It commits only
// data paths, never code, and pushes to origin/main, whose push deploys Pages
// (.github/workflows/pages.yml). It publishes only when something a reader
// would see moved: a note, a talk file, a recording sidecar, a moved
// world-model fingerprint, an analysis. Receipt ledgers, re-stamped
// world-models and re-rendered HTML alone (every tick touches them) wait for
// the next real change and ride along with it.
//
// Never forces. A rejected push (main moved elsewhere) or no network is
// reported and left for the next tick; the commit stays local.
//
// Usage: bun scripts/serve/publish.ts [--root <dir>] [--dry-run] [--reason "<why>"]

import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const root = resolve(flag("root") ?? join(HERE, "..", ".."));
const dryRun = argv.includes("--dry-run");
const reason = flag("reason") ?? "serve tick";

const git = (...args: string[]) => {
  const r = Bun.spawnSync({ cmd: ["git", ...args], cwd: root, stdout: "pipe", stderr: "pipe" });
  return { ok: r.exitCode === 0, out: r.stdout.toString().trim(), err: r.stderr.toString().trim() };
};
const report = (o: Record<string, unknown>) => { console.log(JSON.stringify(o)); process.exit(0); };

// Data the site is built from, plus the rendered pages. Code (scripts/, src/,
// docs, CSS, the runtime) is committed by hand, separately.
const DATA = ["talks", "notes", "recordings", "state", "analysis", "brief", "editorial", "atlases", "photos/manifest.json",
  "site/recommendations.json", "site/index.html", "site/talks", "site/visuals", "site/people.html", "site/themes.html",
  "site/schedule.html", "site/today.html", "site/xref.js", "index.html"];
// Under state/, only a moved fingerprint counts: a render that moved rewrites
// the node's .version. Ledgers, and world-models re-stamped by an unmoved
// render (a gateway records received_at every tick), are noise.
const NOISE = (p: string): boolean => (p.startsWith("state/") && !p.endsWith(".version")) || /\.html$/.test(p) || p === "site/xref.js";

const branch = git("rev-parse", "--abbrev-ref", "HEAD").out;
if (branch !== "main") report({ published: false, why: `on branch ${branch}, not main` });

const changed = git("status", "--porcelain", "-uall", "--", ...DATA).out.split("\n").filter(Boolean).map((l) => l.slice(3).replace(/^"|"$/g, ""));
const meaningful = changed.filter((p) => !NOISE(p));
const ahead = Number(git("rev-list", "--count", "origin/main..HEAD").out || "0");

if (!meaningful.length && !ahead) report({ published: false, why: "nothing a reader would see changed", pending: changed.length });
if (dryRun) report({ published: false, dry_run: true, would_commit: changed.length, meaningful: meaningful.slice(0, 20), ahead });

if (meaningful.length) {
  git("add", "-A", "--", ...DATA);
  const top = [...new Set(meaningful.map((p) => p.split("/").slice(0, p.startsWith("talks/") || p.startsWith("notes/") ? 2 : 1).join("/")))].slice(0, 8);
  const msg = `data: ${reason}\n\n${top.map((t) => `- ${t}`).join("\n")}\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>\n`;
  const c = Bun.spawnSync({ cmd: ["git", "commit", "-q", "-F", "-"], cwd: root, stdin: Buffer.from(msg), stdout: "pipe", stderr: "pipe" });
  if (c.exitCode !== 0) report({ published: false, why: "commit failed", err: c.stderr.toString().trim() });
}

// GitHub Pages address for origin (owner.github.io/repo/), when origin is on GitHub.
const pagesUrl = (): string | null => {
  const m = git("remote", "get-url", "origin").out.match(/github\.com[:/]([^/]+)\/(.+?)(?:\.git)?$/);
  return m ? `https://${m[1]!.toLowerCase()}.github.io/${m[2]}/` : null;
};

const push = git("push", "-q", "origin", "HEAD:main");
const head = git("rev-parse", "--short", "HEAD").out;
report(push.ok
  ? { published: true, commit: head, files: changed.length, url: pagesUrl() }
  : { published: false, committed: head, why: "push failed; commit kept locally for the next tick", err: push.err.split("\n").slice(-2).join(" ") });
