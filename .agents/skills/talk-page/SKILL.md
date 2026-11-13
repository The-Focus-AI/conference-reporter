---
name: talk-page
description: Design and build a scrollytelling talk experience — visual rail on the left, story on the right, collapsible, with photos, diagrams, quotes, or video stills. Use after /talk-polish, or when a talk should be readable without the raw transcript.
---

# Talk experience

A talk page is a reading experience, not a transcript with styling. The visual
rail carries the mechanism; the right column carries the argument.

Read [`TALKS.md`](../../../TALKS.md) for the visual language and the page
contract.

## 1. Start from the story

Require `talks/<slug>/story.md`. If it does not exist, run `/talk-polish` first.

Read the story, the dossier, the photos, and the transcript's section headings.
Do not compose from the transcript alone.

## 2. Ask the reader question

Ask:

- Who is this page for?
- What should they be able to say after it?
- Which **three** key points from the story must survive?

Propose a chapter order (4–6 chapters) and one visual per chapter. Wait for the
user to approve or change it before composing.

## 3. Choose the visual rail

One card per chapter, in order. Types:

- `photo` — a filed photo that shows a slide, the speaker, or the room.
- `slide` — a published slide or a video still.
- `quote` — the line that carries the point.
- `diagram` — a small SVG/HTML mechanism, at most 7 nodes.
- `video` — a poster/placeholder and a link at a timestamp.
- `code` — a CLI, schema, or proof.

The rail is a stack, not a carousel. The active card is visible; previous cards
recede to a spine. If the talk has no photos, draw the mechanism. Do not use a
stock illustration.

**Slide photos are straightened, not just cropped.** A slide shot from the
audience is skewed. Write the rail image into `experience/` with:

```bash
python3 scripts/straighten-slide.py talks/<slug>/photos/<photo> talks/<slug>/experience/<name>.jpg
```

It finds the lit screen's corners and warps it flat (16:9 by default; `--aspect
4:3` or `auto`). When it refuses ("auto corners don't look like a slide": an LED
wall, a speaker in front), pass `--corners TL,TR,BR,BL` read off the photo, or
keep a plain crop (`sips -c H W --cropOffset Y X`) if the shot is head-on. Look
at the result before using it. The caption says “straightened from
photos/<file>” or “cropped from photos/<file>”. Never edit the filed original.

## 4. Compose `talks/<slug>/experience/page.html`

Required shell:

```html
<div class="talk-layout">
  <aside class="talk-rail" aria-label="Visuals">
    <div class="talk-visuals">
      <figure class="talk-visual" data-visual="v1">…</figure>
      <figure class="talk-visual" data-visual="v2">…</figure>
    </div>
  </aside>
  <main class="talk-copy">
    <section data-chapter="the-demo" data-visual="v1">…</section>
    <section data-chapter="the-script" data-visual="v2">…</section>
  </main>
</div>
<button type="button" data-talk-collapse>Hide visuals</button>
```

- Every section has a `data-chapter` slug and a `data-visual` that matches a
  card.
- Cite every factual claim as a link to `../../talks/<slug>/transcript.md` plus
  the timestamp.
- Link the video at the timestamp where it helps, not as a substitute for the
  text.
- No external scripts, no inline event handlers.
- The fixed runtime is `stories/runtime/talk.js` + `talk.css`. From
  `talks/<slug>/experience/`, link `../../../stories/runtime/talk.css` and
  `../../../stories/runtime/talk.js`. Do not invent a second runtime.

## 5. Collapse and mobile

- Desktop: the rail is sticky. `data-talk-collapse` hides it and centres the
  text; the label becomes “Show visuals”.
- Mobile: the rail goes to the top and is not sticky. The story follows. It must
  not cover the text.
- Print: hide the controls; print each chapter's visual above its text.

## 6. Validate and serve

- Every `data-visual` has a matching card and every card has a section.
- Every `img src` resolves; no external images.
- Every citation link resolves to a talk that exists.
- Every quote appears verbatim in the transcript.
- At 380px: one column, no horizontal scroll, controls reachable.
- Print preview: no clipped figures.

```bash
bun scripts/explainer-server.ts --root . --dir talks/<slug>/experience
```

Do not link the reader to `transcript.md` as the experience. The page is the
experience; the transcript is the evidence link at the bottom of each chapter.
