---
name: conference-next
description: Inspect a conference build and recommend what to work on next — which talk to turn into a story, which theme is ready for a through-line, and what is missing. Use when the user asks what is next, where to start, or what to do with the corpus.
---

# Next work

The build has more material than attention. This skill ranks it and stops.

## Run the audit

```bash
bun scripts/next-work.ts            # markdown
bun scripts/next-work.ts --json     # structured
bun scripts/next-work.ts --write    # also editorial/next.md
```

It scans:

- `notes/inbox/*.md` — how many notes the operator captured on each talk (`talk:`).
- `talks/*/transcript.md` — title, speakers, duration, word count, and whether
  the transcript is the local Qwen one (`source:`).
- `talks/*/links.md` — a video link.
- `talks/*/photos/` — filed photos.
- `talks/*/story.md` and `talks/*/experience/` — has the talk been storied?
- `analysis/themes.md` — which themes cite the talk.
- `atlases/*/atlas.json` — existing through-lines.

The operator's notes decide the order. Unstoried talks with a transcript rank
first, by how many notes the operator took on them; a Qwen transcript beats a
Voice Memos one at equal notes. Notes are where the operator's attention went,
and the story is built from them. The score only breaks ties, and is a prompt,
not a verdict:

```
themes * 3 + min(photos, 8) + video(3) + no-story(8) + long-enough(1)
```

## Read it in three passes

Always lead with the unstoried talk the operator took the most notes on. At
equal notes, a Qwen transcript beats a Voice Memos one. If the most-noted talk
is still on Voice Memos, still lead with it, and say its Qwen pass is waiting
(do not run Qwen to get there unless the operator asks). The passes below are
secondary context.

1. **Best visual candidate.** The top unstoried talk with photos and video. It
   is the cheapest way to test the talk-page layout.
2. **Best argument candidate.** The top unstoried talk with three themes and no
   photos. It will need generated diagrams, so it tests the harder visual case.
3. **Theme readiness.** A theme with at least three stories and no atlas. That is
   the next through-line, not the next talk.

Do not recommend a talk that already has `story.md` and `experience/index.html`.

## Output

Tell the user:

- the top one or two talks, with the exact slug;
- why (themes, photos, video, length);
- the first theme that will be ready for a through-line;
- what is missing (no video, no photos, thin transcript, no dossier).

Then ask which talk to take through `/talk-polish`. One at a time.

## Boundaries

- The audit does not write prose, choose quotes, or build pages.
- A score is not an editorial judgment. If the user wants a different talk, take
  it; the audit is a map, not a manager.
- Never run `talk-polish` and `talk-page` in the same turn without the user's choices.
