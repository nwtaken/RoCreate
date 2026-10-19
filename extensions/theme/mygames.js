/* Your experiences: a Home panel with the public experiences you own and the ones owned by
   communities you own, with live players, a trend line for the last two hours (recorded
   only while a Home tab is open), visits, rating and links to the Creator Hub.
   Roblox only. One refresh a minute while the tab is visible; the list of experiences
   itself is re-read every ten minutes. */
(() => {
  if (location.hostname !== "www.roblox.com") return;
  const HIST_KEY = "rcMyGamesHist", LIST_KEY = "rcMyGamesList";
  const KEEP = 2 * 3600e3, LIST_TTL = 10 * 60e3, TICK = 60e3, SHOW = 8;
  let prefs = { enabled: true, myGames: true };
  let state = { games: [], stats: new Map(), hist: {}, at: 0, error: "" };
  let timer = 0, busy = false, listAt = 0;

  const uid = () => document.querySelector('meta[name="user-data"]')?.dataset.userid || "";
  const onHome = () => location.pathname.replace(/\/+$/, "") === "/home";
  const on = () => prefs.enabled !== false && prefs.myGames !== false && rcAlive() && onHome() && !!uid();
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const fmt = (n) => (n >= 1e9 ? (n / 1e9).toFixed(1) + "B" : n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n >= 1e3 ? (n / 1e3).toFixed(1) + "K" : String(n ?? 0));
  const ago = (t) => {
    const s = (Date.now() - Date.parse(t)) / 1000, d = s / 86400;
    return s < 3600 ? Math.max(1, Math.round(s / 60)) + "m ago" : s < 86400 ? Math.round(s / 3600) + "h ago" : d < 60 ? Math.round(d) + "d ago" : d < 730 ? Math.round(d / 30.4) + "mo ago" : Math.round(d / 365) + "y ago";
  };
  const store = (k, d) => new Promise((done) => chrome.storage.local.get({ [k]: d }, (r) => done(chrome.runtime.lastError ? d : r[k])));
  async function json(url) {
    const r = await fetch(url, { credentials: "include" });
    if (r.status === 429) throw new Error("Roblox is rate limiting; trying again in a minute.");
    if (!r.ok) throw new Error("Roblox answered " + r.status + ".");
    return r.json();
  }

  async function loadList() {
    const cached = await store(LIST_KEY, null);
    if (cached && cached.uid === uid() && Date.now() - cached.at < LIST_TTL) { listAt = cached.at; return cached.games; }
    const u = uid();
    const games = [];
    const mine = await json(`https://games.roblox.com/v2/users/${u}/games?accessFilter=2&limit=50&sortOrder=Desc`);
    for (const g of mine.data || []) games.push({ id: g.id, place: g.rootPlace?.id, name: g.name, owner: "You" });
    const roles = await json(`https://groups.roblox.com/v2/users/${u}/groups/roles`).catch(() => ({ data: [] }));
    const owned = (roles.data || []).filter((r) => r.role.rank === 255).slice(0, 10);
    for (const r of owned) {
      const list = await json(`https://games.roblox.com/v2/groups/${r.group.id}/gamesV2?accessFilter=2&limit=50&sortOrder=Desc`).catch(() => ({ data: [] }));
      for (const g of list.data || []) games.push({ id: g.id, place: g.rootPlace?.id, name: g.name, owner: r.group.name });
    }
    listAt = Date.now();
    chrome.storage.local.set({ [LIST_KEY]: { uid: u, at: listAt, games } });
    return games;
  }

  async function refresh(force) {
    if (busy || !on()) return;
    busy = true;
    try {
      if (force || !state.games.length || Date.now() - listAt > LIST_TTL) {
        if (force) await chrome.storage.local.remove(LIST_KEY);
        state.games = await loadList();
      }
      const ids = state.games.map((g) => g.id).slice(0, 50);
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

  function spark(points) {
    if (!points || points.length < 2) return '<span class="rc-mg-spark rc-mg-flat">collecting trend</span>';
    const w = 96, h = 26, xs = points.map(([t]) => t), ys = points.map(([, p]) => p);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const X = (t) => ((t - x0) / Math.max(1, x1 - x0)) * w, Y = (p) => h - 2 - ((p - y0) / Math.max(1, y1 - y0)) * (h - 4);
    const d = points.map(([t, p], i) => (i ? "L" : "M") + X(t).toFixed(1) + " " + Y(p).toFixed(1)).join(" ");
    const up = ys[ys.length - 1] >= ys[0];
    return `<svg class="rc-mg-spark" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true"><path d="${d}" fill="none" stroke="${up ? "#34D399" : "#F87171"}" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
  }

  function panelHtml() {
    const rows = state.games.map((g) => ({ g, s: state.stats.get(g.id) })).filter((r) => r.s)
      .sort((a, b) => (b.s.playing || 0) - (a.s.playing || 0) || (b.s.visits || 0) - (a.s.visits || 0));
    const total = rows.reduce((n, r) => n + (r.s.playing || 0), 0), visits = rows.reduce((n, r) => n + (r.s.visits || 0), 0);
    const head = `<div class="rc-mg-head"><div><h2>Your experiences</h2><span class="rc-mg-sub">${rows.length ? `${rows.length} public experience${rows.length === 1 ? "" : "s"} you or your communities own` : state.error ? "" : "Loading…"}</span></div>
      <div class="rc-mg-kpis"><span><b>${fmt(total)}</b> playing now</span><span><b>${fmt(visits)}</b> visits</span>
      <button type="button" class="rc-mg-refresh" data-k="refresh" title="Refresh now">${busy ? "Refreshing…" : state.at ? "Updated " + (Date.now() - state.at < 60e3 ? "just now" : ago(new Date(state.at).toISOString())) : "Refresh"}</button></div></div>`;
    if (state.error && !rows.length) return head + `<div class="rc-mg-empty">${esc(state.error)}</div>`;
    if (!rows.length) return head + (state.at ? `<div class="rc-mg-empty">No public experiences yet. <a href="https://create.roblox.com/dashboard/creations" target="_blank" rel="noopener">Open the Creator Hub</a></div>` : "");
    const tiles = rows.slice(0, SHOW).map(({ g, s }) => {
      const votes = (s.up || 0) + (s.down || 0), rating = votes ? Math.round((s.up / votes) * 100) + "%" : "n/a";
      const icon = state.icons?.get(g.id);
      return `<div class="rc-mg-tile">
        <a class="rc-mg-main" href="/games/${s.rootPlaceId || g.place}">
          <span class="rc-mg-icon">${icon ? `<img src="${esc(icon)}" alt="" loading="lazy">` : ""}</span>
          <span class="rc-mg-text"><b>${esc(s.name || g.name)}</b><small>${esc(g.owner)} · updated ${esc(ago(s.updated))}</small></span>
        </a>
        <div class="rc-mg-live"><span class="rc-mg-dot${s.playing ? " rc-mg-on" : ""}"></span><b>${fmt(s.playing || 0)}</b><small>playing</small>${spark(state.hist[g.id])}</div>
        <div class="rc-mg-facts"><span><b>${fmt(s.visits || 0)}</b> visits</span><span><b>${rating}</b> liked</span><span><b>${fmt(s.favoritedCount || 0)}</b> favorites</span></div>
        <a class="rc-mg-hub" href="https://create.roblox.com/dashboard/creations/experiences/${g.id}/overview" target="_blank" rel="noopener">Creator Hub</a>
      </div>`;
    }).join("");
    const more = rows.length > SHOW ? `<div class="rc-mg-more">${rows.length - SHOW} more on the <a href="https://create.roblox.com/dashboard/creations" target="_blank" rel="noopener">Creator Hub</a></div>` : "";
    return head + `<div class="rc-mg-grid">${tiles}</div>` + (state.error ? `<div class="rc-mg-note">${esc(state.error)}</div>` : "") + more;
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
      box.addEventListener("click", (e) => { if (e.target.closest('[data-k="refresh"]')) refresh(true); });
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
    timer = setInterval(() => { if (document.visibilityState === "visible") refresh(false); }, TICK);
  }
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && on() && Date.now() - state.at > TICK) refresh(false); });

  const load = () => chrome.storage.sync.get({ enabled: true, myGames: true }, (s) => { if (!chrome.runtime.lastError) { prefs = s; schedule(); } });
  const start = () => { load(); rcWatch(() => { if (onHome() && on() && !document.getElementById("rc-mygames")?.isConnected) paint(); }); };
  if (document.body) start(); else addEventListener("DOMContentLoaded", start, { once: true });
  chrome.storage.onChanged.addListener((changes, area) => { if (area === "sync" && rcAlive()) load(); });
})();
