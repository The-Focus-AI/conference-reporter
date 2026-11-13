---
name: talk-ask
description: Answer questions about the recorded conference talks from their transcripts and dossiers — what a talk said, who said it, which talk covered a topic, or how two talks compare. Use for talk content; /conference-themes is for patterns across all talks.
---

# Ask the talks

The corpus is every `talks/*/transcript.md` in this build (`ls talks/`), each
with a dossier beside it. Every answer is **traceable**: each claim names a
talk and a timestamp. Search is cheaper than a guess here.

Each transcript's frontmatter `source:` names the recogniser.
`voice-memos-transcript` is Apple's ASR, with word-level timings.
`qwen3-asr-1.7b` (or another `qwen3-asr-*`) is the local Qwen3-ASR fallback:
it was prompted with the session's speaker and product names, so those are
usually right, but its section timestamps are only as fine as its ~5 s
segments. Say which recogniser a quote came from when two talks disagree on a
name or a number.

## 1. Frame the question

Pull the nouns, the speaker names, and any talk the user named.

The transcripts are recogniser text, so names and jargon arrive garbled
("Feathers, AI" for Featherless, "Metropic" for Anthropic). Search stems and
likely spellings, then read the section to see what was meant. Quote the text as
it stands; a correction belongs in your sentence, never inside the quote.

## 2. Find the candidate talks

```bash
grep -rilE 'context window|context rot' talks/*/transcript.md
grep -ril 'speaker-surname' talks/*/transcript.md talks/*/links.md
ls talks/
```

- A **topic** question starts in `transcript.md`.
- A **person, company, or link** question starts in `links.md`.
- A talk with no transcript hit may still be in the schedule: search
  `brief/schedule.md` (every session, with abstracts where published) or
  `state/world-model/conference-schedule/published/program/sessions.json`.

Use your grep tool when it is available; the commands above are the shape, not a
requirement.

## 3. Read the section, not the hit

Open the file and read from the nearest `### HH:MM:SS — Title` heading to the
next. That heading is the citation. For a whole-talk question ("summarize it",
"what was the argument"), read the frontmatter and every heading, then the
opening and closing sections.

## 4. Answer

- Lead with the answer; put the evidence under it.
- Cite each claim as `[<talk title>](talks/<date>-<slug>/transcript.md)` at
  `HH:MM:SS`.
- Attribute to the speaker when the transcript distinguishes speakers.
- Report what the talk **claims**. Mark your own inference as yours.
- For a comparison, cite both talks and name where they disagree.
- When nothing matches: say the recorded corpus does not cover it, name the
  talks you searched, and point at `brief/schedule.md` if the session existed
  but was never recorded. Absence in 28 talks is not absence at the conference.

The answer is done when every claim carries a talk + timestamp (or a schedule
`session_id`) and the answer names the talks searched.


## Keep the trace

When the user says keep this, save this, or add it to research, write the
question, the answer, and the talks + timestamps used to
`notes/research/<YYYY-MM-DD>-<slug>.md`. `/conference-hooks` mines those traces later; a
good answer that stays in the chat is lost.
