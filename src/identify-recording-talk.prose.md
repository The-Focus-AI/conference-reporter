---
name: identify-recording-talk
kind: function
version: 0.3.0
---

# Identify Recording Talk

> The judgement call, with the receipts attached. Time narrows the field to a
> handful of parallel sessions; only the transcript can pick one — and only by
> quoting something that actually identifies the talk.

### Description

For each new recording, finds the sessions whose slot it could plausibly be,
reads the transcript for identifying evidence, and returns either a decided match
with quoted evidence, or a ranked shortlist marked `needs-review`.

### Parameters

- `recordings`: the new recording entries (folder, title, `recorded_at`,
  `duration_seconds`, path to `transcript.txt`).
- `program`: the schedule truth — days, sessions, rooms, formats, titles, abstracts.
- `notes`: the operator's captured notes under `notes/inbox/`, read for
  attributions (`talk:` frontmatter and `captured_at`).
- `speakers`: the roster, so an uttered name or company can be resolved.

### Returns

- `matches`: one entry per input recording:
  `{ recording_id, session_id, confidence, method, evidence, candidates, status }`
  where `status` is `matched` or `needs-review`.
- `matched`: the subset with `status: matched`, ready for rendering.
- `needs_review`: the subset that could not be decided, with why.

### Invariants

- **Evidence or it did not happen.** A `matched` entry either quotes at least one
  verbatim fragment from the transcript that names the talk, the speaker, or the
  speaker's company, or — when the recording never names them — pairs an
  operator attribution (a note naming the talk captured inside the recording's
  span, or a folder title naming the speaker) with at least two verbatim
  transcript quotes that each answer a specific claim in the session's abstract
  (`method: time+attribution+transcript`). When neither holds, an operator
  confirmation whose session fits the recording's time produces `matched` with
  `method: time+operator`: a decision note (`kind: decision`, naming the
  recording and the `session_id`), or a Voice Memos title that exactly names a
  speaker of that session. Cite the note or the title as evidence. Time and duration alone can never
  produce `matched`, and neither can an attribution alone.
- Quotes are verbatim and short — a phrase or a sentence, never a paragraph, never
  paraphrased, and never assembled from separate parts of the transcript.
- Every candidate comes from `program`; no session is invented, and no candidate
  is dropped for being inconvenient.
- Two recordings may not both be `matched` to the same session. The longer
  recording wins; the other becomes `needs-review` with the conflict named.
- A recording that matches nothing in the program (housekeeping, hallway, side
  event) returns `needs-review` with an empty `candidates` list and a stated
  reason — it is genuinely not a talk.
- The folder `title` (from the m4a `©nam`) is typed by the operator. An exact,
  case-insensitive match to a speaker of a time-fitting session is the
  operator's confirmation; anything looser is evidence to verify in the
  transcript, not ground truth.

### Errors

- `program-unavailable`: `program` is empty or missing sessions; identification
  cannot proceed and must not fall back to guessing.

### Strategies

- when the recording starts 0–5 minutes before a slot: that is the normal pattern;
  people press record as the talk begins. Do not penalise it.
- when several sessions share the slot: five-way parallels are the norm at this
  conference. Duration helps most (18-minute talks vs 60–120-minute workshops).
- when the emcee speaks first: "please welcome …" is the strongest evidence in the
  recording — quote it verbatim, including the company.
- when the speaker self-identifies: "I'm X, I run Y at Z" is nearly as strong.
- when the folder title is a company ("Air Canada") and the transcript mentions
  that company: that is corroboration, provided the company appears in the talk
  itself, not just in a sponsor slide.
- when two candidates both carry evidence: record both, quote both, and set
  `needs-review`. Never break a tie by score alone.
- when the recording is only a minute or two: closing remarks and housekeeping are
  legitimate non-talks; prefer `needs-review` over forcing a match.
- when the introduction was lost: read `notes` for one whose `talk:` names a
  candidate and whose `captured_at` falls inside the recording, then quote the
  transcript against that candidate's abstract. Prefix evidence `note:`,
  `title:`, or `transcript:` so a reader can see which kind each piece is.
- when the transcript came from Qwen with a schedule prompt: a name it contains
  may be the prompt talking. Count it as attribution, not as a named quote. If
  the recording keeps an unprompted Voice Memos transcript in
  `transcript_alternates`, look there for the speaker or company by name and
  quote it with its file (`transcript.txt: "…"`); that quote counts as named.
- when the transcript is mostly questions: match on the questioners' references to
  the talk topic rather than an introduction that was missed.

### Shape

- `self`: narrow by time and duration, read transcripts, weigh quoted evidence,
  resolve names against the roster, and record the decision plus its alternatives.
- `prohibited`: inventing quotes or candidates, editing the transcript, matching
  across days without evidence, or treating a folder title as proof on its own.

### Runtime

- `persist`: true
