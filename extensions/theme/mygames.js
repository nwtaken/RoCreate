/* Your experiences: a Home panel in the Creator Hub table style. It lists the public
   experiences you own, the ones of every community Roblox lets you manage, and the ones of
   your primary community, with live players, a two-hour trend (recorded only while a Home
   tab is open), visits, rating, favorites and when each was last updated.
   Roblox only. Live numbers refresh once a minute while the tab is visible; the list of
   experiences is re-read every thirty minutes. */
(() => {
  if (location.hostname !== "www.roblox.com") return;
  const HIST_KEY = "rcMyGamesHist", LIST_KEY = "rcMyGamesList";
  const KEEP = 2 * 3600e3, LIST_TTL = 30 * 60e3, TICK = 60e3;
  let prefs = { enabled: true, myGames: true };
  let state = { games: [], stats: new Map(), hist: {}, at: 0, error: "", icons: null };
  let timer = 0, busy = false, listAt = 0, showQuiet = false;

  const uid = () => document.querySelector('meta[name="user-data"]')?.dataset.userid || "";
  const onHome = () => location.pathname.replace(/\/+$/, "") === "/home";
  const on = () => prefs.enabled !== false && prefs.myGames !== false && rcAlive() && onHome() && !!uid();
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const fmt = (n) => (n >= 1e9 ? (n / 1e9).toFixed(1) + "B" : n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n >= 1e4 ? Math.round(n / 1e3) + "K" : n >= 1e3 ? (n / 1e3).toFixed(1) + "K" : String(n ?? 0));
  const ago = (t) => {
    const s = (Date.now() - (typeof t === "number" ? t : Date.parse(t))) / 1000, d = s / 86400;
    return s < 60 ? "just now" : s < 3600 ? Math.round(s / 60) + "m ago" : s < 86400 ? Math.round(s / 3600) + "h ago" : d < 60 ? Math.round(d) + "d ago" : d < 730 ? Math.round(d / 30.4) + "mo ago" : Math.round(d / 365) + "y ago";
  };
  const store = (k, d) => new Promise((done) => chrome.storage.local.get({ [k]: d }, (r) => done(chrome.runtime.lastError ? d : r[k])));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  async function json(url) {
    const r = await fetch(url, { credentials: "include" });
    if (r.status === 429) throw new Error("Roblox is rate limiting; trying again in a minute.");
    if (!r.ok) throw new Error("Roblox answered " + r.status + ".");
    return r.json();
  }

  async function loadList() {
    const cached = await store(LIST_KEY, null);
    if (cached && cached.v === 2 && cached.uid === uid() && Date.now() - cached.at < LIST_TTL) { listAt = cached.at; return cached.games; }
    const u = uid(), games = [], seen = new Set();
    const add = (g, owner, manage) => { if (!seen.has(g.id) && games.length < 50) { seen.add(g.id); games.push({ id: g.id, place: g.rootPlace?.id, name: g.name, owner, manage }); } };
    const mine = await json(`https://games.roblox.com/v2/users/${u}/games?accessFilter=2&limit=50&sortOrder=Desc`);
    for (const g of mine.data || []) add(g, "You", true);
    const managed = (await json("https://develop.roblox.com/v1/user/groups/canmanage").catch(() => ({ data: [] }))).data || [];
    const primary = (await json(`https://groups.roblox.com/v1/users/${u}/groups/primary/role`).catch(() => null))?.group;
    const groups = managed.map((g) => ({ id: g.id, name: g.name, manage: true }));
    if (primary && !groups.some((g) => g.id === primary.id)) groups.unshift({ id: primary.id, name: primary.name, manage: false });
    // four communities at a time keeps the one-off list read quick but gentle
    const todo = groups.slice(0, 25), lists = new Array(todo.length);
    for (let i = 0; i < todo.length; i += 4) {
      await Promise.all(todo.slice(i, i + 4).map((g, k) => json(`https://games.roblox.com/v2/groups/${g.id}/gamesV2?accessFilter=2&limit=50&sortOrder=Desc`).then((l) => (lists[i + k] = l.data || []), () => (lists[i + k] = []))));
      if (i + 4 < todo.length) await sleep(120);
    }
    todo.forEach((g, i) => { for (const x of lists[i] || []) add(x, g.name, g.manage); });
    listAt = Date.now();
    chrome.storage.local.set({ [LIST_KEY]: { v: 2, uid: u, at: listAt, games } });
    return games;
  }

  async function refresh(force) {
    if (busy || !on()) return;
    busy = true;
    paint();
    try {
      if (force || !state.games.length || Date.now() - listAt > LIST_TTL) {
        if (force) { await chrome.storage.local.remove(LIST_KEY); state.icons = null; }
        state.games = await loadList();
      }
      const ids = state.games.map((g) => g.id);
      if (ids.length) {
        const [det, votes] = await Promise.all([
          json(`https://games.roblox.com/v1/games?universeIds=${ids.join(",")}`),
          json(`https://games.roblox.com/v1/games/votes?universeIds=${ids.join(",")}`).catch(() => ({ data: [] })),
        ]);
        const v = new Map((votes.data || []).map((x) => [x.id, x]));
        for (const d of det.data || []) state.stats.set(d.id, { ...d, up: v.get(d.id)?.upVotes, down: v.get(d.id)?.downVotes });
        if (!state.icons) {
          const icons = await json(`https://thumbnails.roblox.com/v1/games/icons?universeIds=${ids.join(",")}&size=150x150&format=Png&isCircular=false`).catch(() => ({ data: [] }));
          state.icons = new Map((icons.data || []).filter((i) => /^https:\/\/[a-z0-9.]*rbxcdn\.com\//.test(i.imageUrl || "")).map((i) => [i.targetId, i.imageUrl]));
        }
        const now = Date.now(), hist = await store(HIST_KEY, {});
        for (const id of ids) {
          const s = state.stats.get(id); if (!s) continue;
          const pts = (hist[id] || []).filter(([t]) => now - t < KEEP);
          if (!pts.length || now - pts[pts.length - 1][0] > 45e3) pts.push([now, s.playing || 0]);
          hist[id] = pts;
        }
        for (const k of Object.keys(hist)) if (!ids.includes(+k)) delete hist[k];
        chrome.storage.local.set({ [HIST_KEY]: hist });
        state.hist = hist;
      }
      state.at = Date.now();
      state.error = "";
    } catch (e) {
      state.error = e.message;
    } finally {
      busy = false;
      paint();
    }
  }

  function trend(points, playing) {
    if (!playing) return "";
    if (!points || points.length < 2) return '<span class="rc-mg-tracking">tracking</span>';
    const ys = points.map(([, p]) => p), lo = Math.min(...ys), hi = Math.max(...ys);
    const w = 88, h = 24, xs = points.map(([t]) => t), x0 = xs[0], x1 = xs[xs.length - 1];
    const X = (t) => ((t - x0) / Math.max(1, x1 - x0)) * w, Y = (p) => (hi === lo ? h / 2 : h - 3 - ((p - lo) / (hi - lo)) * (h - 6));
    const d = points.map(([t, p], i) => (i ? "L" : "M") + X(t).toFixed(1) + " " + Y(p).toFixed(1)).join(" ");
    const delta = ys[ys.length - 1] - ys[0], color = delta > 0 ? "#34D399" : delta < 0 ? "#F87171" : "#64748B";
    return `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-label="Players over the last two hours"><path d="${d}" fill="none" stroke="${color}" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
  }

  const HUB = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  function row({ g, s }) {
    const votes = (s.up || 0) + (s.down || 0), rating = votes ? Math.round((s.up / votes) * 100) + "%" : "n/a";
    const icon = state.icons?.get(g.id), live = (s.playing || 0) > 0;
    return `<div class="rc-mg-row${live ? " rc-mg-live" : ""}" role="row">
      <a class="rc-mg-name" role="cell" href="/games/${s.rootPlaceId || g.place}"><span class="rc-mg-icon">${icon ? `<img src="${esc(icon)}" alt="" loading="lazy">` : ""}</span><span class="rc-mg-text"><b>${esc(s.name || g.name)}</b><small>${esc(g.owner)}</small></span></a>
      <span class="rc-mg-num rc-mg-playing" role="cell">${live ? '<i class="rc-mg-dot"></i>' : ""}${fmt(s.playing || 0)}</span>
      <span class="rc-mg-trend" role="cell">${trend(state.hist[g.id], s.playing)}</span>
      <span class="rc-mg-num" role="cell">${fmt(s.visits || 0)}</span>
      <span class="rc-mg-num rc-mg-hide-sm" role="cell">${rating}</span>
      <span class="rc-mg-num rc-mg-hide-sm" role="cell">${fmt(s.favoritedCount || 0)}</span>
      <span class="rc-mg-num rc-mg-muted rc-mg-hide-md" role="cell">${s.updated ? esc(ago(s.updated)) : ""}</span>
      <span class="rc-mg-act" role="cell">${g.manage ? `<a class="rc-mg-hub" href="https://create.roblox.com/dashboard/creations/experiences/${g.id}/overview" target="_blank" rel="noopener" title="Open in the Creator Hub" aria-label="Open ${esc(s.name || g.name)} in the Creator Hub">${HUB}</a>` : ""}</span>
    </div>`;
  }

  function panelHtml() {
    const rows = state.games.map((g) => ({ g, s: state.stats.get(g.id) })).filter((r) => r.s)
      .sort((a, b) => (b.s.playing || 0) - (a.s.playing || 0) || (b.s.visits || 0) - (a.s.visits || 0));
    const active = rows.filter((r) => r.s.playing > 0), quiet = rows.filter((r) => !(r.s.playing > 0));
    const sum = (k) => rows.reduce((n, r) => n + (r.s[k] || 0), 0);
    const status = busy ? "Refreshing…" : state.at ? "Updated " + ago(state.at) : "Loading…";
    const head = `<div class="rc-mg-head"><h2>Your experiences</h2>
      <button type="button" class="rc-mg-refresh" data-k="refresh" title="Refresh now"><svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.3-5.6M20 4v5h-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>${status}</button></div>`;
    if (!rows.length) {
      const msg = state.error ? esc(state.error) : state.at ? 'No public experiences yet. <a href="https://create.roblox.com/dashboard/creations" target="_blank" rel="noopener">Open the Creator Hub</a>' : "Finding the experiences you own and manage…";
      return head + `<div class="rc-mg-empty">${msg}</div>`;
    }
    const kpis = `<div class="rc-mg-kpis">
      <div class="rc-mg-kpi rc-mg-kpi-live"><span>Playing now</span><b>${fmt(sum("playing"))}</b><small>${active.length} of ${rows.length} experiences live</small></div>
      <div class="rc-mg-kpi"><span>Visits</span><b>${fmt(sum("visits"))}</b><small>all time</small></div>
      <div class="rc-mg-kpi"><span>Favorites</span><b>${fmt(sum("favoritedCount"))}</b><small>across these experiences</small></div>
      <div class="rc-mg-kpi"><span>Experiences</span><b>${rows.length}</b><small>yours and your communities'</small></div></div>`;
    const header = `<div class="rc-mg-row rc-mg-th" role="row"><span role="columnheader">Experience</span><span class="rc-mg-num" role="columnheader">Playing</span><span role="columnheader">Last 2 h</span><span class="rc-mg-num" role="columnheader">Visits</span><span class="rc-mg-num rc-mg-hide-sm" role="columnheader">Liked</span><span class="rc-mg-num rc-mg-hide-sm" role="columnheader">Favorites</span><span class="rc-mg-num rc-mg-hide-md" role="columnheader">Updated</span><span></span></div>`;
    const shown = active.length ? active : quiet.slice(0, 3);
    const rest = active.length ? quiet : quiet.slice(3);
    const more = rest.length ? `<button type="button" class="rc-mg-more" data-k="quiet" aria-expanded="${showQuiet}">${showQuiet ? "Hide" : "Show"} ${rest.length} experience${rest.length === 1 ? "" : "s"} with no players right now</button>` : "";
    return head + kpis + `<div class="rc-mg-table" role="table">${header}${shown.map(row).join("")}${showQuiet ? rest.map(row).join("") : ""}</div>` + more + (state.error ? `<div class="rc-mg-note">${esc(state.error)}</div>` : "");
  }

  let painted = "";
  function paint() {
    const old = document.getElementById("rc-mygames");
    if (!on()) { old?.remove(); painted = ""; return; }
    const anchor = document.querySelector("#HomeContainer > .section");
    if (!anchor) return;
    let box = old;
    if (!box) {
      box = document.createElement("section");
      box.id = "rc-mygames";
      box.className = "rc-ext";
      box.setAttribute("aria-label", "Your experiences");
      box.addEventListener("click", (e) => {
        if (e.target.closest('[data-k="refresh"]')) refresh(true);
        else if (e.target.closest('[data-k="quiet"]')) { showQuiet = !showQuiet; paint(); }
      });
    }
    const html = panelHtml();
    if (html !== painted) { box.innerHTML = html; painted = html; }
    if (box.previousElementSibling !== anchor) anchor.after(box);
  }

  function schedule() {
    clearInterval(timer);
    paint();
    if (!on()) return;
    refresh(false);
    timer = setInterval(() => { if (document.visibilityState === "visible") refresh(false); else paint(); }, TICK);
  }
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && on() && Date.now() - state.at > TICK) refresh(false); });

  const load = () => chrome.storage.sync.get({ enabled: true, myGames: true }, (s) => { if (!chrome.runtime.lastError) { prefs = s; schedule(); } });
  const start = () => { load(); rcWatch(() => { if (onHome() && on() && !document.getElementById("rc-mygames")?.isConnected) paint(); }); };
  if (document.body) start(); else addEventListener("DOMContentLoaded", start, { once: true });
  chrome.storage.onChanged.addListener((changes, area) => { if (area === "sync" && rcAlive()) load(); });
})();
