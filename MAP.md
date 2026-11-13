# Finding things

The agent's index to a **conference build**. Paths are from the repo root. The
product story is [README.md](README.md); this is where the bytes actually sit.

> **Template or build.** The upstream template tracks `src/`, `scripts/`,
> `.agents/skills/`, `fixtures/`, `design.md`, and the READMEs. It has no
> conference data. `brief/`, `state/`, `talks/`, `recordings/inbox/`, `photos/`, `site/`,
> `analysis/`, `notes/inbox/`, `notes/research/`, `editorial/backlog.md`,
> `editorial/hooks/`, `explainers/<slug>/`, `atlases/<slug>/`, and `magazine/<issue>/` are ignored
> by the "conference build data" block in `.gitignore`. A build deletes that
> block; see `.agents/skills/conference-init/SKILL.md`.

## How data flows

`src/` is the source of truth for the machinery. `dist/` is compiled and
disposable. Each row is one node under `src/`: what it reads, the truth it keeps,
and the files a reader ends up holding.

| Node | Kind | Reads | Maintains | Writes |
| --- | --- | --- | --- | --- |
| `schedule-check` | gateway | a cron tick or a manual kick | `check_requests` | — |
| `conference-schedule` | responsibility | `check_requests` | `event`, `venue`, `program`, `speakers`, `change_log`, `coverage` | `state/world-model/conference-schedule/` |
| `schedule-brief` | responsibility | the schedule facets | `brief` | `brief/schedule.md`, `brief/changes.md` |
| `recording-inbox-watch` | gateway | the drop folder, every 15 minutes | `inbox_scans` | — |
| `recording-intake` | responsibility | `inbox_scans`, `program`, `speakers` | `recordings`, `matches`, `talks`, `attachments` | `talks/<date>-<slug>/transcript.md` |
| `talk-photos` | responsibility | `program`, `recordings`, `event` | `photos`, `placements`, `event_photos` | `talks/*/photos/`, `photos/event/` |
| `talk-links` | responsibility | `program`, `speakers`, `talks`, `event` | `people`, `companies`, `resources`, `freshness`, `coverage` | `talks/*/links.md` |
| `talk-insights` | responsibility | `talks` | `theses`, `claims`, `coverage` | — |
| `conference-themes` | responsibility | `claims`, `theses`, `coverage`, `talks` | `themes`, `singletons`, `contested`, `corpus` | `analysis/themes.md` |
| `capture-note` | function | a kind, the text, a time, an optional talk | — | `notes/inbox/<stamp>-<slug>.md` |
| `append-backlog` | function | a list, an item, a source | — | `editorial/backlog.md` |

Every node also writes its world-model to `state/world-model/<node>/published/`
and a receipt to `state/world-model/<node>/receipts.jsonl`. A node renders only
when its contract or an input fingerprint moved, so a row with no new input
costs nothing. `runs/<id>/` holds the log for one wake.

`/conference-themes`, `/conference-hooks`, `/conference-explainer`,
`/conference-atlas`, and `/conference-magazine` are skills. They compose
artifacts. A contract consumes an artifact through a declared input, and
publishes its own structured truth for anything downstream. See
[`FRAMEWORK.md`](FRAMEWORK.md#where-skills-and-contracts-meet).

## Schedule truth

Base: `state/world-model/conference-schedule/published/`.

| You want | Read |
| --- | --- |
| all sessions: title, abstract, room, track, speakers, start/end | `program/sessions.json` |
| the same, readable | `program/program.md` · `brief/schedule.md` |
| event name, dates, timezone, status | `event.json` |
| rooms and venue | `venue/venue.json` · `venue/venue.md` |
| speakers, affiliations, bios, links | `speakers/speakers.json` · `speakers/speakers.md` |
| what the source page did not publish | `coverage/coverage.md` |
| what changed since tracking began | `change-log/change_log.md` · `brief/changes.md` |

`brief/schedule.md` is the human brief: every session, with abstracts where the
page published one.

## The talks

A build renders the sessions it recorded; the template has none. A talk is one
folder:

| File | What it is |
| --- | --- |
| `talks/<YYYY-MM-DD>-<slug>/transcript.md` | The cleaned transcript. Frontmatter: `title`, `speakers` (name + affiliation), `room`, `starts_at`, `ends_at`, `format`, `recording`, `duration`. Body: `### HH:MM:SS — Section` headings over ASR text. |
| `talks/<YYYY-MM-DD>-<slug>/links.md` | The dossier: speakers, company, verified resources, gaps. |
| `talks/<YYYY-MM-DD>-<slug>/photos/` | Photos filed to the talk. Local only, not committed. |
| `talks/<YYYY-MM-DD>-<slug>/story.md` | The reader's cut: chapters, key points, quotes, visual cues. Derived, cited, not evidence. |
| `talks/<YYYY-MM-DD>-<slug>/experience/` | The talk page: sticky visual rail and story. |

`ls talks/` is the recorded corpus. `brief/schedule.md` is everything else.

## Recordings

`recordings/inbox/<date>_<time>_<label>/` holds `transcript.txt`,
`transcript.words.json`, `meta.json`, and `attachments/`. `audio.m4a` is local
only. The label is the Voice Memos name, not the talk slug.

## Dossiers and photos as state

| Path | What it is |
| --- | --- |
| `state/world-model/talk-links/published/world-model.json` | People, companies, resources, freshness, keyed by `session_id`. |
| `state/world-model/talk-photos/published/world-model.json` | Photo placements. |
| `photos/manifest.json` | The raw photo inventory with UTC capture times. |

## Serve evidence

`runs/<YYYYMMDD>-<HHMMSS>-<rand6>/` holds the activation, the compiled intent,
and `vm.log.md` for one wake. `runs/serve/` holds the trigger plan, the spool,
`policy.json`, and `serve.log.md`. Both are generated and gitignored.

## Joining the pieces

Slugs collide across parallel tracks; join on `recording` or on `title` +
`starts_at`.

- **Talk → session:** `recording` from the transcript frontmatter →
  `state/world-model/recording-intake/published/world-model.json` →
  `matches[<label>].session_id`. The match carries `confidence` and `evidence`.
- **Talk → session (no recording index):** `title` + `starts_at` in
  `program/sessions.json`, with YAML quotes and smart punctuation normalised.
- **Talk → words:** `transcript.md`; the `### HH:MM:SS` heading is the citation.

## Template and build

The template tracks `src/`, `scripts/`, `.agents/skills/`, `fixtures/`,
`design.md`, and the READMEs. It has no conference data.

A build is a **separate clone** in its own directory and repo. It has run
`conference-init`, removed the ignore block, and tracks its own:

- `state/` — the world-model, receipts, and published facets
- `brief/` — the schedule and changelog
- `talks/` — transcripts and dossiers
- `recordings/inbox/` — transcripts and `meta.json` (no audio)
- `analysis/themes.md`, `editorial/backlog.md`, `explainers/<slug>/`,
  `magazine/<issue>/`

Missing in both, and how it comes back:

| Missing | Comes back from |
| --- | --- |
| `node_modules/` | `bun install` |
| `.env` | `cp .env.example .env`, set `CONFERENCE_URL` |
| `dist/` | `prose compile`, then promote `manifest.next.json` → `manifest.active.json` |
| `runs/` | the first serve wake |
| `state/`, `brief/` | the schedule render, in a session opened in the build |
| `talks/` | `recording-intake` after `mise run sync` (copy) and the serve tick (Qwen) |
| `talks/*/photos/`, `photos/event/` | `mise run photos` over the local drop; filed copies stay local |
| `recordings/**/*.m4a` | `mise run sync` (needs Full Disk Access) |
| `recordings/inbox/*/transcript.txt` with no Voice Memos transcript | `mise run transcribe` (local Qwen3-ASR, `QWEN_ASR_DIR`) |

A built clone answers questions about the talks and the schedule with nothing
running. Only new observations need serve. The template has no talks to ask
about until it builds.

## Ask the corpus

A build's transcripts are the corpus. Search the headings and body, then read the
sections that hit. Word counts are build-specific.

- `/talk-ask` — what a talk said, who said it, which talk covered a topic.
- `/conference-themes` — the patterns across every talk; the first report is
  `analysis/themes.md`.

## The field guide

`mise run site` renders `site/index.html` from the schedule truth through
`scripts/site/template.html`. Two optional build files feed it:
`site/map/map.json` (floor plans, room outlines, routes) and
`site/recommendations.json` (a go, maybe or skip call per session id). The
render fails if a recommendation names a session no longer in the schedule. A
viewer's picks live in the published artifact's `plans` collection, not in `state/`.

## Notes and editorial

| Path | What it is |
| --- | --- |
| `notes/inbox/` | one file per `/conference-capture` — observation, question, link, quote, todo |
| `notes/research/` | a `/talk-ask` or `/conference-themes` answer kept on purpose |
| `editorial/backlog.md` | ideas to write, things to review, things to digest |
| `editorial/hooks/` | evidence-backed bullets, one file per synthesis |
| `magazine/<issue>/` | `issue.md`, `issue.html`, and the photos used |

[`FRAMEWORK.md`](FRAMEWORK.md) is the pipeline that connects them.

## Explainers

A build's `explainers/<slug>/` holds `guide.md`, `glossary.json`,
`questions.json`, `page.html` (the composed design), `runtime/`, `assets/`, and
the bundled `index.html`. The design language is [`design.md`](design.md).
`page.html` is the source; bundle it with `scripts/bundle-explainer.ts`, validate
with `scripts/validate-explainer.ts`, then serve. See [`FRAMEWORK.md`](FRAMEWORK.md).

## Atlases

A build's `atlases/<slug>/` holds `atlas.json` (nodes, edges, evidence),
`page.html` (the composed shell), and the bundled `index.html`. The fixed
runtime is `atlases/runtime/`. Bundle with `scripts/bundle-atlas.ts`, validate
with `scripts/validate-atlas.ts`, then serve like an explainer. The validator
requires a verbatim quote and a real section heading for every claim.
