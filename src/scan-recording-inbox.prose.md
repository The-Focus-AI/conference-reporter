---
name: scan-recording-inbox
kind: function
version: 0.2.0
---

# Scan Recording Inbox

> Filesystem truth, no judgement. What folders exist, what changed since last
> time, and what disappeared. The render needs this to be boring and exact.

### Description

Walks the recording drop folder, reads each `meta.json`, hashes the audio, and
merges the result with the prior index so the committed truth always describes
the whole inbox rather than just this wake's arrivals.

### Parameters

- `inbox`: the drop folder path (from `RECORDINGS_INBOX`).
- `prior_recordings`: the prior `recordings` facet, keyed by recording id.

### Returns

- `recordings`: the merged index — every folder on disk now, plus any prior entry
  whose folder has vanished (kept, so a disappearance is visible rather than
  silent).
- `new`: the ids present on disk that were absent or unchanged in `prior`.
- `missing`: prior ids whose folder no longer exists, with the last-known title
  and `recorded_at`.
- `folder_fingerprint`: a hash over sorted folder names and `audio_sha256` values.

### Invariants

- Read-only: nothing under the inbox is written, moved, or deleted.
- A folder is only indexed when it contains `audio.m4a`; a folder with audio but
  no `transcript.txt` is indexed with `status: failed` and reported in the
  return, never dropped. On low battery the mover defers local transcription,
  so this is the normal state of a fresh folder until it is plugged in.
- `new` means *content* new: a folder whose audio hash and transcript hash match
  the prior entry is not new, even if its mtime changed. The transcript hashed
  is the one `meta.json` `transcript` names, so a re-transcription made the
  one in force makes the folder new again.
- The fingerprint is computed over folder names and audio hashes only, so adding
  an attachment does not re-trigger identification of an already-clean talk.
- A `meta.json` that cannot be parsed is a hard failure for that folder, not a
  guess about its contents.

### Strategies

- when a folder has no `meta.json` but has audio and a transcript: index it with
  nulls and let the render decide, rather than refusing the whole scan.
- when two folders share a title and minute: the mover already suffixed them
  (`-2`); keep both, they are different recordings.
- when a folder was deleted by hand: report it in `missing` but keep the prior
  index entry, so the truth records that it once existed.

### Shape

- `self`: read directories and files, hash audio, merge prior state.
- `prohibited`: interpreting the transcript, matching talks, writing files.

### Runtime

- `persist`: true
