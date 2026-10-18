/* Game stats on roblox.com from Creator Exchange (creatorexchange.io): estimated
   revenue and its trend plus total visits on every game card, and a stats strip on
   game pages, a 7-day player graph when you point at a card's stats, a sort control on
   Charts, and a watchlist (star on the game page, listed in the popup). The numbers
   come from background.js. chrome.storage.sync: { stats, sort, watch: [{ id, place, name }] }.

   The cards are React-owned, so nothing on them is changed: one element is added
   over the thumbnail (cards have fixed heights and hover layouts, so anything below
   the title gets covered), and it is added again if React re-renders the card. */
(() => {
  const DEFAULTS = { stats: true, sort: "default", watch: [] };
  let on = DEFAULTS.stats;
  let sortBy = DEFAULTS.sort;
  let watched = new Set();
  let watchList = []; // [{ id, place, name }], for the strip on Home

  const fmt = (n, digits = 1) => {
    if (n == null || !isFinite(n)) return "–";
    const a = Math.abs(n);
    for (const [v, s] of [[1e12, "T"], [1e9, "B"], [1e6, "M"], [1e3, "K"]]) {
      if (a >= v) return +(n / v).toFixed(digits) + s;
    }
    return String(Math.round(n));
  };
  const pct = (n) => (n == null || !isFinite(n) ? "" : `${n >= 0 ? "+" : ""}${Math.round(n)}%`);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

  const ICON = {
    robux: '<svg viewBox="0 0 16 16"><path d="M8 1.5 13.6 4.75v6.5L8 14.5 2.4 11.25v-6.5Z"/><rect x="5.75" y="5.75" width="4.5" height="4.5" rx=".8"/></svg>',
    visits: '<svg viewBox="0 0 16 16"><circle cx="6" cy="5.5" r="2.3"/><path d="M1.8 13c.4-2.4 2.1-3.6 4.2-3.6s3.8 1.2 4.2 3.6"/><path d="M10.6 3.4a2.2 2.2 0 0 1 0 4.2M11.9 9.6c1.3.5 2.1 1.6 2.3 3.4"/></svg>',
  };
  const arrow = (t) => (t == null || t === 0 ? "" : t > 0 ? '<b class="rcx-up">↑</b>' : '<b class="rcx-down">↓</b>');
  const trendTitle = (t) => (t == null ? "" : ` (${pct(t)} vs the period before)`);

  function ask(msg) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(msg, (r) => resolve(chrome.runtime.lastError ? null : r));
      } catch {
        resolve(null); // extension was reloaded: this old page can't reach it any more
      }
    });
  }

  /* ---- game cards (charts, home, discover, search) ---- */
  const universeOf = (a) => {
    if (/^\d+$/.test(a.id)) return a.id;
    const m = (a.getAttribute("href") || "").match(/[?&]universeId=(\d+)/);
    return m ? m[1] : null;
  };
  const nameOf = (a) =>
    a.querySelector(".game-card-name")?.getAttribute("title") ||
    a.querySelector(".game-card-name")?.textContent ||
    a.querySelector("img[alt]")?.getAttribute("alt") ||
    "";

  const stats = new Map(); // universeId -> stats (or { missing })

  function cardHtml(s) {
    return (
      (watched.has(s.universeId) ? '<span class="rcx-pill rcx-star" title="On your watchlist">★</span>' : "") +
      // exact numbers and the player graph open when you point at these (showSpark)
      `<span class="rcx-pill rcx-rev">${ICON.robux}${fmt(s.revenue)}${arrow(s.revenueTrend)}</span>` +
      `<span class="rcx-pill">${ICON.visits}${fmt(s.visits, 0)}</span>`
    );
  }

  const THUMB = ".game-card-thumb-container, .featured-game-icon-container, .game-card-thumb";
  const thumbOf = (a) => a.querySelector(THUMB) || a;
  const boxOf = (a) => thumbOf(a).querySelector(":scope > .rcx-card");

  function paintCard(a, s) {
    let box = boxOf(a);
    if (!s || s.missing || s.revenue == null) {
      box?.remove();
      return;
    }
    if (!box) {
      box = document.createElement("div");
      box.className = "rcx-card";
      thumbOf(a).appendChild(box);
    }
    const html = cardHtml(s);
    if (box.innerHTML !== html) box.innerHTML = html;
  }

  const pending = new Map(); // universeId -> name, waiting for the next batch
  let batchTimer = 0;

  function scanCards() {
    for (const a of document.querySelectorAll("a.game-card-link")) {
      const id = universeOf(a);
      if (!id) continue;
      if (stats.has(id)) {
        if (!boxOf(a)) paintCard(a, stats.get(id));
      } else if (!pending.has(id)) {
        pending.set(id, nameOf(a).trim());
      }
    }
    if (pending.size && !batchTimer) batchTimer = setTimeout(flush, 120);
  }

  function paintAll(got) {
    for (const a of document.querySelectorAll("a.game-card-link")) {
      const id = universeOf(a);
      if (id && got[id]) paintCard(a, got[id]);
    }
    queueSort();
  }

  // First from the cache / top games (one quick answer for the whole page), then the
  // rest by name in small groups, so cards fill in as their searches finish.
  async function flush() {
    batchTimer = 0;
    const games = [...pending].slice(0, 120).map(([id, name]) => ({ id, name }));
    games.forEach((g) => (pending.delete(g.id), stats.set(g.id, null))); // asked: don't ask again
    const got = (await ask({ type: "rcx-stats", games })) || {};
    for (const [id, s] of Object.entries(got)) stats.set(id, s);
    paintAll(got);
    const rest = games.filter((g) => !got[g.id]);
    if (pending.size) batchTimer = setTimeout(flush, 120);
    for (let i = 0; i < rest.length; i += 8) {
      const group = rest.slice(i, i + 8);
      const found = (await ask({ type: "rcx-stats", games: group, search: true })) || {};
      for (const g of group) stats.set(g.id, found[g.id] || { missing: true });
      paintAll(found);
    }
  }

  /* ---- game page ---- */
  let pagePainted = "";

  async function scanGamePage() {
    const meta = document.getElementById("game-detail-meta-data");
    const id = meta?.dataset.universeId;
    const anchor = document.querySelector(".game-main-content");
    if (!id || !anchor || pagePainted === id) return;
    pagePainted = id;
    const name = meta.dataset.placeName || document.querySelector(".game-name")?.textContent || "";
    // placeholder tiles right away, so the strip doesn't pop in late
    document.getElementById("rcx-panel")?.remove();
    const panel = document.createElement("div");
    panel.id = "rcx-panel";
    panel.className = "col-xs-12";
    panel.innerHTML = `<div class="rcx-panel-grid">${'<div class="rcx-tile rcx-skel"><div class="rcx-label"></div><div class="rcx-value"></div></div>'.repeat(6)}</div>`;
    anchor.after(panel);
    const [list, extra] = await Promise.all([
      ask({ type: "rcx-stats", games: [{ id, name }], search: true }),
      ask({ type: "rcx-details", id }),
    ]);
    const s = list?.[id];
    if (!s || s.missing) return panel.remove();
    const d = extra || {};
    const tile = (label, value, sub = "", title = "") =>
      `<div class="rcx-tile" title="${esc(title)}"><div class="rcx-label">${label}</div>` +
      `<div class="rcx-value">${value}</div>${sub ? `<div class="rcx-sub">${sub}</div>` : ""}</div>`;
    const trend = (n) =>
      n == null ? "" : `<span class="${n >= 0 ? "rcx-up" : "rcx-down"}">${pct(n)}</span> this week`;
    const tiles = [
      tile("Est. revenue", `R$ ${fmt(s.revenue)} ${arrow(s.revenueTrend)}`,
        s.revenueTrend == null ? "" : `<span class="${s.revenueTrend >= 0 ? "rcx-up" : "rcx-down"}">${pct(s.revenueTrend)}</span> trend`,
        "Creator Exchange's revenue estimate" + trendTitle(s.revenueTrend)),
      tile("Playing", fmt(s.playing), trend(d.playersWeek), s.playing != null ? Number(s.playing).toLocaleString() + " players" : ""),
      // how well the game earns for its size: revenue estimate per player online now
      s.revenue != null && s.playing > 0
        ? tile("Per player", "R$ " + fmt(s.revenue / s.playing), "right now", "Estimated revenue divided by the players online right now")
        : "",
      tile("Visits", fmt(s.visits), trend(d.visitsWeek), s.visits != null ? Number(s.visits).toLocaleString() + " visits" : ""),
      tile("Rating", s.likeRatio != null ? Math.round(s.likeRatio) + "%" : "–", s.favorites != null ? fmt(s.favorites) + " favorites" : "likes"),
      d.rank ? tile("Global rank", "#" + Number(d.rank).toLocaleString(), d.momentum ? esc(d.momentum) : "") : "",
      d.session ? tile("Avg. session", Math.round(d.session) + " min") : "",
    ].join("");
    panel.innerHTML =
      `<div class="rcx-panel-grid">${tiles}</div>` +
      `<div class="rcx-chart7" hidden></div>` +
      `<div class="rcx-panel-foot"><button type="button" class="rcx-watch"></button>` +
      `<button type="button" class="rcx-watch rcx-copy" data-copy="${esc(id)}" title="Copy the universe ID">Universe ${esc(id)}</button>` +
      (meta.dataset.placeId ? `<button type="button" class="rcx-watch rcx-copy" data-copy="${esc(meta.dataset.placeId)}" title="Copy the place ID">Place ${esc(meta.dataset.placeId)}</button>` : "") +
      `<a class="rcx-source" href="https://creatorexchange.io/roblox-game/${id}" target="_blank" rel="noopener">` +
      `Estimates by Creator Exchange ↗</a></div>`;
    const btn = panel.querySelector(".rcx-watch");
    const label = () => {
      const w = watched.has(id);
      btn.classList.toggle("rcx-watching", w);
      btn.textContent = w ? "★ Watching" : "☆ Watch";
    };
    label();
    btn.addEventListener("click", () => {
      if (!rcAlive()) return;
      chrome.storage.sync.get(DEFAULTS, (st) => {
        const list = st.watch.filter((g) => g.id !== id);
        if (!watched.has(id)) list.unshift({ id, place: meta.dataset.placeId || "", name: s.name || name });
        chrome.storage.sync.set({ watch: list.slice(0, 60) });
      });
    });
    for (const c of panel.querySelectorAll(".rcx-copy")) {
      c.addEventListener("click", () => navigator.clipboard.writeText(c.dataset.copy).then(() => {
        const old = c.textContent;
        c.textContent = "Copied";
        setTimeout(() => (c.textContent = old), 1200);
      }));
    }
    panel.rcxLabel = label;
    if (!panel.isConnected) anchor.after(panel);
    // players over the last 7 days, full width under the tiles
    ask({ type: "rcx-history", id }).then((h) => {
      const box = panel.querySelector(".rcx-chart7");
      if (!box || !h?.points || h.points.length < 3) return;
      const ys = h.points.map((p) => p[1]);
      const now = ys[ys.length - 1], change = ys[0] ? ((now - ys[0]) / ys[0]) * 100 : null;
      box.innerHTML =
        `<div class="rcx-chart7-head"><span>Players, last 7 days` +
        (change == null ? "" : ` · <span class="${change >= 0 ? "rcx-up" : "rcx-down"}">${pct(change)}</span>`) +
        `</span><span>Now <b>${fmt(now)}</b> · Peak <b>${fmt(Math.max(...ys))}</b> · Low <b>${fmt(Math.min(...ys))}</b></span></div>` +
        sparkSvg(h.points, 1000, 80).replace("<svg ", '<svg preserveAspectRatio="none" ');
      box.hidden = false;
    });
  }

  /* ---- Home: your watchlist as a strip under the page title ---- */
  let homeFor = "", homeBusy = false;
  async function scanHome() {
    if (location.pathname.replace(/\/+$/, "") !== "/home") return;
    const strip = document.getElementById("rcx-home");
    const key = watchList.map((g) => g.id).join(",");
    if (!watchList.length) return strip?.remove();
    const skip = '.left-nav, [role="dialog"], [class*="dialog"], [class*="modal"], footer, #header';
    const title = document.querySelector("[data-rc-greeting]") || [...document.querySelectorAll("h1")].find((h) => !h.closest(skip) && h.textContent.trim());
    if (!title) return;
    if (strip && homeFor === key) {
      if (!strip.isConnected || strip.previousElementSibling !== title) title.after(strip); // React re-rendered around it
      return;
    }
    if (homeBusy) return;
    homeBusy = true;
    const st = (await ask({ type: "rcx-stats", games: watchList.map((g) => ({ id: String(g.id), name: String(g.name || "") })), search: true })) || {};
    homeBusy = false;
    homeFor = key;
    const box = strip || Object.assign(document.createElement("div"), { id: "rcx-home" });
    box.innerHTML =
      `<div class="rcx-home-head"><span>Your watchlist</span><span class="rcx-home-note">Estimates by Creator Exchange</span></div><div class="rcx-home-row">` +
      watchList.slice(0, 12).map((g) => {
        const s = st[g.id] || {};
        const href = g.place ? `/games/${encodeURIComponent(g.place)}` : `https://creatorexchange.io/roblox-game/${encodeURIComponent(g.id)}`;
        return `<a class="rcx-home-tile" href="${href}"${g.place ? "" : ' target="_blank" rel="noopener"'}>` +
          `<span class="rcx-home-name">${esc(s.name || g.name || g.id)}</span>` +
          `<span class="rcx-home-rev">${s.revenue != null ? "R$ " + fmt(s.revenue) + arrow(s.revenueTrend) : "not tracked"}</span>` +
          `<span class="rcx-home-sub">${s.playing != null ? fmt(s.playing) + " playing" : ""}</span></a>`;
      }).join("") + `</div>`;
    if (!box.isConnected || box.previousElementSibling !== title) title.after(box);
  }

  /* ---- community pages: totals across the group's experiences ----
     The group's public games (Roblox) with Creator Exchange's estimates for the tracked ones,
     in a strip above the About / Events tabs. */
  let groupPainted = "";
  async function scanGroupPage() {
    const gid = location.pathname.match(/^\/(?:communities|groups)\/(\d+)/)?.[1];
    const tabs = document.querySelector('[role="tablist"]');
    if (!gid || !tabs || groupPainted === gid || !document.querySelector(".profile-header-details-community-name")) return;
    groupPainted = gid;
    // every public game (up to 500), biggest first; Creator Exchange is asked about the top 30
    const games = [];
    let cursor = "";
    for (let page = 0; page < 5; page++) {
      const r = await fetch(`https://games.roblox.com/v2/groups/${gid}/gamesV2?accessFilter=2&limit=100&sortOrder=Asc${cursor ? "&cursor=" + encodeURIComponent(cursor) : ""}`, { credentials: "include" }).catch(() => null);
      if (!r?.ok) break;
      const j = await r.json();
      games.push(...(j.data || []));
      if (!(cursor = j.nextPageCursor)) break;
    }
    if (!games.length) return;
    games.sort((a, b) => (b.placeVisits || 0) - (a.placeVisits || 0));
    const st = (await ask({ type: "rcx-stats", games: games.slice(0, 30).map((g) => ({ id: String(g.id), name: g.name })), search: true })) || {};
    const tracked = games.map((g) => st[String(g.id)]).filter((x) => x && !x.missing);
    const sum = (k) => tracked.reduce((n, x) => n + (x[k] || 0), 0);
    const top = [...tracked].sort((a, b) => (b.revenue || 0) - (a.revenue || 0))[0];
    const tile = (label, value, sub = "") =>
      `<div class="rcx-tile"><div class="rcx-label">${label}</div><div class="rcx-value">${value}</div>${sub ? `<div class="rcx-sub">${sub}</div>` : ""}</div>`;
    document.getElementById("rcx-group")?.remove();
    const box = document.createElement("div");
    box.id = "rcx-group";
    box.innerHTML = `<div class="rcx-panel-grid">` +
      (tracked.length ? tile("Est. revenue", "R$ " + fmt(sum("revenue")), `${tracked.length} tracked game${tracked.length > 1 ? "s" : ""}`) : "") +
      tile("Experiences", String(games.length) + (games.length >= 500 ? "+" : ""), "public") +
      (tracked.length ? tile("Playing now", fmt(sum("playing")), "in tracked games") : "") +
      tile("Visits", fmt(games.reduce((n, g) => n + (g.placeVisits || 0), 0)), "all public games") +
      (top ? tile("Top earner", esc(top.name || ""), "R$ " + fmt(top.revenue)) : "") +
      `</div><a class="rcx-source" href="https://creatorexchange.io" target="_blank" rel="noopener">Estimates by Creator Exchange ↗</a>`;
    tabs.before(box);
  }

  /* ---- Charts: sort every row by a stat (control under the page title) ----
     The rows are flex lists owned by React, so the cards are never moved: a generated
     stylesheet gives each card's <li> an `order`, matched by its universe id. */
  const SORTS = [
    ["default", "Default"],
    ["revenue", "Revenue"],
    ["visits", "Visits"],
    ["trend", "Rising"],
    ["perplayer", "Per player"],
  ];
  const sortValue = (st) =>
    !st || st.missing ? null
      : sortBy === "revenue" ? st.revenue
      : sortBy === "visits" ? st.visits
      : sortBy === "perplayer" ? (st.revenue != null && st.playing > 0 ? st.revenue / st.playing : null)
      : st.revenueTrend;

  function applySort() {
    let css = "";
    if (on && sortBy !== "default") {
      const ids = [...new Set([...document.querySelectorAll("a.game-card-link")].map(universeOf).filter(Boolean))];
      const ranked = ids
        .map((id) => [id, sortValue(stats.get(id))])
        .sort((a, b) => (b[1] ?? -Infinity) - (a[1] ?? -Infinity));
      css = ranked
        .map(([id, v], i) => `li:has(> div > a.game-card-link[id="${id}"]){order:${v == null ? 99999 : i}}`)
        .join("\n");
    }
    let tag = document.getElementById("rcx-sort-css");
    if (!tag) {
      tag = document.createElement("style");
      tag.id = "rcx-sort-css";
      document.documentElement.appendChild(tag);
    }
    if (tag.textContent !== css) tag.textContent = css;
  }
  let sortTimer = 0;
  const queueSort = () => {
    clearTimeout(sortTimer);
    sortTimer = setTimeout(applySort, 200);
  };

  function placeSortControl() {
    if (!location.pathname.startsWith("/charts") || document.getElementById("rcx-sort")) return;
    const host = document.querySelector(".games-list-header");
    if (!host) return;
    const bar = document.createElement("div");
    bar.id = "rcx-sort";
    bar.innerHTML =
      '<span class="rcx-sort-label">Sort</span>' +
      SORTS.map(([k, t]) => `<button type="button" data-k="${k}">${t}</button>`).join("");
    bar.addEventListener("click", (e) => {
      const k = e.target.closest("button")?.dataset.k;
      if (k && rcAlive()) chrome.storage.sync.set({ sort: k });
    });
    host.appendChild(bar);
    markSort();
  }
  const markSort = () =>
    document.querySelectorAll("#rcx-sort button").forEach((b) => b.classList.toggle("rcx-active", b.dataset.k === sortBy));

  /* ---- hover sparkline: players over the last 7 days ---- */
  let sparkFor = null, sparkTimer = 0;
  const spark = () => {
    let el = document.getElementById("rcx-spark");
    if (!el) {
      el = document.createElement("div");
      el.id = "rcx-spark";
      document.documentElement.appendChild(el);
    }
    return el;
  };
  function hideSpark() {
    clearTimeout(sparkTimer);
    sparkFor = null;
    document.getElementById("rcx-spark")?.classList.remove("rcx-show");
  }

  function sparkSvg(points, w, h) {
    const ys = points.map((p) => p[1]);
    const lo = Math.min(...ys), hi = Math.max(...ys), span = hi - lo || 1;
    const t0 = points[0][0], tspan = points[points.length - 1][0] - t0 || 1;
    const xy = points.map(([t, v]) => [((t - t0) / tspan) * w, h - 3 - ((v - lo) / span) * (h - 6)]);
    const line = xy.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join("");
    const area = `${line}L${w},${h}L0,${h}Z`;
    const up = ys[ys.length - 1] >= ys[0];
    return (
      `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" class="${up ? "rcx-up" : "rcx-down"}">` +
      `<path d="${area}" class="rcx-area"/><path d="${line}" class="rcx-line"/></svg>`
    );
  }

  async function showSpark(a) {
    const id = universeOf(a);
    const st = stats.get(id);
    if (!id || !st || st.missing) return;
    sparkFor = a;
    const h = await ask({ type: "rcx-history", id });
    if (sparkFor !== a) return;
    const el = spark();
    let graph = "";
    if (h?.points?.length >= 3) {
      const pts = h.points, ys = pts.map((p) => p[1]);
      const now = ys[ys.length - 1], change = ys[0] ? ((now - ys[0]) / ys[0]) * 100 : null;
      graph =
        `<div class="rcx-spark-sub">Players, last 7 days` +
        (change == null ? "" : ` · <span class="${change >= 0 ? "rcx-up" : "rcx-down"}">${pct(change)}</span>`) + `</div>` +
        sparkSvg(pts, 220, 56) +
        `<div class="rcx-spark-row"><span>Now <b>${fmt(now)}</b></span><span>Peak <b>${fmt(Math.max(...ys))}</b></span><span>Low <b>${fmt(Math.min(...ys))}</b></span></div>`;
    }
    el.innerHTML =
      `<div class="rcx-spark-title">${esc(st.name || nameOf(a))}</div>` +
      `<div class="rcx-spark-facts"><div><i>Est. revenue</i><b>R$ ${fmt(st.revenue)}</b>${arrow(st.revenueTrend)}` +
      (st.revenueTrend == null ? "" : ` <span class="${st.revenueTrend >= 0 ? "rcx-up" : "rcx-down"}">${pct(st.revenueTrend)}</span>`) +
      `</div><div><i>Visits</i><b>${fmt(st.visits, 1)}</b></div>` +
      (st.revenue != null && st.playing > 0 ? `<div><i>Per player</i><b>R$ ${fmt(st.revenue / st.playing)}</b></div><div><i>Playing</i><b>${fmt(st.playing)}</b></div>` : "") +
      `</div>` + graph;
    // beside the card, not over it: Roblox's own hover card (Play button) opens below the thumbnail
    const r = (a.querySelector(THUMB) || a).getBoundingClientRect();
    const W = 244, H = el.offsetHeight || 160;
    let left = r.right + 10, top = Math.min(Math.max(8, r.top), innerHeight - H - 8);
    if (left + W > innerWidth - 8) left = r.left - W - 10;
    if (left < 8) { // no room on either side: above the thumbnail
      left = Math.min(Math.max(8, r.left + r.width / 2 - W / 2), innerWidth - W - 8);
      top = Math.max(8, r.top - H - 8);
    }
    el.style.left = left + "px";
    el.style.top = top + "px";
    el.classList.add("rcx-show");
  }

  // only the stats pills in the thumbnail's corner open it, so hovering a card
  // still leaves Roblox's hover card and its Play button alone
  document.addEventListener("mouseover", (e) => {
    if (!on) return;
    const a = e.target.closest?.(".rcx-card")?.closest("a.game-card-link") || null;
    if (a === sparkFor) return;
    hideSpark();
    if (a) {
      sparkFor = a;
      sparkTimer = setTimeout(() => showSpark(a), 250);
    }
  }, true);
  addEventListener("scroll", hideSpark, true);

  /* ---- wiring ---- */
  let timer = 0;
  const queue = () => {
    if (!on || timer) return;
    timer = setTimeout(() => {
      timer = 0;
      scanCards();
      scanGamePage();
      scanGroupPage();
      scanHome();
      placeSortControl();
    }, 250);
  };

  function setOn(v) {
    on = v;
    document.documentElement.classList.toggle("rcx-on", on);
    applySort();
    if (on) queue();
    else hideSpark();
  }

  function setWatch(list) {
    watchList = list || [];
    watched = new Set(watchList.map((g) => g.id));
    homeFor = ""; // redraw the Home strip with the new list
    for (const a of document.querySelectorAll("a.game-card-link")) {
      const id = universeOf(a);
      if (id && stats.get(id)) paintCard(a, stats.get(id));
    }
    document.getElementById("rcx-panel")?.rcxLabel?.();
  }

  chrome.storage.sync.get(DEFAULTS, (s) => {
    sortBy = s.sort;
    setWatch(s.watch);
    setOn(!!s.stats);
  });
  chrome.storage.onChanged.addListener((c, area) => {
    if (area !== "sync") return;
    if (c.watch) setWatch(c.watch.newValue);
    if (c.sort) {
      sortBy = c.sort.newValue || "default";
      markSort();
      applySort();
    }
    if (c.stats) setOn(!!c.stats.newValue);
  });

  function start() {
    rcWatch((records) => {
      // our own inserts don't need a rescan
      if (!records.overflow && records.every((r) => r.target.closest?.(".rcx-card, #rcx-panel, #rcx-sort, #rcx-home, #rcx-group") || [...r.addedNodes].every((n) => n.nodeType !== 1 || n.classList?.contains("rcx-card") || ["rcx-panel", "rcx-sort", "rcx-home", "rcx-group"].includes(n.id)))) return;
      queue();
    });
    queue();
  }
  if (document.body) start();
  else document.addEventListener("DOMContentLoaded", start, { once: true });
})();
