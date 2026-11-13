/**
 * Universal Spatial Altitude Bar (Z1 Summit -> Z2 Theme -> Z3 Talk Story -> Z4 Evidence)
 * + Conference Compass Modal (Cmd/Ctrl+K or /) across every page in the build.
 */
(function () {
  "use strict";
  if (window.__AIE_EXPLORER_INIT__) return;
  window.__AIE_EXPLORER_INIT__ = true;

  var me =
    document.currentScript ||
    document.querySelector('script[src*="explorer.js"]');
  var src = me && me.getAttribute("src");
  var up = src ? src.replace(/site\/explorer\.js.*$/, "") : "";
  if (!src) {
    var pathDepth = location.pathname.replace(/^\//, "").split("/").length - 1;
    up = pathDepth > 0 ? new Array(pathDepth + 1).join("../") : "";
  }

  var THEME_KEY = "aie_active_theme";

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  }

  function queryParam(name) {
    try {
      return new URLSearchParams(location.search).get(name);
    } catch (e) {
      return null;
    }
  }

  function getSavedTheme() {
    try {
      return sessionStorage.getItem(THEME_KEY);
    } catch (e) {
      return null;
    }
  }

  function saveTheme(id) {
    if (!id) return;
    try {
      sessionStorage.setItem(THEME_KEY, id);
    } catch (e) {}
  }

  function appendFrom(href, themeId) {
    if (!themeId || !href || href.indexOf("?") >= 0 || /^https?:|^mailto:|^#/.test(href)) {
      return href;
    }
    var hashIdx = href.indexOf("#");
    if (hashIdx >= 0) {
      return href.slice(0, hashIdx) + "?from=" + encodeURIComponent(themeId) + href.slice(hashIdx);
    }
    return href + "?from=" + encodeURIComponent(themeId);
  }

  function detectLocation(xref) {
    var p = location.pathname;
    var themes = (xref && xref.themes) || [];
    var talks = (xref && xref.talks) || {};
    var themeById = new Map(themes.map(function (t) { return [t.id, t]; }));

    var atlasM = p.match(/\/atlases\/([^/]+)\//);
    var talkStoryM = p.match(/\/talks\/([^/]+)\/experience\//);
    var talkHubM = p.match(/\/site\/talks\/([^/]+)\.html$/);

    var fromUrl = queryParam("from");
    if (fromUrl && themeById.has(fromUrl)) saveTheme(fromUrl);

    if (atlasM) {
      var slug = atlasM[1];
      if (slug === "conference-themes") {
        return { altitude: 1, mode: "master-presentation", themeId: getSavedTheme() || (themes[0] && themes[0].id) || null, talkSlug: null };
      }
      if (themeById.has(slug)) saveTheme(slug);
      return { altitude: 2, mode: "theme-deep-dive", atlasSlug: slug, themeId: slug, talkSlug: null };
    }

    if (talkStoryM) {
      var tSlug = talkStoryM[1];
      var tInfo = talks[tSlug];
      var resolvedTheme = resolveTalkTheme(tInfo, themeById, fromUrl);
      return { altitude: 3, mode: "talk-story", talkSlug: tSlug, themeId: resolvedTheme };
    }

    if (p.endsWith("/site/talks/index.html") || p.endsWith("/site/talks/")) {
      var qTheme = queryParam("theme");
      var saved = (qTheme && themeById.has(qTheme) && qTheme) || getSavedTheme();
      return { altitude: 3, mode: "talks-directory", talkSlug: null, themeId: saved || null };
    }

    if (talkHubM && talkHubM[1] !== "index") {
      var hSlug = talkHubM[1];
      var hInfo = talks[hSlug];
      var resolvedHTheme = resolveTalkTheme(hInfo, themeById, fromUrl);
      return { altitude: 4, mode: "talk-evidence", talkSlug: hSlug, themeId: resolvedHTheme };
    }

    if (p.endsWith("/site/themes.html") || (!/\/site\//.test(p) && (p.endsWith("/index.html") || p === "/"))) {
      return { altitude: 1, mode: "summit-explorer", themeId: null, talkSlug: null };
    }

    return { altitude: 0, mode: "utility", themeId: null, talkSlug: null };
  }

  function resolveTalkTheme(talkInfo, themeById, fromUrl) {
    if (fromUrl && themeById.has(fromUrl)) return fromUrl;
    var saved = getSavedTheme();
    if (talkInfo && Array.isArray(talkInfo.themeIds)) {
      if (saved && talkInfo.themeIds.indexOf(saved) >= 0) return saved;
      if (talkInfo.themeIds.length) return talkInfo.themeIds[0];
    }
    return saved && themeById.has(saved) ? saved : null;
  }

  function withXref(cb) {
    if (window.__AIE_XREF__) {
      cb(window.__AIE_XREF__);
      return;
    }
    var existing = document.querySelector('script[src*="site/xref.js"]');
    if (existing) {
      existing.addEventListener("load", function () {
        if (window.__AIE_XREF__) cb(window.__AIE_XREF__);
      });
      return;
    }
    var s = document.createElement("script");
    s.src = up + "site/xref.js";
    s.async = true;
    s.onload = function () {
      if (window.__AIE_XREF__) cb(window.__AIE_XREF__);
    };
    document.head.appendChild(s);
  }

  function buildUi(xref) {
    if (document.querySelector(".zoom-bar-wrap")) return;

    var nav = document.querySelector(".topnav");
    if (!nav) return;

    var themes = xref.themes || [];
    var talks = xref.talks || {};
    var themeById = new Map(themes.map(function (t) { return [t.id, t]; }));
    var loc = detectLocation(xref);
    var activeTheme = loc.themeId ? themeById.get(loc.themeId) : null;
    var activeTalk = loc.talkSlug ? talks[loc.talkSlug] : null;

    var wrap = el("div", "zoom-bar-wrap");
    wrap.setAttribute("role", "region");
    wrap.setAttribute("aria-label", "Spatial altitude and zoom navigation");
    var bar = el("div", "zoom-bar");
    var track = el("div", "zoom-track");
    var actions = el("div", "zoom-actions");

    var pop = el("div", "z-popover");
    pop.hidden = true;
    document.body.appendChild(pop);

    function closePop() {
      pop.hidden = true;
      pop.textContent = "";
    }

    document.addEventListener("click", function (e) {
      if (!pop.hidden && !pop.contains(e.target) && !wrap.contains(e.target)) closePop();
    });

    function openPopover(anchorBtn, titleText, items) {
      var wasSame = !pop.hidden && pop.getAttribute("data-owner") === titleText;
      closePop();
      if (wasSame) return;

      pop.setAttribute("data-owner", titleText);
      var head = el("div", "z-pop-head");
      head.appendChild(el("span", "", titleText));
      head.appendChild(el("span", "", items.length + " options"));
      pop.appendChild(head);

      items.forEach(function (it) {
        var a = el("a", "z-pop-item" + (it.active ? " is-active" : ""));
        a.href = it.href;
        var main = el("div", "z-pop-main");
        main.appendChild(el("div", "z-pop-title", it.title));
        if (it.sub) main.appendChild(el("div", "z-pop-sub", it.sub));
        a.appendChild(main);
        if (it.meta) a.appendChild(el("span", "z-pop-meta", it.meta));
        pop.appendChild(a);
      });

      pop.hidden = false;
      var rect = anchorBtn.getBoundingClientRect();
      var left = Math.max(12, Math.min(rect.left, window.innerWidth - pop.offsetWidth - 12));
      var top = rect.bottom + 6;
      pop.style.left = left + "px";
      pop.style.top = top + "px";
    }

    function addSep() {
      track.appendChild(el("span", "z-sep", "▸"));
    }

    function makeStep(opts) {
      var sw = el("div", "z-step-wrap");
      var node = opts.href ? el("a", "z-step") : el("button", "z-step");
      if (opts.href) node.href = opts.href;
      else node.type = "button";
      if (opts.here) node.classList.add("is-here");
      if (opts.muted) node.classList.add("is-muted");
      if (opts.title) node.title = opts.title;
      node.appendChild(el("span", "z-tag", opts.tag));
      node.appendChild(el("span", "z-lbl", opts.label));
      if (opts.onClick) {
        node.appendChild(el("span", "z-caret", "▾"));
        node.addEventListener("click", function (e) {
          e.preventDefault();
          opts.onClick(node);
        });
      }
      sw.appendChild(node);
      track.appendChild(sw);
      return node;
    }

    function themeItems(filterIds) {
      var list = filterIds && filterIds.length
        ? filterIds.map(function (id) { return themeById.get(id); }).filter(Boolean)
        : themes;
      return list.map(function (th) {
        return {
          title: "Theme " + th.num + ": " + th.name,
          sub: th.talkCount + " talks · " + th.claimCount + " claims",
          meta: "Z2 →",
          href: up + th.deepDiveHref,
          active: activeTheme && activeTheme.id === th.id,
        };
      });
    }

    function talkItems(slugList, fromThemeId) {
      return slugList
        .map(function (slug) { return talks[slug]; })
        .filter(Boolean)
        .map(function (t) {
          return {
            title: t.title,
            sub: t.speakers || t.when || "",
            meta: "Z3 →",
            href: appendFrom(up + t.storyHref, fromThemeId),
            active: activeTalk && activeTalk.slug === t.slug,
          };
        });
    }

    if (loc.altitude === 0) {
      makeStep({
        tag: "Z1",
        label: "Summit Themes",
        href: up + "index.html",
        title: "Return to the 6-theme post-conference hub",
      });
      addSep();
      makeStep({
        tag: "VIEW",
        label: (document.title || "").split("·")[0].trim() || "Archive",
        here: true,
      });
    } else {
      // Z1 Summit
      makeStep({
        tag: "Z1",
        label: loc.mode === "master-presentation" ? "Summit (Guided)" : "Summit",
        href: up + "index.html",
        here: loc.altitude === 1,
        title: "Zoom out to the 6-layer Summit overview",
      });
      addSep();

      // Z2 Theme
      if (loc.altitude === 1) {
        makeStep({
          tag: "Z2",
          label: "Pick a theme",
          muted: true,
          onClick: function (btn) {
            openPopover(btn, "Zoom into a Z2 Theme Deep Dive", themeItems());
          },
        });
      } else if (loc.mode === "talks-directory") {
        makeStep({
          tag: "Z2",
          label: activeTheme ? "Theme " + activeTheme.num + ": " + activeTheme.name : "All " + (xref.themes || []).length + " themes",
          muted: !activeTheme,
          onClick: function (btn) {
            openPopover(btn, "Switch to Z2 Theme Deep Dive", themeItems());
          },
        });
      } else if (loc.altitude === 2 && loc.atlasSlug && loc.atlasSlug !== "conference-themes" && !activeTheme) {
        // A through-line atlas that is not one theme's deep dive.
        makeStep({
          tag: "Z2",
          label: loc.atlasSlug.replace(/-/g, " "),
          here: true,
        });
      } else if (activeTheme) {
        makeStep({
          tag: "Z2",
          label: "Theme " + activeTheme.num + ": " + activeTheme.name,
          href: loc.altitude === 2 ? null : up + activeTheme.deepDiveHref,
          here: loc.altitude === 2,
          onClick: loc.altitude === 2
            ? function (btn) { openPopover(btn, "Switch Z2 Theme Deep Dive", themeItems()); }
            : activeTalk && activeTalk.themeIds && activeTalk.themeIds.length > 1
              ? function (btn) {
                  var list = themeItems(activeTalk.themeIds).concat([
                    { title: "All " + (xref.themes || []).length + " themes overview", sub: "Guided conference presentation", meta: "Z1", href: up + xref.masterPresentation.href, active: false },
                  ]);
                  openPopover(btn, "Themes for this talk (or jump)", list);
                }
              : null,
        });
      } else {
        makeStep({
          tag: "Z2",
          label: "All themes",
          href: up + "index.html",
        });
      }

      addSep();

      // Z3 Talk Story
      if (loc.altitude === 1) {
        makeStep({
          tag: "Z3",
          label: "34 talks",
          href: up + "site/talks/index.html",
          muted: true,
        });
      } else if (loc.mode === "talks-directory") {
        makeStep({
          tag: "Z3",
          label: "All 34 Talks",
          here: true,
        });
      } else if (loc.altitude === 2) {
        var themeTalkSlugs = (activeTheme && activeTheme.talkSlugs) || (xref.scheduleOrder || []).map(function (o) { return o.slug; });
        makeStep({
          tag: "Z3",
          label: themeTalkSlugs.length + " talks in theme",
          muted: true,
          onClick: function (btn) {
            openPopover(
              btn,
              activeTheme ? "Talks in Theme " + activeTheme.num : "Recorded Talks",
              talkItems(themeTalkSlugs, activeTheme && activeTheme.id)
            );
          },
        });
      } else if (activeTalk) {
        makeStep({
          tag: "Z3",
          label: activeTalk.title,
          href: loc.altitude === 3 ? null : appendFrom(up + activeTalk.storyHref, activeTheme && activeTheme.id),
          here: loc.altitude === 3,
          title: activeTalk.title,
        });
      }

      addSep();

      // Z4 Evidence
      if (activeTalk) {
        makeStep({
          tag: "Z4",
          label: "Evidence & Transcript",
          href: loc.altitude === 4 ? null : appendFrom(up + activeTalk.hubHref, activeTheme && activeTheme.id),
          here: loc.altitude === 4,
        });
      } else {
        makeStep({
          tag: "Z4",
          label: "Evidence",
          href: up + "index.html#evidence",
          muted: true,
        });
      }
    }

    // Zoom Out / Zoom In buttons
    var outTarget = null;
    var inTarget = null;
    var inAction = null;

    if (loc.altitude === 0) {
      outTarget = up + "index.html";
    } else if (loc.altitude === 1) {
      if (loc.mode === "master-presentation") {
        outTarget = up + "index.html";
        inTarget = themes[0] ? up + themes[0].deepDiveHref : null;
      } else {
        inTarget = up + ((xref.masterPresentation && xref.masterPresentation.href) || "atlases/conference-themes/page.html");
      }
    } else if (loc.altitude === 2) {
      outTarget = up + "index.html" + (activeTheme ? "#" + activeTheme.id : "");
      if (document.getElementById("talks-in-theme")) {
        inAction = function () {
          document.getElementById("talks-in-theme").scrollIntoView({ behavior: "smooth", block: "start" });
        };
      }
    } else if (loc.altitude === 3) {
      if (loc.mode === "talks-directory") {
        outTarget = up + "index.html";
      } else {
        outTarget = activeTheme ? up + activeTheme.deepDiveHref : up + "site/talks/index.html";
        inTarget = activeTalk ? appendFrom(up + activeTalk.hubHref, activeTheme && activeTheme.id) : null;
      }
    } else if (loc.altitude === 4) {
      outTarget = activeTalk ? appendFrom(up + activeTalk.storyHref, activeTheme && activeTheme.id) : up + "site/talks/index.html";
    }

    var outEl = outTarget ? el("a", "z-btn") : el("button", "z-btn is-disabled");
    outEl.textContent = "− Out";
    if (outTarget) {
      outEl.href = outTarget;
      outEl.title = "Zoom out one level ([)";
    } else {
      outEl.type = "button";
      outEl.disabled = true;
    }
    actions.appendChild(outEl);

    var inEl = inTarget ? el("a", "z-btn") : el("button", "z-btn");
    inEl.textContent = "+ In";
    if (inTarget) {
      inEl.href = inTarget;
      inEl.title = "Zoom in one level (])";
    } else if (inAction) {
      inEl.type = "button";
      inEl.title = "Jump down to talks in this theme (])";
      inEl.addEventListener("click", inAction);
    } else {
      inEl.type = "button";
      inEl.disabled = true;
      inEl.classList.add("is-disabled");
    }
    actions.appendChild(inEl);

    var compassBtn = el("button", "z-btn compass-btn");
    compassBtn.type = "button";
    compassBtn.title = "Search themes, debates & talks (Cmd+K or /)";
    compassBtn.appendChild(document.createTextNode("Explore "));
    compassBtn.appendChild(el("kbd", "", "⌘K"));
    actions.appendChild(compassBtn);

    bar.appendChild(track);
    bar.appendChild(actions);
    wrap.appendChild(bar);
    nav.insertAdjacentElement("afterend", wrap);

    // Annotate existing talk links inside a theme deep dive with ?from=<theme-id>
    if (loc.altitude === 2 && activeTheme) {
      document.querySelectorAll('a[href*="/talks/"]').forEach(function (a) {
        var h = a.getAttribute("href");
        if (h) a.setAttribute("href", appendFrom(h, activeTheme.id));
      });
    }

    // Build Compass Modal (⌘K)
    var modal = buildCompassModal(xref, up);
    compassBtn.addEventListener("click", modal.open);

    // Keyboard shortcuts: Cmd/Ctrl+K, /, [, ]
    document.addEventListener("keydown", function (e) {
      var tag = e.target && e.target.tagName;
      var inField = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (e.target && e.target.isContentEditable);
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        modal.toggle();
        return;
      }
      if (inField) return;
      if (e.key === "/") {
        e.preventDefault();
        modal.open();
      } else if (e.key === "[" && outTarget) {
        location.href = outTarget;
      } else if (e.key === "]") {
        if (inTarget) location.href = inTarget;
        else if (inAction) inAction();
      }
    });
  }

  function buildCompassModal(xref, up) {
    var backdrop = el("div", "compass-backdrop");
    backdrop.hidden = true;
    var dialog = el("div", "compass-dialog");
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-label", "Conference Compass");

    var sRow = el("div", "compass-search-row");
    var sLbl = el("label", "", "COMPASS");
    sLbl.setAttribute("for", "compass-q");
    var input = el("input", "compass-input");
    input.id = "compass-q";
    input.type = "search";
    input.placeholder = "Jump to any theme, speaker, talk, or debate…";
    var closeBtn = el("button", "compass-close", "ESC");
    closeBtn.type = "button";
    sRow.appendChild(sLbl);
    sRow.appendChild(input);
    sRow.appendChild(closeBtn);

    var results = el("div", "compass-results");
    var foot = el("div", "compass-foot");
    foot.appendChild(el("span", "", "6 themes · 6 debates · " + Object.keys(xref.talks || {}).length + " talks"));
    foot.appendChild(el("span", "", "↑↓ select · Enter open · [ / ] zoom out / in"));

    dialog.appendChild(sRow);
    dialog.appendChild(results);
    dialog.appendChild(foot);
    backdrop.appendChild(dialog);
    document.body.appendChild(backdrop);

    var allThemes = xref.themes || [];
    var allContested = xref.contested || [];
    var allTalks = (xref.scheduleOrder || []).map(function (o) {
      return (xref.talks && xref.talks[o.slug]) || o;
    });

    var selectedIdx = 0;
    var selectableRows = [];

    function renderList(qRaw) {
      results.textContent = "";
      selectableRows = [];
      selectedIdx = 0;
      var q = (qRaw || "").trim().toLowerCase();
      var tokens = q ? q.split(/\s+/) : [];
      var matchText = function (hay) {
        if (!tokens.length) return true;
        var low = (hay || "").toLowerCase();
        return tokens.every(function (tok) { return low.indexOf(tok) >= 0; });
      };

      // 1. Themes (+ Guided Master Overview)
      var matchedThemes = allThemes.filter(function (th) {
        return matchText([th.name, th.claim, (th.alsoCalled || []).join(" "), (th.topSpeakers || []).join(" ")].join(" "));
      });

      if (!q || matchedThemes.length || matchText((((xref.masterPresentation && xref.masterPresentation.title) || "") + " overview master presentation").toLowerCase())) {
        var tg = el("div", "compass-group");
        tg.appendChild(el("div", "compass-group-title", "Z1–Z2 · Conference Themes & Deep Dives"));
        var tl = el("div", "compass-list");

        if (!q || matchText((((xref.masterPresentation && xref.masterPresentation.title) || "") + " master themes presentation overview").toLowerCase())) {
          tl.appendChild(makeRow({
            img: null,
            mono: "Z1",
            title: (xref.masterPresentation && xref.masterPresentation.title) || "All themes",
            sub: (xref.masterPresentation && xref.masterPresentation.subtitle) || "Guided presentation across every theme",
            href: up + ((xref.masterPresentation && xref.masterPresentation.href) || "atlases/conference-themes/page.html"),
            badge: "Z1 Presentation →",
            badgeGo: true,
          }));
        }

        matchedThemes.forEach(function (th) {
          tl.appendChild(makeRow({
            img: th.leadSlide && th.leadSlide.src ? up + th.leadSlide.src : null,
            mono: "T" + th.num,
            title: "Theme " + th.num + ": " + th.name,
            sub: th.claim,
            href: up + th.deepDiveHref,
            badge: "Z2 Deep Dive →",
            badgeGo: true,
          }));
        });
        tg.appendChild(tl);
        results.appendChild(tg);
      }

      // 2. Contested Debates
      var matchedDebates = allContested.filter(function (d) {
        return matchText(d.question + " " + (d.sides || []).map(function (s) { return s.speakers + " " + s.stance; }).join(" "));
      });
      if (matchedDebates.length) {
        var dg = el("div", "compass-group");
        dg.appendChild(el("div", "compass-group-title", "Contested Fault Lines"));
        var dl = el("div", "compass-list");
        matchedDebates.slice(0, q ? 6 : 3).forEach(function (d) {
          dl.appendChild(makeRow({
            img: null,
            mono: "VS",
            title: d.question,
            sub: (d.sides || []).map(function (s) { return s.speakers; }).filter(Boolean).join(" vs. "),
            href: up + "index.html#contested",
            badge: "Compare →",
          }));
        });
        dg.appendChild(dl);
        results.appendChild(dg);
      }

      // 3. Talks
      var matchedTalks = allTalks.filter(function (t) {
        return matchText([t.title, t.speakers, t.thesis, t.when].join(" "));
      });
      if (matchedTalks.length) {
        var kg = el("div", "compass-group");
        kg.appendChild(el("div", "compass-group-title", "Z3–Z4 · Talks (" + matchedTalks.length + ")"));
        var kl = el("div", "compass-list");
        matchedTalks.slice(0, q ? 20 : 8).forEach(function (t) {
          kl.appendChild(makeRow({
            img: t.leadImage ? up + t.leadImage : null,
            mono: "TALK",
            title: t.title,
            sub: [t.speakers, t.thesis].filter(Boolean).join(" · "),
            href: up + t.storyHref,
            badge: "Z3 Story →",
            hubHref: up + t.hubHref,
          }));
        });
        kg.appendChild(kl);
        results.appendChild(kg);
      }

      if (!selectableRows.length) {
        results.appendChild(el("div", "compass-empty", "No matching themes, debates, or talks."));
      } else {
        updateSelection(0);
      }
    }

    function makeRow(cfg) {
      var row = el("a", "compass-row");
      row.href = cfg.href;
      var thumb = el("div", "compass-thumb");
      if (cfg.img) {
        var im = document.createElement("img");
        im.src = cfg.img;
        im.alt = "";
        im.loading = "lazy";
        thumb.appendChild(im);
      } else {
        thumb.textContent = cfg.mono;
      }
      var main = el("div", "compass-main");
      main.appendChild(el("div", "compass-title", cfg.title));
      if (cfg.sub) main.appendChild(el("div", "compass-sub", cfg.sub));

      var links = el("div", "compass-links");
      links.appendChild(el("span", "compass-badge" + (cfg.badgeGo ? " go" : ""), cfg.badge));
      if (cfg.hubHref) {
        var hBtn = el("span", "compass-badge hub", "Z4 Hub");
        hBtn.addEventListener("click", function (ev) {
          ev.preventDefault();
          ev.stopPropagation();
          location.href = cfg.hubHref;
        });
        links.appendChild(hBtn);
      }

      row.appendChild(thumb);
      row.appendChild(main);
      row.appendChild(links);
      row.addEventListener("click", close);
      selectableRows.push(row);
      return row;
    }

    function updateSelection(idx) {
      if (!selectableRows.length) return;
      selectedIdx = (idx + selectableRows.length) % selectableRows.length;
      selectableRows.forEach(function (r, i) {
        r.classList.toggle("is-selected", i === selectedIdx);
      });
      var cur = selectableRows[selectedIdx];
      if (cur && cur.scrollIntoView) cur.scrollIntoView({ block: "nearest" });
    }

    function open() {
      backdrop.hidden = false;
      renderList(input.value);
      input.focus();
      input.select();
    }

    function close() {
      backdrop.hidden = true;
    }

    function toggle() {
      if (backdrop.hidden) open();
      else close();
    }

    input.addEventListener("input", function () {
      renderList(input.value);
    });
    input.addEventListener("keydown", function (e) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        updateSelection(selectedIdx + 1);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        updateSelection(selectedIdx - 1);
      } else if (e.key === "Enter" && selectableRows[selectedIdx]) {
        e.preventDefault();
        selectableRows[selectedIdx].click();
      } else if (e.key === "Escape") {
        e.preventDefault();
        close();
      }
    });

    closeBtn.addEventListener("click", close);
    backdrop.addEventListener("click", function (e) {
      if (e.target === backdrop) close();
    });

    return { open: open, close: close, toggle: toggle };
  }

  withXref(buildUi);
})();
