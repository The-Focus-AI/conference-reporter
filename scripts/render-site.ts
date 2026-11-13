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
import { navConfig, topnav } from "./site/nav.ts";
import { livestreamLookup } from "./site/livestreams.ts";

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

// Floor maps are optional build data: site/map/map.json plus the images it names.
// Images are inlined so the guide stays one file that works offline.
interface MapPlan { id: string; floor: string; label: string; dates: string[]; image: string; alt: string; notes: string[]; rooms: Record<string, number[]> }
interface VenueMaps { source_url: string; names: string; routes: Array<{ title: string; text: string }>; plans: MapPlan[] }

const IMAGE_TYPES: Record<string, string> = { avif: "image/avif", png: "image/png", webp: "image/webp", jpg: "image/jpeg", jpeg: "image/jpeg" };
const mapDir = join(root, "site/map");
const loadMaps = () => {
  const path = join(mapDir, "map.json");
  if (!existsSync(path)) return null;
  const maps = JSON.parse(readFileSync(path, "utf8")) as VenueMaps;
  return {
    source_url: maps.source_url, names: maps.names, routes: maps.routes,
    plans: maps.plans.map(({ image, ...plan }) => {
      const type = IMAGE_TYPES[image.split(".").pop()?.toLowerCase() ?? ""];
      if (!type) throw new Error(`unsupported map image type: ${image}`);
      return { ...plan, src: `data:${type};base64,${readFileSync(join(mapDir, image)).toString("base64")}` };
    }),
  };
};

// Recommendations are optional build data too: an opinion about the schedule, kept out of its truth.
// A session the file doesn't name simply has no call. A stale id is a mistake worth failing on.
interface Recommendations { profile: string; calls: Record<string, { call: "go" | "maybe" | "skip"; why: string }> }
const loadRecommendations = () => {
  const path = join(root, "site/recommendations.json");
  if (!existsSync(path)) return null;
  const recs = JSON.parse(readFileSync(path, "utf8")) as Recommendations;
  const known = new Set(wm.program.sessions.map((s) => s.session_id));
  const stale = Object.keys(recs.calls).filter((id) => !known.has(id));
  if (stale.length) throw new Error(`recommendations name sessions no longer in the schedule: ${stale.join(", ")}`);
  return recs;
};

// Only pass the fields the page reads, so a change elsewhere in the truth cannot leak in.
const titleGap = wm.coverage.gaps.find((g) => g.startsWith("talk title not published"));
const watch = livestreamLookup(root);
const data = {
  event: wm.event,
  venue: wm.venue,
  days: wm.program.days,
  sessions: wm.program.sessions.map((s) => ({
    id: s.session_id, title: s.title, abstract: s.abstract, format: s.format, room: s.room_id,
    note: s.location_note, day: s.day, start: s.starts_at, end: s.ends_at,
    speakers: s.speaker_ids, status: s.status, source: s.source_url,
    video: watch(s)?.url ?? null,
  })),
  speakers: Object.fromEntries(Object.entries(wm.speakers).map(([id, p]) => [id, {
    name: p.name, affiliation: p.affiliation, bio: p.bio, links: p.links,
  }])),
  untitled: titleGap ? [...titleGap.slice(titleGap.lastIndexOf(":") + 1).matchAll(/[^\s,]+/g)].map((m) => m[0]) : [],
  gaps: wm.coverage.gaps,
  verified: wm.coverage.last_verified_at,
  maps: loadMaps(),
  recommendations: loadRecommendations(),
};

const template = readFileSync(join(HERE, "site", "template.html"), "utf8");
// "<" is escaped so source text can never close the data block.
const json = JSON.stringify(data).replace(/</g, "\\u003c");
if (!["/*SITE_DATA*/null", "/*SITE_TITLE*/", "/*NAV_CSS*/", "<!--TOPNAV-->"].every((p) => template.includes(p))) throw new Error("template is missing a placeholder");
// The site's top bar, shared with every other page; its CSS is inlined so the guide stays one file.
const navCss = readFileSync(join(root, "site/nav.css"), "utf8");
const title = `${String(wm.event.name).replace(/&/g, "&amp;").replace(/</g, "&lt;")} Field Guide`;
const html = template.replace("/*SITE_TITLE*/", () => title).replace("/*SITE_DATA*/null", () => json)
  .replace("/*NAV_CSS*/", () => navCss).replace("<!--TOPNAV-->", () => topnav("schedule", "../", navConfig(root)));

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, html);
console.log(`wrote ${out} · ${data.sessions.length} sessions · ${wm.venue.rooms.length} rooms · ${Object.keys(data.speakers).length} speakers · ${Math.round(html.length / 1024)} KB`);
