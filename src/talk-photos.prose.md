---
name: talk-photos
kind: responsibility
version: 0.2.0
---

# Talk Photos

> Photos taken at the conference, filed under the talk they belong to — or
> parked as event-level when they are of the room, the hallway, or the break.

### Goal

Every photo dropped into the photo folder is either filed under the session it
captured or explicitly parked as event-level / unplaced with a stated reason.
A photo is never filed under a talk whose window does not contain it.

### Requires

- `program`: the day and session structure — times, rooms, titles, formats.
- `recordings`: the capture windows of the talks that were actually recorded.
- `event`: the conference's dates and IANA timezone.

The render also reads the operator's notes under `notes/inbox/` (their `talk:`
and `captured_at`) to choose between parallel sessions. Notes are evidence the
render reads, like the photos themselves, not a subscribed facet.

### Maintains

The photo index and where each photo was filed.

- `photos`: `{ [photo_id]: { file, captured_at_utc, captured_at_local, sha256, width, height, burst_id, session_id, method, confidence, evidence, placed_path, status } }`
  with `status` one of `placed`, `event`, `needs-review`, `unplaced`
- `placements`: `{ [session_id]: { dir, photos: [photo_id] } }`
- `event_photos`: `{ [date]: [photo_id] }` — registration, breaks, receptions, expo
- `coverage`: `{ photos_dir, photo_count, placed_count, event_count, review_count, unplaced_count, timezone, last_checked, generated_at }`

**Canonicalization spec**:

- **Material**: each photo's `file`, `sha256`, `captured_at_local` (to the
  minute), `session_id`, `method`, `confidence`, `placed_path`, `status`,
  `burst_id`; the `placements` sets and the `event_photos` sets.
- **Immaterial** (excluded from the fingerprint): `captured_at_utc` (derived),
  `width`, `height`, file sizes, `generated_at`, and copy timestamps.
- Ordering: `photos` by `captured_at_local` then `file`; `placements[].photos`
  by `captured_at_local`; `event_photos[date]` likewise.
- Text normalization: NFC, trimmed, whitespace-collapsed.

#### photos

Per-photo placement truth. Material: everything in the entry except the
immaterial fields above. `evidence` is the *reason the placement is defensible*
— the matched recording window, the single session window, or the event window
— and is material: a placement that cannot state its evidence is not a
placement.

#### placements

One entry per talk that received photos, keyed by `session_id`, carrying the
talk's photo directory and its photo ids. A talk with no photos has no entry.
This facet is what a dossier or a brief subscribes to when it wants the pictures.

**Postconditions** (self-policed before signing):

- **Complete**: every photo in `photos/manifest.json` has exactly one `photos`
  entry; no entry exists for a file that is not in the manifest.
- **Windowed**: a `placed` photo's `captured_at_local` falls inside its
  session's `[starts_at, ends_at]`, or inside a recording window that is matched
  to that session (the recording-overlap method).
- **Evidenced**: a `placed` photo names the window that decided it (recording id
  or session id); a `needs-review` photo lists its candidate sessions. A photo
  placed by `session+attribution` also names the operator note that picked the
  session among parallel candidates, and lists the candidates it was picked
  from.
- **One home**: a photo appears in at most one `placements` entry.
- **Raw is immutable**: photos in the drop folder are read-only; filing copies
  them into `talks/<slug>/photos/` and never moves or edits the original.
- **No invented talks**: `session_id` is always a session present in `program`.

### Continuity

- **input-driven**: a new `program` or `recordings` receipt, or a manual photo
  drop kick. A new photo drop is an external kick; re-running over an unchanged
  drop moves no fingerprint and files nothing twice.
- **self-driven**: while the event is live and for **7 days after it ends**,
  scan the drop every 6 hours so a photo exported late is still filed. After
  that, the drop only moves on a manual kick.

### Errors

- `photos-unreadable`: the photo folder or the manifest cannot be read.
- `photo-copy-failed`: a placement could not be written; the prior index stands.
- `unparseable-timestamp`: a filename carries no `PXL_YYYYMMDD_HHMMSS` stamp and
  no usable EXIF time; the photo is `unplaced`, never guessed.

### Strategies

- when a photo is UTC-dated: convert with `event.timezone`; never compare the
  raw filename against a local session time (the four-hour trap).
- when several photos land in the same minute: one burst, ordered by filename;
  all are filed, the first is the primary.
- when a recording is active and matched: prefer it over a bare time match, but
  only inside its own recording window.
- when a photo falls in a break, registration, expo, or reception window: file it
  under `event_photos[date]`, not under a talk.
- when two sessions share the window and no recording is active, but the
  operator captured a note under `notes/inbox/` whose `talk:` names one of them
  and whose `captured_at` falls inside that session's window: place the photo
  there with `method: session+attribution`, quoting the note path in
  `evidence`. Notes on more than one candidate, or none: `needs-review`.
- when two talks share the window and no recording is active: `needs-review`
  with both candidates named.

### Shape

- `self`: read the manifest, convert time, resolve the window, copy into place,
  and write the index.
- `delegates`: `place-talk-photos` (the mapping decision).
- `prohibited`: editing or deleting a raw photo; inventing a session; filing by
  wall-clock "now"; writing outside `talks/<slug>/photos/` or `photos/event/`.

### Environment

- `PHOTOS_DIR`: the photo drop folder. Defaults to `photos`.

### Runtime

- `persist`: project
