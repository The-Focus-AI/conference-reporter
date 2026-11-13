---
name: capture-note
kind: function
version: 0.1.0
---

# Capture Note

> The microphone gets the talk; this gets everything around it.

### Description

Turns one observation, question, link, quote, or todo into one note file:
classified, timestamped in the event timezone, linked to the session only when a
window decides it, and routed to the backlog when it is a todo. A note is
evidence, not a summary — what was said or seen, not what it meant a week later.

### Parameters

- `kind`: `observation`, `question`, `link`, `quote`, or `todo`.
- `text`: the words as they were said or seen. Preserved exactly.
- `captured_at`: local ISO 8601 with offset. Default: now, in the event timezone.
- `talk`: optional `talks/<slug>/` the note belongs to, when the user names one.
- `bucket`: for `kind: todo` only — `review` or `digest`.
- `timezone`: the event's IANA zone. Default: `event.timezone` from
  `state/world-model/conference-schedule/published/event.json`.
- `program`: the session windows to match against. Default: `program.sessions`
  from the published schedule truth.

### Returns

- `path`: `notes/inbox/<YYYY-MM-DDTHHMM>-<slug>.md`
- `note`: `{ captured_at, kind, session_id, talk, tags }` — the frontmatter as
  written
- `session_id`: the matched session, or `null`
- `backlog`: `{ list, line }` for a `todo`, otherwise `null`

### Invariants

- `captured_at` carries the event's timezone offset. It is never UTC: the note
  sits beside the schedule and the photos, and those are local.
- `session_id` is set only when exactly one session window contains
  `captured_at`. Zero matches or two leaves it `null` — a wrong link is worse
  than none.
- `text` is preserved exactly: names, numbers, and product spellings are not
  corrected at capture time.
- The body states what happened, not what it meant.
- An existing note is never overwritten; a second note in the same minute takes a
  `-2` suffix.
- The only writes are the note file and, through `append-backlog`, one backlog
  line.

### Errors

- `unknown-kind`: `kind` is not one of the five names.
- `missing-bucket`: `kind: todo` without `bucket: review` or `digest`.
- `clock-unresolved`: the event timezone cannot be read, so a local timestamp
  cannot be trusted.

### Strategies

- when the user names a talk: set `talk` even if no window matches — the user's
  attribution outranks the clock, and `session_id` stays `null` unless a window
  also contains `captured_at`.
- when `text` is a link: the URL is the body; the slug comes from the page title
  or the host, not from the URL path.
- when `captured_at` falls in two parallel tracks: leave `session_id: null` and
  name the candidate sessions in the body, so the reader can decide.
- when the note is a question and its answer already exists in `notes/research/`:
  capture it anyway and name the trace in the body; the ask is evidence too.

### Shape

- `self`: classify, timestamp locally, match one window, write one note.
- `delegates`:
  - `append-backlog`: the todo route.
- `prohibited`: writing into `notes/research/`; editing or deleting an existing
  note; inventing a session link; restating the note as a conclusion.

### Runtime

- `persist`: true
