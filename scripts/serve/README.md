# prose serve — runtime operating manual

`prose serve` is the **run phase** of this repository's OpenProse program. It does
not compile and it holds no semantic judgment: it loads the active compiled
intent, registers triggers, compares fingerprints, launches ordinary bounded
renders, and appends receipts.

Doctrine: [responsibility-runtime.md](../../.agents/skills/open-prose/responsibility-runtime.md)
and [concepts/reconciler.md](../../.agents/skills/open-prose/concepts/reconciler.md).
This file is the operator/host mapping for that doctrine in *this* repository.

## Pieces

| Piece | Path | Role |
| --- | --- | --- |
| Validator | `scripts/serve/validate-manifest.ts` | Validates `dist/manifest.active.json` against `compiler/ir-v0.md`, checks artifacts, and derives the trigger plan. |
| Fingerprint check | `scripts/serve/check-fingerprints.ts` | Tests compiled canonicalizers and validators against populated models. Run after every compile, before promoting; the validator cannot catch a canonicalizer that hashes populated truth as empty. |
| HTTP adapter | `scripts/serve/http-adapter.ts` | Loopback listener. Accepts the declared `POST` ingress routes, returns `202`, spools the event. |
| Runtime state | `runs/serve/` | `serve.json`, `triggers.json`, `policy.json`, `triggers/` spool, `serve.log.md`. Generated; `runs/` is gitignored. |
| Trigger plan | `runs/serve/triggers.json` | The resolved cron / HTTP / self-clock registrations from the manifest + contracts. |
| Pause policy | `runs/serve/policy.json` | Operator scoping of nodes. Optional. |

Nothing here reloads a changed manifest. Recompile, promote
`manifest.next.json` → `manifest.active.json`, then restart serve.

## Starting

```bash
bun scripts/serve/validate-manifest.ts        # must print VALID
# write runs/serve/triggers.json from the validator's --json plan (registration)
bun scripts/serve/http-adapter.ts --port 8787 &
# register the cron adapters (host: DSH sessions — see "Host mapping" below)
```

A serve start is **not** a wake. Nothing renders until a trigger fires: a cron
fire, an HTTP event, or a self-clock coming due.

## Triggers

The active topology declares two kinds of ingress, both external-driven gateways:

| Gateway | Cron | Route | Event |
| --- | --- | --- | --- |
| `recording-inbox-watch` | `*/15 * * * *` | `POST /webhooks/recordings/scan` | `scan-requested` |
| `schedule-check` | `0 */6 * * *` | `POST /webhooks/conference/check` | `check-requested` |

Self-clocks come from `### Continuity`: `conference-schedule` (6h upcoming,
hourly in `[starts_on − 72h, ends_on + 24h]`, daily archived),
`recording-intake` (15m), `talk-photos` (6h during the event + 7 days) and
`talk-links` (6h during the event + 72h, daily to 30 days, weekly to 90 days,
then settled). A self-tick is a synthetic self-receipt; it rides the same
propagation path as an upstream receipt. The settling cadence is why a dossier
picks up the recording or recap post that appeared days after the talk.

### Host mapping

This host has no daemon supervisor; it has a session scheduler. The mapping:

- **cron adapter** → one DSH scheduled reminder per cron expression. The due
  prompt is the tick; the tick handler is this session running the procedure
  below. Schedules are session-scoped: if the serve session ends, the triggers
  end with it.
- **HTTP adapter** → the loopback listener. It acknowledges before the render
  and spools; the next tick drains the spool. Webhook latency is therefore
  bounded by the tick cadence (≤ 15m), not by render duration.

## Tick procedure

Run this on every due trigger. It is deterministic; the renders it launches are
the only intelligent steps.

1. **Check the intent.** `bun scripts/serve/validate-manifest.ts`. Not `VALID`
   → log the errors and stop. Never serve an invalid manifest.
2. **Drain the spool.** For each `runs/serve/triggers/*.json`, read the event and
   move the file to `runs/serve/triggers/processed/`. Each event is an
   external-driven edge receipt for its `node`.
3. **Collect the wake set.** Due cron fires from `triggers.json`, drained HTTP
   events, and self-clocks whose cadence has elapsed since the node's last
   receipt. De-duplicate: one wake per node per tick; coalesce the refs.
4. **Reconcile each woken node**, in topology order (producers before
   subscribers):
   - `policy.json` pauses the node → write a `skipped` receipt with
     `semantic_diff.reason: "paused-by-operator"`; do not render.
   - Memo key = `(contract_fingerprint, input_fingerprints)`. The contract
     fingerprint is the manifest node's; each input fingerprint is the producer
     receipt's published `fingerprints.<facet>` for the subscribed facet.
     Unchanged since the node's last receipt → `skipped` receipt, spawn nothing.
   - **External gateways are the exception that proves the rule:** the wake's
     trigger id *is* an input fingerprint. A fresh cron fire or webhook event is
     new evidence and must be observed (a gateway with no inputs would otherwise
     skip forever); only a re-delivery of the *same* trigger id may skip. The
     gateway's render re-observes the world — if the observation is unchanged its
     own fingerprints do not move, so nothing downstream wakes.
   - Otherwise **launch one bounded render** and let it commit (below).
5. **Propagate.** Only a `rendered` receipt whose facet fingerprints moved wakes
   subscribers. Resolve targets from `topology.edges`; a subscriber of facet *X*
   does not wake for facet *Y*. A `skipped` or `failed` receipt propagates
   nothing.
6. **Log.** Append one line per wake and per propagation decision to
   `runs/serve/serve.log.md`.

Single-flight: one render per node at a time. A wake that arrives while a render
is in flight marks the node dirty and collapses into one follow-up render; the
tick never stacks N renders.

## A bounded render (activation)

Each activation gets its own `runs/{YYYYMMDD}-{HHMMSS}-{random6}/` directory,
mirroring `runs/20261023-144257-23b283/`:

```text
activation.json        # kind: openprose.activation — node, wake {source, refs}, manifest sha
root.prose.md          # snapshot of the invoked responsibility/gateway source
sources/               # snapshots of the functions it calls
compiled-intent.json   # the active topology slice the render was handed
workspace/             # private scratch — never fingerprinted
vm.log.md              # append-only execution log
```

The render reads the **prior world-model by reference** (never pre-stuffed),
writes a candidate world-model, applies its compiled canonicalizer locally:

```bash
bun -e 'const c=require("./dist/canonicalizers/<node>.js");console.log(JSON.stringify(c.canonicalize(require(process.argv[1])),null,2))' <candidate.json>
```

and self-polices its `### Maintains` postconditions (plus, when the manifest says
`deterministic`, `dist/postconditions/<node>.js` → `validate(worldModel)`). On
success it commits:

- `state/world-model/<node>/versions/<atomic-fp>/world-model.json`
- `state/world-model/<node>/published/world-model.json` and per-facet artifacts
- `state/world-model/<node>/.version` and `published/.version`
- one receipt appended to `state/world-model/<node>/receipts.jsonl`

On failure nothing is published: write the `failed` receipt, leave the last-good
truth standing.

### Receipt shape

Identical to the existing ledger entries (see
`state/world-model/conference-schedule/receipts.jsonl`):

```json
{"at":"...","contract_fingerprint":"<hex>","cost":{...},"fingerprints":{"@atomic":"...","<facet>":"..."},"input_fingerprints":{...},"node":"...","prev":"<prior atomic fp or null>","run_id":"...","semantic_diff":{...},"sig":{"alg":"sha256-canonical-json","digest":"...","signer":null,"v":1},"status":"rendered","wake":{"refs":[...],"source":"input|self|external"}}
```

- `status` is `rendered` | `skipped` | `failed`. Skipped carries zero cost.
- `cost.tokens` stay `null` rather than estimated; `surprise_cause` must equal
  `wake.source`.
- `sig.digest` is sha256 over the canonical JSON of the receipt without `sig`.
- **Fingerprint normalization:** the manifest carries `sha256:<hex>` tokens; this
  ledger stores bare lowercase hex and normalizes with `strip(/^sha256:/)` on
  every comparison. Do not treat the prefix as a change.

## Pausing or fencing a node

`runs/serve/policy.json` scopes serve without touching the contracts:

```json
{
  "paused":   { "recording-intake": { "at": "...", "by": "operator", "reason": "..." } },
  "inflight": { "recording-intake": { "run_id": "...", "started_at": "...", "by": "operator", "reason": "..." } }
}
```

- `paused` — no render and no propagation. The node's upstream gateways keep
  ticking and keep their own truth current, so the backlog is measured, not
  lost. Remove the entry to resume.
- `inflight` — a render for this node is currently running in another turn. A
  wake that arrives now is coalesced into the follow-up render (single-flight),
  not spawned in parallel. Clear the entry when the render commits.

Both are operator controls, not semantic judgments: the reconciler still decides
skip-vs-render from fingerprints when the node is neither paused nor in flight.

## Limits (v0)

- Session-scoped schedules; no standalone daemon.
- No automatic manifest reload; restart serve after promoting a new compile.
- No webhook authentication; the adapter binds loopback only.
- No queue, file-watch, or provider-subscription adapters.
- One session = one serve instance.
