---
name: recording-intake
kind: responsibility
version: 0.3.0
---

# Recording Intake

> The semantic half of the pipeline. The Python mover puts a folder on disk; this
> node decides *which talk it is*, cleans the transcript into something readable,
> files any images where they belong, and records the evidence for every claim it
> makes about identity.
>
> This is the one place an LLM is allowed to make a judgement — and it must show
> its receipts.

### Goal

Every recording dropped into the inbox becomes an identified, cleanly rendered
talk linked to the session it captured — with its evidence quoted, its ambiguous
cases surfaced rather than guessed, and its attachments filed where a reader will
find them.

### Requires

- `inbox_scans`: whether the recording drop folder changed since the last wake.
  *(Maintained by `recording-inbox-watch`.)*
- `program`: the day and session structure — times, rooms, formats, titles,
  abstracts. *(Facet `program` of `conference-schedule`.)*
- `speakers`: the roster, so a name in the transcript can be resolved to a person
  and a company. *(Facet `speakers` of `conference-schedule`.)*

### Maintains

The intake truth, per recording folder and per resulting talk.

- `recordings`: `{ [recording_id]: { folder, path, title, recorded_at, duration_seconds, word_count, audio_sha256, status } }`
  with `status` one of `new`, `identified`, `needs-review`, `cleaned`, `failed`
- `matches`: `{ [recording_id]: { session_id, confidence, method, evidence: [String], candidates: [{ session_id, why, confidence }], status } }`
- `talks`: `{ [session_id]: { slug, path, title, speakers, room_id, starts_at, source_recording, sections: [String], word_count, cleaned_at } }`
- `attachments`: `[{ talk_slug, path, placement, at_seconds, caption, source }]`

**Canonicalization spec**:

- **Material**: everything structural above, including `status`, `confidence`,
  `method`, the `evidence` quotes, the candidate list, `talks.sections`, and every
  attachment `path`/`placement`/`at_seconds`.
- **Immaterial** (excluded from the fingerprint): `cleaned_at`, `word_count` delta
  from a cosmetic re-clean, and any render timestamps. A re-clean that produces
  the same structure must not wake anything.
- `recordings` is ordered by `recorded_at`; `matches.candidates` by descending
  confidence then `starts_at`; `attachments` by `(talk_slug, at_seconds, path)`.
- Text normalization: Unicode NFC, trimmed, whitespace-collapsed — **except**
  inside `evidence`, which is quoted verbatim from the transcript and must not be
  rewritten at all.

#### recordings

The complete index of the drop folder — one entry per recording folder, keyed by
a stable id derived from the folder name. Material: `folder`, `path`, `title`,
`recorded_at`, `duration_seconds`, `word_count`, `audio_sha256`, `status`. This
facet is what makes "did we miss a recording?" answerable: a folder on disk with
no entry here is a bug, and the render must fail rather than skip it.

#### matches

Which session each recording captured, and why. Material: `session_id`,
`confidence`, `method` (`time`, `time+title`, `time+transcript`, `time+title+transcript`,
`time+attribution+transcript`, `time+operator`),
`evidence`, `candidates`, `status`. An entry may exist with `status:
needs-review` and `session_id: null`; that is a *result*, not a failure — it says
the recordings is real, the slot is known, and the talk is not decided.

#### talks

The rendered talks, keyed by `session_id`. Material: `slug`, `path`, `title`,
`speakers`, `room_id`, `starts_at`, `source_recording`, `sections`. Title,
speakers, room, and time are copied from `program` — never retyped from the
recording — so a schedule correction propagates into the talk on the next render.

#### attachments

Every non-audio file that travelled with a recording, and where it ended up.
Material: `talk_slug`, `path`, `placement` (`inline` or `listed`), `at_seconds`,
`caption`, `source`. `at_seconds` is material because an inline image that moves
in the transcript is a real change to the document.

**Postconditions** (self-policed before signing):

- **Complete**: every folder present in the inbox has exactly one `recordings`
  entry, and every `recordings` entry with `status: cleaned` has one `talks` entry.
  A folder that cannot be read fails the render with `inbox-unreadable`; it is
  never silently dropped.
- **No evidence, no match**: every `matches` entry with a `session_id` carries
  either
  - **named**: at least one verbatim `evidence` quote from that recording's
    transcript that names the talk, the speaker, or the speaker's company; or
  - **attributed** (`method: time+attribution+transcript`), when the recording
    never names them: an operator attribution — a note under `notes/inbox/`
    whose `talk:` is this session's talk, captured inside the recording's span,
    or the recording's folder title naming this session's speaker — **and** at
    least two verbatim transcript quotes that each match a specific claim in
    this session's `abstract`. Each piece is its own `evidence` entry, prefixed
    `transcript:`, `note:` (with the note path), or `title:`, and the abstract
    claim a quote answers is named beside it.

  - **confirmed** (`method: time+operator`), when neither of the above holds
    but the operator has decided, in either of two ways: a note under
    `notes/inbox/` with `kind: decision` naming this recording and this
    `session_id`; or the recording's Voice Memos title (the operator typed it)
    matching, exactly and case-insensitively, the name of a speaker of this
    session in `speakers`. Either way the session's window must fit the
    recording's time. A title that only resembles a name ("Ankir Jain") is
    attribution, not confirmation. The decision note's path is an `evidence` entry, the match's
    confidence stays below a named match's, and the cleaned talk says in its
    header that it was filed on the operator's confirmation.

  A match justified only by time and duration, or by an attribution without
  transcript corroboration or an operator decision, cannot reach `cleaned`.
- **One talk, one recording**: two recordings may not both claim the same
  `session_id`. When they do, the longer recording wins, the other becomes
  `needs-review`, and both are listed.
- **Faithful rendering**: a cleaned transcript adds no sentence, no fact, and no
  speaker attribution that is not in the source. Filler removal, punctuation,
  casing, paragraphing, and headings are allowed; paraphrase is not.
- **Raw material is immutable**: `audio.m4a`, every transcript file, and
  `meta.json` in the inbox are read-only. The render never edits or deletes them.
  The transcript in force is the file `meta.json` `transcript` names
  (`transcript.txt` unless the mover re-transcribed); earlier transcripts stay
  beside it, listed in `transcript_alternates`.
- **Qwen first**: the transcript in force is the local Qwen3-ASR one whenever
  the mover has made it; a Voice Memos transcript in force means the upgrade is
  still waiting on power. Render from whichever is in force; never wait for
  the upgrade.
- **Re-transcription re-decides**: when the transcript in force changes, the
  recording is identified and cleaned again from the new text, and the talk's
  `source` names its engine. Evidence quotes come from the transcript in force
  or from an alternate transcript of the same recording listed in
  `transcript_alternates`; each such quote names its file. A name quoted from an
  unprompted alternate (Voice Memos) counts as **named**; a name quoted from a
  schedule-prompted Qwen transcript counts only as attribution.
- **Attachments are copies**: files are copied into the talk folder, never moved
  out of the inbox, and `placement: inline` requires an `at_seconds` inside the
  recording's duration.
- **Unknown stays null**: a missing speaker, room, or caption is `null`, not a
  plausible invention.
- **Idempotent**: a recording already `cleaned` with unchanged audio and transcript
  is not re-cleaned, and its talk file is not rewritten.

### Errors

- `inbox-unreadable`: the inbox directory or a recording folder cannot be read.
- `transcript-missing`: a recording has audio but no `transcript.txt`; the
  recording is indexed and marked `failed` rather than transcribed here. This is
  expected, not a fault, when Voice Memos had no transcript and the mover
  deferred local transcription because the machine was on battery. When a later tick (or `mise run transcribe`) adds the transcript, the
  inbox fingerprint moves and the recording is identified on that wake.
- `talk-write-failed`: a talk file could not be written; the prior talk stands.
- `attachment-unsafe`: an attachment path escapes the talk folder, or a symlink is
  involved.

### Continuity

- **input-driven**: a new `inbox_scans` receipt whose `folder_fingerprint` moved.
- **self-driven**: every 15 minutes, so a drop that arrives without a kick is
  still picked up. The cadence rule lives here; the fingerprint it compares lives
  in the world-model.

A tick with no new folder moves no fingerprint and renders nothing.

### Execution

```prose
let prior = read_world_model("self")

# 1. Read the folder: what exists, what is new, what the audio hashes say.
let scan = call scan-recording-inbox
  inbox: RECORDINGS_INBOX
  prior_recordings: prior.recordings

# 2. Decide which talk each new recording captured. Time narrows, content decides.
let identified = call identify-recording-talk
  recordings: scan.new
  program: program
  speakers: speakers
  notes: "notes/inbox/"

# 3. Render each decided talk: frontmatter from the schedule, text from the
#    transcript, cleaned but never rewritten.
let cleaned = call clean-talk-transcript
  matches: identified.matched
  program: program
  speakers: speakers

# 4. File the side files, inline where a timestamp can be defended.
let placed = call place-talk-attachments
  talks: cleaned.talks
  inbox: RECORDINGS_INBOX

commit_world_model {
  recordings: scan.recordings,
  matches: identified.matches,
  talks: cleaned.talks,
  attachments: placed.attachments,
}
```

`scan.recordings` is the merged index (prior entries carried forward plus new
ones), so the committed truth is always the whole inbox, not just this wake's
arrivals.

### Shape

- `self`: read the inbox and transcripts, decide identity, render talks, file
  attachments, and keep the index complete.
- `delegates`:
  - `scan-recording-inbox`: folder inventory, hashing, prior-state merge
  - `identify-recording-talk`: time priors plus transcript evidence → match or review
  - `clean-talk-transcript`: faithful, structured rendering of a decided talk
  - `place-talk-attachments`: side-file placement and inline anchoring
- `prohibited`: editing or deleting raw recordings, transcripts, or `meta.json`;
  inventing a talk title, speaker, room, or time instead of reading `program`;
  asserting a match without a quotable excerpt; transcribing audio (that is the
  mover's job: local Qwen3-ASR is the transcript of record, with Voice Memos'
  in force only until power allows the upgrade); writing outside `talks/`.

### Invariants

- The inbox is the source of record for *what was recorded*; `program` is the
  source of record for *what was scheduled*. This node joins them and never
  overwrites either.
- Evidence quotes are verbatim and short (a sentence fragment, not a paragraph).
- A `needs-review` entry is a successful outcome; a guessed match is not.
- Every write is inside `talks/<slug>/`. The inbox is read-only.
- Rerunning a render over already-cleaned recordings changes nothing.

### Strategies

- when a recording starts before its slot by up to ten minutes: that is normal —
  people hit record when the talk begins, not when the grid says so.
- when several sessions share the slot: the recording start offset and the
  duration narrow the field, then the transcript decides. Five-way parallel slots
  are the common case, not the exception.
- when the folder title names a company or a person ("Air Canada", "Ksenia"):
  treat it as strong evidence, and look for that name in the transcript before
  relying on it. When it exactly names a speaker of a session that fits the
  recording's time, it is the operator's confirmation and the match can stand
  on it (`time+operator`), even if the transcript never says the name.
- when the emcee introduces the talk: the announcement is the best evidence
  available — quote it, including the speaker's name and company.
- when the speaker introduces themselves: quote the self-introduction.
- when two candidates both have evidence: do not break the tie by score. Record
  both with their quotes and set `needs-review`.
- when a transcript is mostly Q&A or starts mid-sentence: match on the topic and
  the questioners' references rather than an introduction that was never captured.
- when the introduction was lost and nothing names the talk: look for the
  operator's attribution (notes captured during the recording that name the
  talk, then the folder title) and for transcript quotes that answer the
  abstract's specific claims. Both present → `time+attribution+transcript`;
  either missing → `needs-review`.
- when transcription was biased with schedule names (`transcript_source` is a
  Qwen model): a speaker or company name in the transcript may come from the
  prompt rather than the audio. Treat it as attributed evidence, not named.
- when a recording clearly belongs to no session in the program (hallway
  conversation, housekeeping, a side event): `needs-review` with candidates
  empty — it is not a talk.
- when an attachment has no defensible timestamp: `placement: listed`, not
  `inline`.

### Environment

- `RECORDINGS_INBOX`: the drop folder the Python mover writes into. Defaults to
  `recordings/inbox`.

### Runtime

- `persist`: project
