// The one top bar every page in this build shows. render-pages.ts and
// render-site.ts use topnav(); the talk runtime (stories/runtime/talk.js) builds
// the same links in the browser from the `nav` block render-pages writes into
// site/xref.js. Keep the three in step.
//
// `up` is the path from the page back to the repo root ("", "../", "../../").
//
// The bar has two phases, set by `phase` in editorial/presentation.json:
//   live    (default) — during the event: Today is the front page.
//   archive           — after it: the themes explorer is the front page.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type Section = "today" | "themes" | "talks" | "people" | "schedule" | "followups";
export type Phase = "live" | "archive";

export interface NavConfig { brand: string; badge: string; phase: Phase; items: Array<[Section, string, string]> }

const LIVE: Array<[Section, string, string]> = [
  ["today", "Today", "index.html"],
  ["schedule", "Schedule", "site/schedule.html"],
  ["talks", "Talks", "site/talks/index.html"],
  ["themes", "Themes", "site/themes.html"],
  ["people", "People", "site/people.html"],
  ["followups", "Follow-ups", "site/followups.html"],
];

const ARCHIVE: Array<[Section, string, string]> = [
  ["themes", "Themes", "index.html"],
  ["talks", "Talks", "site/talks/index.html"],
  ["people", "People", "site/people.html"],
  ["schedule", "Schedule", "site/schedule.html"],
  ["today", "Daily log", "site/today.html"],
  ["followups", "Follow-ups", "site/followups.html"],
];

// Brand: presentation.json `brand`, else the event name from the schedule truth.
export const navConfig = (root: string): NavConfig => {
  const read = (p: string): Record<string, unknown> => {
    const f = join(root, p);
    try { return existsSync(f) ? (JSON.parse(readFileSync(f, "utf8")) as Record<string, unknown>) : {}; } catch { return {}; }
  };
  const pres = read("editorial/presentation.json");
  const wm = read("state/world-model/conference-schedule/published/world-model.json") as { event?: { name?: string } };
  const phase: Phase = pres.phase === "archive" ? "archive" : "live";
  return {
    brand: typeof pres.brand === "string" ? pres.brand : wm.event?.name ?? "Conference",
    badge: typeof pres.badge === "string" ? pres.badge : phase === "archive" ? "Archive" : "Live",
    phase,
    items: phase === "archive" ? ARCHIVE : LIVE,
  };
};

const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export const topnav = (active: Section | null, up: string, cfg: NavConfig): string =>
  `<nav class="topnav" aria-label="Site"><a class="brand" href="${up}index.html">${esc(cfg.brand)}${cfg.badge ? `<span class="brand-badge">${esc(cfg.badge)}</span>` : ""}</a>${cfg.items.map(
    ([key, label, href]) => `<a href="${up}${href}"${key === active ? ' aria-current="page"' : ""}>${label}</a>`,
  ).join("")}</nav>`;
