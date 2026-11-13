---
name: recording-inbox-watch
kind: gateway
version: 0.3.0
---

# Recording Inbox Watch

> The only thing this gateway knows is *whether the inbox changed*. It scans the
> drop folder, fingerprints it, and lets the reconciler decide whether the
> expensive render is worth running. Fifteen minutes of polling with no arrivals
> costs nothing downstream.
>
> Before it scans, each tick asks the mover to bring every recording onto the
> local Qwen3-ASR transcript, which is more accurate than Voice Memos'. That is
> just what happens to a recording here, power permitting.

### Continuity

- external-driven

### Schedule

- `*/15 * * * *` — a tick every fifteen minutes. A dropped recording can also be
  kicked by hand without waiting for the tick.

### Receives

- POST /webhooks/recordings/scan
- Provider: local operator, or the cron adapter
- Event: `scan-requested`

### Maintains

- `inbox_scans`: `{ folder_fingerprint, folder_count, latest_recorded_at, scanned_at }` —
  the latest observed state of the recording drop folder.

**Canonicalization spec**:

- **Material**: `folder_fingerprint` (a hash over the sorted folder names plus each
  `audio_sha256`, with an `untranscribed` mark on any folder that has audio but
  no transcript yet, and the transcript file name when `meta.json` names one
  other than `transcript.txt`), `folder_count`, and `latest_recorded_at`. A new
  recording, a replaced audio file, a deleted folder, a deferred transcript
  arriving, or a re-transcription becoming the one in force moves the
  fingerprint; nothing else does. A folder on its original `transcript.txt`
  hashes exactly as it did before these marks existed.
- **Immaterial** (excluded): `scanned_at` and any filesystem mtimes. A tick is not
  a change.
- The fingerprint is computed by reading the folder, never cached across wakes.

### Strategies

- **Qwen is the transcript of record.** Before scanning, run the mover's upgrade
  pass (`scripts/export-voice-memos.ts --transcribe-missing`): every recording
  whose transcript in force is not yet Qwen's gets one, written beside the
  Voice Memos transcript and named in `meta.json`. The upgraded folder's
  fingerprint moves, so `recording-intake` re-decides and re-cleans it.
- **Power gate.** The upgrade runs only when the machine is plugged in (AC
  power). On battery it defers without failing, whatever the charge: the
  recording keeps its Voice Memos transcript, intake works from that, and a
  later tick upgrades it once power allows. The deferral is recorded in the
  receipt's `semantic_diff.transcript_upgrade`.
- The upgrade is the mover's work, not this gateway's judgment: it never edits
  an existing transcript and never decides which talk a recording is.

### Emits

- `recording-intake`

### Payload

None. The inbox path is runtime configuration (`RECORDINGS_INBOX`, default
`recordings/inbox`) declared on `recording-intake`.
