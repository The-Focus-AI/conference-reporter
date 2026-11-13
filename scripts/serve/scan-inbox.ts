#!/usr/bin/env bun
// prose serve — deterministic host implementation of `scan-recording-inbox`.
//
// Filesystem truth, no judgement: which folders exist, what each carries, and a
// fingerprint over folder names + audio hashes. The semantic work (identify,
// clean, place) stays in the Prose render.
//
// The mover already wrote `audio_sha256` into each `meta.json` at export time.
// This scan trusts that hash and does not re-read gigabytes of audio on every
// 15-minute tick. Pass --verify-hash to prove the index.
//
// Usage:
//   bun scripts/serve/scan-inbox.ts [--inbox <dir>] [--prior <world-model.json>] [--verify-hash] [--json]

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";

export interface RecordingEntry {
  folder: string;
  path: string;
  title: string | null;
  recorded_at: string | null;
  duration_seconds: number | null;
  word_count: number | null;
  audio_sha256: string;
  status: "new" | "failed";
}

export interface ScanFailure {
  folder: string;
  error: string;
}

export interface ScanResult {
  kind: "openprose.scan.inbox";
  scanned_at: string;
  inbox: string;
  folder_fingerprint: string;
  folder_count: number;
  latest_recorded_at: string | null;
  recordings: Record<string, RecordingEntry>;
  missing: string[];
  failures: ScanFailure[];
  errors: string[];
}

export interface ScanOptions {
  root: string;
  inbox: string;
  prior?: string | null;
  verifyHash?: boolean;
}

const sha256 = (s: string): string => createHash("sha256").update(s).digest("hex");
const countWords = (text: string): number => (text.trim() ? text.trim().split(/\s+/).length : 0);

async function hashFile(file: string): Promise<string> {
  const hasher = new Bun.CryptoHasher("sha256");
  const stream = Bun.file(file).stream();
  for await (const chunk of stream) hasher.update(chunk);
  return hasher.digest("hex");
}

interface Meta {
  title?: string | null;
  recorded_at?: string | null;
  duration_seconds?: number | null;
  transcript_word_count?: number | null;
  audio_sha256?: string | null;
  transcript?: string | null;
}

export async function scanInbox(opts: ScanOptions): Promise<ScanResult> {
  const { root, inbox } = opts;
  const priorPath = opts.prior ?? null;
  const prior = priorPath && existsSync(priorPath) ? (JSON.parse(readFileSync(priorPath, "utf8")) as { recordings?: Record<string, RecordingEntry> }) : null;
  const priorRecordings = prior?.recordings ?? {};

  if (!existsSync(inbox)) {
    throw new Error(JSON.stringify({ error: "inbox-unreadable", inbox }));
  }

  const folders = readdirSync(inbox)
    .filter((name) => !name.startsWith("."))
    .map((name) => join(inbox, name))
    .filter((p) => statSync(p).isDirectory())
    .sort();

  const recordings: Record<string, RecordingEntry> = {};
  const failures: ScanFailure[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();
  // The transcript file each folder's meta.json names, when it is not the default.
  const chosen = new Map<string, string>();

  for (const dir of folders) {
    const folder = basename(dir);
    const audio = join(dir, "audio.m4a");
    if (!existsSync(audio)) {
      failures.push({ folder, error: "audio-missing" });
      continue;
    }

    let meta: Meta;
    try {
      meta = JSON.parse(readFileSync(join(dir, "meta.json"), "utf8")) as Meta;
    } catch (e) {
      failures.push({ folder, error: `meta-unreadable: ${(e as Error).message}` });
      continue;
    }

    // meta.json names the transcript in force; a re-transcription adds a file
    // beside transcript.txt rather than replacing it.
    const transcriptFile = typeof meta.transcript === "string" && meta.transcript && !meta.transcript.includes("/") ? meta.transcript : "transcript.txt";
    if (transcriptFile !== "transcript.txt") chosen.set(folder, transcriptFile);
    const transcriptPath = join(dir, transcriptFile);
    const hasTranscript = existsSync(transcriptPath);
    const transcript = hasTranscript ? readFileSync(transcriptPath, "utf8") : null;
    const audioSha = opts.verifyHash ? await hashFile(audio) : meta.audio_sha256 ?? null;

    if (!audioSha) {
      failures.push({ folder, error: "audio-hash-missing" });
      continue;
    }
    if (opts.verifyHash && meta.audio_sha256 && meta.audio_sha256 !== audioSha) {
      errors.push(`audio-hash-mismatch: ${folder}`);
    }

    seen.add(folder);
    recordings[folder] = {
      folder,
      path: `recordings/inbox/${folder}`,
      title: meta.title ?? null,
      recorded_at: meta.recorded_at ?? null,
      duration_seconds: meta.duration_seconds ?? null,
      word_count: hasTranscript ? countWords(transcript!) : meta.transcript_word_count ?? null,
      audio_sha256: audioSha,
      status: hasTranscript ? "new" : "failed",
    };
    if (!hasTranscript) failures.push({ folder, error: "transcript-missing" });
  }

  // A folder that vanished keeps its prior entry, so a disappearance is visible.
  for (const [id, rec] of Object.entries(priorRecordings)) {
    if (!seen.has(id)) recordings[id] = { ...rec, status: rec.status ?? "new" };
  }

  const ids = Object.keys(recordings).sort();
  // A folder still waiting for its transcript (deferred local ASR) is marked, and
  // so is a folder whose meta.json names a transcript other than transcript.txt,
  // so either change moves the fingerprint and wakes recording-intake. Folders
  // on their original transcript.txt hash exactly as before.
  const folderFingerprint = sha256(ids.map((id) => {
    const r = recordings[id]!;
    const file = chosen.get(r.folder);
    return `${r.folder}\t${r.audio_sha256}${r.status === "failed" ? "\tuntranscribed" : ""}${file ? `\t${file}` : ""}`;
  }).join("\n"));
  const latest = ids.map((id) => recordings[id]!.recorded_at).filter((x): x is string => Boolean(x)).sort().at(-1) ?? null;

  return {
    kind: "openprose.scan.inbox",
    scanned_at: new Date().toISOString(),
    inbox,
    folder_fingerprint: folderFingerprint,
    folder_count: ids.length,
    latest_recorded_at: latest,
    recordings,
    missing: Object.keys(priorRecordings).filter((id) => !seen.has(id)),
    failures,
    errors,
  };
}

function parseArgs(argv: string[]): { root: string; inbox: string; prior: string | null; verifyHash: boolean; json: boolean } {
  const flag = (name: string, fallback: string | null = null): string | null => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] ?? fallback : fallback;
  };
  const root = resolve(flag("root", process.env.PROSE_OPENPROSE_ROOT ?? join(import.meta.dir, "..", ".."))!);
  return {
    root,
    inbox: resolve(flag("inbox", process.env.RECORDINGS_INBOX ?? join(root, "recordings", "inbox"))!),
    prior: flag("prior"),
    verifyHash: argv.includes("--verify-hash"),
    json: argv.includes("--json"),
  };
}

if (import.meta.main) {
  const args = parseArgs(process.argv.slice(2));
  const out = await scanInbox(args);
  if (args.json) {
    process.stdout.write(JSON.stringify(out, null, 2) + "\n");
  } else {
    const failed = Object.values(out.recordings).filter((r) => r.status === "failed").length;
    console.log(`inbox            ${out.inbox}`);
    console.log(`folders          ${out.folder_count}`);
    console.log(`latest recording ${out.latest_recorded_at}`);
    console.log(`fingerprint      ${out.folder_fingerprint}`);
    console.log(`status           ${out.folder_count - failed} new · ${failed} failed`);
    for (const f of out.failures) console.log(`FAIL             ${f.folder}: ${f.error}`);
    for (const e of out.errors) console.log(`ERROR            ${e}`);
  }
  process.exit(out.errors.length ? 4 : 0);
}
