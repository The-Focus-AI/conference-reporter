/**
 * Local speech-to-text with Qwen3-ASR (antirez/qwen-asr, a pure C build), used when a
 * recording has no Voice Memos transcript, or when one is asked for explicitly.
 *
 * The binary and weights live outside this repo:
 *   QWEN_ASR_DIR    the checkout holding `qwen_asr`   (default ~/src/qwen-asr)
 *   QWEN_ASR_MODEL  model directory inside it, or an absolute path
 *                   (default qwen3-asr-1.7b)
 *
 * Audio is transcribed in chunks (QWEN_ASR_CHUNK_SECONDS, default 300): one long
 * pass breaks down partway through a talk. Each finished chunk is cached under
 * QWEN_ASR_CACHE (default ~/.cache/focus-conference/qwen-asr), keyed by audio
 * hash, model, chunk length and prompt, so an interrupted run resumes at the
 * first unfinished chunk.
 *
 * Qwen gives timings per segment (about five seconds), not per word. Every word
 * in a segment carries that segment's start and end, and `timing` says so. No
 * finer timing is invented.
 *
 * Qwen can echo its prompt as transcript text, and on a long pass the echo can
 * open a segment that then carries minutes of real speech. A run of three or
 * more prompt terms is cut out of the segment and the rest kept; the number of
 * segments touched is `echo_segments`. A name left in the transcript came from
 * the audio.
 *
 * Qwen runs on every CPU core at a few times realtime: a 25-minute talk drains a
 * laptop battery noticeably. It runs only when the machine is plugged in; on
 * battery it is deferred, not run, unless the caller allows it
 * (`--allow-battery`, or RECORDINGS_ASR_ON_BATTERY=allow). A
 * deferred recording arrives without a transcript; `mise run transcribe` fills it
 * in once the machine is on AC power.
 */

import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";

export interface Word {
  w: string;
  start: number | null;
  end: number | null;
}

export interface Transcript {
  text: string;
  words: Word[];
  locale: string | null;
  source: string;
  timing: "word" | "segment";
  echo_segments: number;
}

const expand = (p: string): string => (p.startsWith("~") ? join(homedir(), p.slice(1)) : p);

export interface QwenSetup {
  binary: string;
  model: string;
  name: string;
}

export interface Power {
  onBattery: boolean | null;
  percent: number | null;
}

/** Where power comes from right now. Unknown (not macOS, no pmset) is null. */
export function powerSource(): Power {
  try {
    const run = Bun.spawnSync({ cmd: ["pmset", "-g", "batt"], stdout: "pipe", stderr: "pipe" });
    if (run.exitCode !== 0) return { onBattery: null, percent: null };
    const out = run.stdout.toString();
    const pct = out.match(/(\d+)%/);
    return {
      onBattery: out.includes("'Battery Power'") ? true : out.includes("'AC Power'") ? false : null,
      percent: pct ? Number(pct[1]) : null,
    };
  } catch {
    return { onBattery: null, percent: null };
  }
}

/**
 * The local install, or the reason it cannot run now: not installed, or on
 * battery power without permission to run there.
 */
export function qwenSetup(opts: { allowBattery?: boolean } = {}): QwenSetup | { missing: string } {
  const allow = opts.allowBattery || process.env.RECORDINGS_ASR_ON_BATTERY === "allow";
  if (!allow) {
    const power = powerSource();
    // Run only when plugged in. On battery it defers, whatever the charge.
    if (power.onBattery) {
      return { missing: `on battery power at ${power.percent ?? "?"}% (Qwen runs only when plugged in); deferred — plug in, or pass --allow-battery` };
    }
  }
  const dir = expand(process.env.QWEN_ASR_DIR ?? "~/src/qwen-asr");
  const binary = join(dir, "qwen_asr");
  const modelSetting = process.env.QWEN_ASR_MODEL ?? "qwen3-asr-1.7b";
  const model = isAbsolute(expand(modelSetting)) ? expand(modelSetting) : join(dir, modelSetting);
  if (!existsSync(binary)) return { missing: `no qwen_asr binary at ${binary} (set QWEN_ASR_DIR)` };
  if (!existsSync(join(model, "vocab.json"))) return { missing: `no Qwen3-ASR model at ${model} (set QWEN_ASR_MODEL)` };
  const name = model.split("/").filter(Boolean).pop() ?? "qwen3-asr";
  return { binary, model, name };
}

/**
 * A spelling hint from the schedule: the speaker names and affiliations of
 * sessions that overlap the recording, so they come out right. Titles are left
 * out: they are long, and a long prompt is what Qwen echoes back as text.
 */
export function schedulePrompt(root: string, recordedAt: Date | null, durationSeconds: number | null): string | null {
  const path = join(root, "state/world-model/conference-schedule/published/world-model.json");
  if (!recordedAt || !existsSync(path)) return null;
  try {
    const wm = JSON.parse(readFileSync(path, "utf8")) as {
      program: { sessions: Array<{ title: string; starts_at: string; ends_at: string; speaker_ids: string[] }> };
      speakers: Record<string, { name?: string; affiliation?: string }>;
    };
    // Voice Memos stamps creation near the start; allow slack either side.
    const slack = 30 * 60 * 1000;
    const from = recordedAt.getTime() - slack;
    const to = recordedAt.getTime() + (durationSeconds ?? 3600) * 1000 + slack;
    const terms = new Set<string>();
    for (const s of wm.program.sessions) {
      const a = Date.parse(s.starts_at);
      const b = Date.parse(s.ends_at);
      if (!(a < to && b > from) || !s.speaker_ids.length) continue;
      for (const id of s.speaker_ids) {
        const sp = wm.speakers[id];
        if (sp?.name) terms.add(sp.name);
        if (sp?.affiliation) terms.add(sp.affiliation);
      }
    }
    if (!terms.size) return null;
    return `Conference talk transcription. Preserve spelling: ${[...terms].join("; ")}`;
  } catch {
    return null;
  }
}

const PROMPT_TERMS = "Preserve spelling:";

/** The prompt's spelling terms, lowercased, for echo detection. */
export function promptTerms(prompt: string | null): string[] {
  if (!prompt) return [];
  const at = prompt.indexOf(PROMPT_TERMS);
  if (at < 0) return [];
  return prompt.slice(at + PROMPT_TERMS.length).split("; ").map((t) => t.trim().toLowerCase()).filter(Boolean);
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The segment with any echoed prompt removed: the header, and every run of
 * three or more prompt terms in a row. Speech around the echo is kept.
 */
export function stripEcho(text: string, terms: string[]): { text: string; echoed: boolean } {
  if (!terms.length) return { text, echoed: false };
  const term = `(?:${terms.map(escapeRe).join("|")})[;.,]?\\s*`;
  const run = new RegExp(`(?:conference talk transcription\\.?\\s*)?(?:preserve spelling:\\s*)?(?:${term}){3,}`, "gi");
  const out = text.replace(run, " ").replace(/\s+/g, " ").trim();
  return { text: out, echoed: out !== text.trim() };
}

/** Seconds per chunk. Long single passes break down partway (Ankit Jain: speech stopped at 10:54 of 22:30). */
export const CHUNK_SECONDS = Number(process.env.QWEN_ASR_CHUNK_SECONDS ?? "300");

/** Where finished chunks are kept, so an interrupted run resumes. */
const cacheRoot = (): string => expand(process.env.QWEN_ASR_CACHE ?? "~/.cache/focus-conference/qwen-asr");

interface Segment {
  start: number | null;
  end: number | null;
  text: string;
}

const sha = (data: string | Uint8Array): string => new Bun.CryptoHasher("sha256").update(data).digest("hex");

/**
 * Transcribe one audio file in CHUNK_SECONDS pieces. Each finished chunk is
 * written to the cache (keyed by audio hash, model, chunk length and prompt)
 * before the next starts, so a run cut short by a kill, a crash or a flat
 * battery picks up at the first unfinished chunk. Throws with the tool's own
 * message on failure; finished chunks stay cached.
 */
export function qwenTranscribe(setup: QwenSetup, audioPath: string, prompt: string | null, log: (line: string) => void = () => {}): Transcript {
  const key = [sha(readFileSync(audioPath)).slice(0, 16), setup.name, `${CHUNK_SECONDS}s`, sha(prompt ?? "").slice(0, 8)].join("-");
  const cache = join(cacheRoot(), key);
  mkdirSync(cache, { recursive: true });

  // --timestamps needs a file, not stdin, so decode to 16 kHz mono WAV chunks.
  const work = mkdtempSync(join(tmpdir(), "qwen-asr-"));
  try {
    const ff = Bun.spawnSync({
      cmd: ["ffmpeg", "-y", "-loglevel", "error", "-i", audioPath, "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le",
        "-f", "segment", "-segment_time", String(CHUNK_SECONDS), join(work, "chunk_%03d.wav")],
      stdout: "pipe",
      stderr: "pipe",
    });
    if (ff.exitCode !== 0) throw new Error(`ffmpeg could not decode ${audioPath}: ${ff.stderr.toString().trim()}`);
    const chunks = readdirSync(work).filter((f) => f.startsWith("chunk_")).sort();

    const terms = promptTerms(prompt);
    const words: Word[] = [];
    const lines: string[] = [];
    let echoed = 0;
    chunks.forEach((chunk, i) => {
      const offset = i * CHUNK_SECONDS;
      const done = join(cache, chunk.replace(/\.wav$/, ".json"));
      let segments: Segment[];
      if (existsSync(done)) {
        segments = JSON.parse(readFileSync(done, "utf8")) as Segment[];
        log(`chunk ${i + 1}/${chunks.length} cached`);
      } else {
        const cmd = [setup.binary, "-d", setup.model, "-i", join(work, chunk), "--timestamps", "--silent"];
        if (prompt) cmd.push("--prompt", prompt);
        const run = Bun.spawnSync({ cmd, stdout: "pipe", stderr: "pipe" });
        if (run.exitCode !== 0) throw new Error(`qwen_asr failed on ${audioPath} chunk ${i + 1}/${chunks.length}: ${run.stderr.toString().trim()}`);
        segments = run.stdout.toString().split("\n").filter((l) => l.trim().startsWith("{")).map((l) => {
          const seg = JSON.parse(l) as { start?: number; end?: number; text?: string };
          return {
            start: seg.start == null ? null : Math.round((seg.start + offset) * 100) / 100,
            end: seg.end == null ? null : Math.round((seg.end + offset) * 100) / 100,
            text: (seg.text ?? "").trim(),
          };
        });
        // Write then rename: a half-written file must never look finished.
        writeFileSync(`${done}.tmp`, JSON.stringify(segments));
        renameSync(`${done}.tmp`, done);
        log(`chunk ${i + 1}/${chunks.length} transcribed`);
      }
      for (const seg of segments) {
        const clean = stripEcho(seg.text, terms);
        if (clean.echoed) echoed++;
        if (!clean.text) continue;
        lines.push(clean.text);
        for (const w of clean.text.split(/\s+/)) words.push({ w, start: seg.start, end: seg.end });
      }
    });
    return { text: lines.join(" "), words, locale: null, source: setup.name, timing: "segment", echo_segments: echoed };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
