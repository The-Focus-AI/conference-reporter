#!/usr/bin/env bun
// Renders the conference guide from the published schedule truth.
//
// A derived projection: state/world-model/conference-schedule/published/ is the
// truth, and site/index.html is disposable. It holds no model call and no edits.
//
// Usage: bun scripts/render-site.ts [--root <dir>] [--out site/index.html]

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const flag = (name: string, fallback: string): string => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] ?? fallback : fallback;
};

const root = resolve(flag("root", join(HERE, "..")));
const out = resolve(root, flag("out", "site/index.html"));
const truthPath = join(root, "state/world-model/conference-schedule/published/world-model.json");

if (!existsSync(truthPath)) {
  console.error(`no published schedule at ${truthPath}: render conference-schedule first`);
  process.exit(2);
}

interface Session {
  session_id: string; title: string; abstract: string | null; format: string | null;
  room_id: string | null; location_note: string | null; day: string;
  starts_at: string; ends_at: string; speaker_ids: string[]; status: string; source_url: string | null;
}
interface Speaker { name: string; affiliation: string | null; bio: string | null; links: string[] }

const wm = JSON.parse(readFileSync(truthPath, "utf8")) as {
  event: Record<string, unknown>;
  venue: { rooms: Array<{ room_id: string; name: string; floor: string | null }> } & Record<string, unknown>;
  program: { days: Array<{ date: string; label: string | null; session_count: number }>; sessions: Session[] };
  speakers: Record<string, Speaker>;
  coverage: { gaps: string[]; last_verified_at: string | null };
};

// Only pass the fields the page reads, so a change elsewhere in the truth cannot leak in.
const titleGap = wm.coverage.gaps.find((g) => g.startsWith("talk title not published"));
const data = {
  event: wm.event,
  venue: wm.venue,
  days: wm.program.days,
  sessions: wm.program.sessions.map((s) => ({
    id: s.session_id, title: s.title, abstract: s.abstract, format: s.format, room: s.room_id,
    note: s.location_note, day: s.day, start: s.starts_at, end: s.ends_at,
    speakers: s.speaker_ids, status: s.status, source: s.source_url,
  })),
  speakers: Object.fromEntries(Object.entries(wm.speakers).map(([id, p]) => [id, {
    name: p.name, affiliation: p.affiliation, bio: p.bio, links: p.links,
  }])),
  untitled: titleGap ? [...titleGap.slice(titleGap.lastIndexOf(":") + 1).matchAll(/[^\s,]+/g)].map((m) => m[0]) : [],
  gaps: wm.coverage.gaps,
  verified: wm.coverage.last_verified_at,
};

const template = readFileSync(join(HERE, "site", "template.html"), "utf8");
// "<" is escaped so source text can never close the data block.
const json = JSON.stringify(data).replace(/</g, "\\u003c");
if (!template.includes("/*SITE_DATA*/null") || !template.includes("/*SITE_TITLE*/")) throw new Error("template is missing a placeholder");
const title = `${String(wm.event.name).replace(/&/g, "&amp;").replace(/</g, "&lt;")} Field Guide`;
const html = template.replace("/*SITE_TITLE*/", () => title).replace("/*SITE_DATA*/null", () => json);

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, html);
console.log(`wrote ${out} · ${data.sessions.length} sessions · ${wm.venue.rooms.length} rooms · ${Object.keys(data.speakers).length} speakers · ${Math.round(html.length / 1024)} KB`);
