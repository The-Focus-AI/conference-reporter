#!/usr/bin/env bun
// prose serve — sign a `skipped` receipt for a node whose memo key did not move.
//
// The reconciler's cheap path: a wake whose (contract_fingerprint,
// input_fingerprints) equals the node's last receipt renders nothing. It appends
// one skipped receipt (zero cost, prior fingerprints carried) and exits.
//
// Usage:
//   bun scripts/serve/skip-receipt.ts --node conference-schedule --source self \
//     --trigger-id conference-schedule:self:2026-11-10T15:06:00-08:00 [--reason "..."]

import { createHash } from "node:crypto";
import { appendFileSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const flag = (name: string, fallback?: string): string | undefined => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : fallback;
};
const root = resolve(flag("root", join(HERE, "..", ".."))!);
const node = flag("node");
const source = flag("source", "self")!;
if (!node) {
  console.error("--node is required");
  process.exit(2);
}

const strip = (fp: string): string => fp.replace(/^sha256:/, "");
const canon = (v: unknown): unknown =>
  Array.isArray(v) ? v.map(canon)
  : v && typeof v === "object" ? Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, canon((v as Record<string, unknown>)[k])]))
  : v;
const ny = (d: Date): string => {
  const off = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", timeZoneName: "longOffset" }).formatToParts(d).find((p) => p.type === "timeZoneName")!.value.replace("GMT", "");
  return d.toLocaleString("sv-SE", { timeZone: "America/New_York" }).replace(" ", "T") + off;
};

const ledger = join(root, "state/world-model", node, "receipts.jsonl");
const prior = JSON.parse(readFileSync(ledger, "utf8").trim().split("\n").at(-1)!);
const ir = JSON.parse(readFileSync(join(root, "dist/manifest.active.json"), "utf8"));
const contract = strip(ir.contract_fingerprints[node]);
if (contract !== prior.contract_fingerprint) {
  console.error(`contract moved for ${node} (${prior.contract_fingerprint.slice(0, 12)} → ${contract.slice(0, 12)}): render, do not skip`);
  process.exit(3);
}
// The memo key is contract AND inputs: refuse when any upstream facet this node
// subscribes to has moved since its last receipt (e.g. the inbox moved this tick).
const movedInputs = Object.entries((prior.input_fingerprints ?? {}) as Record<string, string>).filter(([key, fp]) => {
  const [up, facet] = [key.slice(0, key.indexOf(".")), key.slice(key.indexOf(".") + 1)];
  const lines = readFileSync(join(root, "state/world-model", up, "receipts.jsonl"), "utf8").trim().split("\n");
  const current = JSON.parse(lines.at(-1)!).fingerprints?.[facet];
  return current !== undefined && strip(current) !== strip(fp);
}).map(([key]) => key);
if (movedInputs.length) {
  console.error(`input moved for ${node} (${movedInputs.join(", ")}): render, do not skip`);
  process.exit(4);
}

const now = new Date();
const at = ny(now);
const stamp = at.replace(/[-:T]/g, "").slice(0, 14);
const runId = `${stamp.slice(0, 8)}-${stamp.slice(8, 14)}-${createHash("sha256").update(at + Math.random()).digest("hex").slice(0, 6)}`;
const triggerId = flag("trigger-id", `${node}:${source}:${at}`)!;
const receipt = {
  at,
  contract_fingerprint: contract,
  cost: { accounting: "memo hit; no render", model: null, provider: null, surprise_cause: source, tokens: { fresh: null, reused: null } },
  fingerprints: prior.fingerprints,
  input_fingerprints: prior.input_fingerprints ?? {},
  node,
  prev: prior.fingerprints["@atomic"],
  run_id: runId,
  semantic_diff: { summary: flag("reason", `${source} wake: contract and input fingerprints unchanged; no render`) },
  status: "skipped",
  wake: { source, refs: [{ trigger: source === "self" ? "self-clock" : source, trigger_id: triggerId, fired_at: at }] },
};
const sig = { alg: "sha256-canonical-json", digest: createHash("sha256").update(JSON.stringify(canon(receipt))).digest("hex"), signer: null, v: 1 };
appendFileSync(ledger, JSON.stringify({ ...receipt, sig }) + "\n");
console.log(JSON.stringify({ node, status: "skipped", run_id: runId }));
