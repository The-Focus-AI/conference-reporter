/**
 * Fixed scroll runtime for talk stories and theme presentations.
 * The page owns the visuals and the copy; this owns which card is active,
 * plus shared site chrome and deterministic cross-referencing from site/xref.js.
 */
(function () {
  "use strict";

  const me = document.currentScript || document.querySelector('script[src$="stories/runtime/talk.js"]');
  const src = me && me.getAttribute("src");
  const up = src ? src.replace(/stories\/runtime\/talk\.js.*$/, "") : "../../../";
  const hub = (s) => up + "site/talks/" + s + ".html";

  const talkMatch = location.pathname.match(/\/talks\/([^/]+)\/experience\//);
  const talkSlug = talkMatch && talkMatch[1];
  const atlasMatch = location.pathname.match(/\/atlases\/([^/]+)\//);
  const atlasSlug = atlasMatch && atlasMatch[1];

  const el = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  };

  // Site chrome: shared top bar, universal zoom bar CSS/JS, and markdown link rewrites.
  (function siteChrome() {
    if (!src) return;
    if (!document.querySelector(".topnav")) {
      const css = document.createElement("link");
      css.rel = "stylesheet";
      css.href = up + "site/nav.css";
      document.head.appendChild(css);

      const exCss = document.createElement("link");
      exCss.rel = "stylesheet";
      exCss.href = up + "site/explorer.css";
      document.head.appendChild(exCss);

      const nav = document.createElement("nav");
      nav.className = "topnav in-talk";
      nav.setAttribute("aria-label", "Site");
      const currentSection = atlasSlug ? "themes" : "talks";

      // Brand and links come from site/xref.js (written by render-pages from
      // editorial/presentation.json); until it loads, a neutral default.
      const fillNav = (cfg) => {
        nav.textContent = "";
        const brand = document.createElement("a");
        brand.className = "brand";
        brand.href = up + "index.html";
        brand.appendChild(document.createTextNode(cfg.brand || "Conference"));
        if (cfg.badge) brand.appendChild(el("span", "brand-badge", cfg.badge));
        nav.appendChild(brand);
        for (const it of cfg.items) {
          const a = document.createElement("a");
          a.textContent = it.label;
          a.href = up + it.href;
          if (it.key === currentSection) a.setAttribute("aria-current", "page");
          nav.appendChild(a);
        }
      };
      fillNav({ brand: "", badge: "", items: [
        { key: "today", label: "Today", href: "index.html" },
        { key: "talks", label: "Talks", href: "site/talks/index.html" },
        { key: "themes", label: "Themes", href: "site/themes.html" },
        { key: "people", label: "People", href: "site/people.html" },
        { key: "schedule", label: "Schedule", href: "site/schedule.html" },
      ] });
      window.__CONF_FILL_NAV__ = fillNav;
      document.body.prepend(nav);

      const exJs = document.createElement("script");
      exJs.src = up + "site/explorer.js";
      exJs.defer = true;
      document.head.appendChild(exJs);
    }

    for (const a of document.querySelectorAll('a[href*=".md"]')) {
      const href = a.getAttribute("href") || "";
      const m = href.match(/^(?:\.\.\/\.\.\/([^/]+)\/|\.\.\/)(transcript|links|story)\.md(?:#.*)?$/);
      const s = m && (m[1] || talkSlug);
      if (s) {
        a.setAttribute("href", hub(s) + "#" + m[2]);
      } else if (atlasSlug && href === "story.md") {
        a.setAttribute("href", up + "index.html" + (atlasSlug === "conference-themes" ? "" : "#" + atlasSlug));
      }
    }
  })();

  function prependCardThumb(card, imgSrc, linkHref) {
    if (!imgSrc || card.querySelector(".card-thumb")) return;
    const thumb = el("a", "card-thumb");
    thumb.href = linkHref;
    const img = document.createElement("img");
    img.src = up + imgSrc;
    img.alt = "";
    img.loading = "lazy";
    thumb.appendChild(img);
    const first = card.firstElementChild;
    if (first && first.tagName === "DIV" && !first.className) {
      first.insertBefore(thumb, first.firstChild);
    } else {
      card.insertBefore(thumb, card.firstChild);
    }
  }

  // Cross-referencing injected deterministically from site/xref.js.
  function renderXref(xref) {
    if (!xref || document.querySelector(".talk-xref")) return;
    const themes = xref.themes || [];
    const themeById = new Map(themes.map((t) => [t.id, t]));
    const foot = document.querySelector(".talk-foot");
    const insertBeforeFoot = (node) => {
      if (foot && foot.parentNode) foot.parentNode.insertBefore(node, foot);
      else document.body.appendChild(node);
    };

    if (talkSlug && xref.talks && xref.talks[talkSlug]) {
      const info = xref.talks[talkSlug];
      const mast = document.querySelector(".talk-masthead");
      if (mast && !mast.querySelector(".talk-theme-strip")) {
        const strip = el("div", "talk-theme-strip");
        strip.appendChild(el("span", "strip-lbl", "Themes"));
        for (const tid of info.themeIds || []) {
          const th = themeById.get(tid);
          if (!th) continue;
          const chip = el("a", "talk-theme-chip", `Theme ${th.num}: ${th.name} →`);
          chip.href = up + th.deepDiveHref;
          strip.appendChild(chip);
        }
        if (xref.masterPresentation) {
          const allChip = el("a", "talk-theme-chip overview", "Master themes presentation");
          allChip.href = up + xref.masterPresentation.href;
          strip.appendChild(allChip);
        }
        const controls = mast.querySelector(".talk-controls");
        if (controls) mast.insertBefore(strip, controls);
        else mast.appendChild(strip);
      }

      const wrap = el("section", "talk-xref");
      wrap.setAttribute("aria-label", "Themes and related talks");

      // 1. Themes this talk shapes
      const themeBlock = el("div", "xref-block");
      const thHead = el("div", "xref-head");
      thHead.appendChild(el("h2", "", info.themeIds && info.themeIds.length ? "Themes this talk shapes" : "Conference themes"));
      thHead.appendChild(el("span", "xref-sub", "Jump from this talk into its theme deep-dive presentation"));
      themeBlock.appendChild(thHead);

      const thGrid = el("div", "xref-grid");
      for (const tid of info.themeIds || []) {
        const th = themeById.get(tid);
        if (!th) continue;
        const card = el("article", "xref-card is-theme");
        const top = el("div");
        const kick = el("div", "xc-kicker");
        kick.appendChild(el("span", "", `Theme ${th.num}`));
        kick.appendChild(el("span", "", `${th.talkCount} talks · ${th.claimCount} claims`));
        top.appendChild(kick);
        const h3 = el("h3", "xc-title");
        const ta = el("a", "", th.name);
        ta.href = up + th.deepDiveHref;
        h3.appendChild(ta);
        top.appendChild(h3);
        top.appendChild(el("p", "xc-desc", th.claim));
        card.appendChild(top);
        prependCardThumb(card, th.leadSlide && th.leadSlide.src, up + th.deepDiveHref);
        const links = el("div", "xc-links");
        const dLink = el("a", "", "Open deep dive →");
        dLink.href = up + th.deepDiveHref;
        links.appendChild(dLink);
        const aLink = el("a", "", "All claims");
        aLink.href = up + th.hubAnchor;
        links.appendChild(aLink);
        card.appendChild(links);
        thGrid.appendChild(card);
      }
      if (xref.masterPresentation) {
        const card = el("article", "xref-card is-theme");
        const top = el("div");
        const kick = el("div", "xc-kicker");
        kick.appendChild(el("span", "", "Overview"));
        kick.appendChild(el("span", "", "6 themes · 33 talks"));
        top.appendChild(kick);
        const h3 = el("h3", "xc-title");
        const ta = el("a", "", xref.masterPresentation.title);
        ta.href = up + xref.masterPresentation.href;
        h3.appendChild(ta);
        top.appendChild(h3);
        top.appendChild(el("p", "xc-desc", xref.masterPresentation.subtitle));
        card.appendChild(top);
        const links = el("div", "xc-links");
        const dLink = el("a", "", "Start presentation →");
        dLink.href = up + xref.masterPresentation.href;
        links.appendChild(dLink);
        const hLink = el("a", "", "Themes hub");
        hLink.href = up + "index.html";
        links.appendChild(hLink);
        card.appendChild(links);
        thGrid.appendChild(card);
      }
      themeBlock.appendChild(thGrid);
      wrap.appendChild(themeBlock);

      // 2. Contested fault lines (if any)
      if (info.contested && info.contested.length) {
        const cBlock = el("div", "xref-block");
        const cHead = el("div", "xref-head");
        cHead.appendChild(el("h2", "", "Where speakers disagreed"));
        cHead.appendChild(el("span", "xref-sub", "Contested debates in the conference corpus"));
        cBlock.appendChild(cHead);
        const cGrid = el("div", "xref-grid");
        for (const c of info.contested) {
          const card = el("article", "xref-card is-contested");
          const top = el("div");
          const kick = el("div", "xc-kicker");
          kick.appendChild(el("span", "", "Contested question"));
          top.appendChild(kick);
          const h3 = el("h3", "xc-title", c.question);
          top.appendChild(h3);
          top.appendChild(el("p", "xc-desc", `This talk: ${c.stance}`));
          card.appendChild(top);
          const links = el("div", "xc-links");
          for (const p of c.peers || []) {
            const pa = el("a", "", `Compare: ${p.speakers || p.title} →`);
            pa.href = up + p.storyHref;
            links.appendChild(pa);
          }
          const allC = el("a", "", "All debates");
          allC.href = up + "index.html#contested";
          links.appendChild(allC);
          card.appendChild(links);
          cGrid.appendChild(card);
        }
        cBlock.appendChild(cGrid);
        wrap.appendChild(cBlock);
      }

      // 3. Related talks
      if (info.related && info.related.length) {
        const rBlock = el("div", "xref-block");
        const rHead = el("div", "xref-head");
        rHead.appendChild(el("h2", "", "Related talks to explore"));
        rHead.appendChild(el("span", "xref-sub", "Connected by shared themes, contested questions, or field notes"));
        rBlock.appendChild(rHead);
        const rGrid = el("div", "xref-grid");
        for (const r of info.related) {
          const card = el("article", "xref-card");
          const top = el("div");
          const kick = el("div", "xc-kicker");
          kick.appendChild(el("span", "", r.speakers || "Speaker"));
          if (r.when) kick.appendChild(el("span", "", r.when));
          top.appendChild(kick);
          const h3 = el("h3", "xc-title");
          const ra = el("a", "", r.title);
          ra.href = up + r.storyHref;
          h3.appendChild(ra);
          top.appendChild(h3);
          if (r.reasons && r.reasons.length) {
            const tags = el("div", "xc-tags");
            for (const reason of r.reasons) {
              const isConflict = /contested|counter/i.test(reason);
              tags.appendChild(el("span", "xref-tag" + (isConflict ? " conflict" : ""), reason));
            }
            top.appendChild(tags);
          }
          if (r.thesis) top.appendChild(el("p", "xc-desc", r.thesis));
          card.appendChild(top);
          const rInfo = xref.talks && xref.talks[r.slug];
          prependCardThumb(card, rInfo && rInfo.leadImage, up + r.storyHref);
          const links = el("div", "xc-links");
          const sLink = el("a", "", "Read story →");
          sLink.href = up + r.storyHref;
          links.appendChild(sLink);
          const hLink = el("a", "", "Talk hub");
          hLink.href = up + r.hubHref;
          links.appendChild(hLink);
          card.appendChild(links);
          rGrid.appendChild(card);
        }
        rBlock.appendChild(rGrid);
        wrap.appendChild(rBlock);
      }

      // 4. Prev / Next talk
      const order = xref.scheduleOrder || [];
      const idx = order.findIndex((o) => o.slug === talkSlug);
      if (idx >= 0) {
        const pn = el("div", "xref-prevnext");
        const prev = order[idx - 1];
        const next = order[idx + 1];
        if (prev) {
          const a = el("a", "xref-pn prev");
          a.href = up + prev.storyHref;
          a.appendChild(el("span", "pn-dir", "← Previous talk"));
          a.appendChild(el("span", "pn-title", prev.title));
          if (prev.speakers) a.appendChild(el("span", "pn-who", prev.speakers));
          pn.appendChild(a);
        } else {
          pn.appendChild(el("div"));
        }
        if (next) {
          const a = el("a", "xref-pn next");
          a.href = up + next.storyHref;
          a.appendChild(el("span", "pn-dir", "Next talk →"));
          a.appendChild(el("span", "pn-title", next.title));
          if (next.speakers) a.appendChild(el("span", "pn-who", next.speakers));
          pn.appendChild(a);
        } else {
          pn.appendChild(el("div"));
        }
        wrap.appendChild(pn);
      }

      insertBeforeFoot(wrap);
      return;
    }

    if (atlasSlug && themes.length) {
      for (const card of document.querySelectorAll(".theme-talk-item")) {
        const talkLink = card.querySelector('a[href*="/talks/"]');
        if (talkLink) {
          const m = (talkLink.getAttribute("href") || "").match(/\/talks\/([^/]+)\//);
          const tInfo = m && xref.talks && xref.talks[m[1]];
          if (tInfo && tInfo.leadImage) prependCardThumb(card, tInfo.leadImage, talkLink.getAttribute("href"));
          continue;
        }
        const themeLink = card.querySelector('a[href$="/page.html"]');
        if (themeLink) {
          const m = (themeLink.getAttribute("href") || "").match(/\.\.\/([^/]+)\/page\.html/);
          const th = m && themeById.get(m[1]);
          if (th && th.leadSlide && th.leadSlide.src) prependCardThumb(card, th.leadSlide.src, themeLink.getAttribute("href"));
        }
      }

      if (atlasSlug === "conference-themes" && document.getElementById("theme-deep-dives")) return;
      const wrap = el("section", "talk-xref");
      wrap.setAttribute("aria-label", "All conference themes");

      const tIdx = themes.findIndex((t) => t.id === atlasSlug);
      if (tIdx >= 0) {
        const pn = el("div", "xref-prevnext");
        const prev = themes[(tIdx - 1 + themes.length) % themes.length];
        const next = themes[(tIdx + 1) % themes.length];
        const aPrev = el("a", "xref-pn prev");
        aPrev.href = up + prev.deepDiveHref;
        aPrev.appendChild(el("span", "pn-dir", `← Theme ${prev.num}`));
        aPrev.appendChild(el("span", "pn-title", prev.name));
        aPrev.appendChild(el("span", "pn-who", `${prev.talkCount} talks · ${prev.claimCount} claims`));
        pn.appendChild(aPrev);

        const aNext = el("a", "xref-pn next");
        aNext.href = up + next.deepDiveHref;
        aNext.appendChild(el("span", "pn-dir", `Theme ${next.num} →`));
        aNext.appendChild(el("span", "pn-title", next.name));
        aNext.appendChild(el("span", "pn-who", `${next.talkCount} talks · ${next.claimCount} claims`));
        pn.appendChild(aNext);
        wrap.appendChild(pn);
      }

      const block = el("div", "xref-block");
      const head = el("div", "xref-head");
      head.appendChild(
        el(
          "h2",
          "",
          atlasSlug === "conference-themes"
            ? "Open any theme deep-dive presentation"
            : "All 6 conference themes"
        )
      );
      const sub = el("span", "xref-sub");
      if (xref.masterPresentation) {
        const mLink = el("a", "", "Master presentation");
        mLink.href = up + xref.masterPresentation.href;
        sub.appendChild(mLink);
        sub.appendChild(document.createTextNode(" · "));
      }
      const hLink = el("a", "", "Themes hub & full claims");
      hLink.href = up + "index.html";
      sub.appendChild(hLink);
      head.appendChild(sub);
      block.appendChild(head);

      const grid = el("div", "xref-grid");
      for (const th of themes) {
        const isCurrent = th.id === atlasSlug;
        const card = el("article", "xref-card is-theme" + (isCurrent ? " is-current-theme" : ""));
        const top = el("div");
        const kick = el("div", "xc-kicker");
        kick.appendChild(el("span", "", isCurrent ? `Theme ${th.num} · current` : `Theme ${th.num}`));
        kick.appendChild(el("span", "", `${th.talkCount} talks · ${th.claimCount} claims`));
        top.appendChild(kick);
        const h3 = el("h3", "xc-title");
        const ta = el("a", "", th.name);
        ta.href = up + th.deepDiveHref;
        h3.appendChild(ta);
        top.appendChild(h3);
        top.appendChild(el("p", "xc-desc", th.claim));
        card.appendChild(top);
        prependCardThumb(card, th.leadSlide && th.leadSlide.src, up + th.deepDiveHref);
        const links = el("div", "xc-links");
        const dLink = el("a", "", isCurrent ? "Reading now" : "Open deep dive →");
        dLink.href = up + th.deepDiveHref;
        links.appendChild(dLink);
        const cLink = el("a", "", "Evidence & talks");
        cLink.href = up + th.hubAnchor;
        links.appendChild(cLink);
        card.appendChild(links);
        grid.appendChild(card);
      }
      block.appendChild(grid);
      wrap.appendChild(block);

      insertBeforeFoot(wrap);
    }
  }

  const applyNav = (x) => { if (x && x.nav && window.__CONF_FILL_NAV__) window.__CONF_FILL_NAV__(x.nav); };
  if (window.__AIE_XREF__) {
    applyNav(window.__AIE_XREF__);
    renderXref(window.__AIE_XREF__);
  } else if (src) {
    const xs = document.createElement("script");
    xs.src = up + "site/xref.js";
    xs.async = true;
    xs.onload = () => {
      if (window.__AIE_XREF__) { applyNav(window.__AIE_XREF__); renderXref(window.__AIE_XREF__); }
    };
    document.head.appendChild(xs);
  }

  // Scrollytelling rail synchronization
  const layout = document.querySelector(".talk-layout");
  const sections = [...document.querySelectorAll(".talk-copy section[data-chapter]")];
  const visuals = [...document.querySelectorAll(".talk-visual[data-visual]")];
  const rail = document.querySelector(".talk-rail");
  const visualsBox = document.querySelector(".talk-visuals");
  if (!layout || !sections.length || !visuals.length) return;

  let caption = document.querySelector(".talk-rail-caption");
  if (!caption && rail) {
    caption = el("p", "talk-rail-caption");
    caption.setAttribute("aria-live", "polite");
    rail.appendChild(caption);
  }
  let progressWrap = document.querySelector(".talk-rail-progress");
  if (!progressWrap && rail) {
    progressWrap = el("div", "talk-rail-progress");
    progressWrap.setAttribute("aria-hidden", "true");
    progressWrap.appendChild(document.createElement("span"));
    rail.appendChild(progressWrap);
  }
  const progress = progressWrap ? progressWrap.querySelector("span") : null;

  let count = document.querySelector(".talk-rail-count");
  if (!count && rail) {
    count = document.createElement("p");
    count.className = "talk-rail-count";
    count.setAttribute("aria-hidden", "true");
    rail.appendChild(count);
  }

  let beatButtons = [];
  if (rail && visualsBox && !rail.querySelector(".talk-rail-beats")) {
    const beatsBar = el("div", "talk-rail-beats");
    beatsBar.setAttribute("aria-label", "Chapters");
    beatButtons = sections.map((sec, idx) => {
      const btn = el("button", "talk-rail-beat", String(idx + 1).padStart(2, "0"));
      btn.type = "button";
      btn.title = sec.getAttribute("data-caption") || `Chapter ${idx + 1}`;
      btn.addEventListener("click", () => {
        sec.scrollIntoView({ behavior: "smooth", block: "center" });
        activate(sec);
      });
      beatsBar.appendChild(btn);
      return btn;
    });
    rail.insertBefore(beatsBar, visualsBox);
  }

  const byVisual = new Map();
  for (const v of visuals) byVisual.set(v.getAttribute("data-visual"), v);

  // Inline copies for phones: one card above each chapter, built once.
  for (const section of sections) {
    const v = byVisual.get(section.getAttribute("data-visual"));
    if (!v || section.querySelector(".inline-visual")) continue;
    const copy = v.cloneNode(true);
    copy.classList.remove("talk-visual", "is-active");
    copy.classList.add("inline-visual");
    copy.removeAttribute("data-visual");
    copy.setAttribute("aria-hidden", "true");
    section.insertBefore(copy, section.firstChild);
  }

  function activate(section) {
    const id = section.getAttribute("data-visual");
    for (const v of visuals) v.classList.toggle("is-active", v.getAttribute("data-visual") === id);
    for (const s of sections) s.classList.toggle("is-current", s === section);
    if (caption) caption.textContent = section.getAttribute("data-caption") || "";
    const i = sections.indexOf(section);
    if (progress) progress.style.width = `${((i + 1) / sections.length) * 100}%`;
    if (count) count.textContent = `${i + 1} / ${sections.length}`;
    beatButtons.forEach((b, bi) => b.classList.toggle("is-active", bi === i));
  }

  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const id = entry.target.getAttribute("data-visual");
        if (id && byVisual.has(id)) activate(entry.target);
      }
    },
    { rootMargin: "-45% 0px -45% 0px", threshold: 0 },
  );
  sections.forEach((s) => io.observe(s));

  const toggle = document.querySelector("[data-talk-collapse]");
  if (toggle) {
    toggle.addEventListener("click", () => {
      const collapsed = layout.toggleAttribute("data-talk-collapsed");
      toggle.textContent = collapsed ? "Show visuals" : "Hide visuals";
      toggle.setAttribute("aria-pressed", String(collapsed));
    });
  }

  activate(sections[0]);
})();
