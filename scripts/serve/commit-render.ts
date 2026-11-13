#!/usr/bin/env bun
// Commit one node's rendered world-model: validate, canonicalize, publish, sign.
//
// A render (usually a subagent) writes a candidate world-model and a meta file,
// then calls this. Nothing is published unless the node's compiled postcondition
// passes; on failure the last-good truth stands and the exit code is 1.
//
// Usage:
//   bun scripts/serve/commit-render.ts --node <node> --candidate <candidate.json> --meta <meta.json>
//       [--run-id <YYYYMMDD-HHMMSS-xxxxxx>] [--at <ISO with offset>] [--root <dir>]
//
// meta.json:
//   {
//     "input_fingerprints": { "<producer>.<facet>": "<hex>", ... },
//     "wake": { "source": "input" | "self" | "external", "refs": [ ... ] },
//     "summary": "one paragraph: what moved and why",
//     "cost_accounting": "what the render read, searched and checked",
//     "model": "claude-opus-5-5",          // optional; recorded in cost.model
//     "facet_files": ["recordings", ...],   // facets also written as published/<facet>.json
//     "extra_diff": { ... }                 // optional; merged into semantic_diff
//   }
//
// Writes state/world-model/<node>/versions/<atomic>/world-model.json, the
// published copy and facet files, both .version files, one signed receipt in
// receipts.jsonl, and runs/<run-id>/workspace/commit.json. Prints a JSON summary.
//
// When the canonical fingerprints equal the last receipt's, nothing moved:
// pass --unmoved-ok to record that render (status "rendered", moved_facets [])
// without rewriting the version; otherwise the helper stops and says so, since
// an unmoved render usually means the receipt should be a skip
// (scripts/serve/skip-receipt.ts).

import { createHash, randomBytes } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const flag = (name: string): string | undefined => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : undefined; };
const has = (name: string): boolean => argv.includes(`--${name}`);
const die = (msg: string): never => { console.error(msg); process.exit(2); };

const root = resolve(flag("root") ?? join(HERE, "..", ".."));
const node = flag("node") ?? die("--node is required");
const candPath = flag("candidate") ?? die("--candidate is required");
const metaPath = flag("meta") ?? die("--meta is required");
const now = new Date();
const runId = flag("run-id") ?? `${now.toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15)}-${randomBytes(3).toString("hex")}`;
const at = flag("at") ?? (() => {
  const off = -now.getTimezoneOffset(), sign = off >= 0 ? "+" : "-", a = Math.abs(off);
  const local = new Date(now.getTime() + off * 60e3).toISOString().slice(0, 19);
  return `${local}${sign}${String(Math.floor(a / 60)).padStart(2, "0")}:${String(a % 60).padStart(2, "0")}`;
})();

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
interface Meta {
  input_fingerprints: Record<string, string>;
  wake: { source: string; refs: unknown[] };
  summary: string;
  cost_accounting: string;
  model?: string;
  facet_files?: string[];
  extra_diff?: Record<string, unknown>;
}

const strip = (fp: string): string => fp.replace(/^sha256:/, "");
const canon = (v: Json): Json => Array.isArray(v) ? v.map(canon) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon((v as Record<string, Json>)[k]!)])) : v;

const wm = JSON.parse(readFileSync(candPath, "utf8")) as Record<string, Json>;
const meta = JSON.parse(readFileSync(metaPath, "utf8")) as Meta;
for (const k of ["input_fingerprints", "wake", "summary", "cost_accounting"] as const) if (meta[k] === undefined) die(`meta.json is missing ${k}`);

const ir = JSON.parse(readFileSync(join(root, "dist", "manifest.active.json"), "utf8")) as { contract_fingerprints: Record<string, string> };
if (!ir.contract_fingerprints[node]) die(`node ${node} is not in dist/manifest.active.json`);

const post = require(join(root, "dist", "postconditions", `${node}.js`)) as { validate: (w: unknown) => { ok: boolean; failures: unknown[] } };
const verdict = post.validate(wm);
if (!verdict.ok) { console.log(JSON.stringify({ node, run_id: runId, status: "failed", verdict }, null, 2)); process.exit(1); }

const canonizer = require(join(root, "dist", "canonicalizers", `${node}.js`)) as { canonicalize: (w: unknown) => Record<string, string> };
const fingerprints = Object.fromEntries(Object.entries(canonizer.canonicalize(wm)).map(([k, v]) => [k, strip(v)]));
const atomic = fingerprints["@atomic"]!;

const wmDir = join(root, "state", "world-model", node);
const ledger = join(wmDir, "receipts.jsonl");
const lines = existsSync(ledger) ? readFileSync(ledger, "utf8").trim().split("\n").filter(Boolean) : [];
const prior = lines.length ? (JSON.parse(lines.at(-1)!) as { run_id?: string; fingerprints?: Record<string, string> }) : null;
const moved = Object.keys(fingerprints).filter((k) => k !== "@atomic" && fingerprints[k] !== prior?.fingerprints?.[k]);
const unmoved = prior?.fingerprints?.["@atomic"] === atomic;
if (unmoved && !has("unmoved-ok")) die(`fingerprints unmoved (@atomic ${atomic.slice(0, 12)}): write a skip receipt, or pass --unmoved-ok to record this render`);

if (!unmoved) {
  mkdirSync(join(wmDir, "versions", atomic), { recursive: true });
  mkdirSync(join(wmDir, "published"), { recursive: true });
  const pretty = JSON.stringify(wm, null, 2) + "\n";
  writeFileSync(join(wmDir, "versions", atomic, "world-model.json"), pretty);
  writeFileSync(join(wmDir, "published", "world-model.json"), pretty);
  for (const f of meta.facet_files ?? []) writeFileSync(join(wmDir, "published", `${f}.json`), JSON.stringify(wm[f], null, 2) + "\n");
  writeFileSync(join(wmDir, ".version"), atomic + "\n");
  writeFileSync(join(wmDir, "published", ".version"), atomic + "\n");
}

const receipt = {
  at,
  contract_fingerprint: strip(ir.contract_fingerprints[node]!),
  cost: { accounting: meta.cost_accounting, model: meta.model ?? null, provider: meta.model ? "anthropic" : null, surprise_cause: meta.wake.source, tokens: { fresh: null, reused: null } },
  fingerprints,
  input_fingerprints: meta.input_fingerprints,
  node,
  prev: prior?.fingerprints?.["@atomic"] ?? null,
  run_id: runId,
  semantic_diff: { summary: meta.summary, moved_facets: moved, prior_render: prior?.run_id ?? null, postcondition: verdict, ...(meta.extra_diff ?? {}) },
  status: "rendered",
  wake: meta.wake,
};
const sig = { alg: "sha256-canonical-json", digest: createHash("sha256").update(JSON.stringify(canon(receipt as unknown as Json))).digest("hex"), signer: null, v: 1 };
mkdirSync(wmDir, { recursive: true });
appendFileSync(ledger, JSON.stringify({ ...receipt, sig }) + "\n");

mkdirSync(join(root, "runs", runId, "workspace"), { recursive: true });
writeFileSync(join(root, "runs", runId, "workspace", "commit.json"), JSON.stringify({ node, status: "rendered", atomic, prev: receipt.prev, moved, unmoved, postcondition: verdict }) + "\n");
console.log(JSON.stringify({ node, run_id: runId, atomic: atomic.slice(0, 12), prev: receipt.prev?.slice(0, 12) ?? null, moved, unmoved }, null, 2));
