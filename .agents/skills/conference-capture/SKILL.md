---
name: conference-capture
description: Capture an observation, question, link, quote, or todo from the conference into notes/inbox/. Use when the user says note this, remember this, capture this, log this, or wants something added to review or digest later.
---

# Capture

One note, one file. The microphone gets the talk; this gets everything around it.

## 1. Classify

`kind`: `observation`, `question`, `link`, `quote`, or `todo`.

A thing to do after the conference is `todo`, and needs a bucket: `review` (go
back and check it) or `digest` (read, watch, or process it).

## 2. Timestamp

Read `state/world-model/conference-schedule/published/event.json` for the
timezone. Name the file `YYYY-MM-DDTHHMM-<slug>.md` and repeat the time in
frontmatter:

```yaml
---
captured_at: 2026-10-14T11:32:00-04:00
kind: observation
session_id: null
talk: null
tags: []
---
```

Never timestamp in UTC. Notes sit beside the schedule and the photos, and those
are local.

## 3. Link the session

- Exactly one session window contains `captured_at` → set `session_id`.
- The user names a talk or slug → set `talk: talks/<slug>/`.
- Otherwise leave both `null`. A wrong link is worse than none.
- Rooms drift off the clock: a stage can run 15–20 minutes early or late. When
  the user has said which talk they are in ("I'm at the X talk"), use that
  session until they say otherwise, even if the clock says the next slot. When a
  note fits a different talk by topic, ask. If they correct you ("no, that's from
  X's talk"), move the note.

## 4. Write the body

The words as they were said or seen. Preserve names and numbers exactly; the
reader can correct them later. State what happened, not what it meant.

Keep the user's wording, typos included; put a likely reading in parentheses
("Slot is asymmetric. (As typed; probably 'slop'.)"). A line placing the note
in its talk is fine; a link to another talk or a claim about it needs evidence
from that talk's transcript or notes, otherwise leave it out. A quick web lookup
the user asks for goes in the body marked as not yet verified.

## 5. Route todos

Append to `editorial/backlog.md` under `## Review later` or `## Digest later`:

```md
- [ ] <one line> — <source: note path, talk path, or URL>
```

Done when: the file exists with valid frontmatter, `session_id`/`talk` are set or
explicitly null, and every todo has a backlog line.
