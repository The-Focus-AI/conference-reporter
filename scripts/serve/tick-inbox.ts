#!/usr/bin/env bun
// prose serve — one `recording-inbox-watch` tick.
//
// Deterministic: scans the inbox, canonicalizes `inbox_scans`, writes a signed
// receipt, and reports whether the folder fingerprint moved (the only thing that
// can wake `recording-intake`). No model call lives here.
//
// Usage:
//   bun scripts/serve/tick-inbox.ts --fired-at 2026-10-23T18:30:00-04:00

import { createHash } from "node:crypto";
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { scanInbox } from "./scan-inbox.ts";
import type { CanonicalizerModule, Manifest, PostconditionModule, Receipt, WakeSource } from "./types.ts";

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));

const argv = process.argv.slice(2);
const flag = (name: string, fallback?: string): string | undefined => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : fallback;
};

const root = resolve(flag("root", join(HERE, "..", ".."))!);
const node = "recording-inbox-watch";
const firedAt = flag("fired-at") ?? new Date().toISOString();

const ny = (d: Date): string => {
  const timeZone = "America/New_York";
  const offset = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset" })
    .formatToParts(d).find((p) => p.type === "timeZoneName")!.value.replace("GMT", "");
  return d.toLocaleString("sv-SE", { timeZone }).replace(" ", "T") + offset;
};
const now = ny(new Date());
const localStamp = new Date().toLocaleString("sv-SE", { timeZone: "America/New_York" }).replace(/[-: ]/g, "").slice(0, 14);
const runId = flag("run-id") ?? `${localStamp.slice(0, 8)}-${localStamp.slice(8, 14)}-${createHash("sha256").update(`${firedAt}${Math.random()}`).digest("hex").slice(0, 6)}`;

const readJson = <T>(p: string): T => JSON.parse(readFileSync(p, "utf8")) as T;
const strip = (fp: string): string => fp.replace(/^sha256:/, "");
const canon = (v: unknown): unknown =>
  Array.isArray(v) ? v.map(canon)
  : v && typeof v === "object" ? Object.fromEntries(Object.keys(v as Record<string, unknown>).sort().map((k) => [k, canon((v as Record<string, unknown>)[k])]))
  : v;

// The mover's transcript upgrade runs first: every recording should be on the
// local Qwen transcript (more accurate than Voice Memos). It runs only on AC power
// or battery above the floor, and defers otherwise; a recording it upgrades gets
// a new transcript in force, which moves the folder fingerprint below.
const upgradeRun = argv.includes("--no-upgrade")
  ? null
  : Bun.spawnSync({ cmd: ["bun", join(root, "scripts", "export-voice-memos.ts"), "--transcribe-missing"], cwd: root, stdout: "pipe", stderr: "pipe" });
const upgradeLine = upgradeRun
  ? (upgradeRun.stdout.toString().split("\n").filter((l) => l.includes("qwen ")).at(-1) ?? upgradeRun.stderr.toString().trim().split("\n").at(-1) ?? "").trim()
  : "skipped (--no-upgrade)";

const scan = await scanInbox({ root, inbox: join(root, "recordings", "inbox") });
const wm: Record<string, unknown> = {
  inbox_scans: {
    folder_fingerprint: scan.folder_fingerprint,
    folder_count: scan.folder_count,
    latest_recorded_at: scan.latest_recorded_at,
    scanned_at: now,
  },
};

const ir = readJson<Manifest>(join(root, "dist", "manifest.active.json"));
const canonizer = require(join(root, "dist", "canonicalizers", `${node}.js`)) as CanonicalizerModule;
const fingerprints = Object.fromEntries(Object.entries(canonizer.canonicalize(wm)).map(([k, v]) => [k, strip(v)]));
const atomic = fingerprints["@atomic"]!;

const wmDir = join(root, "state", "world-model", node);
const ledger = join(wmDir, "receipts.jsonl");
const prior = ((): Receipt | null => {
  if (!existsSync(ledger)) return null;
  const lines = readFileSync(ledger, "utf8").trim().split("\n").filter(Boolean);
  return lines.length ? (JSON.parse(lines.at(-1)!) as Receipt) : null;
})();

const triggerId = `${node}:*/15 * * * *:${firedAt}`;
if (prior?.wake.refs.some((r) => r.trigger_id === triggerId)) {
  console.log(JSON.stringify({ deduped: true, trigger_id: triggerId, run_id: prior.run_id }));
  process.exit(0);
}

const runDir = join(root, "runs", runId);
mkdirSync(join(runDir, "sources"), { recursive: true });
mkdirSync(join(runDir, "workspace", node), { recursive: true });
const manifestSha = createHash("sha256").update(readFileSync(join(root, "dist", "manifest.active.json"))).digest("hex");
writeFileSync(join(runDir, "activation.json"), JSON.stringify({
  kind: "openprose.activation", node, run_id: runId, started_at: now,
  manifest: { path: "dist/manifest.active.json", sha256: manifestSha },
  wake: { source: "external" satisfies WakeSource, refs: [{ trigger: "cron", trigger_id: triggerId, expression: "*/15 * * * *", fired_at: firedAt }] },
  root: `src/${node}.prose.md`, prior_run: prior?.run_id ?? null,
}, null, 2) + "\n");
copyFileSync(join(root, `src/${node}.prose.md`), join(runDir, "root.prose.md"));
copyFileSync(join(root, "src/scan-recording-inbox.prose.md"), join(runDir, "sources", "scan-recording-inbox.prose.md"));

mkdirSync(join(wmDir, "versions", atomic), { recursive: true });
mkdirSync(join(wmDir, "published"), { recursive: true });
const pretty = JSON.stringify(wm, null, 2) + "\n";
writeFileSync(join(wmDir, "versions", atomic, "world-model.json"), pretty);
writeFileSync(join(wmDir, "published", "world-model.json"), pretty);
writeFileSync(join(wmDir, ".version"), atomic + "\n");
writeFileSync(join(wmDir, "published", ".version"), atomic + "\n");

const post = require(join(root, "dist", "postconditions", `${node}.js`)) as PostconditionModule;
const verdict = post.validate(wm);
const moved = atomic !== prior?.fingerprints["@atomic"];

const receipt: Omit<Receipt, "sig"> = {
  at: now,
  contract_fingerprint: strip(ir.contract_fingerprints[node]!),
  cost: { accounting: "deterministic folder scan; no model call", model: null, provider: null, surprise_cause: "external", tokens: { fresh: null, reused: null } },
  fingerprints,
  input_fingerprints: {},
  node,
  prev: prior?.fingerprints["@atomic"] ?? null,
  run_id: runId,
  semantic_diff: {
    first_run: !prior,
    summary: moved
      ? `folder fingerprint moved: ${prior?.fingerprints["@atomic"]?.slice(0, 12) ?? "none"} → ${atomic.slice(0, 12)} · ${scan.folder_count} folders · latest ${scan.latest_recorded_at}`
      : `scheduled 15-minute scan: ${scan.folder_count} folders, folder fingerprint unchanged, no arrival; nothing downstream wakes`,
    folder_fingerprint: scan.folder_fingerprint,
    folder_count: scan.folder_count,
    latest_recorded_at: scan.latest_recorded_at,
    transcript_upgrade: upgradeLine,
  },
  status: "rendered",
  wake: { source: "external", refs: [{ trigger: "cron", trigger_id: triggerId, expression: "*/15 * * * *", fired_at: firedAt }] },
};
const sig = {
  alg: "sha256-canonical-json",
  digest: createHash("sha256").update(JSON.stringify(canon(receipt))).digest("hex"),
  signer: null,
  v: 1,
};
appendFileSync(ledger, JSON.stringify({ ...receipt, sig }) + "\n");

writeFileSync(join(runDir, "vm.log.md"), `# run:${runId} ${node}
root: src/recording-inbox-watch.prose.md

1→ [external] cron */15 ${triggerId} ✓
1→ transcript upgrade: ${upgradeLine}
1→ scan-recording-inbox ✓ ${scan.folder_count} folders · fingerprint ${scan.folder_fingerprint}
1→ ${node} ✓ rendered @atomic ${atomic} (${moved ? "MOVED" : "unmoved"})
1→ [propagate] ${moved ? "recording-intake (@atomic) → wake" : "none — inbox_scans did not move"}
---end ${now}
`);

// Step 7: when the inbox moved, refresh the HTML views so the site shows it.
const views = moved
  ? Bun.spawnSync({ cmd: ["bun", join(root, "scripts", "serve", "refresh-views.ts")], cwd: root, stdout: "pipe", stderr: "pipe" }).stdout.toString().trim().split("\n")
  : [];

console.log(JSON.stringify({
  run_id: runId, node, atomic, moved, prev: prior?.fingerprints["@atomic"] ?? null,
  folder_fingerprint: scan.folder_fingerprint, folder_count: scan.folder_count,
  postcondition: verdict, trigger_id: triggerId, transcript_upgrade: upgradeLine, views,
}, null, 2));
