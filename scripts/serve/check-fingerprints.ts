#!/usr/bin/env bun
// Checks compiled canonicalizers and postconditions against populated models.
//
// `prose compile` generates dist/ per build, and these bugs pass manifest
// validation: a `[]` path that cannot read a keyed map hashes populated truth the
// same as empty truth, so subscribers never wake and nothing reports an error.
// Run this after every compile, before promoting.
//
// Usage: bun scripts/serve/check-fingerprints.ts [--root <dir>]

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const i = argv.indexOf("--root");
const root = resolve(i >= 0 ? argv[i + 1]! : join(HERE, "..", ".."));

type Fingerprints = Record<string, string>;
type Model = any; // eslint-disable-line @typescript-eslint/no-explicit-any

if (!existsSync(join(root, "dist", "canonicalizers"))) {
  console.error("no dist/canonicalizers: run `prose compile` first");
  process.exit(2);
}

const canon = (node: string) =>
  (require(join(root, "dist/canonicalizers", `${node}.js`)) as { canonicalize: (m: Model) => Fingerprints }).canonicalize;
const validate = (node: string) =>
  (require(join(root, "dist/postconditions", `${node}.js`)) as { validate: (m: Model) => { ok: boolean; failures: string[] } }).validate;

const EMPTY = "sha256:" + createHash("sha256").update("[]").digest("hex");
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));
const moved = (a: Fingerprints, b: Fingerprints): string => Object.keys(a).filter((k) => a[k] !== b[k]).sort().join(",");

let failed = 0;
const check = (name: string, ok: boolean, detail = ""): void => {
  console.log(`${ok ? "pass" : "FAIL"}  ${name}${!ok && detail ? `  (${detail})` : ""}`);
  if (!ok) failed++;
};

// conference-schedule: `speakers` is a keyed map.
{
  const c = canon("conference-schedule");
  const session = { session_id: "s1", title: "A talk", abstract: null, track: null, format: "talk", room_id: "r1", location_note: null, day: "2026-01-01", starts_at: "2026-01-01T09:00:00-08:00", ends_at: "2026-01-01T09:30:00-08:00", speaker_ids: ["a"], status: "scheduled", source_url: "u", source_anchor: "x" };
  const speaker = (name: string) => ({ name, affiliation: "Org", bio: "Bio", links: [], talks: ["s1"], source_url: "u" });
  const m: Model = {
    event: { name: "E", timezone: "America/Los_Angeles", starts_on: "2026-01-01", ends_on: "2026-01-01", status: "upcoming" },
    venue: { name: "V", rooms: [{ room_id: "r1", name: "R", floor: "1" }], confirmed: true },
    program: { days: [{ date: "2026-01-01", label: null, session_count: 1 }], sessions: [session], session_count: 1, stated_session_count: null },
    speakers: { a: speaker("A"), b: speaker("B") },
    change_log: [],
    coverage: { pages: [{ url: "u", role: "schedule", content_hash: "h", byte_length: 1, truncated: false }], unparsed_regions: [], gaps: [], last_verified_at: "t", verification_count: 1, enrichment: { done: [], pending: [], failed: [] } },
  };
  const base = c(m);
  check("schedule: speakers hashes populated truth", base.speakers !== EMPTY);
  const bio = clone(m); bio.speakers.a.bio = "New";
  check("schedule: a bio moves speakers and @atomic only", moved(base, c(bio)) === "@atomic,speakers", moved(base, c(bio)));
  const order = clone(m); order.speakers = { b: m.speakers.b, a: m.speakers.a };
  check("schedule: speaker key order moves nothing", moved(base, c(order)) === "", moved(base, c(order)));
  const swap = clone(m); swap.speakers = { a: m.speakers.b, b: m.speakers.a };
  check("schedule: swapping two speakers moves speakers", moved(base, c(swap)).includes("speakers"));
  const poll = clone(m); poll.coverage.last_verified_at = "later"; poll.coverage.verification_count = 2; poll.coverage.pages[0].content_hash = "h2";
  check("schedule: poll bookkeeping moves nothing", moved(base, c(poll)) === "", moved(base, c(poll)));
  const pending = clone(m); pending.coverage.enrichment.pending = ["c"];
  check("schedule: enrichment.pending moves coverage", moved(base, c(pending)).includes("coverage"));
  const v = validate("conference-schedule");
  check("schedule: valid model passes", v(m).ok, v(m).failures.join("; "));
  const nullFormat = clone(m); Object.assign(nullFormat.program.sessions[0], { format: null, speaker_ids: [] });
  check("schedule: speakerless format null passes", v(nullFormat).ok, v(nullFormat).failures.join("; "));
  const side = clone(m); Object.assign(side.program.sessions[0], { format: "side-event", speaker_ids: [] });
  check("schedule: speakerless side-event passes", v(side).ok, v(side).failures.join("; "));
  const talk = clone(m); talk.program.sessions[0].speaker_ids = [];
  check("schedule: speakerless talk fails", !v(talk).ok);
  for (const text of ["TBD", "Details TBD.", "Description TBD"]) {
    const tbd = clone(m); tbd.program.sessions[0].abstract = text;
    check(`schedule: abstract "${text}" fails`, !v(tbd).ok);
  }
}

// recording-intake: `recordings`, `matches`, and `talks` are keyed maps.
{
  const c = canon("recording-intake");
  const m: Model = {
    recordings: { r1: { folder: "f", path: "p", title: "t", recorded_at: "x", duration_seconds: 60, word_count: 10, audio_sha256: "a", status: "new" } },
    matches: { r1: { session_id: "s1", confidence: 0.9, method: "time", evidence: ["q"], candidates: [], status: "matched" } },
    talks: { s1: { slug: "my-talk", path: "talks/my-talk/transcript.md", title: "T", speakers: ["A"], room_id: "r", starts_at: "x", source_recording: "r1", sections: ["00:00:00"], word_count: 10, cleaned_at: "x" } },
    attachments: [{ talk_slug: "my-talk", path: "a.png", placement: "inline", at_seconds: 5, caption: null, source: "s" }],
  };
  const base = c(m);
  for (const f of ["@atomic", "recordings", "matches", "talks", "attachments"]) check(`intake: ${f} hashes populated truth`, base[f] !== EMPTY);
  const title = clone(m); title.talks.s1.title = "New";
  check("intake: a talk title moves talks and @atomic only", moved(base, c(title)) === "@atomic,talks", moved(base, c(title)));
  const clean = clone(m); clean.talks.s1.word_count = 11; clean.talks.s1.cleaned_at = "later";
  check("intake: a cosmetic re-clean moves nothing", moved(base, c(clean)) === "", moved(base, c(clean)));
  const v = validate("recording-intake");
  check("intake: an attachment on a talk's slug passes", v(m).ok, v(m).failures.join("; "));
  const bad = clone(m); bad.attachments[0].talk_slug = "nope";
  check("intake: an attachment on an unknown talk fails", !v(bad).ok);
}

// talk-links: maps of arrays, and rechecks must cost nothing downstream.
{
  const c = canon("talk-links");
  const m: Model = {
    people: { s1: [{ name: "A", role: "r", affiliation: "x", links: { site: "u" }, evidence: ["e"], status: "found" }] },
    companies: { s1: [{ name: "C", url: "u", what: "w", evidence: [] }] },
    resources: { s1: [{ type: "blog", title: "B", url: "u", why: "w", evidence: [], first_seen: "d", published_at: null, verified_at: "v1" }] },
    freshness: { s1: { phase: "live", last_checked: "a", next_check: "b", checks: 1 } },
    coverage: { s1: { searched: ["q"], gaps: [], generated_at: "g" } },
  };
  const base = c(m);
  for (const f of ["people", "companies", "resources"]) check(`links: ${f} hashes populated truth`, base[f] !== EMPTY);
  const other = clone(m); other.people = { s2: m.people.s1 };
  check("links: a person on another session moves people", moved(base, c(other)).includes("people"));
  const recheck = clone(m); recheck.freshness.s1 = { phase: "live", last_checked: "later", next_check: "later", checks: 2 }; recheck.coverage.s1.generated_at = "later"; recheck.resources.s1[0].verified_at = "v2";
  check("links: a recheck that finds nothing moves nothing", moved(base, c(recheck)) === "", moved(base, c(recheck)));
  const gap = clone(m); gap.coverage.s1.gaps = ["dead link"];
  check("links: a gap moves coverage", moved(base, c(gap)).includes("coverage"));
  const phase = clone(m); phase.freshness.s1.phase = "settled";
  check("links: a lifecycle phase moves freshness", moved(base, c(phase)).includes("freshness"));
}

// talk-insights and talk-photos: keyed maps.
{
  const c = canon("talk-insights");
  const m: Model = {
    theses: { s1: { thesis: "T", confidence: 0.5 } },
    claims: { s1: [{ claim_id: "c", section: "00:00:00", at_seconds: 0, quote: "q", claim: "x", speaker: null, also_at: [] }] },
    coverage: { s1: { sections_read: 1, claims_found: 1, thin: true, gaps: ["g"], extracted_at: "a" } },
  };
  const base = c(m);
  for (const f of ["theses", "claims", "coverage"]) check(`insights: ${f} hashes populated truth`, base[f] !== EMPTY);
  const again = clone(m); again.coverage.s1.extracted_at = "later";
  check("insights: a re-extraction moves nothing", moved(base, c(again)) === "", moved(base, c(again)));

  const p = canon("talk-photos");
  const ph: Model = {
    photos: { p1: { file: "a.jpg", sha256: "h", captured_at_local: "t", session_id: "s1", method: "m", confidence: 1, evidence: ["e"], placed_path: "x", status: "placed", burst_id: null, width: 1, height: 1, captured_at_utc: "u" } },
    placements: {}, event_photos: {},
  };
  const pb = p(ph);
  check("photos: photos hashes populated truth", pb.photos !== EMPTY);
  const dim = clone(ph); dim.photos.p1.width = 2; dim.photos.p1.captured_at_utc = "v";
  check("photos: dimensions move nothing", moved(pb, p(dim)) === "", moved(pb, p(dim)));
}

console.log(failed ? `\nresult    ${failed} FAILED — do not promote` : "\nresult    PASS — fingerprints follow the contracts");
process.exit(failed ? 1 : 0);
