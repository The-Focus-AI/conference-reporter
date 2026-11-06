---
name: conference-schedule
kind: responsibility
version: 0.1.0
---

# Conference Schedule

> One clone, one conference. The repo is cloned per event, so the URL is
> configuration and the truth is single-event: every facet below describes *this*
> conference, never a registry of conferences.

### Goal

The tracked conference's schedule is current and complete: every session,
speaker, room, and start/end time matches the official source, every change
since the last verified state is recorded, and the venue is described well
enough to know where to be and when.

### Requires

- `check_requests`: the latest request to re-verify the tracked conference — a
  six-hourly tick or a manual kick. *(Maintained by `schedule-check`.)*

### Maintains

The one conference truth, structurally:

- `event`: `{ name, edition, city, timezone, starts_on, ends_on, status, official_url, schedule_url }`
  with `status` one of `upcoming`, `live`, `archived`
- `venue`: `{ name, address, city, maps_url, rooms: [{ room_id, name, floor }], transit, accessibility, confirmed, source_url }`
- `program`: `{ days: [{ date, label, session_count }], sessions: [Session], session_count, stated_session_count }`
- `speakers`: `{ [speaker_id]: { name, affiliation, bio, links: [String], talks: [session_id], source_url } }`
- `change_log`: `[Change]`, append-only
- `coverage`: `{ pages: [{ url, role, content_hash, byte_length, truncated }], unparsed_regions: [String], gaps: [String], last_verified_at, verification_count, enrichment: { done, pending, failed } }`

`Session` is `{ session_id, title, abstract, track, format, room_id, location_note, day, starts_at, ends_at, speaker_ids, status, source_url, source_anchor }`
where `format` is one of `talk`, `keynote`, `workshop`, `panel`, `break`,
`registration`, `social`, `side-event`, or `null` when the source does not
establish one, and `status` is one of `scheduled`, `cancelled`, `unscheduled`.

`Change` is `{ at, seq, kind, session_id, field, before, after, summary, source_url }`
where `kind` is one of `added`, `removed`, `retitled`, `retimed`,
`room-changed`, `speaker-changed`, `cancelled`, `venue-changed`,
`event-dates-changed`, `source-archived`.

**Canonicalization spec** (what equality means for the fingerprint):

- **Material everywhere**: the structural content of `event`, `venue`,
  `program`, `speakers`, and `change_log`, minus the immaterial list below.
- **Immaterial everywhere** (excluded from the fingerprint): `coverage.last_verified_at`,
  `coverage.verification_count`, every page `content_hash` / `byte_length` /
  `truncated` flag, and any `fetched_at`. These advance on every poll and must
  never look like surprise. `coverage.gaps` and `coverage.unparsed_regions` are
  **material** — a coverage regression is real news.
- **Text normalization**: Unicode NFC, trim, collapse internal whitespace runs to
  one space. No paraphrasing, no title-casing, no reflow of `abstract` or `bio`:
  a re-render of identical source text must hash identically.
- **Ordering**: `sessions` by `(starts_at, room_id, session_id)`; `rooms` by
  `room_id`; `speakers` by `speaker_id`; `change_log` by `(at, seq)`; `links` by
  URL, deduplicated.
- **Ids are derived from source anchors, not positions.** `session_id` comes from
  the source's stable anchor when it has one, else
  `slug(title) + "@" + starts_at`; `speaker_id` from `slug(name)`. Inserting a
  session must not re-key its neighbours.
- **Absence is `null`**, never `""`, `"TBD"`, or an invented value. Unknown
  values are listed in `coverage.gaps`.
- **Times are offset-qualified ISO 8601** in `event.timezone`
  (`2026-10-13T09:00:00-04:00`). A date-only value is not a time; it becomes
  `null` plus a coverage gap.

#### event

Identity and dates — the brief's masthead subscription. Material: `name`,
`edition`, `city`, `timezone`, `starts_on`, `ends_on`, `status`, and the
official/schedule URLs (tracking parameters stripped).

#### venue

Where the conference physically is. Material: `name`, `address`, `city`, the
room set (`room_id`, `name`, `floor`), `transit`, `accessibility`, `confirmed`,
and `source_url`. Immaterial: `maps_url` query parameters and coordinate
ordering. `confirmed: false → true` is a real change: it means the venue was
read from an authoritative page rather than inferred from the schedule header.

#### program

The complete session list — the brief's main subscription. Material: the session
set with `title`, `abstract`, `track`, `format`, `room_id`, `location_note`,
`day`, `starts_at`, `ends_at`, `speaker_ids`, `status`, plus `days` and the two
counts. A talk moving ten minutes, changing room, or gaining a speaker is a
fingerprint move; a page re-render is not.

#### speakers

The roster behind `speaker_ids`. Material: `name`, `affiliation`, `bio`, `links`,
`talks`, `source_url`. Immaterial: avatar URLs, follower counts, link ordering.
An unreachable speaker page leaves the record as it was and counts in
`coverage.enrichment.pending` — it never blanks a known bio.

#### change_log

The append-only record of what moved: `added`, `removed`, `retitled`, `retimed`,
`room-changed`, `speaker-changed`, `cancelled`, `venue-changed`,
`event-dates-changed`, `source-archived`. Material: the ordered `Change` set;
because it is append-only, it is monotone — it only ever grows. A change is
appended only when a material field moved, never for cosmetic churn. This is the
facet a change digest or a chat notification subscribes to.

#### coverage

The completeness ledger — how much of the source was actually read. Material:
`gaps`, `unparsed_regions`, `stated_session_count` versus `session_count`, and
the `enrichment.pending` / `enrichment.failed` counts. Immaterial:
`last_verified_at`, `verification_count`, page hashes. This facet is what keeps
"complete list" an auditable claim rather than a hope.

**Postconditions** (self-policed before signing; no separate judge beat):

- Every session has `session_id`, `title`, `starts_at`, `ends_at`, and `status`;
  every session with a `format` of `talk`, `keynote`, `workshop`, or `panel`
  has at least one `speaker_id`, and every `speaker_id` resolves in `speakers`.
  `side-event` needs no speaker. A session whose source does not establish a
  format has `format: null` and a `coverage.gaps` line; a format is never chosen
  to satisfy this rule.
- No session's `abstract` or `title` holds a placeholder such as `TBD`. A title
  that only repeats the speaker line is kept as published and named in the
  `coverage.gaps` title line.
- Every timestamp is offset-qualified ISO 8601 in `event.timezone`; no naive
  local time, no UTC-shifted duplicate.
- **Completeness**: `program.session_count` equals the sum of `days[].session_count`,
  and equals `stated_session_count` whenever the source states a total. If they
  differ, `coverage.gaps` names the exact difference and the render signals
  `coverage-gap`. A partially-read page is never reported as a complete schedule.
- Nothing is invented: `abstract`, `bio`, `affiliation`, `links`, `track`, and
  `room_id` are populated only from source text, else `null`/empty.
  Abstracts are quoted, never summarized.
- `change_log` is append-only: entries are never dropped, reordered, or
  rewritten, and `seq` is strictly increasing.
- `event.timezone` is an IANA zone and every `day` falls inside
  `starts_on..ends_on` or is explicitly a side event outside the main dates.
- A session with `room_id: null` carries a `location_note` naming the off-site
  place (side events, socials).

### Errors

- `source-unreachable`: the schedule source could not be fetched after retries;
  the prior truth stands and the run fails rather than publishing a blank.
- `coverage-gap`: the parsed session count does not reconcile with the stated or
  reachable count; publish what was read, name the gap, fail loudly.
- `timezone-ambiguous`: the source gives offsets or labels that cannot be mapped
  to one IANA zone, so times cannot be published honestly.
- `not-a-schedule`: the URL resolves to a page that is not a conference program
  (wrong route, marketing redirect, 404-with-200).

### Continuity

- **input-driven**: a new `check_requests` receipt from `schedule-check`.
- **self-driven**: every 6h while `event.status` is `upcoming`; **hourly** while
  `now` falls inside `[starts_on - 72h, ends_on + 24h]`; daily once
  `event.status` is `archived`.

The cadence *rule* lives here; the expiry *data* (the dates it reads) lives in the
world-model. A tick that finds no material change writes an unmoved fingerprint
and costs nothing downstream — cost scales with surprise, not with the clock.

### Execution

```prose
let prior = read_world_model("self")

# 1. Fetch the source page set and hash it. Unchanged hashes are the cheap gate:
#    a stable page must not produce a moved truth.
let fetched = call fetch-conference-pages
  conference_url: CONFERENCE_URL
  prior_pages: prior.coverage.pages

# 2. Structure the pages. Extraction never invents; unknowns become null + gaps.
let extracted = call extract-conference-program
  pages: fetched.pages
  page_set: fetched.page_set
  prior: prior

# 3. Enrich speakers whose bio or links are still missing, bounded per render.
let enriched = call enrich-speaker-profiles
  speakers: extracted.speakers
  sessions: extracted.program.sessions
  budget: 40

# 4. Diff against the prior truth, append what genuinely moved, reconcile counts.
let next = call update-conference-truth
  prior: prior
  extracted: extracted
  speakers: enriched
  fetched: fetched

commit_world_model next
```

The render writes the structured truth and self-polices the postconditions above;
it never decides "did this change" — the reconciler compares fingerprints.

### Shape

- `self`: fetch official pages, structure sessions and speakers, normalize times
  and rooms, diff against the prior truth, and own the completeness ledger.
- `delegates`:
  - `fetch-conference-pages`: page discovery, fetching, hashing, segmentation
  - `extract-conference-program`: page text → structured event/venue/program/speakers
  - `enrich-speaker-profiles`: bounded bio and link retrieval for the roster
  - `update-conference-truth`: diff, change-log append, count reconciliation
- `prohibited`: inventing sessions, speakers, times, rooms, tracks, abstracts, or
  affiliations; paraphrasing abstracts; harvesting attendee or personal data;
  bypassing authentication, paywalls, or robots directives; editing the source
  site; publishing the brief (that belongs to `schedule-brief`).

### Invariants

- The published world-model is the only durable truth; `workspace/` scratch is
  disposable and never subscribed to.
- A render that finds no material change republishes the same structural truth:
  fingerprint unmoved, no change appended.
- No field is ever filled from model prior knowledge of the conference — source
  text or `null`.
- `session_id` and `speaker_id` are stable across renders; re-keying is treated
  as a removal plus an addition, and is therefore avoided.
- The prior truth is never destroyed by a failed fetch: on `failed`, the last
  committed truth stands.

### Strategies

- when the fetched page is truncated: segment by day, room, or anchor and fetch
  the remainder; a truncated page is never accepted as complete.
- when the source states a total ("167 sessions"): reconcile against it exactly.
  A mismatch is a `coverage-gap`, not a rounding decision.
- when a talk's speaker is only named on a modal or speaker page: follow that
  link rather than publishing a speakerless talk.
- when times are labelled non-IANAlly ("ET", "local"): map once to the IANA zone
  that the city implies, record the mapping in `event.timezone`, and never mix
  offsets across days.
- when the page carries an archive banner: set `event.status = archived` and drop
  to the daily cadence; archived schedules are still worth tracking for the
  record, but not hourly.
- when side events sit outside the venue: keep them in `program` with
  `room_id: null` and a `location_note`, so the main grid stays clean.
- when two sessions claim the same room and time: publish both, and note the
  clash in `coverage.gaps` rather than silently dropping one.

### Environment

- `CONFERENCE_URL`: the official conference page (or its schedule route) this
  clone tracks. Required; set per clone; not a secret.

### Runtime

- `persist`: project
