#!/usr/bin/env bun
// Renders the build's own pages, all under one top bar (scripts/site/nav.ts):
//
//   index.html                  Today: the day's plan with now/next, what's captured, latest notes, pipeline
//   site/talks/index.html       Talks: one block per captured talk, built vs pending
//   site/talks/<slug>.html      One hub per talk: speakers, notes, photos, recording, themes, links, transcript
//   site/themes.html            Themes: analysis/themes.md, linked back to the hubs
//   site/people.html            People: every speaker, with follow and write-to links on X
//
// The planner and floor maps (site/index.html) are rendered by render-site.ts;
// the plain timetable (site/schedule.html) is rendered here. Everything here
// is a derived projection over the schedule truth, the recording intake truth,
// talks/, notes/inbox/, analysis/ and the receipt ledgers. No model call, no
// network. Markdown sources are rendered inline so nothing opens as raw text.
//
// Usage: bun scripts/render-pages.ts [--root <dir>]

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { navConfig, topnav, type Section } from "./site/nav.ts";
import { livestreamLookup } from "./site/livestreams.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const flag = (name: string, fallback: string): string => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] ?? fallback : fallback;
};
const root = resolve(flag("root", join(HERE, "..")));

const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const exists = (p: string): boolean => existsSync(join(root, p));
const list = (dir: string): string[] => (exists(dir) ? readdirSync(join(root, dir)).filter((f) => !f.startsWith(".")).sort() : []);
const isDir = (p: string): boolean => exists(p) && statSync(join(root, p)).isDirectory();
const read = (p: string): string => readFileSync(join(root, p), "utf8");
const write = (p: string, s: string): void => { mkdirSync(dirname(join(root, p)), { recursive: true }); writeFileSync(join(root, p), s); };
const clock = (d: Date): string => d.toLocaleTimeString("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" });
const day = (d: Date): string => d.toLocaleDateString("en-US", { timeZone: TZ, weekday: "short", month: "short", day: "numeric" });
const slugify = (s: string): string => s.toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const stripFront = (md: string): string => md.replace(/^---\n[\s\S]*?\n---\n?/, "");
const front = (md: string, key: string): string | undefined => md.match(new RegExp(`^${key}:\\s*"?([^"\\n]*)"?\\s*$`, "m"))?.[1];
const md = (s: string): string => Bun.markdown.html(s);

// --- Schedule truth.
interface Session { session_id: string; title: string; abstract: string | null; format: string | null; starts_at: string; ends_at: string; room_id: string | null; speaker_ids: string[]; day: string }
interface Speaker { name: string; affiliation: string | null; bio: string | null; links: string[] }
const wm = JSON.parse(read("state/world-model/conference-schedule/published/world-model.json")) as {
  event: { name: string; timezone?: string; starts_on?: string; ends_on?: string };
  program: { sessions: Session[]; days: Array<{ date: string; label: string | null }> };
  speakers: Record<string, Speaker>;
  venue: { rooms: Array<{ room_id: string; name: string }> };
};
// The event's own timezone: every clock and day label on the site is local to it.
const TZ: string = wm.event.timezone ?? "UTC";
const NAV = navConfig(root);

// Editorial choices for the post-event pages: titles, copy, and which picture
// stands for each theme. Optional; every field has a neutral default. See
// docs/USAGE.md "Presentation". Lives in editorial/ because it is build data.
interface Visual { src: string; alt: string; caption: string }
interface Slide { src: string; alt: string; speaker: string; slug: string }
interface Presentation {
  phase?: "live" | "archive";
  title?: string; summary?: string; dates_label?: string; share_text?: string;
  stack?: { title?: string; lede?: string; axis_top?: string; axis_bottom?: string; unit?: string };
  cards?: { title?: string; lede?: string };
  hero?: Visual; contested_visual?: Visual;
  theme_visuals?: Record<string, Visual>; theme_slides?: Record<string, Slide>;
}
const P: Presentation = exists("editorial/presentation.json") ? (JSON.parse(read("editorial/presentation.json")) as Presentation) : {};
const dateRange = (): string => {
  const e = wm.event;
  if (!e.starts_on) return "";
  const f = (d: string, o: Intl.DateTimeFormatOptions): string => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", ...o });
  const a = f(e.starts_on, { month: "short", day: "numeric" }), y = e.starts_on.slice(0, 4);
  if (!e.ends_on || e.ends_on === e.starts_on) return `${a}, ${y}`;
  const b = e.ends_on.slice(0, 7) === e.starts_on.slice(0, 7) ? f(e.ends_on, { day: "numeric" }) : f(e.ends_on, { month: "short", day: "numeric" });
  return `${a}–${b}, ${y}`;
};
const rooms = new Map(wm.venue.rooms.map((r) => [r.room_id, r.name]));
const roomName = (s: Session): string => (s.room_id ? rooms.get(s.room_id) ?? s.room_id : "");
const livestream = livestreamLookup(root);
const watchLink = (s: Session | null, cls = ""): string => { const v = s ? livestream(s) : null; return v ? `<a class="${cls}" href="${esc(v.url)}" rel="noopener" title="Livestream, around ${v.at} (approximate)">Watch on the livestream ▸</a>` : ""; };
const sessionSlug = (s: Session): string => `${s.starts_at.slice(0, 10)}-${slugify(s.title)}`;
const sessionById = new Map(wm.program.sessions.map((s) => [s.session_id, s]));
const bySlug = new Map(wm.program.sessions.map((s) => [sessionSlug(s), s]));
const recs = exists("site/recommendations.json")
  ? (JSON.parse(read("site/recommendations.json")) as { calls: Record<string, { call: string; why: string }> }).calls
  : {};

const xHandle = (links: string[]): string | null => {
  for (const l of links) {
    const m = l.match(/^https?:\/\/(?:www\.)?(?:x|twitter)\.com\/@?([A-Za-z0-9_]{1,15})\/?(?:[?#].*)?$/);
    if (m && !["intent", "share", "home", "i", "search"].includes(m[1]!.toLowerCase())) return m[1]!;
  }
  return null;
};
const linkLabel = (l: string): string => {
  const h = l.replace(/^https?:\/\/(www\.)?/, "");
  if (/^linkedin\.com/.test(h)) return "LinkedIn";
  if (/^github\.com/.test(h)) return "GitHub";
  if (/^(x|twitter)\.com/.test(h)) return "X";
  if (/^bsky\.app/.test(h)) return "Bluesky";
  if (/youtube\.com/.test(h)) return "YouTube";
  return h.split("/")[0]!;
};

// --- Captured talks: talk folders, notes and recordings, keyed by slug.
const intakePath = "state/world-model/recording-intake/published/world-model.json";
const intake = exists(intakePath)
  ? (JSON.parse(read(intakePath)) as { matches: Record<string, { session_id: string | null; status: string }>; talks: Record<string, { slug: string }> })
  : { matches: {}, talks: {} };
const photosPath = "state/world-model/talk-photos/published/world-model.json";
const photoPlacements = (exists(photosPath) ? (JSON.parse(read(photosPath)) as { placements?: Record<string, { dir: string }> }).placements : undefined) ?? {};
const sessionForSlug = (slug: string): Session | null => {
  const fromIntake = Object.entries(intake.talks).find(([, t]) => t.slug === slug)?.[0];
  const fromFiles = ["transcript.md", "links.md", "story.md"].map((f) => `talks/${slug}/${f}`).filter(exists)
    .map((f) => front(read(f), "session_id")).find(Boolean);
  // A photos-only talk (no recording yet) is known by the photo step's placements.
  const fromPhotos = Object.entries(photoPlacements).find(([, v]) => v.dir === `talks/${slug}/photos`)?.[0];
  const id = fromIntake ?? fromFiles ?? fromPhotos;
  return (id && sessionById.get(id)) || bySlug.get(slug) || null;
};
interface Note { file: string; at: string; kind: string; body: string }
interface Recording { folder: string; minutes: number; source: string; audio: string | null }
interface Talk { slug: string; session: Session | null; title: string; notes: Note[]; recordings: Recording[] }
const talks = new Map<string, Talk>();
const talk = (slug: string): Talk => {
  if (!talks.has(slug)) {
    // A talk folder keeps its slug when the schedule retitles the session, so
    // resolve it by session id first (intake truth, then the folder's own files).
    const s = sessionForSlug(slug);
    talks.set(slug, { slug, session: s, title: s?.title ?? slug, notes: [], recordings: [] });
  }
  return talks.get(slug)!;
};
for (const d of list("talks")) if (isDir(`talks/${d}`)) talk(d);

const notes: Note[] = list("notes/inbox").filter((f) => f.endsWith(".md")).map((f) => {
  const raw = read(`notes/inbox/${f}`);
  return { file: f, at: front(raw, "captured_at") ?? "", kind: front(raw, "kind") ?? "note", body: stripFront(raw).trim() };
});
for (const n of notes) {
  const t = read(`notes/inbox/${n.file}`).match(/^talk:\s*talks\/([^/\s]+)\/?\s*$/m)?.[1];
  if (t) talk(t).notes.push(n);
}

for (const d of list("recordings/inbox")) {
  if (!isDir(`recordings/inbox/${d}`) || !exists(`recordings/inbox/${d}/meta.json`)) continue;
  const meta = JSON.parse(read(`recordings/inbox/${d}/meta.json`));
  const match = intake.matches[d];
  let slug: string | null = null;
  if (match?.session_id && intake.talks[match.session_id]) slug = intake.talks[match.session_id]!.slug;
  if (!slug && match?.status === "needs-review") continue;
  if (!slug) {
    const title = String(meta.title ?? "").toLowerCase();
    const s = wm.program.sessions.find((x) => x.speaker_ids.some((id) => (wm.speakers[id]?.name ?? "").toLowerCase() === title));
    if (s) slug = sessionSlug(s);
  }
  if (!slug) continue;
  const audio = list(`recordings/inbox/${d}`).find((f) => /^audio\.(m4a|mp3|wav|aac)$/.test(f));
  talk(slug).recordings.push({
    folder: d, minutes: meta.duration_seconds ? Math.round(meta.duration_seconds / 60) : 0,
    source: meta.transcript_source ?? "no transcript yet", audio: audio ? `recordings/inbox/${d}/${audio}` : null,
  });
}
const captured = [...talks.values()].sort((a, b) => (a.session?.starts_at ?? "9999").localeCompare(b.session?.starts_at ?? "9999"));
const capturedSessionIds = new Set(captured.map((t) => t.session?.session_id).filter(Boolean) as string[]);
const hubHref = (slug: string, up: string): string => `${up}site/talks/${slug}.html`;
const pagePath = (slug: string): string | undefined => ["experience/index.html", "experience/page.html"].map((f) => `talks/${slug}/${f}`).find(exists);
// A talk's front door: its story page when one is built, otherwise its hub.
const talkHref = (slug: string, up: string): string => { const pg = pagePath(slug); return pg ? `${up}${pg}` : hubHref(slug, up); };
const leadSlideImage = (slug: string): string | null => {
  const f = list(`talks/${slug}/experience`).find((x) => /\.(jpe?g|png|webp)$/i.test(x));
  return f ? `talks/${slug}/experience/${f}` : null;
};
const slugBySession = new Map(captured.filter((t) => t.session).map((t) => [t.session!.session_id, t.slug]));
const talkBySlug = new Map(captured.map((t) => [t.slug, t]));

// Pictures for the themes pages, from editorial/presentation.json (see P above).
type ClayVisual = Visual;
const THEME_SLIDES: Record<string, Slide> = P.theme_slides ?? {};
const HERO_CLAY: ClayVisual | null = P.hero ?? null;
const CONTESTED_CLAY: ClayVisual | null = P.contested_visual ?? null;
const THEME_CLAY: Record<string, ClayVisual> = P.theme_visuals ?? {};
const SYNTH_TITLE = (): string => P.title ?? `${themes.length} themes across ${corpusMeta.talk_count ?? captured.length} talks`;
const STACK = { title: P.stack?.title ?? "How the themes stack up", lede: P.stack?.lede ?? "Pick a theme to see its lead picture, its strongest quote, and the talks behind it.", axisTop: P.stack?.axis_top ?? "", axisBottom: P.stack?.axis_bottom ?? "", unit: P.stack?.unit ?? "Theme" };

// --- Structured themes, claims, theses, contested fault lines & singletons.
interface RawClaim { claim_id: string; section: string; at_seconds: number; quote: string; claim: string; speaker?: string }
interface ResolvedClaim extends RawClaim { session_id: string; slug: string; title: string; speakers: string }
interface ThemeWmEntry {
  theme_id: string; name: string; claim_sentence: string; definition: string;
  claims: string[]; counter_claims: string[]; also_called: string[];
  why_uncontested: string | null; talk_slugs: string[]; talk_count: number;
}
interface Theme {
  num: string; id: string; name: string; claim: string; definition: string;
  alsoCalled: string[]; slugs: Set<string>; claims: ResolvedClaim[];
  counters: ResolvedClaim[]; counterSlugs: Set<string>; whyUncontested: string | null;
}
interface ContestedItem {
  question: string;
  sides: Array<{ claim_id: string; stance: string; slug: string | null; title: string; speakers: string; section: string }>;
}

const themesMd = exists("analysis/themes.md") ? read("analysis/themes.md") : "";
const thesis = new Map<string, string>();
for (const m of themesMd.matchAll(/^- \[[^\]]+\]\(\.\.\/talks\/([^/]+)\/transcript\.md\): (.+)$/gm)) thesis.set(m[1]!, m[2]!);

const thesesPath = "state/world-model/talk-insights/published/theses.json";
const claimsPath = "state/world-model/talk-insights/published/claims.json";
const themesWmPath = "state/world-model/conference-themes/published/world-model.json";
const shortSpeakers = (slug: string): string => {
  const s = talkBySlug.get(slug)?.session ?? null;
  if (!s) return "";
  return s.speaker_ids.map((id) => wm.speakers[id]?.name).filter(Boolean).join(", ");
};

if (exists(thesesPath)) {
  const rawTheses = JSON.parse(read(thesesPath)) as Record<string, { thesis?: string; one_liner?: string } | string>;
  for (const [sid, val] of Object.entries(rawTheses)) {
    const slug = intake.talks[sid]?.slug ?? slugBySession.get(sid);
    if (!slug) continue;
    const text = typeof val === "string" ? val : (val.thesis ?? val.one_liner ?? "");
    if (text) thesis.set(slug, text);
  }
}

const claimById = new Map<string, ResolvedClaim>();
if (exists(claimsPath)) {
  const rawClaims = JSON.parse(read(claimsPath)) as Record<string, RawClaim[]>;
  for (const [sid, list] of Object.entries(rawClaims)) {
    const slug = intake.talks[sid]?.slug ?? slugBySession.get(sid) ?? sid;
    const tObj = talkBySlug.get(slug);
    const title = tObj?.title ?? slug;
    const spk = shortSpeakers(slug);
    for (const c of list) {
      claimById.set(c.claim_id, {
        ...c,
        session_id: sid,
        slug,
        title,
        speakers: c.speaker ?? spk,
      });
    }
  }
}

const themes: Theme[] = [];
let contestedList: ContestedItem[] = [];
let singletonList: ResolvedClaim[] = [];
let corpusMeta: { talk_count?: number; word_count?: number } = {};

if (exists(themesWmPath)) {
  const twm = JSON.parse(read(themesWmPath)) as {
    themes: ThemeWmEntry[];
    contested?: Array<{ question: string; sides: Array<{ claim_id: string; stance: string }> }>;
    singletons?: string[];
    corpus?: { talk_count?: number; word_count?: number };
  };
  corpusMeta = twm.corpus ?? {};
  twm.themes.forEach((tw, idx) => {
    const claims = tw.claims.map((cid) => claimById.get(cid)).filter(Boolean) as ResolvedClaim[];
    const counters = tw.counter_claims.map((cid) => claimById.get(cid)).filter(Boolean) as ResolvedClaim[];
    themes.push({
      num: String(idx + 1).padStart(2, "0"),
      id: tw.theme_id,
      name: tw.name,
      claim: tw.claim_sentence,
      definition: tw.definition,
      alsoCalled: tw.also_called ?? [],
      slugs: new Set(tw.talk_slugs),
      claims,
      counters,
      counterSlugs: new Set(counters.map((c) => c.slug)),
      whyUncontested: tw.why_uncontested,
    });
  });
  contestedList = (twm.contested ?? []).map((q) => ({
    question: q.question,
    sides: q.sides.map((s) => {
      const c = claimById.get(s.claim_id);
      return {
        claim_id: s.claim_id,
        stance: s.stance,
        slug: c?.slug ?? null,
        title: c?.title ?? "",
        speakers: c?.speakers ?? "",
        section: c?.section ?? "",
      };
    }),
  }));
  singletonList = (twm.singletons ?? []).map((cid) => claimById.get(cid)).filter(Boolean) as ResolvedClaim[];
} else {
  const themeBlock = themesMd.split(/^## Themes\s*$/m)[1]?.split(/^## /m)[0] ?? "";
  let idx = 0;
  for (const part of themeBlock.split(/^### /m).slice(1)) {
    const name = part.split("\n")[0]!.trim();
    themes.push({
      num: String(++idx).padStart(2, "0"),
      id: slugify(name),
      name,
      claim: part.match(/^\*\*(.+)\*\*\s*$/m)?.[1] ?? "",
      definition: "",
      alsoCalled: [],
      slugs: new Set([...part.matchAll(/\.\.\/talks\/([^/]+)\/transcript\.md/g)].map((m) => m[1]!)),
      claims: [],
      counters: [],
      counterSlugs: new Set(),
      whyUncontested: null,
    });
  }
}

const themesForSlug = (slug: string): Theme[] => themes.filter((th) => th.slugs.has(slug));
const themeDeepDiveRel = (id: string): string => `atlases/${id}/page.html`;
const masterThemesRel = "atlases/conference-themes/page.html";

// Note cross-references: direct mentions of other talk slugs in notes/inbox.
const noteLinksBySlug = new Map<string, Set<string>>();
for (const t of captured) {
  const refs = new Set<string>();
  for (const n of t.notes) {
    for (const m of n.body.matchAll(/talks\/([a-z0-9-]+)/g)) {
      if (m[1] && m[1] !== t.slug && talkBySlug.has(m[1])) refs.add(m[1]);
    }
  }
  if (refs.size) noteLinksBySlug.set(t.slug, refs);
}

interface RelatedTalk { slug: string; title: string; speakers: string; when: string; thesis: string; storyHref: string; hubHref: string; reasons: string[]; score: number }
const relatedFor = (slug: string, limit = 5): RelatedTalk[] => {
  const baseThemes = themesForSlug(slug);
  const baseContested = contestedList.filter((q) => q.sides.some((s) => s.slug === slug));
  const baseObj = talkBySlug.get(slug);
  const baseNotes = noteLinksBySlug.get(slug) ?? new Set<string>();
  const scored: RelatedTalk[] = [];

  for (const other of captured) {
    if (other.slug === slug) continue;
    let score = 0;
    const reasons: string[] = [];

    for (const th of baseThemes) {
      if (th.slugs.has(other.slug)) {
        score += 3;
        reasons.push(th.name);
      } else if (th.counterSlugs.has(other.slug)) {
        score += 2;
        reasons.push(`Counter: ${th.name}`);
      }
    }
    for (const th of themesForSlug(other.slug)) {
      if (th.counterSlugs.has(slug) && !reasons.includes(th.name)) {
        score += 2;
        reasons.push(`Counter: ${th.name}`);
      }
    }
    for (const q of baseContested) {
      if (q.sides.some((s) => s.slug === other.slug)) {
        score += 4;
        if (!reasons.includes("Contested debate")) reasons.unshift("Contested debate");
      }
    }
    if (baseNotes.has(other.slug) || noteLinksBySlug.get(other.slug)?.has(slug)) {
      score += 3;
      reasons.push("Note link");
    }
    if (score === 0 && baseObj?.session && other.session && baseObj.session.day === other.session.day && baseObj.session.room_id === other.session.room_id) {
      score += 1;
      reasons.push("Same day & room");
    }
    if (score > 0) {
      scored.push({
        slug: other.slug,
        title: other.title,
        speakers: shortSpeakers(other.slug),
        when: other.session ? `${day(new Date(other.session.starts_at))} · ${clock(new Date(other.session.starts_at))}` : "",
        thesis: thesis.get(other.slug) ?? "",
        storyHref: talkHref(other.slug, ""),
        hubHref: hubHref(other.slug, ""),
        reasons: reasons.slice(0, 3),
        score,
      });
    }
  }

  return scored
    .sort((a, b) => b.score - a.score || (talkBySlug.get(b.slug)?.session?.starts_at ?? "").localeCompare(talkBySlug.get(a.slug)?.session?.starts_at ?? ""))
    .slice(0, limit);
};

// --- Artifacts per talk, linked to the hub's own sections.
type State = "built" | "pending";
interface Artifact { name: string; state: State; anchor: string; note?: string }
// A talk can carry more than one story: extra pages sit beside page.html in experience/.
const extraPages = (slug: string): { href: string; title: string }[] =>
  list(`talks/${slug}/experience`).filter((f) => f.endsWith(".html") && f !== "page.html" && f !== "index.html")
    .map((f) => `talks/${slug}/experience/${f}`)
    .map((f) => ({ href: f, title: (read(f).match(/<title>([^<]*)<\/title>/)?.[1] ?? f).split(" · ")[0]!.trim() }));
const artifacts = (t: Talk): Artifact[] => {
  const p = `talks/${t.slug}`;
  const photos = list(`${p}/photos`).length;
  const story = exists(`${p}/story.md`) ? read(`${p}/story.md`) : "";
  const transcript = exists(`${p}/transcript.md`) ? read(`${p}/transcript.md`) : "";
  return [
    { name: "Recording", state: t.recordings.length ? "built" : "pending", anchor: "recording", note: t.recordings.length ? `${t.recordings.reduce((n, r) => n + r.minutes, 0)} min` : undefined },
    { name: "Transcript", state: transcript ? "built" : "pending", anchor: "transcript", note: transcript ? front(transcript, "source") : undefined },
    { name: "Links", state: exists(`${p}/links.md`) ? "built" : "pending", anchor: "links" },
    { name: "Photos", state: photos ? "built" : "pending", anchor: "photos", note: photos ? `${photos}` : undefined },
    { name: "Notes", state: t.notes.length ? "built" : "pending", anchor: "notes", note: t.notes.length ? `${t.notes.length}` : undefined },
    { name: "Story", state: story ? "built" : "pending", anchor: "story", note: front(story, "status") },
    { name: "Talk page", state: pagePath(t.slug) ? "built" : "pending", anchor: "story" },
  ];
};
const builtCount = (t: Talk): number => artifacts(t).filter((a) => a.state === "built").length;

// --- People: one row per speaker, with X intent links.
const followHref = (h: string): string => `https://x.com/intent/follow?screen_name=${encodeURIComponent(h)}`;
const writeHref = (h: string, title: string | null): string =>
  `https://x.com/intent/post?text=${encodeURIComponent(title ? `@${h} ${P.share_text ?? "Enjoyed your talk"} "${title}" at ${wm.event.name}. ` : `@${h} `)}`;
const speakerSessions = (id: string): Session[] =>
  wm.program.sessions.filter((s) => s.speaker_ids.includes(id)).sort((a, b) => a.starts_at.localeCompare(b.starts_at));
// Talk dossiers sometimes find a handle the roster lacks.
const dossierHandles = new Map<string, string>();
for (const t of captured) {
  if (!exists(`talks/${t.slug}/links.md`) || !t.session) continue;
  const handles = [...read(`talks/${t.slug}/links.md`).matchAll(/https?:\/\/(?:x|twitter)\.com\/@?([A-Za-z0-9_]{1,15})/g)].map((m) => m[1]!);
  if (t.session.speaker_ids.length === 1 && handles[0]) dossierHandles.set(t.session.speaker_ids[0]!, handles[0]);
}
const handleFor = (id: string): string | null => xHandle(wm.speakers[id]?.links ?? []) ?? dossierHandles.get(id) ?? null;

const personCard = (id: string, up: string, heard: Session | null): string => {
  const p = wm.speakers[id]!;
  const h = handleFor(id);
  const sessions = speakerSessions(id);
  const s = heard ?? sessions[0] ?? null;
  const seen = new Set<string>();
  const others = p.links.filter((l) => !/(x|twitter)\.com/.test(l)).filter((l) => {
    const k = l.replace(/^https?:\/\/(www\.)?/, "").replace(/\/+$/, "").toLowerCase();
    return seen.has(k) ? false : (seen.add(k), true);
  });
  const talkLine = s
    ? capturedSessionIds.has(s.session_id)
      ? `<a href="${hubHref(slugBySession.get(s.session_id) ?? sessionSlug(s), up)}">${esc(s.title)}</a>`
      : `${esc(s.title)} <span class="minor">· ${esc(day(new Date(s.starts_at)))} ${esc(clock(new Date(s.starts_at)))}</span>`
    : "";
  return `<div class="person" data-search="${esc(`${p.name} ${p.affiliation ?? ""} ${h ?? ""} ${s?.title ?? ""}`.toLowerCase())}">
    <div class="who"><b>${esc(p.name)}</b>${p.affiliation ? ` <span class="minor">${esc(p.affiliation)}</span>` : ""}<div class="talkline">${talkLine}</div></div>
    <div class="acts">${h
      ? `<a class="btn" href="${followHref(h)}" target="_blank" rel="noopener">Follow @${esc(h)}</a><a class="btn ghost" href="${writeHref(h, heard ? heard.title : null)}" target="_blank" rel="noopener">Write</a><label class="done"><input type="checkbox" data-handle="${esc(h)}"> followed</label>`
      : `<span class="minor">no X handle found</span>`}${others.map((l) => `<a class="ext" href="${esc(l)}" target="_blank" rel="noopener">${esc(linkLabel(l))}</a>`).join("")}</div>
  </div>`;
};

// --- Page shell.
const shell = (o: { title: string; active: Section | null; up: string; body: string; style?: string; script?: string }): string => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(o.title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;600;700&display=swap">
<link rel="stylesheet" href="${o.up}site/theme.css">
<link rel="stylesheet" href="${o.up}site/nav.css">
<link rel="stylesheet" href="${o.up}site/explorer.css">
<link rel="stylesheet" href="${o.up}site/pages.css">
${o.style ? `<style>${o.style}</style>` : ""}
</head>
<body>
${topnav(o.active, o.up, NAV)}
<div class="sheet">
${o.body}
</div>
<script src="${o.up}site/xref.js" defer></script>
<script src="${o.up}site/explorer.js" defer></script>
${o.script ? `<script>${o.script}</script>` : ""}
</body>
</html>
`;
const generatedAt = new Date().toLocaleString("en-US", { timeZone: TZ, dateStyle: "medium", timeStyle: "short" });
const pills = (t: Talk, up: string): string => artifacts(t).map((a) =>
  `<a class="pill ${a.state === "built" ? "call-go" : "call-skip"}" href="${a.name === "Talk page" && a.state === "built" ? talkHref(t.slug, up) : `${hubHref(t.slug, up)}#${a.anchor}`}">${a.name}${a.note ? ` · ${esc(a.note)}` : ""}</a>`).join("");
const whenLine = (s: Session | null): string => (s ? `${day(new Date(s.starts_at))} · ${clock(new Date(s.starts_at))}–${clock(new Date(s.ends_at))} · ${roomName(s)}` : "");
const speakerNames = (s: Session | null): string =>
  s ? s.speaker_ids.map((id) => wm.speakers[id]).filter(Boolean).map((p) => [p!.name, p!.affiliation].filter(Boolean).join(", ")).join(" · ") : "";
const noteTime = (n: Note): string => (n.at ? clock(new Date(n.at)) : n.file.slice(11, 15));
const firstLine = (s: string, n = 110): string => { const l = s.split("\n")[0] ?? ""; return l.length > n ? `${l.slice(0, n)}…` : l; };

// Ticks for "followed" and the people filter, kept in this browser only.
const PEOPLE_JS = `(function(){
  var key="aie-followed";var done={};try{done=JSON.parse(localStorage.getItem(key)||"{}")}catch(e){}
  document.querySelectorAll('input[data-handle]').forEach(function(b){
    var h=b.getAttribute('data-handle').toLowerCase();b.checked=!!done[h];
    b.closest('.person').classList.toggle('is-done',b.checked);
    b.addEventListener('change',function(){done[h]=b.checked;b.closest('.person').classList.toggle('is-done',b.checked);try{localStorage.setItem(key,JSON.stringify(done))}catch(e){}});
  });
  var q=document.getElementById('find');if(q)q.addEventListener('input',function(){var v=q.value.trim().toLowerCase();
    document.querySelectorAll('.person[data-search]').forEach(function(p){p.hidden=v&&p.getAttribute('data-search').indexOf(v)<0});});
})();`;

// On a hub, a link to #transcript or #story opens that section's collapsed text.
const HUB_JS = `(function(){function open(){var t=location.hash&&document.getElementById(location.hash.slice(1));var d=t&&t.querySelector('details');if(d){d.open=true;t.scrollIntoView()}}open();addEventListener('hashchange',open)})();`;

// ===== Emit site/xref.js (shared across all talk stories, theme deep dives & master presentation) =====
const talkContestedMap = new Map<string, Array<{ question: string; stance: string; peers: Array<{ slug: string; title: string; speakers: string; stance: string; storyHref: string; hubHref: string }> }>>();
for (const slug of captured.map((t) => t.slug)) talkContestedMap.set(slug, []);
for (const q of contestedList) {
  for (const side of q.sides) {
    if (!side.slug || !talkContestedMap.has(side.slug)) continue;
    const peers = q.sides
      .filter((other) => other.slug && other.slug !== side.slug)
      .map((other) => ({
        slug: other.slug!,
        title: other.title,
        speakers: other.speakers,
        stance: other.stance,
        storyHref: talkHref(other.slug!, ""),
        hubHref: hubHref(other.slug!, ""),
      }));
    talkContestedMap.get(side.slug)!.push({ question: q.question, stance: side.stance, peers });
  }
}

{
  const xrefTalks: Record<string, {
    slug: string; title: string; speakers: string; when: string; thesis: string;
    storyHref: string; hubHref: string; themeIds: string[];
    leadImage: string | null; minutes: number; photoCount: number; noteCount: number; builtCount: number;
    contested: ReturnType<typeof talkContestedMap.get>;
    related: RelatedTalk[];
  }> = {};
  for (const t of captured) {
    const p = `talks/${t.slug}`;
    xrefTalks[t.slug] = {
      slug: t.slug,
      title: t.title,
      speakers: shortSpeakers(t.slug),
      when: whenLine(t.session),
      thesis: thesis.get(t.slug) ?? "",
      storyHref: talkHref(t.slug, ""),
      hubHref: hubHref(t.slug, ""),
      themeIds: themesForSlug(t.slug).map((th) => th.id),
      leadImage: leadSlideImage(t.slug),
      minutes: t.recordings.reduce((n, r) => n + r.minutes, 0),
      photoCount: list(`${p}/photos`).filter((f) => /\.(jpe?g|png|webp|heic)$/i.test(f)).length,
      noteCount: t.notes.length,
      builtCount: builtCount(t),
      contested: talkContestedMap.get(t.slug) ?? [],
      related: relatedFor(t.slug, 5),
    };
  }
  const xrefPayload = {
    nav: { brand: NAV.brand, badge: NAV.badge, phase: NAV.phase, items: NAV.items.map(([key, label, href]) => ({ key, label, href })) },
    masterPresentation: {
      slug: "conference-themes",
      title: SYNTH_TITLE(),
      subtitle: `How all ${themes.length} conference themes fit together across ${corpusMeta.talk_count ?? captured.length} talks`,
      href: masterThemesRel,
    },
    themes: themes.map((th) => {
      const sortedSlugs = [...th.slugs].sort((a, b) =>
        (talkBySlug.get(a)?.session?.starts_at ?? "").localeCompare(talkBySlug.get(b)?.session?.starts_at ?? ""),
      );
      const leadClaim = th.claims.find((c) => c.quote && c.quote.trim().length > 0) ?? null;
      return {
        num: th.num,
        id: th.id,
        name: th.name,
        claim: th.claim,
        definition: th.definition,
        alsoCalled: th.alsoCalled,
        talkCount: th.slugs.size,
        claimCount: th.claims.length,
        counterCount: th.counters.length,
        whyUncontested: th.whyUncontested,
        leadSlide: THEME_SLIDES[th.id] ?? null,
        clayVisual: THEME_CLAY[th.id] ?? null,
        featuredQuote: leadClaim
          ? {
              quote: leadClaim.quote,
              speaker: leadClaim.speakers,
              title: leadClaim.title,
              slug: leadClaim.slug,
              section: leadClaim.section,
            }
          : null,
        talkSlugs: sortedSlugs,
        topSpeakers: [...new Set(sortedSlugs.map((sl) => shortSpeakers(sl).split(",")[0]?.trim()).filter(Boolean))].slice(0, 4),
        deepDiveHref: themeDeepDiveRel(th.id),
        hubAnchor: `index.html#${th.id}`,
      };
    }),
    contested: contestedList,
    talks: xrefTalks,
    scheduleOrder: captured.map((t) => ({
      slug: t.slug,
      title: t.title,
      speakers: shortSpeakers(t.slug),
      storyHref: talkHref(t.slug, ""),
      hubHref: hubHref(t.slug, ""),
    })),
  };
  write("site/xref.js", `window.__AIE_XREF__ = ${JSON.stringify(xrefPayload).replace(/</g, "\\u003c")};\n`);
}

// ===== Talk hubs (Z4 Raw Evidence & Dossier) =====
const themeChips = (slug: string, up: string): string =>
  themesForSlug(slug).map((th) =>
    `<a class="chip" href="${up}${themeDeepDiveRel(th.id)}" title="Open Theme ${th.num} deep dive presentation">Theme ${th.num}: ${esc(th.name)} →</a><a class="chip hash" href="${up}index.html#${th.id}" title="Jump to Theme ${th.num} claims on Summit hub">#</a>`
  ).join("");

for (let ti = 0; ti < captured.length; ti++) {
  const t = captured[ti]!;
  const prevT = ti > 0 ? captured[ti - 1]! : null;
  const nextT = ti + 1 < captured.length ? captured[ti + 1]! : null;
  const up = "../../";
  const p = `talks/${t.slug}`;
  const s = t.session;
  const page = pagePath(t.slug);
  const photos = list(`${p}/photos`).filter((f) => /\.(jpe?g|png|webp|heic)$/i.test(f));
  const storyMd = exists(`${p}/story.md`) ? read(`${p}/story.md`) : "";
  const transcriptMd = exists(`${p}/transcript.md`) ? read(`${p}/transcript.md`) : "";
  const linksMd = exists(`${p}/links.md`) ? stripFront(read(`${p}/links.md`)).replace(/^# .*\n/m, "") : "";
  const people = s ? s.speaker_ids.filter((id) => wm.speakers[id]) : [];
  const tThemes = themesForSlug(t.slug);
  const tContested = talkContestedMap.get(t.slug) ?? [];
  const tRelated = relatedFor(t.slug, 5);
  const body = `
  <header class="masthead hub">
    <p class="mono agency">${esc(whenLine(s))}</p>
    <h1>${esc(t.title)}</h1>
    ${s ? `<p class="speakers">${esc(speakerNames(s))}</p>` : ""}
    ${thesis.get(t.slug) ? `<p class="sub">${esc(thesis.get(t.slug)!)}</p>` : ""}
  </header>
  <div class="marginalia mono"><span><a href="index.html">← All talks</a>${prevT ? ` · <a href="${hubHref(prevT.slug, up)}" title="${esc(prevT.title)}">← Prev talk</a>` : ""}${nextT ? ` · <a href="${hubHref(nextT.slug, up)}" title="${esc(nextT.title)}">Next talk →</a>` : ""}</span><span>${builtCount(t)} of 7 built · Z4 Evidence Hub</span></div>
  ${page ? `<div class="hub-zoom-banner"><div class="hzb-copy"><span class="mono">Level 4 · Raw Evidence &amp; Dossier</span><strong class="hzb-title">Want the visual narrative with stage slides?</strong></div><div class="card-acts"><a class="cta small" href="${up}${page}">↖ Zoom up to Talk Story →</a>${watchLink(s, "cta small ghost")}</div></div>` : ""}
  <div class="pills" style="margin-top:.85rem">${pills(t, up)}</div>
  ${extraPages(t.slug).map((e) => `<a class="cta small" style="margin-top:.6rem" href="${up}${e.href}">Also: ${esc(e.title)} →</a>`).join("")}
  <div class="chips"><span class="mono">Themes</span>${themeChips(t.slug, up) || `<span class="minor">Unassigned</span>`}<a class="chip" href="${up}${masterThemesRel}">Themes presentation →</a></div>

  ${people.length ? `<section class="view" id="people"><div class="view-head"><h2>Speaker${people.length > 1 ? "s" : ""}</h2></div>
    <div class="people">${people.map((id) => personCard(id, up, s)).join("")}</div></section>` : ""}

  <section class="view" id="notes"><div class="view-head"><h2>My notes</h2><p class="lede">${t.notes.length ? `${t.notes.length} captured during the talk.` : "None captured."}</p></div>
    ${t.notes.length ? `<ol class="notes">${[...t.notes].sort((a, b) => a.file.localeCompare(b.file)).map((n) =>
      `<li><span class="mono">${esc(noteTime(n))} · ${esc(n.kind)}</span><div class="prose">${md(n.body)}</div></li>`).join("")}</ol>` : ""}
  </section>

  <section class="view" id="photos"><div class="view-head"><h2>Photos</h2><p class="lede">${photos.length ? `${photos.length} filed.` : "None filed."}</p></div>
    ${photos.length ? `<div class="photos">${photos.map((f) => `<a href="${up}${p}/photos/${esc(f)}"><img loading="lazy" src="${up}${p}/photos/${esc(f)}" alt="Photo taken during the talk, ${esc(f)}"></a>`).join("")}</div>` : ""}
  </section>

  <section class="view" id="recording"><div class="view-head"><h2>Recording</h2><p class="lede">${t.recordings.length ? "My Voice Memos from the room." : "None synced."}${s && livestream(s) ? ` The public livestream: <a href="${esc(livestream(s)!.url)}" rel="noopener">YouTube, around ${livestream(s)!.at}</a> (approximate).` : ""}</p></div>
    ${t.recordings.map((r) => `<div class="rec"><span class="mono">${esc(r.folder)} · ${r.minutes} min · ${esc(r.source)}</span>${r.audio ? `<audio controls preload="none" src="${up}${esc(r.audio)}"></audio>` : ""}</div>`).join("")}
  </section>

  <section class="view" id="story"><div class="view-head"><h2>Story</h2><p class="lede">${page ? `<a href="${up}${page}">The scrolling talk page</a> is built.${extraPages(t.slug).length ? ` Also: ${extraPages(t.slug).map((e) => `<a href="${up}${e.href}">${esc(e.title)}</a>`).join(", ")}.` : ""}` : storyMd ? "A draft story, not yet a page." : "Not written yet."}</p></div>
    ${storyMd && !page ? `<details><summary>Read the draft</summary><div class="prose">${md(stripFront(storyMd))}</div></details>` : ""}
  </section>

  <section class="view" id="related">
    <div class="view-head"><h2>Themes & related talks</h2><p class="lede">Cross-references across the ${themes.length} conference themes, contested debates, and connected talks.</p></div>
    <div class="rel-grid">
      ${tThemes.map((th) => `<article class="rel-card is-theme"><div><span class="mono">Theme ${th.num} · ${th.slugs.size} talks</span><b><a href="${up}${themeDeepDiveRel(th.id)}">${esc(th.name)}</a></b><p>${esc(th.claim)}</p></div><div class="card-acts"><a href="${up}${themeDeepDiveRel(th.id)}">Open deep dive →</a><a href="${up}index.html#${th.id}">Claims</a></div></article>`).join("")}
      ${tContested.map((c) => `<article class="rel-card is-contested"><div><span class="mono">Contested fault line</span><b>${esc(c.question)}</b><p>Here: ${esc(c.stance)}</p></div><div class="card-acts">${c.peers.map((peer) => `<a href="${up}${peer.storyHref}">Compare: ${esc(peer.speakers || peer.title)} →</a>`).join("")}<a href="${up}index.html#contested">Debate</a></div></article>`).join("")}
      ${tRelated.map((r) => {
        const img = leadSlideImage(r.slug);
        return `<article class="rel-card">${img ? `<a class="rel-thumb" href="${up}${r.storyHref}"><img loading="lazy" src="${up}${img}" alt=""></a>` : ""}<div><span class="mono">${esc(r.speakers || "Speaker")}${r.reasons.length ? ` · ${esc(r.reasons[0]!)}` : ""}</span><b><a href="${up}${r.storyHref}">${esc(r.title)}</a></b>${r.thesis ? `<p>${esc(firstLine(r.thesis, 140))}</p>` : ""}</div><div class="card-acts"><a href="${up}${r.storyHref}">Read story →</a><a href="${up}${r.hubHref}">Evidence hub</a></div></article>`;
      }).join("")}
    </div>
  </section>

  ${linksMd ? `<section class="view" id="links"><div class="view-head"><h2>Links and resources</h2></div><div class="prose">${md(linksMd)}</div></section>` : `<section class="view" id="links"><div class="view-head"><h2>Links</h2><p class="lede">No dossier yet.</p></div></section>`}

  <section class="view" id="transcript"><div class="view-head"><h2>Transcript</h2><p class="lede">${transcriptMd ? `Machine transcript (${esc(front(transcriptMd, "source") ?? "ASR")}). Garbled words are kept as heard.` : "Not transcribed yet."}</p></div>
    ${transcriptMd ? `<details><summary>Read the transcript</summary><div class="prose transcript">${md(stripFront(transcriptMd))}</div></details>` : ""}
  </section>
  <p class="colophon mono">Generated ${esc(generatedAt)} · bun scripts/render-pages.ts</p>`;
  write(`site/talks/${t.slug}.html`, shell({ title: t.title, active: "talks", up, body, script: PEOPLE_JS + HUB_JS }));
}

// ===== Talks index (Z3 Directory) =====
{
  const up = "../../";
  const initials = (name: string): string =>
    name.split(/[\s,]+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "AI";
  const card = (t: Talk): string => {
    const n = builtCount(t);
    const tThemes = themesForSlug(t.slug);
    const spk = shortSpeakers(t.slug);
    const slide = leadSlideImage(t.slug);
    const mins = t.recordings.reduce((acc, r) => acc + r.minutes, 0);
    const pCount = list(`talks/${t.slug}/photos`).filter((f) => /\.(jpe?g|png|webp|heic)$/i.test(f)).length;
    const plate = slide
      ? `<a class="talk-plate" href="${talkHref(t.slug, up)}"><img loading="lazy" src="${up}${slide}" alt="Slide from ${esc(t.title)}"><span class="talk-plate-badge">${esc(t.session ? day(new Date(t.session.starts_at)) : "Talk")}</span></a>`
      : `<a class="talk-plate is-typo" href="${talkHref(t.slug, up)}"><span class="tp-mono">${esc(initials(spk || t.title))}</span><span class="tp-lbl">${esc(spk || roomName(t.session!) || "Stage Talk")}</span></a>`;
    const themeChipsHtml = tThemes.length
      ? `<div class="card-themes">${tThemes.map((th) => `<a class="chip mini" href="${up}${themeDeepDiveRel(th.id)}" title="${esc(th.claim)}">${esc(th.name)}</a>`).join("")}</div>`
      : "";
    const evParts = [
      mins ? `${mins} min` : null,
      pCount ? `${pCount} photo${pCount === 1 ? "" : "s"}` : null,
      t.notes.length ? `${t.notes.length} note${t.notes.length === 1 ? "" : "s"}` : null,
      `${n}/7 built`,
    ].filter(Boolean);
    const searchHay = `${t.title} ${spk} ${thesis.get(t.slug) ?? ""} ${tThemes.map((x) => x.name).join(" ")}`.toLowerCase();
    return `<article class="talk-card" data-themes="${esc(tThemes.map((th) => th.id).join(" "))}" data-search="${esc(searchHay)}">
      <div>
        ${plate}
        <div class="talk-card-body">
          <div class="mono">${esc(whenLine(t.session))}</div>
          <h3><a href="${talkHref(t.slug, up)}">${esc(t.title)}</a></h3>
          ${t.session ? `<p class="speakers">${esc(speakerNames(t.session))}</p>` : ""}
          ${thesis.get(t.slug) ? `<p class="thesis">${esc(thesis.get(t.slug)!)}</p>` : ""}
          ${themeChipsHtml}
        </div>
      </div>
      <div class="talk-card-foot">
        <div class="talk-evidence-line"><span>${esc(evParts.join(" · "))}</span></div>
        <div class="card-acts">${pagePath(t.slug) ? `<a class="cta small" href="${talkHref(t.slug, up)}">Read the story →</a><a href="${t.slug}.html">Evidence hub</a>` : `<a class="cta small ghost" href="${t.slug}.html">Evidence hub →</a>`}${watchLink(t.session)}</div>
      </div>
    </article>`;
  };
  // Grouped by day, in time order within each day; talks with no session go last.
  const byDay = new Map<string, Talk[]>();
  for (const t of captured) {
    const k = t.session ? t.session.starts_at.slice(0, 10) : "unscheduled";
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k)!.push(t);
  }
  const cards = [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([d, ts]) => {
    const label = d === "unscheduled" ? "Unscheduled" : new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: TZ, weekday: "long", month: "long", day: "numeric" });
    return `<section class="view day-group" id="day-${d}"><div class="view-head"><h2>${esc(label)}</h2><p class="lede"><span class="day-count">${ts.length} talk${ts.length === 1 ? "" : "s"}</span></p></div><div class="blocks">${ts.map(card).join("\n")}</div></section>`;
  }).join("\n");
  const filterButtons = `<div class="talks-toolbar"><input id="talksearch" class="talks-search" type="search" placeholder="Filter talks by title, speaker, or idea…" aria-label="Filter talks"><div class="roomfilter" id="themefilter"><button type="button" data-theme="all" aria-pressed="true">All talks (${captured.length})</button>${themes.map((th) => `<button type="button" data-theme="${th.id}" aria-pressed="false">${esc(th.name)} (${th.slugs.size})</button>`).join("")}</div></div>`;
  const filterJs = `(function(){
    var f=document.getElementById('themefilter');
    var qEl=document.getElementById('talksearch');
    var activeTheme='all';
    var qVal='';
    function apply(){
      var tokens=qVal?qVal.toLowerCase().split(/\\s+/).filter(Boolean):[];
      document.querySelectorAll('.day-group').forEach(function(g){
        var vis=0;
        g.querySelectorAll('article.talk-card').forEach(function(c){
          var list=(c.getAttribute('data-themes')||'').split(' ');
          var hay=c.getAttribute('data-search')||'';
          var okTheme=activeTheme==='all'||list.indexOf(activeTheme)>=0;
          var okQ=!tokens.length||tokens.every(function(tok){return hay.indexOf(tok)>=0});
          var ok=okTheme&&okQ;
          c.hidden=!ok;
          if(ok)vis++;
        });
        g.hidden=vis===0;
        var dc=g.querySelector('.day-count');
        if(dc)dc.textContent=vis+(vis===1?' talk':' talks');
      });
    }
    function setTheme(id){
      activeTheme=id||'all';
      if(f)f.querySelectorAll('button[data-theme]').forEach(function(x){
        x.setAttribute('aria-pressed',String(x.getAttribute('data-theme')===activeTheme));
      });
      apply();
    }
    if(f){
      f.addEventListener('click',function(e){
        var b=e.target.closest('button[data-theme]');
        if(!b)return;
        setTheme(b.getAttribute('data-theme'));
      });
    }
    if(qEl){
      qEl.addEventListener('input',function(){qVal=qEl.value.trim();apply()});
    }
    try{
      var qt=new URLSearchParams(location.search).get('theme');
      if(qt&&f&&f.querySelector('button[data-theme="'+qt+'"]'))setTheme(qt);
    }catch(e){}
  })();`;
  const body = `
  <header class="masthead"><p class="mono agency">${esc(wm.event.name)} · Z3 Talk Directory</p><h1>Talks</h1><p class="sub">Every recorded talk with straightened stage slides, interactive stories, and evidence dossiers linked across all ${themes.length} themes.</p></header>
  <div class="marginalia mono"><span>${captured.length} talks · ${themes.length} themes</span><a href="${up}${masterThemesRel}">Themes presentation →</a></div>
  ${filterButtons}
  ${cards}`;
  write("site/talks/index.html", shell({ title: "Talks", active: "talks", up, body, script: filterJs }));
}

// ===== Themes Explorer (Z1 Summit Root — written to BOTH index.html & site/themes.html) =====
function renderThemesExplorer(up: string): string {
  const totalClaims = claimById.size || themes.reduce((acc, th) => acc + th.claims.length, 0) || 191;
  const maxClaims = Math.max(...themes.map((th) => th.claims.length), 1);

  const renderClaimCard = (c: ResolvedClaim, themeId: string): string => {
    const storyUrl = `${talkHref(c.slug, up)}?from=${encodeURIComponent(themeId)}`;
    const transcriptUrl = `${hubHref(c.slug, up)}#transcript`;
    return `<li class="claim-card"><div class="claim-text">${esc(c.claim)}</div>${c.quote ? `<blockquote class="cl-quote">“${esc(c.quote)}”</blockquote>` : ""}<div class="cl-cite"><a href="${storyUrl}">${esc(c.title)}</a><span><span class="minor">${esc(c.speakers)}</span> · <a class="mono" href="${transcriptUrl}">${esc(c.section || "transcript")}</a></span></div></li>`;
  };

  const hero = `
  <section class="summit-hero" aria-label="Summit overview">
    <div class="summit-hero-main">
      <div class="summit-hero-top">
        <span class="mono">${esc(wm.event.name)}${(P.dates_label ?? dateRange()) ? ` · ${esc(P.dates_label ?? dateRange())}` : ""} · Synthesis</span>
        <h1>${esc(SYNTH_TITLE())}</h1>
        <p class="sub">${esc(P.summary ?? `Across ${corpusMeta.talk_count ?? captured.length} recorded talks${corpusMeta.word_count ? `, ${corpusMeta.word_count.toLocaleString("en-US")} spoken words,` : ""} and ${totalClaims} transcript-verified claims, these are the ${themes.length} themes the conference kept returning to.`)}</p>
      </div>
      <div class="summit-stats">
        <div class="stat-tile"><span class="mono">Corpus</span><strong>${corpusMeta.talk_count ?? captured.length}</strong><span class="minor">Recorded talks</span></div>
        <div class="stat-tile"><span class="mono">Evidence</span><strong>${totalClaims}</strong><span class="minor">Transcript claims</span></div>
        <div class="stat-tile"><span class="mono">Synthesis</span><strong>${themes.length}</strong><span class="minor">Research themes</span></div>
        <div class="stat-tile"><span class="mono">Tension</span><strong>${contestedList.length}</strong><span class="minor">Contested debates</span></div>
      </div>
      <div class="card-acts">
        <a class="cta" href="${up}${masterThemesRel}">Launch Guided Presentation →</a>
        <a class="cta ghost" href="#stack-explorer">Explore the ${themes.length} themes ↓</a>
        <a class="cta ghost" href="${up}site/talks/index.html">Browse All ${captured.length} Talks →</a>
        <a class="cta ghost" href="#contested">${contestedList.length} Contested Debates ↓</a>
      </div>
    </div>
    ${HERO_CLAY ? `<figure class="hero-clay-frame">
      <div class="clay-vitrine">
        <img src="${up}${HERO_CLAY.src}" alt="${esc(HERO_CLAY.alt)}" width="1280" height="720" fetchpriority="high" decoding="async">
      </div>
      <figcaption class="clay-cap mono"><span>${esc(HERO_CLAY.caption)}</span><span>${corpusMeta.talk_count ?? captured.length} talks · ${totalClaims} claims</span></figcaption>
    </figure>` : ""}
  </section>`;

  // The stack is drawn top-down from the last theme to the first (themes.md order).
  const stackOrder = [...themes].reverse();
  const defaultLayerId = themes[0]?.id ?? "";

  const layerButtons = stackOrder.map((th) => {
    const isSel = th.id === defaultLayerId;
    const pct = Math.max(18, Math.round((th.claims.length / maxClaims) * 100));
    const clay = THEME_CLAY[th.id];
    const slide = THEME_SLIDES[th.id];
    const thumbSrc = clay?.src ?? slide?.src ?? "";
    return `<button type="button" class="stack-layer" role="tab" data-layer="${th.id}" aria-selected="${isSel}">
      ${thumbSrc ? `<span class="sl-thumb"><img src="${up}${thumbSrc}" alt="" loading="lazy" width="160" height="90"></span>` : ""}
      <div class="sl-main">
        <div class="sl-top"><span class="sl-num">${esc(STACK.unit)} ${th.num}</span><span class="sl-count">${th.slugs.size} talks · ${th.claims.length} claims</span></div>
        <div class="sl-name">${esc(th.name)}</div>
        <div class="sl-bar"><i style="width:${pct}%"></i></div>
      </div>
    </button>`;
  }).join("\n");

  const stagePanels = themes.map((th) => {
    const slide = THEME_SLIDES[th.id];
    const clay = THEME_CLAY[th.id];
    const deepHref = `${up}${themeDeepDiveRel(th.id)}`;
    const leadClaim = th.claims.find((c) => c.quote && c.quote.trim().length > 0);
    const sortedSlugs = [...th.slugs].sort((a, b) =>
      (talkBySlug.get(a)?.session?.starts_at ?? "").localeCompare(talkBySlug.get(b)?.session?.starts_at ?? ""),
    );
    const previewPills = sortedSlugs.slice(0, 6).map((slug) => {
      const spk = shortSpeakers(slug).split(",")[0]?.trim() || talkBySlug.get(slug)?.title || slug;
      return `<a class="chip mini" href="${talkHref(slug, up)}?from=${encodeURIComponent(th.id)}">${esc(spk)}</a>`;
    }).join("");
    const extraTalksCount = Math.max(0, sortedSlugs.length - 6);
    const statusLabel = th.counters.length ? `${th.counters.length} counter-claim${th.counters.length === 1 ? "" : "s"}` : "Uncontested";
    const primarySrc = clay ? `${up}${clay.src}` : slide ? `${up}${slide.src}` : "";
    const primaryAlt = clay ? clay.alt : slide ? slide.alt : "";
    const primaryCap = clay ? clay.caption : slide ? `Stage slide · ${slide.speaker}` : "";
    const mediaAttrs = [
      clay ? `data-clay-src="${up}${clay.src}" data-clay-alt="${esc(clay.alt)}" data-clay-cap="${esc(clay.caption)}"` : "",
      slide ? `data-slide-src="${up}${slide.src}" data-slide-alt="${esc(slide.alt)}" data-slide-cap="Stage slide · ${esc(slide.speaker)}"` : "",
    ].filter(Boolean).join(" ");

    return `<article class="stage-panel" data-panel="${th.id}"${th.id === defaultLayerId ? "" : " hidden"}>
      ${primarySrc ? `<div class="stage-media" ${mediaAttrs}><img src="${primarySrc}" alt="${esc(primaryAlt)}" width="1280" height="720" loading="lazy" decoding="async"><div class="stage-media-cap"><span class="sm-caption">${esc(primaryCap)}</span>${slide ? `<div class="stage-view-switch" role="group" aria-label="Stage visual mode"><button type="button" data-stage-mode="clay" aria-pressed="true">Clay model</button><button type="button" data-stage-mode="slide" aria-pressed="false">Room slide</button><a class="sm-talk-link" href="${talkHref(slide.slug, up)}?from=${encodeURIComponent(th.id)}">Open talk →</a></div>` : ""}</div></div>` : ""}
      <div class="stage-body">
        <div class="stage-kicker"><span class="mono">${esc(STACK.unit)} ${th.num} of ${String(themes.length).padStart(2, "0")} · ${th.slugs.size} talks · ${th.claims.length} claims</span><span class="pill ${th.counters.length ? "call-maybe" : "call-go"}">${esc(statusLabel)}</span></div>
        <h3>${esc(th.name)}</h3>
        <p class="stage-claim">${esc(th.claim)}</p>
        ${th.definition ? `<p class="stage-def">${esc(th.definition)}</p>` : ""}
        ${leadClaim ? `<blockquote class="stage-quote">“${esc(leadClaim.quote)}”<cite>${esc(leadClaim.speakers)} · <a href="${talkHref(leadClaim.slug, up)}?from=${encodeURIComponent(th.id)}">${esc(leadClaim.title)}</a> · ${esc(leadClaim.section)}</cite></blockquote>` : ""}
        <div class="stage-talks"><span class="mono">Key talks</span>${previewPills}${extraTalksCount ? `<a class="chip mini hash" href="${deepHref}#talks-in-theme">+${extraTalksCount} more</a>` : ""}</div>
        <div class="card-acts">
          <a class="cta small" href="${deepHref}">Zoom into Theme ${th.num} Deep Dive →</a>
          <a class="cta small ghost" href="#${th.id}" data-jump-theme="${th.id}">Inspect all ${th.claims.length} claims ↓</a>
        </div>
      </div>
    </article>`;
  }).join("\n");

  const stackSection = `
  <section class="view" id="stack-explorer">
    <div class="view-head">
      <h2>${esc(STACK.title)}</h2>
      <p class="lede">${esc(STACK.lede)}</p>
    </div>
    <div class="stack-workbench">
      <div class="stack-col">
        ${STACK.axisTop ? `<div class="stack-axis"><span>↑ ${esc(STACK.axisTop)}</span></div>` : ""}
        <div class="stack-layers" role="tablist" aria-label="${themes.length} conference themes">${layerButtons}</div>
        ${STACK.axisBottom ? `<div class="stack-axis"><span>↓ ${esc(STACK.axisBottom)}</span></div>` : ""}
      </div>
      <div class="stack-stage" aria-live="polite">${stagePanels}</div>
    </div>
  </section>`;

  const themeCards = themes.map((th) => {
    const deepHref = `${up}${themeDeepDiveRel(th.id)}`;
    const slide = THEME_SLIDES[th.id];
    const clay = THEME_CLAY[th.id];
    const plateSrc = clay ? `${up}${clay.src}` : slide ? `${up}${slide.src}` : "";
    const plateAlt = clay ? clay.alt : slide ? slide.alt : "";
    const sortedSlugs = [...th.slugs].sort((a, b) =>
      (talkBySlug.get(a)?.session?.starts_at ?? "").localeCompare(talkBySlug.get(b)?.session?.starts_at ?? ""),
    );
    const spkNames = [...new Set(sortedSlugs.map((sl) => shortSpeakers(sl).split(",")[0]?.trim()).filter(Boolean))];
    const spkLine = spkNames.length > 3 ? `${spkNames.slice(0, 3).join(", ")} +${spkNames.length - 3} more` : spkNames.join(", ");

    return `<article class="theme-card-v2">
      <div>
        ${plateSrc ? `<a class="tc-plate" href="${deepHref}"><img loading="lazy" decoding="async" width="1280" height="720" src="${plateSrc}" alt="${esc(plateAlt)}"><div class="tc-plate-overlay"><span class="tc-num">Theme ${th.num}</span><span class="tc-counts">${th.slugs.size} talks · ${th.claims.length} claims</span></div></a>` : ""}
        <div class="tc-body">
          <h3><a href="${deepHref}">${esc(th.name)}</a></h3>
          <p class="tc-claim">${esc(th.claim)}</p>
          ${spkLine ? `<div class="tc-speakers">${esc(spkLine)}</div>` : ""}
        </div>
      </div>
      <div class="tc-foot">
        <a class="tc-primary" href="${deepHref}">Zoom in: Deep dive →</a>
        <a href="#${th.id}" data-jump-theme="${th.id}">All ${th.claims.length} claims ↓</a>
      </div>
    </article>`;
  }).join("\n");

  const cardsSection = `
  <section class="view" id="all-themes">
    <div class="view-head">
      <h2>${esc(P.cards?.title ?? `${themes.length} themes`)}</h2>
      <p class="lede">${esc(P.cards?.lede ?? "Each theme opens into a deep dive: its claims with verbatim transcript quotes, the counter-claims, and the talks behind it.")}</p>
    </div>
    <div class="themes-grid">${themeCards}</div>
  </section>`;

  const contestedHtml = contestedList.length
    ? `<section class="view" id="contested"><div class="contested-showcase"><div class="contested-showcase-copy"><div class="view-head"><h2>Contested fault lines</h2><p class="lede">${contestedList.length} open disagreements where recorded talks pushed against one another directly.</p></div><div class="contested-jumps">${contestedList.map((q, qi) => `<a class="chip mini" href="#fault-${String(qi + 1).padStart(2, "0")}" title="${esc(q.question)}">Fault ${String(qi + 1).padStart(2, "0")}</a>`).join("")}</div></div>${CONTESTED_CLAY ? `<figure class="contested-clay-frame"><div class="clay-vitrine"><img src="${up}${CONTESTED_CLAY.src}" alt="${esc(CONTESTED_CLAY.alt)}" width="1280" height="720" loading="lazy" decoding="async"></div><figcaption class="clay-cap mono"><span>${esc(CONTESTED_CLAY.caption)}</span><span>Position A vs Position B</span></figcaption></figure>` : ""}</div><div class="contested-grid">${contestedList.map((q, qi) =>
        `<article class="contested-card" id="fault-${String(qi + 1).padStart(2, "0")}"><div><span class="mono">Fault line ${String(qi + 1).padStart(2, "0")}</span><h3>${esc(q.question)}</h3></div><ul class="stance-list">${q.sides.map((s, si) =>
          `<li class="stance-item"><div class="stance-head"><span class="stance-tag">Position ${String.fromCharCode(65 + si)} · ${esc(s.speakers || "Speaker")}</span>${s.slug ? `<span class="mono"><a href="${talkHref(s.slug, up)}">${esc(s.title)}</a> · <a href="${hubHref(s.slug, up)}#transcript">${esc(s.section || "transcript")}</a></span>` : ""}</div><span>${esc(s.stance)}</span></li>`
        ).join("")}</ul></article>`
      ).join("")}</div></section>`
    : "";

  const evidenceControls = `
  <section class="view" id="evidence">
    <div class="view-head">
      <h2>Evidence ledger (${totalClaims} claims)</h2>
      <p class="lede">Filter by theme below, or expand any section to inspect the full verbatim quotes linked to every talk story and transcript.</p>
    </div>
    <div class="evidence-filter" id="evidence-filter" role="group" aria-label="Filter evidence by theme">
      <button type="button" data-ev-theme="all" aria-pressed="true">All 6 themes</button>
      ${themes.map((th) => `<button type="button" data-ev-theme="${th.id}" aria-pressed="false">${th.num} · ${esc(th.name)}</button>`).join("")}
    </div>
  </section>`;

  const themeSections = themes.map((th) => {
    const deepHref = `${up}${themeDeepDiveRel(th.id)}`;
    const sortedSlugs = [...th.slugs].sort((a, b) => (talkBySlug.get(a)?.session?.starts_at ?? "").localeCompare(talkBySlug.get(b)?.session?.starts_at ?? ""));
    const talkPills = sortedSlugs.map((slug) => {
      const tObj = talkBySlug.get(slug);
      const spk = shortSpeakers(slug).split(",")[0] ?? "";
      const label = spk ? `${spk}: ${tObj?.title ?? slug}` : (tObj?.title ?? slug);
      return `<a class="chip mini" href="${talkHref(slug, up)}?from=${encodeURIComponent(th.id)}" title="${esc(thesis.get(slug) ?? "")}">${esc(label)}</a>`;
    }).join("");
    const previewClaims = th.claims.slice(0, 6);
    const extraClaims = th.claims.slice(6);
    const counterHtml = th.counters.length
      ? `<div class="counter-callout"><span class="mono">Counter-claims (${th.counters.length})</span><ul class="claim-grid">${th.counters.map((c) => renderClaimCard(c, th.id)).join("")}</ul></div>`
      : th.whyUncontested
        ? `<div class="counter-callout"><span class="mono">Uncontested consensus</span><p>${esc(th.whyUncontested)}</p></div>`
        : "";
    return `<section class="view theme-section" id="${th.id}" data-theme-sec="${th.id}">
      <div class="view-head">
        <div><span class="mono">Theme ${th.num} · ${th.slugs.size} talks · ${th.claims.length} claims</span><h2>${esc(th.name)}</h2></div>
        <a class="btn" href="${deepHref}">Open Theme ${th.num} Deep Dive →</a>
      </div>
      <p class="th-claim">${esc(th.claim)}</p>
      ${th.definition ? `<p class="th-def">${esc(th.definition)}</p>` : ""}
      ${th.alsoCalled.length ? `<p class="mono minor">Also called: ${esc(th.alsoCalled.join(" · "))}</p>` : ""}
      <div class="theme-talk-pills">${talkPills}</div>
      ${previewClaims.length ? `<ul class="claim-grid">${previewClaims.map((c) => renderClaimCard(c, th.id)).join("")}</ul>` : ""}
      ${extraClaims.length ? `<details class="more-claims"><summary class="mono">Show all ${th.claims.length} extracted claims (${extraClaims.length} more)</summary><ul class="claim-grid" style="margin-top:.7rem">${extraClaims.map((c) => renderClaimCard(c, th.id)).join("")}</ul></details>` : ""}
      ${counterHtml}
    </section>`;
  }).join("\n");

  const singletonsHtml = singletonList.length
    ? `<section class="view" id="singletons"><div class="view-head"><h2>Distinctive singletons</h2><p class="lede">${singletonList.length} claims made by only one talk in the corpus.</p></div><details><summary class="mono">Expand all ${singletonList.length} singletons</summary><ul class="singleton-list">${singletonList.map((c) =>
        `<li>${esc(c.claim)} — <a href="${talkHref(c.slug, up)}">${esc(c.title)}</a> <span class="mono">(${esc(c.speakers)}, <a href="${hubHref(c.slug, up)}#transcript">${esc(c.section)}</a>)</span></li>`
      ).join("")}</ul></details></section>`
    : "";

  const limitsBlock = themesMd.split(/^## Limits\s*$/m)[1]?.trim() ?? "";
  const limitsHtml = limitsBlock
    ? `<section class="view" id="limits"><div class="view-head"><h2>Corpus &amp; limits</h2></div><details><summary class="mono">Methodology &amp; coverage notes</summary><div class="prose wide" style="margin-top:.8rem">${md(limitsBlock)}</div></details></section>`
    : "";

  const archiveFooter = `<section class="view" id="archive"><div class="archive-links">
    <span>More archive views:</span>
    ${list("atlases").filter((a) => exists(`atlases/${a}/page.html`)).map((a) => `<a href="${up}atlases/${a}/page.html">Through-line: ${esc(a.replace(/-/g, " "))} →</a>`).join("\n    ")}
    <a href="${up}site/schedule.html">Full schedule →</a>
    <a href="${up}site/today.html">Daily log →</a>
  </div></section>`;

  return [hero, stackSection, cardsSection, contestedHtml, evidenceControls, themeSections, singletonsHtml, limitsHtml, archiveFooter].join("\n");
}

const THEMES_JS = `(function(){
  var layers=[].slice.call(document.querySelectorAll('.stack-layer[data-layer]'));
  var panels=[].slice.call(document.querySelectorAll('.stage-panel[data-panel]'));
  function selectLayer(id){
    layers.forEach(function(b){b.setAttribute('aria-selected',String(b.getAttribute('data-layer')===id))});
    panels.forEach(function(p){p.hidden=p.getAttribute('data-panel')!==id});
  }
  layers.forEach(function(b,idx){
    b.addEventListener('click',function(){selectLayer(b.getAttribute('data-layer'))});
    b.addEventListener('keydown',function(e){
      if(e.key==='ArrowDown'||e.key==='ArrowRight'){e.preventDefault();var n=layers[(idx+1)%layers.length];n.focus();selectLayer(n.getAttribute('data-layer'));}
      if(e.key==='ArrowUp'||e.key==='ArrowLeft'){e.preventDefault();var p=layers[(idx-1+layers.length)%layers.length];p.focus();selectLayer(p.getAttribute('data-layer'));}
    });
  });

  var ef=document.getElementById('evidence-filter');
  var secs=[].slice.call(document.querySelectorAll('.theme-section[data-theme-sec]'));
  function filterEv(id){
    if(ef)ef.querySelectorAll('button[data-ev-theme]').forEach(function(b){b.setAttribute('aria-pressed',String(b.getAttribute('data-ev-theme')===id))});
    secs.forEach(function(s){s.hidden=id!=='all'&&s.getAttribute('data-theme-sec')!==id});
  }
  if(ef){
    ef.addEventListener('click',function(e){
      var b=e.target.closest('button[data-ev-theme]');
      if(b)filterEv(b.getAttribute('data-ev-theme'));
    });
  }
  document.querySelectorAll('[data-jump-theme]').forEach(function(a){
    a.addEventListener('click',function(){filterEv('all')});
  });
  document.addEventListener('click',function(e){
    var btn=e.target.closest('.stage-view-switch button[data-stage-mode]');
    if(!btn)return;
    var mode=btn.getAttribute('data-stage-mode');
    var panel=btn.closest('.stage-panel');
    var media=panel&&panel.querySelector('.stage-media');
    if(!media)return;
    var img=media.querySelector('img');
    var cap=media.querySelector('.sm-caption');
    var src=media.getAttribute(mode==='slide'?'data-slide-src':'data-clay-src');
    var alt=media.getAttribute(mode==='slide'?'data-slide-alt':'data-clay-alt');
    var txt=media.getAttribute(mode==='slide'?'data-slide-cap':'data-clay-cap');
    if(img&&src){img.src=src;if(alt!==null)img.alt=alt;}
    if(cap&&txt!==null)cap.textContent=txt;
    panel.querySelectorAll('.stage-view-switch button[data-stage-mode]').forEach(function(b){
      b.setAttribute('aria-pressed',String(b.getAttribute('data-stage-mode')===mode));
    });
  });

  function syncHash(){
    var h=(location.hash||'').slice(1);
    if(!h)return;
    var sec=secs.find(function(s){return s.id===h});
    if(sec){
      filterEv('all');
      selectLayer(h);
      sec.scrollIntoView({block:'start'});
    }
  }
  addEventListener('hashchange',syncHash);
  syncHash();
})();`;

// After the event (phase "archive") the themes explorer is the front page; during it, Today is.
if (NAV.phase === "archive") write("index.html", shell({ title: `${NAV.brand} · ${SYNTH_TITLE()}`, active: "themes", up: "", body: renderThemesExplorer(""), script: THEMES_JS }));
write("site/themes.html", shell({ title: `Themes · ${SYNTH_TITLE()}`, active: "themes", up: "../", body: renderThemesExplorer("../"), script: THEMES_JS }));

// ===== People =====
{
  const up = "../";
  const heardIds: Array<[string, Session]> = [];
  for (const t of captured) for (const id of t.session?.speaker_ids ?? []) if (wm.speakers[id] && !heardIds.some(([x]) => x === id)) heardIds.push([id, t.session!]);
  const heard = new Set(heardIds.map(([id]) => id));
  const rest = Object.keys(wm.speakers).filter((id) => !heard.has(id))
    .sort((a, b) => (speakerSessions(a)[0]?.starts_at ?? "9").localeCompare(speakerSessions(b)[0]?.starts_at ?? "9") || wm.speakers[a]!.name.localeCompare(wm.speakers[b]!.name));
  const withX = Object.keys(wm.speakers).filter((id) => handleFor(id)).length;
  const body = `
  <header class="masthead"><p class="mono agency">${esc(wm.event.name)}</p><h1>People</h1><p class="sub">Follow a speaker, or start a post to them. Each button opens X; nothing is sent until you send it.</p></header>
  <div class="marginalia mono"><span>${Object.keys(wm.speakers).length} speakers · ${withX} with an X handle</span><span>“Followed” ticks are kept in this browser</span></div>
  <input id="find" class="find" type="search" placeholder="Find a name, company or talk" aria-label="Find a speaker">
  <section class="view"><div class="view-head"><h2>Speakers I've heard</h2><p class="lede">From the talks I've captured. “Write” starts a post that names their talk.</p></div>
    <div class="people">${heardIds.map(([id, s]) => personCard(id, up, s)).join("")}</div></section>
  <section class="view"><div class="view-head"><h2>Everyone else</h2><p class="lede">In schedule order.</p></div>
    <div class="people">${rest.map((id) => personCard(id, up, null)).join("")}</div></section>`;
  write("site/people.html", shell({ title: "People", active: "people", up, body, script: PEOPLE_JS }));
}

// Speaker metadata from the roster: bio and links, shown in the schedule's About and on Today.
const speakerLinkLabel = (u: string): string => {
  const h = (() => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u; } })();
  return /(^|\.)x\.com$|twitter\.com$/.test(h) ? "X" : /linkedin\.com$/.test(h) ? "LinkedIn" : /github\.com$/.test(h) ? "GitHub" : h;
};
const speakerMeta = (s: Session): string => s.speaker_ids.map((id) => wm.speakers[id]).filter(Boolean).map((p) => {
  const links = (p!.links ?? []).map((u) => `<a href="${esc(u)}" rel="noopener">${esc(speakerLinkLabel(u))}</a>`).join(" · ");
  const bio = (p as { bio?: string }).bio;
  return `<div class="tt-speaker"><p><b>${esc(p!.name)}</b>${p!.affiliation ? `, ${esc(p!.affiliation)}` : ""}${links ? ` <span class="mono">${links}</span>` : ""}</p>${bio ? `<p class="minor">${esc(bio)}</p>` : ""}</div>`;
}).join("");
// ===== Follow-ups: editorial/backlog.md rendered, note references linked to their talk =====
{
  const up = "../";
  const src = exists("editorial/backlog.md") ? read("editorial/backlog.md") : "";
  const noteTalk = (file: string): string | undefined =>
    exists(`notes/inbox/${file}`) ? read(`notes/inbox/${file}`).match(/^talk:\s*talks\/([^/\s]+)/m)?.[1] : undefined;
  // Note paths in the backlog become links to the talk's notes; talk paths link to the talk.
  const linked = stripFront(src).replace(/^# .*\n/m, "")
    .replace(/notes\/inbox\/([\w.-]+\.md)/g, (m, f: string) => { const t = noteTalk(f); return t ? `[note](${hubHref(t, up)}#notes)` : `\`${m}\``; })
    .replace(/(?<![\w/])talks\/([\w-]+)\/(?:[\w.-]+)?/g, (m, slug: string) => (exists(`talks/${slug}`) ? `[${slug}](${talkHref(slug, up)})` : m));
  const open = (src.match(/^- \[ \]/gm) ?? []).length;
  const done = (src.match(/^- \[x\]/gim) ?? []).length;
  const body = `
  <header class="masthead"><p class="mono agency">${esc(wm.event.name)}</p><h1>Follow-ups</h1><p class="sub">Ideas to write, things to look into, and things to read after the conference.</p></header>
  <div class="marginalia mono"><span>${open} open · ${done} done</span><span>From editorial/backlog.md</span></div>
  <section class="view prose followups">${md(linked)}</section>`;
  write("site/followups.html", shell({ title: "Follow-ups", active: null, up, body }));
}

// ===== Schedule: a plain timetable, one tab per day, track rooms as columns =====
{
  const up = "../";
  const LONG = 3 * 3600e3;
  const short = (s: Session): string => roomName(s).match(/\(([^)]+)\)/)?.[1] ?? (roomName(s) || "TBA");
  const isTrack = (s: Session): boolean => !!s.room_id && /talk|workshop|keynote/i.test(s.format ?? "talk") && s.format !== "break";
  const who = (s: Session): string => s.speaker_ids.map((id) => { const p = wm.speakers[id]; return p ? p.name + (p.affiliation ? ` (${p.affiliation})` : "") : ""; }).filter(Boolean).join(", ");
  const pill = (s: Session): string => {
    if (slugBySession.has(s.session_id)) return `<span class="pill call-go">captured</span>`;
    const c = recs[s.session_id]?.call;
    return c === "go" ? `<span class="pill call-go">go</span>` : c === "maybe" ? `<span class="pill call-maybe">maybe</span>` : c === "skip" ? `<span class="pill call-skip">skip</span>` : s.format === "break" ? `<span class="pill call-skip">break</span>` : "";
  };
  const cell = (s: Session, withRoom: boolean): string => {
    const href = slugBySession.has(s.session_id) ? talkHref(slugBySession.get(s.session_id)!, up) : null;
    const title = href ? `<a href="${esc(href)}">${esc(s.title)}</a>` : esc(s.title);
    const meta = `<span class="mono">${esc(clock(new Date(s.starts_at)))}–${esc(clock(new Date(s.ends_at)))}${withRoom ? "" : ` · <span class="rm">${esc(short(s))}</span>`}</span>`;
    const why = recs[s.session_id]?.why;
    const bios = speakerMeta(s);
    const more = s.abstract || why || bios ? `<details><summary>About</summary>${why ? `<p class="why"><b>My call:</b> ${esc(why)}</p>` : ""}${s.abstract ? `<p>${esc(s.abstract)}</p>` : ""}${bios}</details>` : "";
    return `<div class="tt-cell" data-start="${s.starts_at}" data-end="${s.ends_at}">${meta}<b class="tt-title">${title}</b>${who(s) ? `<span class="tt-who">${esc(who(s))}</span>` : ""}<div class="tt-foot">${pill(s)}${watchLink(s, "tt-watch")}</div>${more}</div>`;
  };
  const days = wm.program.days.map((d) => {
    const all = wm.program.sessions.filter((s) => s.day === d.date).sort((a, b) => a.starts_at.localeCompare(b.starts_at));
    const allDay = all.filter((s) => Date.parse(s.ends_at) - Date.parse(s.starts_at) > LONG);
    const timed = all.filter((s) => !allDay.includes(s));
    const counts = new Map<string, number>();
    for (const s of timed.filter(isTrack)) counts.set(s.room_id!, (counts.get(s.room_id!) ?? 0) + 1);
    const rooms = [...counts.entries()].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).map(([r]) => r);
    const inTrack = (s: Session): boolean => rooms.includes(s.room_id ?? "");
    const starts = [...new Set(timed.map((s) => s.starts_at))].sort();
    const rows = starts.map((t) => {
      const here = timed.filter((s) => s.starts_at === t);
      const wide = here.filter((s) => !inTrack(s));
      const track = here.filter(inTrack);
      const end = here.map((s) => s.ends_at).sort().at(-1)!;
      const out: string[] = [];
      if (track.length) out.push(`<div class="tt-row" data-start="${t}" data-end="${end}" style="--cols:${rooms.length}"><div class="tt-time mono">${esc(clock(new Date(t)))}</div>${rooms.map((r) => { const s = track.find((x) => x.room_id === r); return s ? cell(s, rooms.length > 1) : `<div class="tt-empty" aria-hidden="true"></div>`; }).join("")}</div>`);
      for (const s of wide) out.push(`<div class="tt-row wide" data-start="${t}" data-end="${s.ends_at}"><div class="tt-time mono">${esc(clock(new Date(t)))}</div>${cell(s, false)}</div>`);
      return out.join("");
    }).join("");
    const head = rooms.length > 1 ? `<div class="tt-head" style="--cols:${rooms.length}"><div></div>${rooms.map((r) => `<div class="mono">${esc(rooms_short(r))}</div>`).join("")}</div>` : "";
    const ad = allDay.length ? `<p class="minor tt-allday">All day: ${allDay.map((s) => `${esc(s.title)} (${esc(short(s))}, ${esc(clock(new Date(s.starts_at)))}–${esc(clock(new Date(s.ends_at)))})`).join(" · ")}</p>` : "";
    return { date: d.date, label: day(new Date(`${d.date}T12:00:00Z`)), full: d.label ?? "", html: `<section class="tt-day" data-day="${d.date}" hidden>${d.label ? `<p class="lede">${esc(d.label)}</p>` : ""}${ad}${head}${rows || `<p class="lede">No timed sessions this day.</p>`}</section>` };
  });
  function rooms_short(r: string): string { const n = rooms.get(r) ?? r; return n.match(/\(([^)]+)\)/)?.[1] ?? n; }
  const body = `
  <header class="masthead"><p class="mono agency">${esc(wm.event.name)}</p><h1>Schedule</h1><p class="sub">Every session, by day and time, room by room.</p></header>
  <div class="marginalia mono"><span class="tt-tabs" role="tablist">${days.map((d) => `<button type="button" role="tab" data-day="${d.date}" title="${esc(d.full)}">${esc(d.label)}</button>`).join("")}</span><span><a href="today.html">Daily capture log →</a> · <a href="index.html">Planner &amp; floor maps →</a></span></div>
  <section class="view">${days.map((d) => d.html).join("")}</section>
  <p class="colophon mono">Times are ${esc(TZ.split("/").pop()!.replace(/_/g, " "))} time · go / maybe are my picks · captured links open the talk</p>`;
  const script = `(function(){
  var today=new Date().toLocaleDateString('en-CA',{timeZone:${JSON.stringify(TZ)}});
  var tabs=[].slice.call(document.querySelectorAll('.tt-tabs button'));var dates=tabs.map(function(b){return b.getAttribute('data-day')});
  var isLiveConf=dates.indexOf(today)>=0;
  var pick=isLiveConf?today:dates[0];
  try{var h=location.hash.slice(1);if(dates.indexOf(h)>=0)pick=h}catch(e){}
  function show(d){tabs.forEach(function(b){b.setAttribute('aria-selected',String(b.getAttribute('data-day')===d))});
    document.querySelectorAll('.tt-day').forEach(function(s){s.hidden=s.getAttribute('data-day')!==d});mark()}
  function mark(){if(!isLiveConf)return;var now=Date.now();document.querySelectorAll('.tt-row').forEach(function(r){var a=Date.parse(r.getAttribute('data-start')),b=Date.parse(r.getAttribute('data-end'));
    r.classList.toggle('past',b<now);r.classList.toggle('cur',a<=now&&now<b)});
    document.querySelectorAll('.tt-cell').forEach(function(c){var a=Date.parse(c.getAttribute('data-start')),b=Date.parse(c.getAttribute('data-end'));c.classList.toggle('on',a<=now&&now<b)})}
  document.querySelector('.tt-tabs').addEventListener('click',function(e){var b=e.target.closest('button');if(b){show(b.getAttribute('data-day'));try{history.replaceState(null,'','#'+b.getAttribute('data-day'))}catch(x){}}});
  show(pick);setInterval(mark,60000);
  var cur=document.querySelector('.tt-day:not([hidden]) .tt-row.cur');if(cur&&pick===today)cur.scrollIntoView({block:'center'});
})();`;
  write("site/schedule.html", shell({ title: "Schedule", active: "schedule", up, body, script }));
}

// ===== Today: the day's plan, now/next, captures. Always site/today.html; also index.html while live. =====
for (const [out, up] of (NAV.phase === "archive" ? [["site/today.html", "../"]] : [["site/today.html", "../"], ["index.html", ""]]) as Array<[string, string]>) {
  // The whole day, both rooms; all-day items (registration, expo hours, lounges) go on one line.
  const ALL_DAY = 3 * 3600e3;
  const shortRoom = (s: Session): string => roomName(s).match(/\(([^)]+)\)/)?.[1] ?? roomName(s);
  const plan = wm.program.sessions
    .filter((s) => Date.parse(s.ends_at) - Date.parse(s.starts_at) <= ALL_DAY)
    .map((s) => ({
      id: s.session_id, day: s.day, start: s.starts_at, end: s.ends_at, title: s.title, room: shortRoom(s),
      main: /main/i.test(roomName(s)),
      who: s.speaker_ids.map((id) => { const p = wm.speakers[id]; return p ? p.name + (p.affiliation ? ` (${p.affiliation})` : "") : ""; }).filter(Boolean).join(", "),
      call: recs[s.session_id]?.call ?? (s.format === "break" ? "break" : ""),
      why: recs[s.session_id]?.why ?? "", abstract: s.abstract ?? "", speakers: speakerMeta(s),
      hub: slugBySession.has(s.session_id) ? talkHref(slugBySession.get(s.session_id)!, up) : null,
      video: livestream(s)?.url ?? null,
    }))
    .sort((a, b) => a.start.localeCompare(b.start) || Number(b.main) - Number(a.main));
  const allDay = wm.program.sessions.filter((s) => Date.parse(s.ends_at) - Date.parse(s.starts_at) > ALL_DAY)
    .map((s) => ({ day: s.day, title: s.title, room: shortRoom(s), start: s.starts_at, end: s.ends_at }));
  const days = wm.program.days.map((d) => ({ date: d.date, label: day(new Date(`${d.date}T12:00:00Z`)), full: d.label ?? "" }));
  const recent = captured.map((t) => `<div class="receipt"><span><a href="${talkHref(t.slug, up)}">${esc(t.title)}</a> <span class="minor">${esc(speakerNames(t.session).split(" · ").map((x) => x.split(",")[0]).join(", "))}</span></span><span class="mono">${builtCount(t)}/7 built</span></div>`).join("");
  const latest = [...notes].sort((a, b) => b.file.localeCompare(a.file)).slice(0, 6).map((n) => {
    const t = read(`notes/inbox/${n.file}`).match(/^talk:\s*talks\/([^/\s]+)/m)?.[1];
    return `<div class="receipt"><span>${t ? `<a href="${hubHref(t, up)}#notes">${esc(firstLine(n.body, 100))}</a>` : esc(firstLine(n.body, 100))}</span><span class="mono">${esc(n.file.slice(5, 10))} ${esc(noteTime(n))}</span></div>`;
  }).join("");
  const manifest = JSON.parse(read("dist/manifest.active.json")) as { topology: { nodes: Array<{ node: string }> } };
  const ORDER = ["schedule-check", "conference-schedule", "schedule-brief", "recording-inbox-watch", "recording-intake", "talk-photos", "talk-links", "talk-insights", "conference-themes"];
  const pipeline = manifest.topology.nodes.map((n) => n.node).sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b)).map((node) => {
    const path = `state/world-model/${node}/receipts.jsonl`;
    const lines = exists(path) ? read(path).trim().split("\n").filter(Boolean) : [];
    const r = lines.length ? (JSON.parse(lines.at(-1)!) as { at: string; status: string; semantic_diff?: { summary?: string } }) : null;
    return `<div class="receipt"><span>${node}<span class="minor"> · ${esc(firstLine(r?.semantic_diff?.summary ?? "", 90))}</span></span><span class="mono">${r ? `${esc(r.status)} · ${clock(new Date(r.at))}` : "never run"}</span></div>`;
  }).join("");
  const git = Bun.spawnSync({ cmd: ["git", "status", "--porcelain"], cwd: root, stdout: "pipe" }).stdout.toString().split("\n").filter(Boolean).length;
  const data = JSON.stringify({ plan, allDay, days, tz: TZ }).replace(/</g, "\\u003c");
  const body = `
  <header class="masthead"><p class="mono agency">${esc(wm.event.name)}${dateRange() ? ` · ${esc(dateRange())}` : ""}</p><h1 id="today-title">Today</h1><p class="sub" id="today-sub">Where the day stands.</p></header>
  <div class="marginalia mono"><span id="dayswitch"></span><a href="${up}site/schedule.html">Full schedule →</a></div>
  <section class="view now-next" id="nownext"></section>
  <section class="view"><div class="view-head"><h2>Schedule</h2><p class="lede">Everything on, in time order. GO and maybe are my picks; tap a talk for its abstract.</p>
    <div class="roomfilter" id="roomfilter"><button type="button" data-r="all">All rooms</button><button type="button" data-r="main">Main stage only</button></div>
    <p class="minor" id="allday"></p></div>
    <ol class="plan" id="plan"></ol></section>
  <section class="view"><div class="view-head"><h2>Captured so far</h2><p class="lede"><a href="${up}site/talks/index.html">${captured.length} talks</a> · ${notes.length} notes · <a href="${up}${NAV.phase === "archive" ? "index.html" : "site/themes.html"}">${themes.length} themes</a></p></div><div>${recent}</div></section>
  <section class="view"><div class="view-head"><h2>Latest notes</h2></div><div>${latest}</div></section>
  <section class="view"><details><summary class="mono">Pipeline · ${git} files uncommitted · updated ${esc(generatedAt)}</summary><div>${pipeline}</div></details></section>`;
  const script = `var D=${data};
(function(){
  var fmt=function(iso){return new Date(iso).toLocaleTimeString('en-US',{timeZone:D.tz,hour:'numeric',minute:'2-digit'})};
  var today=new Date().toLocaleDateString('en-CA',{timeZone:D.tz});
  var dates=D.days.map(function(d){return d.date});
  var pick=dates.indexOf(today)>=0?today:dates[0];
  var esc=function(s){return String(s).replace(/[&<>"]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]})};
  var room='all';try{room=localStorage.getItem('aie-room')||'all'}catch(e){}
  var cur=pick;
  function render(date){cur=date;
    var now=Date.now(), live=date===today;
    var lab=D.days.find(function(d){return d.date===date});
    document.getElementById('today-title').textContent=live?'Today':(lab?lab.label:date);
    document.getElementById('today-sub').textContent=new Date(date+'T12:00:00').toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric'})+(live?' · '+new Date().toLocaleTimeString('en-US',{timeZone:D.tz,hour:'numeric',minute:'2-digit'})+' in San Francisco':'');
    var rows=D.plan.filter(function(p){return p.day===date&&(room==='all'||p.main||p.call==='break')});
    var inProg=live?rows.filter(function(p){return Date.parse(p.start)<=now&&now<Date.parse(p.end)}):[];
    var talksNow=inProg.filter(function(p){return p.call!=='break'});var nowRows=talksNow.length?talksNow:inProg;
    var upcoming=rows.filter(function(p){return Date.parse(p.start)>now&&p.call!=='break'});
    var nextRows=upcoming.length?upcoming.filter(function(p){return p.start===upcoming[0].start}):[];
    var card=function(k,p){return '<div class="nn"><span class="mono">'+k+' · '+fmt(p.start)+'–'+fmt(p.end)+' · '+esc(p.room)+'</span><b>'+(p.hub?'<a href="'+p.hub+'">'+esc(p.title)+'</a>':esc(p.title))+'</b><span class="minor">'+esc(p.who)+'</span></div>'};
    var nn=document.getElementById('nownext');
    nn.innerHTML=live?(nowRows.map(function(p){return card('Now',p)}).join('')+nextRows.map(function(p){return card('Next',p)}).join(''))||'<p class="lede">Nothing else on today.</p>':'';
    nn.hidden=!live;
    var ad=D.allDay.filter(function(a){return a.day===date});
    document.getElementById('allday').textContent=ad.length?'All day: '+ad.map(function(a){return a.title+' ('+a.room+', '+fmt(a.start)+'–'+fmt(a.end)+')'}).join(' · '):'';
    document.querySelectorAll('#roomfilter button').forEach(function(b){b.setAttribute('aria-pressed',String(b.getAttribute('data-r')===room))});
    document.getElementById('plan').innerHTML=rows.map(function(p){
      var past=live&&Date.parse(p.end)<now, cur=nowRows.indexOf(p)>=0;
      var pill=p.hub?'<span class="pill call-go">captured</span>':p.call==='go'?'<span class="pill call-go">go</span>':p.call==='maybe'?'<span class="pill call-maybe">maybe</span>':p.call==='break'?'<span class="pill call-skip">break</span>':'';
      var head=(p.hub?'<a href="'+p.hub+'">'+esc(p.title)+'</a>':esc(p.title))+(p.who?'<span class="minor"> · '+esc(p.who)+'</span>':'');
      var more=(p.abstract||p.why||p.speakers)?'<details><summary>'+head+'</summary>'+(p.why?'<p class="why"><b>Why '+esc(p.call)+':</b> '+esc(p.why)+'</p>':'')+(p.abstract?'<p class="abs">'+esc(p.abstract)+'</p>':'')+(p.speakers||'')+'</details>':head;
      return '<li class="'+(past?'past ':'')+(cur?'cur ':'')+(p.main?'':'side')+'"><span class="mono">'+fmt(p.start)+'</span><span class="t">'+more+'<span class="room mono">'+esc(p.room)+'</span>'+(p.video?' <a class="watch mono" href="'+esc(p.video)+'" rel="noopener">▸ video</a>':'')+'</span>'+pill+'</li>'}).join('')||'<li class="lede">Nothing scheduled.</li>';
    document.getElementById('dayswitch').innerHTML=D.days.map(function(d){return '<button type="button" title="'+esc(d.full)+'" data-d="'+d.date+'"'+(d.date===date?' aria-pressed="true"':'')+'>'+esc(d.label)+'</button>'}).join('');
  }
  document.getElementById('dayswitch').addEventListener('click',function(e){var b=e.target.closest('button');if(b)render(b.getAttribute('data-d'))});
  document.getElementById('roomfilter').addEventListener('click',function(e){var b=e.target.closest('button');if(!b)return;room=b.getAttribute('data-r');try{localStorage.setItem('aie-room',room)}catch(x){}render(cur)});
  render(pick);setInterval(function(){var b=document.querySelector('#dayswitch [aria-pressed]');render(b?b.getAttribute('data-d'):pick)},60000);
})();`;
  write(out, shell({ title: NAV.phase === "archive" ? "Daily log" : "Today", active: "today", up, body, script }));
}

const people = Object.keys(wm.speakers).length;
console.log(`wrote index.html (${NAV.phase === "archive" ? "themes explorer" : "today"}), site/themes.html (${themes.length}), site/talks/ (${captured.length} hubs), site/people.html (${people} speakers, ${Object.keys(wm.speakers).filter((id) => handleFor(id)).length} on X), site/schedule.html, site/today.html`);
