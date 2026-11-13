# Running a conference build: the operator's guide

This is the long-form manual for using this template at a live conference and
after it. [README.md](../README.md) explains the product and the toolchain;
[AGENTS.md](../AGENTS.md) is the working agreement for changing it;
[scripts/serve/README.md](../scripts/serve/README.md) is the runtime's tick
procedure. This guide ties them together into a day-by-day routine, with the
commands, the prompts that drive the agent, and what went wrong the first time
(AI Engineer Code Summit 2026, Nov 10–12, three days, 36 recordings, 157 photos,
211 notes).

Contents:

1. [The shape of a build](#1-the-shape-of-a-build)
2. [Before the event](#2-before-the-event)
3. [Starting and stopping serve](#3-starting-and-stopping-serve)
4. [During a talk: notes](#4-during-a-talk-notes)
5. [Recordings and Qwen](#5-recordings-and-qwen)
6. [Photos](#6-photos)
7. [The livestream](#7-the-livestream)
8. [Rendering a node by hand (subagents and commit-render)](#8-rendering-a-node-by-hand)
9. [From talk to story to page](#9-from-talk-to-story-to-page)
10. [The site](#10-the-site)
11. [Publishing](#11-publishing)
12. [After the event: insights, themes, archive](#12-after-the-event)
13. [Lessons and gotchas](#13-lessons-and-gotchas)
14. [Command reference](#14-command-reference)

---

## 1. The shape of a build

One directory = one repo = one conference. The template (this repo) has no
conference data; `conference-init` clones it into a sibling directory that
tracks its own `brief/`, `state/`, `talks/`, notes and pages.

Two pipelines share one reconciler:

```
schedule-check ─▶ conference-schedule ─▶ schedule-brief
recording-inbox-watch ─▶ recording-intake ─▶ talk-photos
                                         └─▶ talk-links
                         talk-insights ─▶ conference-themes
```

- **Gateways** (`schedule-check`, `recording-inbox-watch`) observe the world on a
  cron. A fresh cron fire is new evidence, so a gateway always renders; if what
  it saw is unchanged, its fingerprint does not move and nothing downstream
  wakes.
- **Responsibilities** render only when an input fingerprint moved. Every render
  commits a world-model under `state/world-model/<node>/` and signs a receipt
  in `receipts.jsonl`.
- **Views** (`index.html`, `site/**`) are projections of that truth. They are
  regenerated, never read back.

Where things live:

| Path | What | Tracked in a build |
| --- | --- | --- |
| `src/*.prose.md` | the contracts (source of truth for behavior) | yes |
| `dist/` | compiled manifest, canonicalizers, postconditions | no (disposable) |
| `state/world-model/<node>/` | durable truth + receipts | yes |
| `runs/` | per-render evidence, `runs/serve/serve.log.md` | no |
| `notes/inbox/` | one note per file, local time | yes |
| `recordings/inbox/<folder>/` | audio + transcripts + `meta.json` | meta and text yes, audio no |
| `photos/` | the raw drop + `manifest.json` | manifest only |
| `talks/<slug>/` | `transcript.md`, `links.md`, `story.md`, `experience/`, `photos/` | yes (photo copies no) |
| `analysis/` | `themes.md`, insight reports | yes |
| `editorial/` | `backlog.md`, `presentation.json`, `livestreams.json` | yes |
| `site/`, `index.html` | rendered pages; `site/*.css`, `site/explorer.js` are template code | yes |

## 2. Before the event

1. **Create the build.** From the template:

   ```
   /conference-init
   ```

   It clones to `../<event>-<year>-<month>`, deletes the conference-data fence
   in `.gitignore`, writes `.env` with `CONFERENCE_URL`, and stops. Open a new
   session in the new directory; never work on a conference in the template.

2. **Compile and promote.** In the build:

   ```
   prose compile
   ```

   then

   ```bash
   mise run fingerprints        # must PASS: catches canonicalizers that hash populated truth as empty
   cp dist/manifest.next.json dist/manifest.active.json
   mise run validate            # must print VALID
   ```

3. **First schedule truth.** Run the schedule gateway once and let it render
   `conference-schedule` and `schedule-brief`:

   ```bash
   bun scripts/serve/tick-schedule.ts --reason manual-kick
   ```

   Read `brief/schedule.md`. Check `state/world-model/conference-schedule/published/event.json`
   has the right timezone: every clock on the site and every photo placement
   depends on it.

4. **Optional field-guide data** (all build data, all optional):

   - `site/recommendations.json`: `{ "calls": { "<session_id>": { "call": "go|maybe|skip", "why": "..." } } }`.
     The schedule render fails if a call names a session no longer in the
     schedule, so re-check after schedule changes.
   - `site/map/map.json` plus floor images: floor plans, room outlines, routes.

5. **Install Qwen3-ASR** if you want the accurate transcripts (README → *Install
   Qwen3-ASR*). Check `mise run dry-run` prints `asr auto (local: qwen3-asr-1.7b)`.

6. **Give Voice Memos Full Disk Access** to the terminal that runs `mise run
   sync`. Recordings sync over iCloud from the phone; name a memo after the
   speaker when you can: an exact speaker-name title counts as your
   attribution during matching.

7. **Optional: refresh views on every write.** A Claude Code hook keeps the
   pages current while you write notes and stories. In the build's
   `.claude/settings.json` (gitignored), replace `<build-dir>`:

   ```json
   {
     "hooks": {
       "PostToolUse": [{
         "matcher": "Write|Edit",
         "hooks": [{
           "type": "command",
           "command": "f=$(jq -r '.tool_input.file_path // .tool_response.filePath // empty'); case \"$f\" in */<build-dir>/talks/*|*/<build-dir>/notes/*|*/<build-dir>/analysis/*|*/<build-dir>/editorial/*) cd \"$CLAUDE_PROJECT_DIR\" && mise run views >/dev/null 2>&1 ;; esac; true",
           "timeout": 30
         }]
       }]
     }
   }
   ```

## 3. Starting and stopping serve

Serve has no daemon here. It is the agent session plus two session-scoped cron
prompts and a loopback HTTP adapter. Say **`prose start`** (or `prose serve`) in
the build session; the agent should:

1. `bun scripts/serve/validate-manifest.ts` → `VALID`.
2. Start the adapter in the background: `bun scripts/serve/http-adapter.ts --port 8787`.
3. Register two crons. Off-minute schedules avoid the top-of-hour pile-up. The
   prompts below are the whole tick; paste them as the cron prompt.

**Inbox tick**, every 15 minutes (e.g. `4,19,34,49 * * * *`):

```text
prose serve tick (recording-inbox-watch cron, */15). Follow scripts/serve/README.md "Tick procedure".
Single-flight first: if a tick-inbox.ts or Qwen process is still running
(pgrep -f "tick-inbox|qwen|transcribe-missing"), or runs/serve/policy.json shows
recording-intake in flight, coalesce: log one line and only run `mise run views`.
Otherwise run the inbox gateway with the Qwen upgrade allowed (it self-gates to AC
power): `bun scripts/serve/tick-inbox.ts`. If the inbox fingerprint moved, render
recording-intake (in a subagent, from the transcripts in force; a re-transcription
re-decides that recording), then wake talk-photos / talk-links per the topology.
Otherwise write skipped receipts only. ALWAYS finish with `mise run views`, even
when nothing moved. Do not commit or publish. Append one line per decision to
runs/serve/serve.log.md. Report in one or two lines.
```

**Schedule tick**, every 6 hours (e.g. `7 */6 * * *`):

```text
prose serve tick (schedule-check cron, every 6h). Follow scripts/serve/README.md
"Tick procedure": run the schedule gateway tick (`bun scripts/serve/tick-schedule.ts`),
propagate to conference-schedule / schedule-brief only if fingerprints moved, refresh
views if anything rendered. Never run Qwen. Do not commit or publish. Append one line
to runs/serve/serve.log.md. Report in one line.
```

Session crons expire (7 days in Claude Code) and die with the session. Restart
them after a context reset.

**`prose stop`**: delete both crons, stop the adapter, confirm nothing is in
flight (`pgrep`, `jq .inflight runs/serve/policy.json`), and log one line:

```
- <date> PT · prose stop: session crons <id> (inbox) and <id> (schedule-check) deleted; http adapter stopped; nothing in flight
```

**`prose state`** / **`prose status`**: summarize the last receipt of every node,
what is in flight, and what is waiting (Qwen deferred, talks without stories).

Single-flight matters: a tick that arrives while an intake subagent is still
working must coalesce, not start a second render of the same node.

## 4. During a talk: notes

Say `note <anything>` and the agent runs `/conference-capture`: one file per
note in `notes/inbox/YYYY-MM-DDTHHMM-<slug>.md`, local time, with:

```yaml
---
captured_at: 2026-11-12T17:08:00-08:00
kind: observation          # observation | question | link | quote | todo
session_id: "1325061"      # the session whose window contains the time
talk: null                 # set by recording-intake once the talk folder exists
tags: [planning, agents]
bucket: review             # todos only: review | digest
---

Don't over-plan.

In Dexter Horthy's "12-Factor-Factories" (1325061, Mainstage), after the
"maintain and understand the codebase" note.
```

Rules that matter:

- **Words as said.** Keep the operator's wording, including typos; add a
  clarification in parentheses ("Slot is asymmetric. (As typed; probably
  'slop'.)") rather than correcting it.
- **Don't invent cross-references.** Link a note to another talk only when the
  connection is verified against that talk's transcript or notes.
- **Todos route to the backlog.** `kind: todo` appends a line to
  `editorial/backlog.md` under `## Review later` or `## Digest later`. "Follow up
  on X" is a todo. The backlog renders as the Follow-ups page.
- **"I'm at the X talk"** sets the session for the following notes. Do this
  whenever the room is running off the clock.
- **The stage runs early or late.** On the last afternoon of AIE Code the main stage
  ran 15–20 minutes early by afternoon. File by what is being said, not by the
  clock, and ask when it is ambiguous. A wrong `session_id` is worse than none.
- **Lookups during a talk.** "Look up X" may get a quick web search appended to
  the note body, marked as unverified. The talk-links node verifies later.

## 5. Recordings and Qwen

```bash
mise run sync        # copy new Voice Memos into recordings/inbox/ (Voice Memos transcript only)
mise run transcribe  # Qwen3-ASR over every folder not yet on Qwen (AC power only)
mise run dry-run     # what sync would do
```

- `sync` only copies; Qwen runs in the serve tick
  (`tick-inbox.ts` → `export-voice-memos.ts --transcribe-missing`) or by hand.
- **Qwen runs only on AC power.** On battery it is deferred, not failed:
  `transcript_upgrade: "qwen deferred: on battery power at 24% ... · 2 recording(s) waiting"`.
  `--allow-battery` (or `RECORDINGS_ASR_ON_BATTERY=allow`) forces it. Running Qwen
  is the operator's call; a "yes, we're plugged in" is for that sitting, not the
  whole conference.
- When Qwen finishes, the inbox fingerprint moves and `recording-intake`
  re-decides each upgraded recording from the Qwen text. Expect `talk-links` to
  re-anchor its evidence quotes (they must be verbatim in the transcript in
  force), and `talk-photos` to come back unmoved.
- **Qwen's prompt leaks.** Qwen is primed with the speaker names of the sessions
  around a recording. It fixes many names Voice Memos garbles (Sourcegraph,
  Thorsten Ball, Ethan Mollick), but it also writes primed names that were never
  said (in one talk "Anthropic" three times where Voice Memos heard
  "Antigravity"). Intake counts a name from a primed transcript as attribution
  only, never as a named quote, and lists suspected prompt artifacts in the
  talk's transcript header. Check them before quoting a company name in a story.
- `meta.json` records `transcript_source` (`voice-memos` | `qwen3-asr-1.7b`) and
  `transcript_timing` (`word` | `segment`). The Voice Memos text stays in
  `transcript_alternates`.

## 6. Photos

Photos come from the phone through Google Photos. The download is the operator's
request each time ("sync the photos"):

1. Open `https://photos.google.com` in the browser pane.
2. Hover the **Today** heading and click its check circle (click by
   coordinates; element refs do not register the selection). The bar shows
   "N selected".
3. Press **Shift+D**. Google zips the selection ("Preparing to download N
   items…") into `~/Downloads/Photos-1-001.zip`. Wait until its size stops
   changing.
4. Unzip into a scratch directory, copy into `photos/` without overwriting
   (`cp -n`), delete the zip, then inventory:

   ```bash
   mise run photos      # writes photos/manifest.json: UTC filename → local time, hashes
   ```

5. The next tick (or a manual `talk-photos` render) files each new photo under
   `talks/<slug>/photos/` by recording overlap or session window.

**Filenames are UTC** (`PXL_20261113_010122172.jpg` is 17:01 PT on Nov 12).
Photos between two recordings, or after the last one, land in `needs-review`;
the operator decides. A photo is a note taken with the camera: stories count
photographed slides as beats.

## 7. The livestream

If the event livestreams, link each session to it:

`editorial/livestreams.json` (see `editorial/livestreams.example.json`):

```json
{
  "streams": [
    { "day": "2026-11-12", "room_id": "<main room id>", "video_id": "<YouTube id>",
      "started_at": "2026-11-12T08:47:01-08:00", "duration_seconds": 32710 }
  ]
}
```

`started_at` is the stream's real start: `yt-dlp --print "%(release_timestamp)s"`
(epoch seconds). `scripts/site/livestreams.ts` gives every session in that room a
`watch?v=…&t=Ns` link (scheduled start − stream start), shown on Today, both
schedules, talk cards and hubs, and `talk-links` cites it in dossiers. The
offset is **approximate**: when the stage ran late, the link landed on the end of
the previous talk. Label it so.

Pulling audio for a talk you missed:

- While the stream is **live or `post_live`** (YouTube still processing),
  `--download-sections` fails (ffmpeg cannot open the live DASH manifest). Wait
  until `yt-dlp --print "%(live_status)s"` says `was_live`.
- Then:

  ```bash
  yt-dlp -f 'bestaudio[ext=m4a]/bestaudio' --download-sections "*0:39:30-1:04:30" -o "talk.%(ext)s" "https://www.youtube.com/watch?v=<id>"
  ```

  Quote the format selector in zsh. Pad a couple of minutes either side and
  find the boundaries by seeking the player and reading the title slide.
- An old yt-dlp gets **403 Forbidden** from YouTube. Update it
  (`python3 -m pip install -U yt-dlp`) before blaming the network.
- Drop the clip into `recordings/inbox/<YYYY-MM-DD_HHMM_title>/` like a Voice
  Memo, with no transcript; Qwen transcribes it on the next plugged-in tick.

## 8. Rendering a node by hand

Ticks launch renders as **subagents**: a render reads a lot (transcripts,
schedule, prior world-model) and its file dumps should not fill the operator's
session. Brief the subagent completely; it knows only the prompt. A good brief:

- **Why it woke:** upstream run id, old → new fingerprint (full hex), which facet
  moved, and the concrete cause ("Qwen re-transcribed 9 recordings; same
  sessions").
- **Read first:** the contract (`src/<node>.prose.md`), AGENTS.md rules that
  apply, `scripts/serve/README.md` ("A bounded render", "Receipt shape"), and
  the previous render's run directory as a template.
- **Operator context** to verify, not to trust: likely matches, a title the
  schedule does not publish yet, the stage running early.
- **Boundaries:** do not commit, push, download, run Qwen, or touch other
  nodes' state.
- **Commit** through the helper, and append one `serve.log.md` line in the
  existing style.
- **Report** in a bounded number of words: run id, old → new `@atomic`, what
  moved, what was withheld, what failed.

Check the receipt yourself before reporting a subagent's result to the operator
(`tail -1 state/world-model/<node>/receipts.jsonl | jq '{run_id,status,fingerprints}'`).

The commit helper:

```bash
bun scripts/serve/commit-render.ts --node recording-intake \
  --candidate runs/<run>/workspace/candidate.json \
  --meta runs/<run>/workspace/meta.json \
  [--run-id <YYYYMMDD-HHMMSS-xxxxxx>] [--at 2026-11-12T18:44:25-08:00] [--unmoved-ok]
```

`meta.json`:

```json
{
  "input_fingerprints": { "recording-inbox-watch.@atomic": "7da643d6…" },
  "wake": { "source": "input", "refs": [{ "trigger": "upstream-receipt", "node": "recording-inbox-watch", "run_id": "20261112-211736-696598", "facet": "@atomic", "fingerprint": "7da643d6…" }] },
  "summary": "9 recordings re-cleaned from Qwen; no match changed …",
  "cost_accounting": "read 9 transcripts and meta; 0 searches",
  "model": "claude-opus-5-5",
  "facet_files": ["recordings", "matches", "talks", "attachments"]
}
```

It validates `dist/postconditions/<node>.js`, canonicalizes with
`dist/canonicalizers/<node>.js`, writes the version, published copy and facet
files, and appends a signed receipt. If nothing moved it stops (write a skip
receipt with `scripts/serve/skip-receipt.ts`, or pass `--unmoved-ok`). A
postcondition is only as strict as its compiled validator: some accept an empty
`{}`, so read the candidate before committing.

## 9. From talk to story to page

```
/conference-next     → which talk next (ranked by your note count)
/talk-polish <slug>  → frame from notes + photos, then talks/<slug>/story.md
/talk-page <slug>    → talks/<slug>/experience/page.html
```

**Notes drive the story.** `next-work` ranks unstoried talks by how many notes
you took, then by Qwen transcript. `talk-polish` clusters every note and every
photo for the talk; the heaviest cluster is the spine, photographed slides are
beats, and parts of the talk you did not note are folded in or left out. It
proposes the frame (clusters with counts, thesis, chapters with verbatim
quotes and timestamps); "write it" or "base it on my notes" approves it. "Open
it up with more detail" means more chapters, not longer ones.

Rules (enforced by the skills and the reviewer, not the code):

- `transcript.md` is evidence and is never edited. Quotes are verbatim, garble
  included.
- Every claim cites a `### HH:MM:SS` heading. Check that every quote sits under
  the heading it cites.
- Do not claim more than the talk did; drop a comparison you cannot ground.
- One talk can carry two stories (`story.md`, `story-<topic>.md`, and an extra
  `experience/<topic>.html`); the hub lists it as "Also: …".

**Slides.** Photos of slides are skewed and washed out:

```bash
python3 scripts/straighten-slide.py IN.jpg OUT.jpg --aspect 16:9
python3 scripts/straighten-slide.py IN.jpg OUT.jpg --aspect 16:9 --corners x1,y1,x2,y2,x3,y3,x4,y4
python3 scripts/clean-slides.py IN.jpg OUT.jpg --mode auto|dark|light|color|illustration|stage
python3 scripts/clean-slides.py --batch jobs.json   # [{src, out, mode?, path_hint?, fallback_p3?}]
```

Auto corner detection often locks onto an inner panel and crops the title: look
at the output, and give `--corners` by hand (contact-sheet coordinates × the
sheet's scale) when it does. `clean-slides.py` converts Display P3 to sRGB,
removes the projector veil and rebalances; pass `--mode stage` for speaker
photos and `illustration` for drawn slides when auto guesses wrong.

**Pages** use the one runtime (`stories/runtime/talk.js`, `talk.css`): every
`data-visual` card has a section and every section a card; no external images;
AI-generated images are illustration, never evidence.

## 10. The site

```bash
mise run views      # everything below, about 0.2 s; run after any change
mise run pages      # Today, talks, hubs, themes, people, follow-ups, schedule timetable
mise run site       # site/index.html: the field guide (planner, maps, picks)
```

| Page | File | From |
| --- | --- | --- |
| Today | `index.html` (live) · `site/today.html` | schedule, picks, captures, latest notes, pipeline receipts |
| Schedule | `site/schedule.html` | timetable, rooms side by side, picks, livestream links |
| Field guide | `site/index.html` | planner, floor maps, abstracts, speaker bios |
| Talks | `site/talks/index.html`, `site/talks/<slug>.html` | one hub per talk: speakers, notes, photos, recording, story, links, transcript |
| Themes | `site/themes.html` (`index.html` once archived) | `analysis/themes.md` + `state/world-model/conference-themes` |
| People | `site/people.html` | speaker roster, X follow/post intents |
| Follow-ups | `site/followups.html` | `editorial/backlog.md` |

The top bar, brand and front page come from `editorial/presentation.json`
(see `editorial/presentation.example.json`):

```json
{
  "phase": "live",
  "brand": "AIE Code ’26",
  "badge": "Live",
  "title": "Six shifts after the diff",
  "summary": "One paragraph for the themes front page.",
  "dates_label": "Nov 10–12, 2026",
  "share_text": "Enjoyed your talk",
  "stack": { "title": "…", "lede": "…", "axis_top": "Human taste", "axis_bottom": "Deterministic foundation", "unit": "Layer" },
  "cards": { "title": "…", "lede": "…" },
  "hero": { "src": "site/visuals/hero.jpg", "alt": "…", "caption": "…" },
  "contested_visual": { "src": "…", "alt": "…", "caption": "…" },
  "theme_visuals": { "<theme_id>": { "src": "…", "alt": "…", "caption": "…" } },
  "theme_slides": { "<theme_id>": { "src": "talks/<slug>/experience/<slide>.jpg", "alt": "…", "speaker": "…", "slug": "<slug>" } }
}
```

- `phase: "live"` (default): Today is the front page and the bar reads Today ·
  Schedule · Talks · Themes · People · Follow-ups.
- `phase: "archive"`: the themes explorer is the front page and Today becomes
  the daily log.
- Everything else is optional; without it the brand is the event name and the
  themes page uses neutral copy and no hero image.
- The main room for "Main stage only" filters is any room whose name contains
  "main".

## 11. Publishing

Nothing commits or pushes on its own. Ticks change files; the operator says
when to publish.

- **Code and data are separate commits.** `feat(site): …` / `fix(serve): …` for
  `scripts/`, `src/`, skills, runtime; `data: …` for notes, talks, state, pages.
- `mise run publish` (`scripts/serve/publish.ts --reason "…"`) commits only data
  paths and pushes `main`, which deploys GitHub Pages through
  `.github/workflows/pages.yml`. It publishes only when something a reader would
  see moved; re-stamped HTML and receipts ride along with the next real change.
  It never forces; a failed push stays local.
- If the agent's permission classifier refuses a push it was not explicitly
  asked for, that is working as intended: ask, then push on the operator's
  "commit and publish".

## 12. After the event

1. Run `talk-insights` over every talk with a transcript, then
   `conference-themes`, which writes `analysis/themes.md` and the themes
   world-model (themes, contested questions, singletons, corpus counts).
2. Re-check `talk-links` on its settling cadence (daily to 30 days, weekly to
   90): official per-talk videos and recap posts appear days later.
3. Write the remaining stories in note order (`/conference-next`).
4. Through-lines: `/conference-atlas` for a theme with three or more stories.
5. Set `"phase": "archive"` in `editorial/presentation.json`, add the
   title/summary/visuals, and `mise run views`.

## 13. Lessons and gotchas

- **The event timezone is everything.** Photos are UTC, notes are local, the
  schedule is local. All site clocks come from `event.json`'s `timezone`.
- **Schedules lie about the clock.** Talks start early and late; the schedule
  may list a talk by speaker name only ("Thariq Shihipar, Independent") while
  the stage title is different. Record what you heard in notes and the talk
  header; the schedule node records only what the official source publishes.
- **A re-transcription changes evidence, not decisions.** After Qwen, matches
  held but 42 of 47 dossier quotes had to be re-anchored to the new text.
- **Battery.** Qwen pegs every core; defer it on battery and let the operator
  say when.
- **Coalesce, don't stack.** One render per node at a time; ticks during a
  render only refresh views.
- **Check a subagent's claim before relaying it** (the receipt, the files),
  and pass the subagent correct clock facts: one render was briefed that a
  cadence was overdue when it was not, and rightly ignored the brief.
- **Facts in notes need sources.** A quick web lookup during a talk goes in the
  note marked "not verified by the talk-links node".
- **Downloads are per request.** Photo zips and livestream clips are downloaded
  only when the operator asks; delete the zip after import.
- **Keep the pages fresh.** Run `mise run views` at the end of every tick and
  after every edit; the hook in §2 does it automatically.

## 14. Command reference

| Command | Does |
| --- | --- |
| `mise run sync` | copy new Voice Memos into `recordings/inbox/` |
| `mise run transcribe` | Qwen3-ASR over folders not on Qwen (AC only) |
| `mise run dry-run` | show what sync would do and the ASR it can see |
| `mise run photos` / `photos-dry` | inventory `photos/` into `photos/manifest.json` |
| `bun scripts/serve/tick-inbox.ts` | inbox gateway tick (Qwen pass, scan, views) |
| `bun scripts/serve/tick-schedule.ts` | schedule gateway tick |
| `bun scripts/serve/skip-receipt.ts --node <n> …` | sign a skipped receipt (refuses if an input moved) |
| `bun scripts/serve/commit-render.ts --node <n> …` | validate, publish and sign a render |
| `bun scripts/serve/http-adapter.ts --port 8787` | loopback webhook listener |
| `mise run views` | re-render every page |
| `mise run pages` / `mise run site` | the pages / the field guide only |
| `mise run publish` | commit data and push (deploys Pages) |
| `mise run contracts` · `validate` · `fingerprints` · `typecheck` | the done-means checks |
| `bun scripts/next-work.ts [--write]` | rank what to write next |
| `python3 scripts/straighten-slide.py` | flatten a photographed slide |
| `python3 scripts/clean-slides.py` | restore a washed-out slide photo |
| `/conference-capture`, `/conference-next`, `/talk-polish`, `/talk-page`, `/talk-ask`, `/conference-themes`, `/conference-atlas`, `/conference-backlog` | the skills |
