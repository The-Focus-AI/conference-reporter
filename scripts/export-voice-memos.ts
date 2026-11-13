#!/usr/bin/env bun
/**
 * Move Voice Memos recordings into this repo. Nothing else.
 *
 * One recording becomes one folder:
 *
 *   recordings/inbox/2026-10-13_0904_Blackwater/
 *     audio.m4a              the original audio, untouched
 *     transcript.txt         the transcript Voice Memos already made (udta/tsrp),
 *                            or a local Qwen3-ASR one when Voice Memos has none
 *     transcript.words.json  word and sentence timings
 *     meta.json              title, recorded_at, duration, word count, hashes
 *     attachments/           any sidecar images/PDFs that came with it
 *
 * No matching, no judging, no cleanup — that is the Prose program's job
 * (`src/recording-intake.prose.md`). This script only moves bytes and writes down
 * what it knows, so a later render can read it without guessing.
 *
 * By default it exports only recordings inside the tracked conference's date
 * window (the event's `starts_on`/`ends_on` from the schedule world-model, padded
 * by one day on each side). The whole library is never exported by accident.
 *
 * Usage:
 *   bun scripts/export-voice-memos.ts --dry-run
 *   bun scripts/export-voice-memos.ts
 *   bun scripts/export-voice-memos.ts --since 2026-10-10 --until 2026-10-15
 *   bun scripts/export-voice-memos.ts --all            # the whole library
 *
 * Transcripts: the local Qwen3-ASR transcript is the one in force whenever it
 * can be made, because it is more accurate than Voice Memos'. Export writes the
 * Voice Memos transcript first (fast, no power needed), then an upgrade pass
 * transcribes each recording with Qwen and makes that the one meta.json names,
 * keeping the Voice Memos one beside it in `transcript_alternates`.
 *
 * Qwen runs only when the machine is plugged in. On battery it is deferred,
 * not failed: the recording keeps its Voice Memos
 * transcript and the next pass (`mise run transcribe`, or the serve inbox tick)
 * upgrades it. --allow-battery or RECORDINGS_ASR_ON_BATTERY=allow overrides.
 *
 *   --asr apple   Voice Memos only; no upgrade pass
 *   bun scripts/export-voice-memos.ts --transcribe-missing
 *     Run only the upgrade pass over the inbox. Needs no Full Disk Access.
 *   bun scripts/export-voice-memos.ts --retranscribe <folder>
 *     Run the upgrade pass for one recording folder.
 *
 * meta.json records `transcript_source` (voice-memos or the Qwen model name) and
 * `transcript_timing` (word, or segment for Qwen's ~5 s segments), and for Qwen
 * `transcript_echo_segments` (segments the echoed prompt was cut from).
 *
 * Needs Full Disk Access (System Settings -> Privacy & Security -> Full Disk
 * Access) for the terminal or app you run it from.
 */

import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { homedir } from "node:os";
import { qwenSetup, qwenTranscribe, schedulePrompt, type QwenSetup, type Transcript, type Word } from "./qwen-asr.ts";

const AUDIO_EXTS = new Set(["m4a", "mp3", "wav", "aiff", "aif", "caf", "qta"]);
const SIDECAR_EXTS = new Set(["jpg", "jpeg", "png", "heic", "pdf", "gif", "webp", "mov", "mp4"]);
const SOURCES = [
  "~/Library/Group Containers/group.com.apple.VoiceMemos.shared/Recordings",
  "~/Library/Application Support/com.apple.voicememos/Recordings",
];

interface Meta {
  title: string;
  recorded_at: string | null;
  duration_seconds: number | null;
  transcript: string | null;
  transcript_word_count: number;
  transcript_locale: string | null;
  transcript_source?: string | null;
  transcript_timing?: "word" | "segment" | null;
  transcript_echo_segments?: number;
  source_file: string;
  audio_sha256: string;
  exported_at: string;
}

interface Window {
  since: string;
  until: string;
  tz: string;
  origin: string;
}

interface Args {
  source?: string;
  dest: string;
  since?: string;
  until?: string;
  padDays: number;
  all: boolean;
  dryRun: boolean;
  asr: "auto" | "apple" | "qwen";
  transcribeMissing: boolean;
  allowBattery: boolean;
  retranscribe?: string;
}

const expand = (p: string): string => (p.startsWith("~") ? join(homedir(), p.slice(1)) : p);
const pad = (n: number): string => String(n).padStart(2, "0");

function localIso(d: Date): string {
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? "+" : "-";
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${sign}${pad(Math.floor(Math.abs(off) / 60))}:${pad(Math.abs(off) % 60)}`;
}

function localStamp(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
}

function zonedDay(d: Date, tz: string): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" })
      .formatToParts(d)
      .map((x) => [x.type, x.value]),
  );
  return `${p.year}-${p.month}-${p.day}`;
}

function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function readable(path: string): boolean {
  try {
    readdirSync(path);
    return true;
  } catch {
    return false;
  }
}

function tcc(path: string): never {
  console.error(
    `\n  ✗ Voice Memos' library is not readable:\n      ${path}\n\n` +
      "  Grant Full Disk Access to the app you are running this from:\n" +
      "    System Settings → Privacy & Security → Full Disk Access → +\n" +
      "  then quit and reopen that app (TCC is read at launch).\n",
  );
  process.exit(2);
}

function findSource(explicit?: string): string {
  if (explicit) {
    const p = expand(explicit);
    if (!existsSync(p) || !statSync(p).isDirectory()) {
      console.error(`  ✗ ${p} is not a directory`);
      process.exit(2);
    }
    if (!readable(p)) tcc(p);
    return p;
  }
  for (const candidate of SOURCES) {
    const p = expand(candidate);
    if (existsSync(p) && readable(p)) return p;
  }
  const tried = SOURCES.map(expand).filter(existsSync);
  if (tried.length) tcc(tried[0]!);
  console.error("  ✗ no Voice Memos library found; pass --source");
  process.exit(2);
}

function m4aTag(data: Buffer, atom: Buffer): string | null {
  const at = data.indexOf(atom);
  if (at < 4) return null;
  const size = data.readUInt32BE(at - 4);
  if (!(size >= 16 && size <= data.length - at)) return null;
  const raw = data.subarray(at + 8, at - 4 + size);
  const text = raw.subarray(8).toString("utf8").replace(/\0/g, "").trim();
  return text || null;
}

function tsrpTranscript(data: Buffer): Transcript | null {
  const atom = Buffer.from("tsrp");
  const at = data.indexOf(atom);
  if (at < 4) return null;
  const size = data.readUInt32BE(at - 4);
  const payload = data.subarray(at + 4, at - 4 + size);
  const start = payload.indexOf("{");
  if (start < 0) return null;
  let obj: {
    attributedString?: { runs?: unknown[]; attributeTable?: Array<{ timeRange?: [number | null, number | null] }> };
    locale?: { identifier?: string };
  };
  try {
    obj = JSON.parse(payload.subarray(start).toString("utf8"));
  } catch {
    return null;
  }
  const attributed = obj.attributedString ?? {};
  const runs = attributed.runs ?? [];
  const table = attributed.attributeTable ?? [];
  if (!runs.length || !table.length) return null;

  const parts: string[] = [];
  const words: Word[] = [];
  for (let i = 0; i + 1 < runs.length; i += 2) {
    const piece = runs[i];
    const idx = runs[i + 1];
    if (typeof piece === "string" && typeof idx === "number") {
      parts.push(piece);
      if (piece.trim()) {
        const span = idx >= 0 && idx < table.length ? table[idx]! : {};
        const rng = span.timeRange ?? [null, null];
        words.push({ w: piece.trim(), start: rng[0] ?? null, end: rng[1] ?? null });
      }
    }
  }
  const text = parts.join("").replace(/\s*\n\s*/g, "\n").replace(/[ \t]+/g, " ").trim();
  return { text, words, locale: obj.locale?.identifier ?? null, source: "voice-memos", timing: "word", echo_segments: 0 };
}

interface Probe {
  duration: number | null;
  created: Date | null;
}

function probe(path: string): Probe {
  try {
    const proc = Bun.spawnSync({
      cmd: ["ffprobe", "-v", "error", "-show_entries", "format=duration:format_tags=creation_time", "-of", "json", path],
      stdout: "pipe",
      stderr: "pipe",
    });
    if (proc.exitCode !== 0) return { duration: null, created: null };
    const fmt = (JSON.parse(proc.stdout.toString() || "{}") as { format?: { duration?: string; tags?: { creation_time?: string } } }).format ?? {};
    const created = fmt.tags?.creation_time ? new Date(fmt.tags.creation_time) : null;
    return {
      duration: fmt.duration ? Math.round(Number(fmt.duration) * 10) / 10 : null,
      created: created && !Number.isNaN(created.getTime()) ? created : null,
    };
  } catch {
    return { duration: null, created: null };
  }
}

function slug(text: string, limit = 48): string {
  const out = text
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .trim()
    .replace(/[\s_]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, limit);
  return out || "recording";
}

async function sha256(path: string): Promise<string> {
  const hasher = new Bun.CryptoHasher("sha256");
  for await (const chunk of Bun.file(path).stream()) hasher.update(chunk);
  return hasher.digest("hex");
}

function existing(dest: string): Map<string, Meta> {
  const index = new Map<string, Meta>();
  if (!existsSync(dest)) return index;
  for (const entry of readdirSync(dest, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const metaPath = join(dest, entry.name, "meta.json");
    if (!existsSync(metaPath)) continue;
    try {
      const meta = JSON.parse(readFileSync(metaPath, "utf8")) as Meta;
      if (meta.audio_sha256) index.set(meta.audio_sha256, meta);
    } catch { /* skip malformed */ }
  }
  return index;
}

function conferenceWindow(root: string): { start: string; end: string; tz: string } | null {
  const published = join(root, "state/world-model/conference-schedule/published");
  // The schedule render writes published/event.json; older builds nested it under event/.
  const event = [join(published, "event.json"), join(published, "event/event.json")].find(existsSync) ?? join(published, "event.json");
  if (!existsSync(event)) return null;
  try {
    const data = JSON.parse(readFileSync(event, "utf8")) as { starts_on?: string; ends_on?: string; timezone?: string };
    if (!data.starts_on || !data.ends_on) return null;
    return { start: data.starts_on, end: data.ends_on, tz: data.timezone ?? "UTC" };
  } catch {
    return null;
  }
}

function resolveWindow(args: Args, root: string): Window | null {
  if (args.all) return null;
  const since = args.since ?? process.env.RECORDINGS_SINCE;
  const until = args.until ?? process.env.RECORDINGS_UNTIL;
  if (Boolean(since) !== Boolean(until)) {
    console.error("  ✗ --since and --until (or RECORDINGS_SINCE/UNTIL) must be given together");
    process.exit(2);
  }
  if (since && until) return { since, until, tz: process.env.RECORDINGS_TZ ?? "UTC", origin: "flags/env" };
  const found = conferenceWindow(root);
  if (!found) {
    console.error("  ✗ no tracked conference window: pass --since/--until, set RECORDINGS_SINCE/RECORDINGS_UNTIL, or pass --all");
    process.exit(2);
  }
  return {
    since: addDays(found.start, -args.padDays),
    until: addDays(found.end, args.padDays),
    tz: found.tz,
    origin: "conference window",
  };
}

function sentences(words: Word[]): Array<{ text: string; start: number | null; end: number | null }> {
  const out: Array<{ text: string; start: number | null; end: number | null }> = [];
  let cur: Word[] = [];
  for (const w of words) {
    cur.push(w);
    if (/[.?!]$/.test(w.w) && cur.length > 2) {
      out.push({ text: cur.map((x) => x.w).join(" "), start: cur[0]!.start, end: cur.at(-1)!.end });
      cur = [];
    }
  }
  if (cur.length) out.push({ text: cur.map((x) => x.w).join(" "), start: cur[0]!.start, end: cur.at(-1)!.end });
  return out;
}

function asrMode(v: string | undefined): Args["asr"] {
  const mode = v ?? process.env.RECORDINGS_ASR ?? "auto";
  if (mode === "auto" || mode === "apple" || mode === "qwen") return mode;
  console.error(`  ✗ --asr must be auto, apple, or qwen (got ${mode})`);
  process.exit(2);
}

/** Writes `<stem>.txt` and `<stem>.words.json`; the default stem is `transcript`. */
function writeTranscript(folder: string, t: Transcript, stem = "transcript"): void {
  writeFileSync(join(folder, `${stem}.txt`), t.text + "\n");
  writeFileSync(join(folder, `${stem}.words.json`), JSON.stringify({ words: t.words, sentences: sentences(t.words), timing: t.timing }, null, 1) + "\n");
}

/** True when the transcript in force already came from the local Qwen model. */
const onQwen = (meta: Meta): boolean => Boolean(meta.transcript_source && meta.transcript_source !== "voice-memos");

/**
 * Make a local Qwen transcript the one in force for one recording folder.
 * Nothing is overwritten: with no transcript yet, Qwen's becomes transcript.txt;
 * with a Voice Memos transcript, Qwen's is written beside it as
 * `transcript.<model>.txt`, meta.json points at it, and the earlier one is
 * listed in `transcript_alternates` so the evidence it carried is kept.
 * Returns false when the folder needs nothing.
 */
function upgradeFolder(dest: string, name: string, setup: QwenSetup, dryRun: boolean): boolean {
  const folder = join(dest, name);
  const metaPath = join(folder, "meta.json");
  if (!existsSync(metaPath)) return false;
  const audioFile = readdirSync(folder).find((f) => f.startsWith("audio."));
  if (!audioFile) return false;
  const meta = JSON.parse(readFileSync(metaPath, "utf8")) as Meta & { transcript_alternates?: Array<Record<string, unknown>> };
  if (onQwen(meta)) return false;
  const hasTranscript = Boolean(meta.transcript) && existsSync(join(folder, meta.transcript!));
  const stem = hasTranscript ? `transcript.${setup.name}` : "transcript";
  if (existsSync(join(folder, `${stem}.txt`)) && stem !== "transcript") return false;
  console.log(`  ${name}  (${meta.duration_seconds ?? "?"}s) → ${setup.name}`);
  if (dryRun) return true;
  const prompt = schedulePrompt(root, meta.recorded_at ? new Date(meta.recorded_at) : null, meta.duration_seconds);
  const t = qwenTranscribe(setup, join(folder, audioFile), prompt, (l) => console.log(`    ${l}`));
  writeTranscript(folder, t, stem);
  const alternates = meta.transcript_alternates ?? [];
  if (hasTranscript) {
    alternates.push({
      file: meta.transcript,
      source: meta.transcript_source ?? "voice-memos",
      timing: meta.transcript_timing ?? "word",
      word_count: meta.transcript_word_count,
      locale: meta.transcript_locale,
    });
  }
  Object.assign(meta, {
    transcript: `${stem}.txt`,
    transcript_word_count: t.words.length,
    transcript_locale: t.locale,
    transcript_source: t.source,
    transcript_timing: t.timing,
    transcript_echo_segments: t.echo_segments,
    ...(alternates.length ? { transcript_alternates: alternates } : {}),
  });
  writeFileSync(metaPath, JSON.stringify(meta, null, 2) + "\n");
  console.log(`    ${t.words.length} words · meta.json now names ${stem}.txt`);
  return true;
}

/**
 * Bring every inbox recording (or just `only`) onto a Qwen transcript. Defers,
 * without failing, when Qwen can't run now (not installed, or battery at or
 * below the floor and not plugged in); the next pass picks it up.
 */
function upgrade(dest: string, dryRun: boolean, only?: string): number {
  if (!existsSync(dest)) {
    console.log(`  nothing to do: ${dest} does not exist`);
    return 0;
  }
  const setup = qwenSetup({ allowBattery: args.allowBattery });
  const names = (only ? [only] : readdirSync(dest, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name)).sort();
  const waiting = names.filter((n) => {
    const m = join(dest, n, "meta.json");
    return existsSync(m) && !onQwen(JSON.parse(readFileSync(m, "utf8")) as Meta);
  });
  if ("missing" in setup) {
    console.log(`  qwen    deferred: ${setup.missing}${waiting.length ? ` · ${waiting.length} recording(s) waiting` : ""}`);
    return 0;
  }
  let done = 0;
  for (const name of waiting) if (upgradeFolder(dest, name, setup, dryRun)) done++;
  if (!dryRun && done) {
    const prior = existsSync(join(dest, "manifest.json")) ? (JSON.parse(readFileSync(join(dest, "manifest.json"), "utf8")) as { source?: string }).source : undefined;
    writeManifest(dest, prior ?? "unknown");
  }
  console.log(`  qwen    ${done} transcribed${dryRun ? " (dry run)" : ""} · ${names.length - waiting.length} already on Qwen`);
  return done;
}

function writeManifest(dest: string, source: string): void {
  const recordings = readdirSync(dest, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => join(dest, e.name, "meta.json"))
    .filter(existsSync)
    .sort()
    .map((p) => ({ ...(JSON.parse(readFileSync(p, "utf8")) as Meta), folder: basename(join(p, "..")) }));
  writeFileSync(join(dest, "manifest.json"), JSON.stringify({ generated_at: localIso(new Date()), source, recordings }, null, 2) + "\n");
}

function needQwen(): QwenSetup {
  const setup = qwenSetup({ allowBattery: args.allowBattery });
  if ("missing" in setup) {
    console.error(`  ✗ Qwen3-ASR is not available: ${setup.missing}`);
    process.exit(2);
  }
  return setup;
}

function parseArgs(argv: string[]): Args {
  const value = (name: string): string | undefined => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  return {
    source: value("source"),
    dest: value("dest") ?? "recordings/inbox",
    since: value("since"),
    until: value("until"),
    padDays: Number(value("pad-days") ?? "1"),
    all: argv.includes("--all"),
    dryRun: argv.includes("--dry-run"),
    asr: asrMode(value("asr")),
    transcribeMissing: argv.includes("--transcribe-missing"),
    allowBattery: argv.includes("--allow-battery"),
    retranscribe: value("retranscribe"),
  };
}

const args = parseArgs(process.argv.slice(2));
const root = resolve(import.meta.dir, "..");
if (args.retranscribe) {
  if (!upgrade(resolve(args.dest), args.dryRun, args.retranscribe)) console.log("  (nothing changed)");
  process.exit(0);
}
if (args.transcribeMissing) {
  upgrade(resolve(args.dest), args.dryRun);
  process.exit(0);
}
// Export always writes the fast Voice Memos transcript first; Qwen then upgrades
// it in a second pass (below), so a recording is never held back waiting on power.
const qwen = args.asr === "apple" ? null : qwenSetup({ allowBattery: args.allowBattery });
if (args.asr === "qwen" && qwen && "missing" in qwen) needQwen();
const window = resolveWindow(args, root);
const source = findSource(args.source);
const dest = resolve(args.dest);
const known = existing(dest);

if (window) console.log(`window  ${window.since} .. ${window.until} (${window.tz})  [${window.origin}, pad ${args.padDays}d]`);
else console.log("window  ALL recordings (--all)");

const audio = readdirSync(source)
  .map((name) => join(source, name))
  .filter((p) => statSync(p).isFile() && AUDIO_EXTS.has((p.split(".").pop() ?? "").toLowerCase()))
  .sort();
console.log(`source  ${source}\ndest    ${dest}\nfound   ${audio.length} recording(s)`);
if (qwen && "missing" in qwen) console.log(`asr     ${args.asr} — Qwen3-ASR unavailable (${qwen.missing}); Voice Memos transcripts only`);
else console.log(`asr     ${args.asr}${qwen ? ` (local: ${qwen.name})` : ""}`);
console.log("");

let moved = 0;
let skipped = 0;
let outOfWindow = 0;
let undated = 0;

for (const path of audio) {
  const info = probe(path);
  const created = info.created;

  if (window) {
    if (!created) {
      undated++;
      continue;
    }
    const day = zonedDay(created, window.tz);
    if (day < window.since || day > window.until) {
      outOfWindow++;
      continue;
    }
  }

  const digest = await sha256(path);
  if (known.has(digest)) {
    skipped++;
    continue;
  }

  const data = readFileSync(path);
  const title = m4aTag(data, Buffer.from([0xa9, 0x6e, 0x61, 0x6d])) ?? basename(path, `.${path.split(".").pop()}`);
  const apple = tsrpTranscript(data);
  // Qwen runs at export only when there is no Voice Memos transcript to start from;
  // otherwise the upgrade pass after the loop replaces it.
  const local = qwen && !("missing" in qwen) && !apple ? qwen : null;
  const stamp = created ? localStamp(created) : "unknown-date";

  const base = `${stamp}_${slug(title)}`;
  let folder = join(dest, base);
  for (let n = 2; existsSync(folder) && !existsSync(join(folder, "meta.json")); n++) {
    folder = join(dest, `${base}-${n}`);
  }

  if (local && args.dryRun) {
    console.log(`  ${basename(folder)}`);
    console.log(`    recorded ${created ? localIso(created) : null}  duration ${info.duration}s  → ${local.name}`);
    moved++;
    continue;
  }
  const transcript = local ? qwenTranscribe(local, path, schedulePrompt(root, created, info.duration), (l) => console.log(`    ${l}`)) : apple;
  const words = transcript?.words ?? [];
  const meta: Meta = {
    title,
    recorded_at: created ? localIso(created) : null,
    duration_seconds: info.duration,
    transcript: transcript ? "transcript.txt" : null,
    transcript_word_count: words.length,
    transcript_locale: transcript?.locale ?? null,
    transcript_source: transcript?.source ?? null,
    transcript_timing: transcript?.timing ?? null,
    ...(transcript && transcript.source !== "voice-memos" ? { transcript_echo_segments: transcript.echo_segments } : {}),
    source_file: basename(path),
    audio_sha256: digest,
    exported_at: localIso(new Date()),
  };

  console.log(`  ${basename(folder)}`);
  console.log(`    recorded ${meta.recorded_at}  duration ${meta.duration_seconds}s  words ${words.length}  [${meta.transcript_source ?? "no transcript"}]`);
  if (args.dryRun) {
    moved++;
    continue;
  }

  mkdirSync(join(folder, "attachments"), { recursive: true });
  await Bun.write(join(folder, `audio.${(path.split(".").pop() ?? "m4a").toLowerCase()}`), Bun.file(path));
  if (transcript) writeTranscript(folder, transcript);
  const stem = basename(path, `.${path.split(".").pop()}`);
  for (const side of readdirSync(source)) {
    const sidePath = join(source, side);
    const sideExt = (side.split(".").pop() ?? "").toLowerCase();
    if (statSync(sidePath).isFile() && basename(side, `.${sideExt}`) === stem && SIDECAR_EXTS.has(sideExt)) {
      copyFileSync(sidePath, join(folder, "attachments", side));
    }
  }
  writeFileSync(join(folder, "meta.json"), JSON.stringify(meta, null, 2) + "\n");
  moved++;
}

if (!args.dryRun && moved) writeManifest(dest, source);
if (args.asr !== "apple") upgrade(dest, args.dryRun);

let summary = `\n  ${moved} moved · ${skipped} already present`;
if (window) summary += ` · ${outOfWindow} outside the window · ${undated} undated (skipped)`;
if (args.dryRun) summary += "  (dry run — nothing written)";
console.log(summary);
