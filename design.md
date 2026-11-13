# Design language

One visual language for everything this build shows a person: the site
(**Today** `index.html`, the **schedule** `site/index.html`, the **talk hubs**
`site/talks/`, **themes** and **people**), the **talk pages**
(`talks/<slug>/experience/`), and the explainer, atlas and magazine artifacts. It started as the field guide's look (the user's
*Quadrangle* system from the Walking Thoughts field manual, applied to a
conference survey sheet) and is now the house style.

The tokens live in one file, [`site/theme.css`](site/theme.css). The talk
runtime ([`stories/runtime/talk.css`](stories/runtime/talk.css)) maps the same
values onto its own variable names. The field guide's template
([`scripts/site/template.html`](scripts/site/template.html)) carries its own
copy because it ships as one self-contained file; keep the three in step.

## Intent

A field sheet at dusk, not a dashboard. Dark green ground, warm off-white ink,
one yellow for "this is the thing to look at." Condensed uppercase display type
for names and headings, a monospace label voice for metadata, a serif italic
for anything said in a human voice. Status is shown with small outlined pills,
never with filled colored blocks. The machinery stays quiet; the content and
the one yellow do the work.

Single theme on purpose: every colour is explicit and there is no light mode to
drift out of sync.

## Tokens

```css
:root {
  color-scheme: dark;
  --ground: #17231b;      /* page */
  --deep: #101712;        /* inputs, wells, video placeholders */
  --surface: #1e2c22;     /* cards, the visual rail */
  --raised: #24352a;      /* callouts, rules inside cards */
  --ink: #f2f1e8;
  --ink-muted: #b9bcae;
  --line: rgba(242, 241, 232, 0.16);
  --line-strong: rgba(242, 241, 232, 0.38);
  --action: #f4cf72;      /* the one yellow: the thing to look at, progress, the active choice */
  --identity: #a9d18f;    /* GO, built, done */
  --attention: #f0b4a0;   /* clashes, warnings, tight changes */
  --machine: #8fb8d8;     /* what the machine says; links */
  --on-action: #17231b;   /* text on yellow */
  --display: "Barlow Condensed", "Arial Narrow", "Helvetica Neue Condensed", system-ui, sans-serif;
  --capture: Georgia, "Times New Roman", serif;
  --body: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  --mono: ui-monospace, SFMono-Regular, Menlo, monospace;
}
```

### Colour roles

| Role | Token | Use for | Never for |
| --- | --- | --- | --- |
| Action | `--action` | the active tab, the progress meter, a card's top rule, the one highlighted item, a section label in a talk | body text, more than one thing per view |
| Identity | `--identity` | GO calls, **built** artifacts, things that are done | warnings |
| Machine | `--machine` | links, maybe calls, anything the pipeline asserts | headings |
| Attention | `--attention` | clashes, deferrals, things that need a decision | decoration |
| Muted | `--ink-muted` | metadata, pending items, skip calls, captions | the main claim |

Text on a yellow fill uses `--on-action`. Pills are outlined in `currentColor`
and carry the role colour as text.

### Type

| Voice | Font | Setting | Used for |
| --- | --- | --- | --- |
| Display | `--display` | 600, uppercase, tracked `.025–.05em`, line-height ~1 | `h1`, `h2`, card titles, talk titles, tab labels |
| Label | `--mono` | 700, `.6–.72rem`, uppercase, tracked `.12–.3em` | kickers, times, counts, pills, "7 of 7 built" |
| Body | `--body` | 400, `.98rem / 1.55` | paragraphs, lists, table cells |
| Capture | `--capture` | italic | the masthead promise, pull quotes, anything a person said |

Scale: masthead `h1` `clamp(2rem, 7vw, 3.1rem)`, view `h2` `1.7rem`, card `h3`
`clamp(1.45rem, 3.6vw, 2.5rem)`, body `.98rem`, minor `.88rem`, labels
`.62–.72rem`. Never below 11px.

### Fonts and assets

Barlow Condensed is the one web font, loaded from Google Fonts with
`preconnect` and `display=swap`; the stack falls back to Arial Narrow if it
can't load, so pages still work offline. Everything else is local: no icon
fonts, no external images, no CDN scripts. Inline SVG for marks and diagrams.

## Layouts

**Sheet.** Every page is a centred column, `max-width: 68rem`, with a 16px side
gutter (`max(16px, env(safe-area-inset-*))`). No horizontal scroll at 380px.

**Field guide** (`site/index.html`). Masthead, marginalia, sticky view tabs,
then one view at a time: a card per talk, slot lists, the calendar, the floor
maps.

**The site.** Every page opens with the same top bar (`.topnav`, built by
[`scripts/site/nav.ts`](scripts/site/nav.ts), styled by
[`site/nav.css`](site/nav.css)): Today · Schedule · Talks · Themes · People, the
current section filled yellow. `mise run views` renders all of it;
`render-pages.ts` owns everything except the schedule, whose components live in
[`site/pages.css`](site/pages.css).

- **Today** (`index.html`). The day's plan: now and next, then my GO picks,
  captured talks and breaks in time order, with past rows dimmed and the current
  one ruled in yellow. A day switcher covers the other dates. Then what's
  captured, the latest notes, and the pipeline folded away at the bottom.
- **Talks** (`site/talks/index.html`). One card per captured talk: thesis,
  "N of 7 built" meter, and a pill per artifact that opens that part of the hub.
- **Talk hub** (`site/talks/<slug>.html`). Everything collected about one talk,
  rendered, never raw markdown: speakers with follow/write buttons, my notes,
  photos, the recording, the story, links, and the transcript (folded). A
  "Read the story" button leads to the talk page when one exists.
- **Themes** (`site/themes.html`). A card per theme, then the full report with
  every citation pointing at the hub's transcript.
- **People** (`site/people.html`). Speakers I've heard first, then everyone in
  schedule order, with a filter. **Follow** and **Write** open X's intent pages;
  nothing is posted from here. "Followed" ticks live in the browser only.

**Talk page** (`talks/<slug>/experience/page.html`). The fixed talk runtime
reads as a story, one beat at a time. Masthead, then two columns: the visual
rail fills the viewport height on the left and stays put, the chapters scroll
on the right. The chapter in view is full strength and the others recede; the
rail shows that chapter's visual, a caption, a progress bar and a "3 / 6"
counter. The runtime adds the site's top bar and a "← Everything from this
talk" link to the hub, and points `../transcript.md` and `../links.md` evidence
links at the hub's rendered sections. This holds down to 700px (columns even out below 980px). Under 700px
there is no rail: the runtime places a copy of each chapter's visual directly
above that chapter's text, so picture and paragraph stay together. See
[`TALKS.md`](TALKS.md) for the page contract.

**Explainer, atlas, magazine.** Same tokens and voices. Their runtimes
(`runtime/reader.css` and the bundlers) still ship the older paper defaults;
when one of these is rebuilt, link `site/theme.css` after the runtime style so
the house tokens win.

**Print.** Controls hidden, every rail visual printed above its chapter text,
figures and quotes `break-inside: avoid`. Dark ground is acceptable in print
preview; if a printed copy is the goal, override `--ground` to white and
`--ink` to near-black in an `@media print` block for that artifact only.

## Components

| Component | Markup | Notes |
| --- | --- | --- |
| Masthead | `<header class="masthead"><p class="mono agency">…</p><h1>…</h1><p class="sub">…</p></header>` | centred; `sub` is the italic capture voice; hidden under 40rem |
| Marginalia | `<div class="marginalia mono">` | the line under the masthead: where, when, a link back |
| View | `<section class="view"><div class="view-head"><h2>…</h2><p class="lede">…</p></div>…</section>` | one per section of a page |
| Card | `<article class="card">` | `--surface`, hairline border, **2px yellow top rule** |
| Pill | `<span class="pill call-go">built</span>` | outlined, label voice; `call-go` built/GO, `call-maybe` machine, `call-skip` pending/muted, `warn` attention |
| Meter | `<div class="meter"><i style="width:…%"></i></div>` | 3px, yellow fill, under a "N of M" label |
| Receipt line | `<div class="receipt"><span>…</span><span class="mono">…</span></div>` | a hairline-topped row: thing on the left, status/time on the right |
| Top bar | `<nav class="topnav">` | every page; one `aria-current` link, filled yellow |
| Artifact pill | `<a class="pill call-go" href="…#notes">Notes · 9</a>` | talk cards and hubs; links to that hub section |
| Person row | `<div class="person">` | name, talk, Follow / Write buttons, other links |
| Rail visual | `<figure class="talk-visual photo-card \| diagram-card \| quote-card">` | talk runtime; one per chapter; photo captions stay inside the frame |
| Reading box | `<div class="reading"><b>The reading:</b> …</div>` | interpretation, never the speaker's words; `--panel` fill |
| Read alongside | `<div class="alongside"><b>Read alongside</b>…</div>` | an outside source, outlined, one short line and a link |

### Labelling what is whose

Talk pages mix three voices and the design keeps them apart:

- **The speaker**: body copy cites a transcript timestamp; quotes are verbatim,
  in the capture serif, with a yellow left rule.
- **The reader's framing**: only inside a *reading* box, labelled "The reading"
  or "From the notes".
- **Outside sources**: only inside a *read alongside* box, linked.

A diagram or mockup that is illustrative says so in its caption.

## Interaction contract (explainers)

The explainer runtime is unchanged. The page includes three placeholders, in
this order:

```html
<head>
  <!--READER_STYLE-->
  …your own <style> (and site/theme.css) after it, so your rules win…
</head>
<body>
  <main id="reader-doc">…the guide…</main>
  <aside id="reader-panel" aria-label="Reader guide"></aside>
  <!--READER_DATA-->
  <!--READER_RUNTIME-->
</body>
```

- `<!--READER_STYLE-->` → `runtime/reader.css` (defaults only).
- `<!--READER_DATA-->` → a JSON block with the glossary and questions.
- `<!--READER_RUNTIME-->` → `runtime/reader.js` (the fixed behavior).
- `data-term` values are glossary keys, lowercased; `data-chapter` values are
  the slugs used in `questions.json`.
- Internal links to talks are `../../talks/<slug>/transcript.md`. Never a bare
  `talks/...`.

The runtime provides class hooks: `.rg-tabs`, `.rg-tab`, `.rg-pane`,
`.rg-search`, `.rg-terms`, `.rg-term`, `.rg-detail`, `.rg-section`,
`.rg-questions`, `.rg-question`, `.rg-input`, `.rg-ask`, `.rg-answer`. Style
them; do not add ids the runtime does not know, and do not attach your own click
handlers to terms or questions.

## Accessibility

`lang` on `<html>`, a viewport meta, `:focus-visible` in `--identity` with a
2px offset, 4.5:1 contrast for body text (ink and muted ink both pass on
`--ground` and `--surface`), alt text on every photo that says what the slide
reads, `aria-live="polite"` on anything that updates, and
`prefers-reduced-motion` respected.

## Checklist before shipping

- Tokens come from `site/theme.css` (or the talk runtime's mapping); no
  hard-coded light colours left from the old paper palette.
- One yellow thing per view.
- Status uses outlined pills in role colours, not filled blocks.
- At 380px: one column, no horizontal scroll, controls reachable.
- Photo and diagram cards keep their captions inside the frame.
- Print preview: no clipped figures, controls hidden.
- Explainers still pass `bun scripts/validate-explainer.ts <index.html>`.
