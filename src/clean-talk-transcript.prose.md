---
name: clean-talk-transcript
kind: function
version: 0.2.0
---

# Clean Talk Transcript

> Turns an ASR transcript into something a person can read — without turning it
> into something a person *wrote*. Structure and punctuation are ours to fix;
> sentences, claims, and names are not.

### Description

For each matched recording, writes `talks/<date>-<slug>/transcript.md`: schedule
frontmatter, timestamped sections, readable paragraphs, and a separated Q&A.
Reads the raw transcript; never rewrites it.

### Parameters

- `matches`: the `matched` entries from `identify-recording-talk`.
- `program`: the schedule truth for title, speakers, room, start/end, format.
- `speakers`: the roster for speaker names and affiliations.

### Returns

- `talks`: `{ [session_id]: { slug, path, title, speakers, room_id, starts_at, source_recording, sections, word_count, cleaned_at } }`
  written to disk at `talks/<YYYY-MM-DD>-<slug>/transcript.md`.

### Invariants

- **Faithful**: no sentence is added, no claim is strengthened, no example is
  invented. Removing fillers ("um", "uh", "you know", repeated words), fixing
  punctuation and casing, and breaking paragraphs are the whole licence.
- **Speaker names come from `program`**, not from the transcript's own noise. A
  mis-heard name in the audio does not get promoted into frontmatter.
- Frontmatter carries: `title`, `speakers` (name + affiliation), `room`, `starts_at`,
  `ends_at`, `format`, `recording` (folder name), `duration`, and `source`:
  `voice-memos-transcript`, or the recording's `meta.json` `transcript_source`
  when that names another engine (for example `qwen3-asr-1.7b`).
- Sections carry a start timestamp taken from the word timings, e.g.
  `### 00:04:12 — The vault problem`. Timestamps must come from the timings file,
  never be estimated. When `transcript_timing` is `segment`, a section starts at
  the start of the segment holding its first word.
- Q&A is split only when a genuine audience question is present; otherwise the
  whole text stays one body.
- Technical terms, product names, and numbers are preserved verbatim, including
  ones the ASR clearly mangled — do not "correct" them into a different claim.
  Where a term is obviously garbled and matters, keep the original and add
  `_(as transcribed)_` rather than guessing.
- `word_count` after cleaning must be lower than the raw count (filler removal
  only reduces); if it is higher, something was added and the render must fail.
- The raw transcript is never modified. It is the file `meta.json`
  `transcript` names (`transcript.txt` unless the recording was re-transcribed),
  with its timings in the matching `.words.json`.

### Errors

- `talk-write-failed`: the talk directory or file could not be written.
- `word-count-regression`: cleaned output is longer than the source; abort rather
  than ship an inflated transcript.

### Strategies

- when the talk opens mid-sentence (recording started late): say so in a one-line
  note at the top rather than smoothing over the gap.
- when several people talk in the Q&A: label turns only when the speaker is
  identifiable from the audio cues in the text ("Question:", "Speaker:"); otherwise
  leave the paragraphs unlabelled rather than attributing wrongly.
- when a slide or demo is referenced ("as you can see here"): keep the sentence and
  leave a `> [slide]` marker only if an attachment exists for that talk; never
  invent a description of what was shown.
- when the ASR produces a long unpunctuated run: prefer short paragraphs over
  aggressive sentence-splitting that changes meaning.
- when the talk is a workshop (60+ minutes): section by topic shift with timestamps
  every few minutes rather than one giant body.

### Shape

- `self`: read the transcript and word timings, structure it, write one Markdown
  file per talk with schedule metadata.
- `prohibited`: paraphrasing, summarizing, merging or splitting claims, renaming
  speakers, editing the raw transcript, or writing outside `talks/`.

### Runtime

- `persist`: true
