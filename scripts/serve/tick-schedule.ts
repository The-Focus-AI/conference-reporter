#!/usr/bin/env bun
// prose serve — one `schedule-check` gateway tick.
//
// Deterministic: records the incoming check request (a cron fire or a manual
// kick) as `check_requests`, canonicalizes it, writes the world-model, and signs
// a receipt. A new request id moves the fingerprint, which is what wakes
// `conference-schedule` to re-verify the official pages. No model call lives here.
//
// Usage:
//   bun scripts/serve/tick-schedule.ts --fired-at 2026-11-10T18:07:00-08:00 [--reason cron-tick|manual-kick]

import { createHash } from "node:crypto";
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const flag = (name: string, fallback?: string): string | undefined => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : fallback;
};
const root = resolve(flag("root", join(HERE, "..", ".."))!);
const node = "schedule-check";
const firedAt = flag("fired-at") ?? new Date().toISOString();
const reason = flag("reason", "cron-tick")!;
const expression = "0 */6 * * *";

const strip = (fp: string): string => fp.replace(/^sha256:/, "");
const canon = (v: unknown): unknown =>
  Array.isArray(v) ? v.map(canon)
  : v && typeof v === "object" ? Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, canon((v as Record<string, unknown>)[k])]))
  : v;
const ny = (d: Date): string => {
  const off = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", timeZoneName: "longOffset" }).formatToParts(d).find((p) => p.type === "timeZoneName")!.value.replace("GMT", "");
  return d.toLocaleString("sv-SE", { timeZone: "America/New_York" }).replace(" ", "T") + off;
};
const now = ny(new Date());
const stamp = now.replace(/[-:T]/g, "").slice(0, 14);
const runId = `${stamp.slice(0, 8)}-${stamp.slice(8, 14)}-${createHash("sha256").update(firedAt + Math.random()).digest("hex").slice(0, 6)}`;
const triggerId = reason === "cron-tick" ? `${node}:${expression}:${firedAt}` : `${node}:${reason}:${firedAt}`;

const wmDir = join(root, "state", "world-model", node);
const ledger = join(wmDir, "receipts.jsonl");
const prior = existsSync(ledger) ? JSON.parse(readFileSync(ledger, "utf8").trim().split("\n").at(-1)!) : null;
if (prior?.wake?.refs?.some((r: { trigger_id: string }) => r.trigger_id === triggerId)) {
  console.log(JSON.stringify({ deduped: true, trigger_id: triggerId, run_id: prior.run_id }));
  process.exit(0);
}

const wm = { check_requests: { items: [{ request_id: triggerId, reason, requested_at: firedAt }], received_at: now } };
const ir = JSON.parse(readFileSync(join(root, "dist", "manifest.active.json"), "utf8"));
const fingerprints = Object.fromEntries(Object.entries(require(join(root, "dist", "canonicalizers", `${node}.js`)).canonicalize(wm)).map(([k, v]) => [k, strip(v as string)])) as Record<string, string>;
const atomic = fingerprints["@atomic"]!;
const post = require(join(root, "dist", "postconditions", `${node}.js`)).validate(wm);
if (!post.ok) {
  console.error(JSON.stringify(post));
  process.exit(1);
}

const pretty = (v: unknown) => JSON.stringify(v, null, 2) + "\n";
mkdirSync(join(wmDir, "versions", atomic), { recursive: true });
mkdirSync(join(wmDir, "published"), { recursive: true });
writeFileSync(join(wmDir, "versions", atomic, "world-model.json"), pretty(wm));
writeFileSync(join(wmDir, "published", "world-model.json"), pretty(wm));
writeFileSync(join(wmDir, ".version"), atomic + "\n");
writeFileSync(join(wmDir, "published", ".version"), atomic + "\n");

const moved = atomic !== prior?.fingerprints?.["@atomic"];
const wake = { source: "external", refs: [{ trigger: reason === "cron-tick" ? "cron" : "manual", trigger_id: triggerId, expression, fired_at: firedAt }] };
const receipt = {
  at: now,
  contract_fingerprint: strip(ir.contract_fingerprints[node]),
  cost: { accounting: "deterministic ingress record; no model call", model: null, provider: null, surprise_cause: "external", tokens: { fresh: null, reused: null } },
  fingerprints,
  input_fingerprints: {},
  node,
  prev: prior?.fingerprints?.["@atomic"] ?? null,
  run_id: runId,
  semantic_diff: { summary: `${reason} check request recorded${moved ? "; fingerprint moved, conference-schedule wakes" : ""}` },
  status: "rendered",
  wake,
};
const sig = { alg: "sha256-canonical-json", digest: createHash("sha256").update(JSON.stringify(canon(receipt))).digest("hex"), signer: null, v: 1 };
appendFileSync(ledger, JSON.stringify({ ...receipt, sig }) + "\n");

const runDir = join(root, "runs", runId);
mkdirSync(runDir, { recursive: true });
copyFileSync(join(root, `src/${node}.prose.md`), join(runDir, "root.prose.md"));
writeFileSync(join(runDir, "vm.log.md"), `# run:${runId} ${node}\n\n1→ [external] ${wake.refs[0]!.trigger} ${triggerId} ✓\n1→ ${node} ✓ rendered @atomic ${atomic} (${moved ? "MOVED" : "unmoved"})\n---end ${now}\n`);
console.log(JSON.stringify({ run_id: runId, node, atomic, moved, trigger_id: triggerId, postcondition: post }, null, 2));
