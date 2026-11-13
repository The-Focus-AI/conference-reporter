---
name: talk-polish
description: Turn a raw ASR transcript into a readable talk story — chapters, key points, pull quotes, and visual cues — while keeping the transcript as the untouched evidence. Use after /conference-next, or when a talk is hard to read.
---

# Polish a talk

The transcript is evidence. The story is the reader's cut. Never confuse them.

## Inputs

- `notes/inbox/*.md` whose `talk:` is this talk — the operator's notes. Read
  them first: they are what the operator found worth writing down, and the story
  is built around them.
- `talks/<slug>/transcript.md` — read the whole thing, including the headings.
- `talks/<slug>/links.md` — video, speakers, resources.
- `talks/<slug>/photos/` — the operator's photos. Look at every one: a photo is
  a note taken with the camera. What they photographed is what they thought
  mattered, alongside what they wrote down.
- `analysis/themes.md` — where the talk sits in the conference.

## 1. Frame from the notes and the photos

The operator's notes and photos are the frame of the story, not a source of
quotes for a frame you chose. They record what the operator thought was
important while listening; the transcript supplies the evidence for it.

1. **Group the notes and photos.** Put every note for the talk into clusters by
   what it is about (cost, people, a tool, a question). Count them. A note with
   emphasis (“!!!”, “super interesting”, “the key thing”) counts double. Then
   read each photo: name the slide, find the moment it was taken (filenames are
   UTC; convert to the event timezone and match the transcript heading), and add
   it to the cluster it belongs to. A photo counts as one beat. A slide that was
   photographed but has no note is still a beat: give it a cluster of its own
   rather than leaving it out.
2. **The heaviest cluster is the spine.** The thesis is the claim that cluster
   makes. The next clusters are the other chapters, in order of weight. A
   chapter no note supports needs a reason, and stays short.
3. **Say what the notes skip.** Parts of the talk with no note or photo behind them are
   folded into a chapter or left out, not given their own chapter because the
   speaker spent time on them.
4. **Answer the questions.** A question in a note is answered in the chapter
   where the talk answers it, or marked open.

Then give the user, in chat:

- **What the notes and photos say**: the clusters with their counts (notes and
  photos separately), and what they skip.
- **The thesis** that follows from the heaviest cluster.
- **The chapters** (3–6), each naming the notes it is built from, with a
  timestamp and a short verbatim quote for each.
- **The visual assets you found**: photos, video, slides, diagrams the talk
  describes.

If the user says to base it on their notes, or approves the frame, write the
story without asking again. Otherwise wait for their correction. Do not write
the story first.

## 2. Write `talks/<slug>/story.md`

```md
---
title: "Beyond “Done”: Building Verification Loops for AI Agents"
speakers: "Nick Nisi, Zack Proser"
duration: "56:47"
source: transcript.md
video: "https://www.youtube.com/watch?v=q4WC4TowkBo"
themes: [verification]
kind: talk-story
status: draft
---

# <cover line>

<two or three sentences: the promise of the talk>

## <chapter claim>

<two to four paragraphs in the reader's direction. Compress, reorder, and
paraphrase. Every factual claim cites the transcript: (00:16:07).>

**Key points**

- <one sentence>
- <one sentence>
- <one sentence>

> “<verbatim quote>”
> — 00:16:07

**Visual:** quote | photo `photos/<file>` | video `00:16:07` | diagram “<what to draw>”
```

Rules:

- **Never edit `transcript.md`.** The story is a separate, derived file.
- Quotes are **verbatim**; ASR garble stays in the quote. Paraphrase around it.
- Every claim points to a `HH:MM:SS` heading that exists in the transcript.
- 4–8 chapters. One idea per chapter. A chapter should be readable in 60–90
  seconds.
- Choose the visual cue that makes the chapter legible, not decoration.
- If a passage is unrecoverably garbled, say so; do not invent a clean version.
- Label the story `status: draft` until the user has read it.

## 3. Check the story

- Every quote appears in `transcript.md`.
- Every timestamp is a `### HH:MM:SS` heading.
- The spine is the heaviest note cluster, and every note lands in a chapter or is named as skipped.
- The key points are the ones the user approved.
- The story does not claim more than the talk did.
- The transcript is byte-identical to before.

## 4. Hand off

The next step is `/talk-page`, which designs the page around the story. Do not build
the page here.
