#!/usr/bin/env bun
/**
 * Inventory the photo drop. Nothing else.
 *
 * Reads every photo in `photos/`, derives the capture time, hashes the file, and
 * writes `photos/manifest.json`. The placement render (`src/talk-photos.prose.md`)
 * decides which talk a photo belongs to; this script only records what is on disk.
 *
 * Time convention: Pixel filenames (`PXL_YYYYMMDD_HHMMSSmmm`) are **UTC**. The
 * conference timezone comes from the schedule world-model (`event.timezone`), so
 * `captured_at_local` is unambiguous. EXIF `DateTime` is local and is used only
 * as a cross-check; a disagreement of more than two minutes is reported.
 *
 * Usage:
 *   bun scripts/export-photos.ts --dry-run
 *   bun scripts/export-photos.ts
 */

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import exifr from "exifr";

interface PhotoEntry {
  file: string;
  captured_at_utc: string | null;
  captured_at_local: string | null;
  time_source: "filename" | "exif" | "none";
  sha256: string;
  width: number | null;
  height: number | null;
  bytes: number;
  burst_id: string | null;
}

interface PhotoManifest {
  kind: "openprose.photos.manifest";
  generated_at: string;
  source_dir: string;
  timezone: string;
  time_convention: string;
  photo_count: number;
  photos: PhotoEntry[];
}

const PHOTO_EXTS = new Set([".jpg", ".jpeg", ".png", ".heic", ".webp"]);
const NAME_RE = /PXL_(\d{8})_(\d{6})(\d{3})/;

const argv = process.argv.slice(2);
const flag = (name: string, fallback: string): string => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] ?? fallback : fallback;
};
const root = resolve(import.meta.dir, "..");
const photosDir = resolve(flag("dir", join(root, "photos")));
const manifestPath = resolve(flag("manifest", join(photosDir, "manifest.json")));
const dryRun = argv.includes("--dry-run");

function eventTimezone(): string {
  const published = join(root, "state/world-model/conference-schedule/published");
  // The schedule render writes published/event.json; older builds nested it under event/.
  const event = [join(published, "event.json"), join(published, "event/event.json")].find(existsSync) ?? join(published, "event.json");
  if (existsSync(event)) {
    try {
      return (JSON.parse(readFileSync(event, "utf8")) as { timezone?: string }).timezone ?? "UTC";
    } catch { /* fall through */ }
  }
  return process.env.CONFERENCE_TZ ?? "UTC";
}

function wallParts(date: Date, tz: string): { iso: string; offset: string } {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  });
  const p = Object.fromEntries(fmt.formatToParts(date).map((x) => [x.type, x.value]));
  const offFmt = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "longOffset" });
  const off = offFmt.formatToParts(date).find((x) => x.type === "timeZoneName")?.value ?? "GMT+00:00";
  const pretty = off.replace("GMT", "") || "+00:00";
  const offset = pretty === "Z" || pretty === "" ? "+00:00" : pretty;
  return { iso: `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`, offset };
}

function zonedIso(date: Date, tz: string): string {
  const { iso, offset } = wallParts(date, tz);
  return `${iso}${offset}`;
}

function zonedDay(date: Date, tz: string): string {
  return wallParts(date, tz).iso.slice(0, 10);
}

async function hashFile(file: string): Promise<string> {
  const hasher = new Bun.CryptoHasher("sha256");
  for await (const chunk of Bun.file(file).stream()) hasher.update(chunk);
  return hasher.digest("hex");
}

interface ExifInfo {
  width: number | null;
  height: number | null;
  localWall: string | null;
}

async function exifInfo(file: string): Promise<ExifInfo> {
  try {
    const exif = (await exifr.parse(file, { pick: ["DateTimeOriginal", "CreateDate", "ModifyDate", "ImageWidth", "ImageHeight", "ExifImageWidth", "ExifImageHeight"] })) as
      | Record<string, unknown>
      | undefined;
    if (!exif) return { width: null, height: null, localWall: null };
    const width = (exif.ImageWidth as number | undefined) ?? (exif.ExifImageWidth as number | undefined) ?? null;
    const height = (exif.ImageHeight as number | undefined) ?? (exif.ExifImageHeight as number | undefined) ?? null;
    const date = (exif.DateTimeOriginal ?? exif.CreateDate ?? exif.ModifyDate) as Date | undefined;
    const localWall = date instanceof Date
      ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}T${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}:${String(date.getSeconds()).padStart(2, "0")}`
      : null;
    return { width, height, localWall };
  } catch {
    return { width: null, height: null, localWall: null };
  }
}

const tz = eventTimezone();
const files = readdirSync(photosDir)
  .filter((n) => !n.startsWith(".") && PHOTO_EXTS.has(extname(n).toLowerCase()))
  .sort();

console.log(`photos  ${photosDir}\nzone    ${tz}\nfound   ${files.length} photo(s)\n`);

const entries: PhotoEntry[] = [];
const undated: string[] = [];
const mismatches: Array<{ file: string; drift: number }> = [];

for (const file of files) {
  const path = join(photosDir, file);
  const m = NAME_RE.exec(basename(file));
  let utc: Date | null = null;
  if (m) {
    const [, day, clock, ms] = m;
    const iso = `${day}T${clock}.${ms}Z`;
    const parsed = new Date(`${day!.slice(0, 4)}-${day!.slice(4, 6)}-${day!.slice(6, 8)}T${clock!.slice(0, 2)}:${clock!.slice(2, 4)}:${clock!.slice(4, 6)}.${ms}Z`);
    utc = Number.isNaN(parsed.getTime()) ? null : parsed;
    if (!utc) console.warn(`  ! unparseable filename timestamp: ${file} (${iso})`);
  }
  const exif = await exifInfo(path);
  if (!utc && exif.localWall) {
    const d = new Date(exif.localWall);
    if (!Number.isNaN(d.getTime())) utc = d;
  }
  if (!utc) undated.push(file);
  if (utc && exif.localWall) {
    const wall = wallParts(utc, tz).iso;
    const drift = Math.abs(new Date(wall).getTime() - new Date(exif.localWall).getTime()) / 1000;
    if (drift > 120) mismatches.push({ file, drift });
  }

  entries.push({
    file,
    captured_at_utc: utc ? utc.toISOString().slice(0, 19) + "+00:00" : null,
    captured_at_local: utc ? zonedIso(utc, tz) : null,
    time_source: m ? "filename" : exif.localWall ? "exif" : "none",
    sha256: await hashFile(path),
    width: exif.width,
    height: exif.height,
    bytes: Bun.file(path).size,
    burst_id: null,
  });
}

entries.sort((a, b) => (a.captured_at_local ?? "").localeCompare(b.captured_at_local ?? ""));
let burstId: string | null = null;
let prev: Date | null = null;
entries.forEach((e, i) => {
  if (!e.captured_at_local) return;
  const t = new Date(e.captured_at_local);
  if (prev && (t.getTime() - prev.getTime()) / 1000 <= 90) {
    e.burst_id = burstId;
  } else {
    burstId = `b${String(i).padStart(2, "0")}`;
    e.burst_id = burstId;
  }
  prev = t;
});

const manifest: PhotoManifest = {
  kind: "openprose.photos.manifest",
  generated_at: new Date().toISOString(),
  source_dir: photosDir,
  timezone: tz,
  time_convention: "filename UTC → event timezone; EXIF DateTime local (cross-check)",
  photo_count: entries.length,
  photos: entries,
};

if (!entries.length) {
  console.error("  ✗ no photos found");
  process.exit(1);
}

if (dryRun) {
  console.log(`  ${entries.length} photo(s) inventoried · ${undated.length} undated · ${mismatches.length} clock mismatches`);
  for (const { file, drift } of mismatches) console.log(`    ! ${file}: EXIF local differs from filename UTC by ${drift.toFixed(0)}s`);
  for (const file of undated) console.log(`    ! ${file}: no parseable capture time`);
  console.log("  (dry run — manifest not written)");
  process.exit(0);
}

writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
console.log(`  wrote ${manifestPath}`);
console.log(`  ${entries.length} photo(s) · ${undated.length} undated · ${mismatches.length} clock mismatches`);
for (const { file, drift } of mismatches) console.log(`    ! ${file}: EXIF local differs from filename UTC by ${drift.toFixed(0)}s`);
for (const file of undated) console.log(`    ! ${file}: no parseable capture time`);
