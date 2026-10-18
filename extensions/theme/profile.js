/* Profile insights: one "Insights" section at the top of the profile's own sections, with
   tabs, so it adds what the profile doesn't show without repeating what it does (friend
   counts, the experiences and communities lists are already there).
     Overview          joined / account age, status or last seen, inventory value,
                       est. game revenue, owned communities, why verified, previous names
     Inventory value   Rolimons value, RAP, rank, peak, value / RAP history chart
     Why verified?     RobloxVerifieds' estimate, flags, badge history, linked accounts
     Roblox items      official Roblox items owned (not limiteds), with their price,
                       including offsale ones (last known price), and the total
     Mutual friends    friends you share
   Sources: Roblox APIs, Rolimons, RobloxVerifieds, Creator Exchange (via background.js).
   Setting: chrome.storage.sync { profile: bool }. */
(() => {
  const uid = location.pathname.match(/^\/users\/(\d+)\/profile/)?.[1];
  if (!uid) return;

  /* ---- helpers ---- */
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const fmt = (n, d = 1) => {
    if (n == null || !isFinite(n)) return "–";
    const a = Math.abs(n);
    for (const [v, s] of [[1e12, "T"], [1e9, "B"], [1e6, "M"], [1e3, "K"]]) if (a >= v) return +(n / v).toFixed(d) + s;
    return Math.round(n).toLocaleString();
  };
  const full = (n) => (n == null ? "–" : Number(n).toLocaleString());
  const day = (t) => new Date(t).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  function ago(t) {
    const s = (Date.now() - t) / 1000;
    for (const [n, u] of [[31536000, "year"], [2592000, "month"], [86400, "day"], [3600, "hour"], [60, "minute"]]) {
      if (s >= n) { const v = Math.floor(s / n); return `${v} ${u}${v > 1 ? "s" : ""} ago`; }
    }
    return "just now";
  }
  function age(t) {
    const m = Math.floor((Date.now() - t) / (30.44 * 86400000));
    const y = Math.floor(m / 12), r = m % 12;
    return y ? `${y}y ${r}m` : `${m}m`;
  }

  let csrf = "";
  async function api(url, body, signal) {
    if (body && !csrf) csrf = document.querySelector('meta[name="csrf-token"]')?.dataset.token || "";
    const opts = () => ({
      method: body ? "POST" : "GET",
      credentials: "include",
      signal,
      headers: body ? { "content-type": "application/json", ...(csrf && { "x-csrf-token": csrf }) } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    let res = await fetch(url, opts());
    if (body && res.status === 403 && res.headers.get("x-csrf-token")) {
      csrf = res.headers.get("x-csrf-token");
      res = await fetch(url, opts());
    }
    if (!res.ok) throw new Error(res.status);
    return res.json();
  }
  const ask = (msg) =>
    new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(msg, (r) => resolve(chrome.runtime.lastError ? null : r));
      } catch {
        resolve(null);
      }
    });
  const me = () => document.querySelector('meta[name="user-data"]')?.dataset.userid || null;

  /* ---- state: each source fills its part, then the panel is redrawn ---- */
  const S = { user: null, presence: null, rol: null, rv: null, games: null, owned: null, mutuals: null, names: null, items: null };
  let tab = "overview";
  let rangeDays = 365;
  let panel = null;

  const tile = (label, value, sub = "", title = "") =>
    `<div class="rcp-tile"${title ? ` title="${esc(title)}"` : ""}><div class="rcp-label">${label}</div>` +
    `<div class="rcp-value">${value}</div>${sub ? `<div class="rcp-sub">${sub}</div>` : ""}</div>`;
  const tone = (score) => (score >= 65 ? "rcp-good" : score >= 45 ? "rcp-mid" : "rcp-bad");

  function overviewHtml() {
    const u = S.user, P = S.presence, r = S.rol, v = S.rv;
    if (!u) return `<div class="rcp-tiles">${'<div class="rcp-tile rcp-skel"><div class="rcp-label"></div><div class="rcp-value"></div></div>'.repeat(4)}</div>`;
    const status = P?.userPresenceType === 2 ? ["rcp-ingame", "In game", P.lastLocation || ""]
      : P?.userPresenceType === 3 ? ["rcp-studio", "In Studio", P.lastLocation || ""]
      : P?.userPresenceType === 1 ? ["rcp-online", "Online", ""]
      : ["", "Offline", r?.lastOnline ? "seen " + ago(r.lastOnline) : ""];
    const tiles = [
      tile("Joined", day(Date.parse(u.created)), age(Date.parse(u.created)) + " old"),
      tile("Status", `<span class="rcp-dot ${status[0]}"></span>${status[1]}`, esc(status[2])),
      r ? tile("Inventory value", r.privacy && !r.value ? "Private" : "R$ " + fmt(r.value), r.rap != null ? "RAP R$ " + fmt(r.rap) : "", "Rolimons") : "",
      S.games?.revenue ? tile("Est. game revenue", "R$ " + fmt(S.games.revenue), `${S.games.count} experience${S.games.count > 1 ? "s" : ""}`, "Creator Exchange") : "",
      S.items?.count ? tile("Roblox items", `${full(S.items.count)}`, `R$ ${fmt(S.items.total)} known`, "Official Roblox items, not limiteds") : "",
      v?.reason || v?.flags?.length ? tile(
        v.flags?.length ? '<span class="rcp-bad">Flagged</span>' : "Why verified?",
        v.reason ? `<span class="${tone(v.reason.score)} rcp-wrap">${esc(v.reason.label)}</span>` : `<span class="rcp-bad">${v.flags.length} flag${v.flags.length > 1 ? "s" : ""}</span>`,
        v.flags?.length ? esc(v.flags[0].reason) : `${v.reason.score}/100 · ${esc(v.reason.confidence || "")} confidence`) : "",
      u.isBanned ? tile("Account", '<span class="rcp-bad">Banned</span>') : "",
    ].join("");
    const names = S.names?.length
      ? `<div class="rcp-names"><span class="rcp-muted">Previously</span>${S.names.map((n) => `<button type="button" data-copy="${esc(n)}" title="Copy">${esc(n)}</button>`).join("")}</div>`
      : "";
    return `<div class="rcp-tiles">${tiles}</div>${names}`;
  }

  function chartSvg(points) {
    const W = 640, H = 170, L = 44, B = 22, T = 8, R = 8;
    const t0 = points[0][0], t1 = points[points.length - 1][0] || t0 + 1;
    const vals = points.flatMap((p) => [p[1], p[2]]).filter((v) => v != null);
    const hi = Math.max(10, ...vals) * 1.08;
    const x = (t) => L + ((t - t0) / (t1 - t0 || 1)) * (W - L - R);
    const y = (v) => T + (1 - v / hi) * (H - T - B);
    const line = (i) => points.filter((p) => p[i] != null).map((p, j) => `${j ? "L" : "M"}${x(p[0]).toFixed(1)},${y(p[i]).toFixed(1)}`).join("");
    let grid = "";
    for (let g = 0; g <= 3; g++) {
      const v = (hi / 3) * g, yy = y(v).toFixed(1);
      grid += `<line x1="${L}" x2="${W - R}" y1="${yy}" y2="${yy}" class="rcp-grid"/><text x="${L - 6}" y="${+yy + 4}" text-anchor="end">${fmt(v, 0)}</text>`;
    }
    for (let g = 0; g <= 4; g++) {
      const t = t0 + ((t1 - t0) / 4) * g;
      grid += `<text x="${x(t).toFixed(1)}" y="${H - 6}" text-anchor="${g === 0 ? "start" : g === 4 ? "end" : "middle"}">${new Date(t).toLocaleDateString(undefined, { month: "short", year: "2-digit" })}</text>`;
    }
    return `<svg viewBox="0 0 ${W} ${H}" class="rcp-chart" preserveAspectRatio="none" data-t0="${t0}" data-t1="${t1}" data-l="${L}" data-r="${R}" data-w="${W}">` +
      grid + `<path d="${line(2)}" class="rcp-rap"/><path d="${line(1)}" class="rcp-val"/>` +
      `<line class="rcp-cursor" y1="${T}" y2="${H - B}" x1="0" x2="0"/></svg><div class="rcp-tip" hidden></div>`;
  }

  const chartPoints = () => {
    const all = S.rol?.chart || [];
    const pts = all.filter((p) => !rangeDays || p[0] >= Date.now() - rangeDays * 86400000);
    return pts.length >= 2 ? pts : all;
  };

  function valueHtml() {
    const r = S.rol;
    const show = chartPoints();
    const peak = (r.chart || []).reduce((m, p) => (p[1] > (m?.[1] ?? -1) ? p : m), null);
    const tiles =
      tile("Value", r.privacy && !r.value ? "Private" : `R$ ${full(r.value)}`, r.privacy ? "inventory is private" : "") +
      tile("RAP", r.privacy && !r.rap ? "Private" : `R$ ${full(r.rap)}`) +
      tile("Rank", r.rank ? "#" + full(r.rank) : "–") +
      (peak ? tile("Peak value", `R$ ${fmt(peak[1])}`, day(peak[0])) : "");
    const chart = show.length >= 2
      ? `<div class="rcp-chart-wrap"><div class="rcp-ranges">${[["1m", 30], ["3m", 91], ["1y", 365], ["All", 0]].map(([t, d]) => `<button type="button" data-days="${d}" class="${d === rangeDays ? "rcp-on" : ""}">${t}</button>`).join("")}` +
        `<span class="rcp-legend"><i class="rcp-val-key"></i>Value <i class="rcp-rap-key"></i>RAP</span></div>${chartSvg(show)}</div>`
      : "";
    return `<div class="rcp-tiles">${tiles}</div>${chart}`;
  }

  function verifyHtml() {
    const v = S.rv;
    let html = "";
    if (v.reason) {
      const s = Math.max(0, Math.min(100, v.reason.score ?? 0));
      html += `<div class="rcp-reason"><div class="rcp-reason-top"><span class="rcp-pill ${tone(s)}">${esc(v.reason.label)}</span>` +
        `<span class="rcp-score ${tone(s)}"><span class="rcp-bar"><i style="width:${s}%"></i></span>${s}/100</span>` +
        (v.reason.confidence ? `<span class="rcp-muted">${esc(v.reason.confidence)} confidence</span>` : "") + `</div>` +
        `<div class="rcp-summary">${esc(v.reason.summary)}</div>` +
        (v.reason.evidence.length ? `<ul class="rcp-evidence">${v.reason.evidence.map((e) => `<li>${esc(e)}</li>`).join("")}</ul>` : "") +
        `<div class="rcp-muted rcp-note">An estimate: Roblox doesn't publish why accounts are verified. Source: RobloxVerifieds.</div></div>`;
    }
    if (v.flags.length) html += `<div class="rcp-flags">${v.flags.map((f) => `<div class="rcp-flag"><b>${esc(f.reason)}</b>${f.note ? `<span>${esc(f.note)}</span>` : ""}<span class="rcp-muted">${f.at ? day(f.at) : ""}</span></div>`).join("")}</div>`;
    const extra = [
      ...v.history.map((h) => `<span class="${h.verified ? "rcp-got" : "rcp-lost"}">${h.verified ? "Verified" : "Lost badge"} · ${day(h.at)}</span>`),
      ...v.linked.map((l) => `<a href="/users/${esc(l.id)}/profile">Linked: ${esc(l.name || l.id)}</a>`),
    ];
    if (extra.length) html += `<div class="rcp-history">${extra.join("")}</div>`;
    return html;
  }

  const MIN_PRICES = [[0, "All"], [100, "100+"], [1000, "1K+"], [10000, "10K+"]];
  let minPrice = 0;

  function itemsHtml() {
    const it = S.items;
    if (it.private) return '<div class="rcp-muted">This inventory is private.</div>';
    if (it.error) return `<div class="rcp-muted">Couldn't load the inventory (Roblox answered ${esc(it.error)}). Refresh the page to try again.</div>`;
    // the price filter only changes what is counted and listed; every price is already known
    const list = it.list.filter((x) => !minPrice || (x.price ?? 0) >= minPrice);
    const sum = (arr) => arr.reduce((n, x) => n + (x.price || 0), 0);
    const on = list.filter((x) => x.onSale), off = list.filter((x) => !x.onSale);
    const unknown = off.filter((x) => x.price == null).length;
    const bundles = list.filter((x) => x.bundle).length;
    const top = list.filter((x) => x.price).sort((a, b) => b.price - a.price).slice(0, minPrice ? 25 : 10);
    const filters = `<div class="rcp-ranges rcp-filters"><span class="rcp-muted">Price</span>${MIN_PRICES.map(([p, t]) =>
      `<button type="button" data-min="${p}" class="${p === minPrice ? "rcp-on" : ""}">${t}</button>`).join("")}</div>`;
    const tiles =
      tile("Items", full(list.length), (minPrice ? `of ${full(it.count)}` : "official") + (bundles ? ` · ${bundles} bundle${bundles > 1 ? "s" : ""}` : "")) +
      tile("Total", "R$ " + full(sum(list)), "of items with a known price") +
      tile("On sale", full(on.length), "R$ " + fmt(sum(on))) +
      tile("Off sale", full(off.length), "R$ " + fmt(sum(off)) + (unknown ? ` · ${unknown} unknown` : ""), "At the last price Roblox lists") +
      (minPrice ? "" : tile("Free", full(list.filter((x) => x.price === 0).length)));
    const rows = top.map((x) =>
      `<a class="rcp-row" href="/${x.bundle ? "bundles" : "catalog"}/${x.id}">${x.img ? `<img src="${esc(x.img)}" alt="">` : "<span class='rcp-ph'></span>"}` +
      `<span class="rcp-row-name">${esc(x.name)}</span><span class="rcp-row-meta">${x.bundle ? '<span class="rcp-tag">Bundle</span> ' : ""}${x.onSale ? "" : '<span class="rcp-off">Offsale</span> '}R$ ${full(x.price)}</span></a>`).join("");
    const progress = !it.done && it.owned
      ? `<div class="rcp-progress"><i style="width:${Math.round((100 * (it.scanned || 0)) / it.owned)}%"></i></div>` +
        `<div class="rcp-muted rcp-note">${it.stale ? "Showing your last scan. " : ""}Checking ${full(it.scanned || 0)} / ${full(it.owned)} items…` +
        (it.wait ? ` Roblox's catalog is busy (it allows 10 requests a minute), going on in ${it.wait} s.` : "") + `</div>`
      : "";
    return filters + progress + `<div class="rcp-tiles">${tiles}</div>` +
      (rows ? `<div class="rcp-subhead">${minPrice ? "Items" : "Most expensive"}</div><div class="rcp-list">${rows}</div>` : (it.done ? '<div class="rcp-muted rcp-more">No items at this price.</div>' : "")) +
      (it.incomplete ? '<div class="rcp-muted rcp-note">Partial results: Roblox kept refusing, so some items are unchecked. They are checked on your next visit.</div>' : "") +
      `<div class="rcp-muted rcp-note">Limiteds and collectibles are left out (see Inventory value). Bundles such as Korblox count once, as the bundle. Offsale items count at the last price Roblox lists; for most older ones it lists none, so they show as unknown.</div>`;
  }

  function mutualsHtml() {
    const m = S.mutuals;
    if (!m.list.length) return '<div class="rcp-muted">You have no friends in common.</div>';
    return `<div class="rcp-people">${m.list.map((p) => `<a href="/users/${p.id}/profile" title="@${esc(p.name)}">` +
      `${p.img ? `<img src="${esc(p.img)}" alt="">` : "<span class='rcp-round'></span>"}<span>${esc(p.display || p.name)}</span></a>`).join("")}</div>` +
      (m.total > m.list.length ? `<div class="rcp-muted rcp-more">+${m.total - m.list.length} more</div>` : "");
  }

  function tabs() {
    return [
      ["overview", "Overview", true],
      ["value", "Inventory value", !!S.rol],
      ["verify", S.rv?.flags?.length ? `Why verified? <b class="rcp-bad">●</b>` : "Why verified?", !!(S.rv && (S.rv.reason || S.rv.flags.length || S.rv.history.length))],
      ["items", S.items ? `Roblox items <span class="rcp-count">${full(S.items.count)}</span>` : "Roblox items", !!S.items],
      ["mutuals", S.mutuals ? `Mutual friends <span class="rcp-count">${S.mutuals.total}</span>` : "Mutual friends", !!S.mutuals],
    ].filter((t) => t[2]);
  }

  function draw() {
    if (!panel) return;
    const list = tabs();
    if (!list.some((t) => t[0] === tab)) tab = "overview";
    const body = tab === "value" ? valueHtml() : tab === "verify" ? verifyHtml() : tab === "mutuals" ? mutualsHtml() : tab === "items" ? itemsHtml() : overviewHtml();
    panel.querySelector(".rcp-tabs").innerHTML = list.map(([k, t]) => `<button type="button" data-tab="${k}" class="${k === tab ? "rcp-on" : ""}">${t}</button>`).join("");
    panel.querySelector(".rcp-body").innerHTML = body;
    if (tab === "value") wireChart();
  }

  function wireChart() {
    const svg = panel.querySelector(".rcp-chart");
    if (!svg) return;
    const show = chartPoints();
    const tip = panel.querySelector(".rcp-tip"), cur = svg.querySelector(".rcp-cursor");
    svg.addEventListener("mousemove", (e) => {
      const box = svg.getBoundingClientRect();
      const W = +svg.dataset.w, L = +svg.dataset.l, R = +svg.dataset.r, t0 = +svg.dataset.t0, t1 = +svg.dataset.t1;
      const t = t0 + ((((e.clientX - box.left) / box.width) * W - L) / (W - L - R)) * (t1 - t0);
      const p = show.reduce((b, q) => (Math.abs(q[0] - t) < Math.abs(b[0] - t) ? q : b), show[0]);
      const px = L + ((p[0] - t0) / (t1 - t0 || 1)) * (W - L - R);
      cur.setAttribute("x1", px); cur.setAttribute("x2", px); cur.classList.add("rcp-show");
      tip.hidden = false;
      tip.innerHTML = `<b>${day(p[0])}</b><span class="rcp-val-t">Value R$ ${full(p[1])}</span><span class="rcp-rap-t">RAP R$ ${full(p[2])}</span>`;
      tip.style.left = Math.min(Math.max(0, (px / W) * box.width - 75), box.width - 150) + "px";
    });
    svg.addEventListener("mouseleave", () => { tip.hidden = true; cur.classList.remove("rcp-show"); });
  }

  /* ---- placement: first of the profile's own sections ---- */
  function place() {
    const content = document.querySelector(".profile-content");
    if (content) { content.prepend(panel); return true; }
    const header = document.querySelector(".profile-header-overlay");
    if (header) { header.after(panel); return true; }
    return false;
  }

  function build() {
    panel = document.createElement("section");
    panel.id = "rcp-panel";
    panel.className = "section";
    panel.innerHTML =
      `<div class="rcp-top"><h2 class="rcp-title">Insights</h2><div class="rcp-tabs"></div><div class="rcp-actions">` +
      `<button type="button" data-copy="${uid}" title="Copy user ID">Copy ID</button>` +
      (cfg.profileValue === false ? "" : `<a href="https://www.rolimons.com/player/${uid}" target="_blank" rel="noopener" title="Open on Rolimons">Rolimons ↗</a>`) +
      (cfg.profileVerify === false ? "" : `<a href="https://robloxverifieds.com/user/${uid}" target="_blank" rel="noopener" title="Open on RobloxVerifieds">Verifieds ↗</a>`) +
      `</div></div><div class="rcp-body"></div>`;
    panel.addEventListener("click", (e) => {
      const t = e.target.closest("[data-tab]");
      if (t) { tab = t.dataset.tab; draw(); return; }
      const d = e.target.closest("[data-days]");
      if (d) { rangeDays = +d.dataset.days; draw(); return; }
      const mp = e.target.closest("[data-min]");
      if (mp) { minPrice = +mp.dataset.min; draw(); thumbs(); return; }
      const c = e.target.closest("[data-copy]");
      if (c) navigator.clipboard.writeText(c.dataset.copy).then(() => {
        const old = c.textContent;
        c.textContent = "Copied";
        setTimeout(() => (c.textContent = old), 1200);
      });
    });
    if (!place()) return false;
    draw();
    // Roblox re-renders parts of the page; put the same panel back if it gets dropped
    rcWatch(() => panel.isConnected || place());
    return true;
  }

  /* ---- data ---- */
  const loaders = [
    async () => {
      const [user, pres] = await Promise.allSettled([
        api(`https://users.roblox.com/v1/users/${uid}`),
        api("https://presence.roblox.com/v1/presence/users", { userIds: [Number(uid)] }),
      ]);
      if (user.status === "fulfilled") S.user = user.value;
      S.presence = pres.value?.userPresences?.[0] || null;
    },
    async () => { S.rol = await ask({ type: "rcx-rolimons", id: uid }); },
    async () => { S.rv = await ask({ type: "rcx-rvuser", id: uid }); },
    async () => {
      const g = await api(`https://games.roblox.com/v2/users/${uid}/games?accessFilter=2&limit=50&sortOrder=Desc`);
      const list = (g.data || []).filter((x) => x.rootPlace?.id);
      if (!list.length) return;
      const st = (await ask({ type: "rcx-stats", games: list.map((x) => ({ id: String(x.id), name: x.name })), search: true })) || {};
      S.games = { count: list.length, revenue: list.reduce((n, x) => n + (st[String(x.id)]?.revenue ?? 0), 0) };
    },
    async () => {
      const g = await api(`https://groups.roblox.com/v2/users/${uid}/groups/roles`);
      const owned = (g.data || []).filter((x) => x.role?.rank === 255).sort((a, b) => (b.group.memberCount ?? 0) - (a.group.memberCount ?? 0));
      if (owned.length) S.owned = { count: owned.length, biggest: `${owned[0].group.name} (${fmt(owned[0].group.memberCount)} members)` };
    },
    async () => {
      const mine = me();
      if (!mine || mine === uid) return;
      const [a, b] = await Promise.all([api(`https://friends.roblox.com/v1/users/${mine}/friends`), api(`https://friends.roblox.com/v1/users/${uid}/friends`)]);
      const theirs = new Set((b.data || []).map((x) => String(x.id)));
      const ids = (a.data || []).map((x) => String(x.id)).filter((id) => theirs.has(id));
      const show = ids.slice(0, 24);
      const [names, heads] = show.length ? await Promise.all([
        api("https://users.roblox.com/v1/users", { userIds: show.map(Number), excludeBannedUsers: false }).catch(() => null),
        api(`https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${show.join(",")}&size=48x48&format=Png&isCircular=true`).catch(() => null),
      ]) : [null, null];
      const nm = Object.fromEntries((names?.data || []).map((u) => [String(u.id), u]));
      const hd = Object.fromEntries((heads?.data || []).map((h) => [String(h.targetId), h.imageUrl]));
      S.mutuals = { total: ids.length, list: show.map((id) => ({ id, name: nm[id]?.name || id, display: nm[id]?.displayName, img: hd[id] })) };
    },
    async () => {
      const h = await api(`https://users.roblox.com/v1/users/${uid}/username-history?limit=100&sortOrder=Desc`);
      S.names = (h.data || []).map((x) => x.name);
    },
  ];

  /* ---- official Roblox items: inventory + bundles -> catalog details, cached per item ---- */
  const ITEM_TYPES = "Hat,HairAccessory,FaceAccessory,NeckAccessory,ShoulderAccessory,FrontAccessory,BackAccessory,WaistAccessory,Face,Gear,TShirtAccessory,ShirtAccessory,PantsAccessory,JacketAccessory,SweaterAccessory,ShortsAccessory,DressSkirtAccessory,LeftShoeAccessory,RightShoeAccessory,EmoteAnimation";
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const itemsDiag = {};
  // diagnostics must never break the count itself
  const saveDiag = (step, extra = {}) => {
    try {
      if (rcAlive()) chrome.storage.local.set({ "oip:diag": Object.assign(itemsDiag, { at: new Date().toISOString(), v: chrome.runtime.getManifest().version, step }, extra) }).catch(() => {});
    } catch {}
  };

  // Roblox's catalog allows 10 requests a minute (x-ratelimit-limit: 10;w=60), its own page
  // uses some of them, and a VPN address shares the limit with other people. So a 429 means
  // wait the window out, with a countdown, and carry on.
  async function patient(url, body, onWait) {
    for (let tries = 0; ; tries++) {
      try {
        return await api(url, body);
      } catch (e) {
        if (e.message !== "429" || tries >= 5 || !rcAlive()) throw e;
        for (let s = 20; s > 0; s--) { onWait(s); await sleep(1000); }
        onWait(0);
      }
    }
  }

  // every page of a cursor list; a page that fails after the first keeps what came before
  async function pages(url, max, onWait) {
    const out = [];
    let cursor = "";
    try {
      for (let p = 0; p < max; p++) {
        const r = await patient(url + (cursor ? "&cursor=" + encodeURIComponent(cursor) : ""), undefined, onWait);
        out.push(...(r.data || []));
        if (!(cursor = r.nextPageCursor)) break;
      }
    } catch (e) {
      if (!out.length) throw e;
      out.cut = true;
    }
    return out;
  }

  // what the catalog says about one item, as kept in the cache
  function judge(d) {
    const t = Date.now();
    const official = d.creatorTargetId === 1 && d.creatorType === "User";
    // every catalog item now has a collectibleItemId, so only the restrictions say "limited"
    const limited = (d.itemRestrictions || []).some((r) => /Limited|Collectible/i.test(r));
    if (!official || limited) return { o: 0, t };
    const onSale = d.priceStatus !== "Off Sale" && !d.isOffSale && d.price != null;
    // offsale: Roblox still lists the last price for some items, 0 for most older ones
    const p = onSale ? d.discountInformation?.originalPrice ?? d.price : d.price > 0 ? d.price : null;
    const c = { o: 1, s: onSale ? 1 : 0, p, n: d.name, t };
    if (d.itemType === "Bundle") c.a = (d.bundledItems || []).filter((x) => x.type === "Asset").map((x) => x.id);
    return c;
  }

  // the item scan is the heavy one: wait until the tab is actually being looked at
  const whenVisible = () => document.visibilityState === "visible" ? Promise.resolve()
    : new Promise((r) => document.addEventListener("visibilitychange", function on() {
      if (document.visibilityState !== "visible") return;
      document.removeEventListener("visibilitychange", on);
      r();
    }));

  async function loadItems() {
    await whenVisible();
    try {
      await loadItemsInner();
    } catch (e) {
      saveDiag("crashed", { error: String(e && (e.stack || e.message || e)).slice(0, 400) });
    }
  }

  async function loadItemsInner() {
    if (!rcAlive()) return;
    saveDiag("start");
    // the last result for this account shows at once, while the inventory loads
    const sumKey = "ois2:" + uid, key = "oic2";
    const last = (await chrome.storage.local.get(sumKey))[sumKey];
    if (last) { S.items = { ...last, scanned: 0, done: false, stale: true }; draw(); }
    const onWait = (s) => {
      if (S.items) S.items.wait = s;
      if (tab === "items") draw();
    };
    // 1. what they own: accessories, faces, gear, emotes... and bundles (Korblox, Headless)
    let assets;
    try {
      assets = await pages(`https://inventory.roblox.com/v2/users/${uid}/inventory?assetTypes=${ITEM_TYPES}&limit=100&sortOrder=Desc`, 60, onWait);
    } catch (e) {
      S.items = last ? { ...last, done: true, incomplete: true } : e.message === "403" ? { private: true, list: [] } : { error: e.message, list: [] };
      saveDiag("inventory failed", { error: e.message });
      return;
    }
    const owned = await pages(`https://catalog.roblox.com/v1/users/${uid}/bundles?limit=100&sortOrder=Desc`, 20, onWait).catch(() => Object.assign([], { cut: true }));
    const seen = new Set();
    // bundles first, so their parts are known before the single items are counted
    const want = [
      ...owned.filter((b) => b.creator?.id === 1 && b.creator.type === "User").map((b) => ({ k: "b" + b.id, id: b.id, name: b.name, bundle: true })),
      ...assets.map((a) => ({ k: String(a.assetId), id: a.assetId, name: a.name })),
    ].filter((x) => x.id && !seen.has(x.k) && seen.add(x.k));
    saveDiag("inventory", { owned: assets.length, bundles: want.length - assets.length });

    // 2. the catalog, for items not in the per-item cache. Not official never changes;
    // on-sale prices are re-checked weekly, offsale ones monthly.
    const cache = (await chrome.storage.local.get(key))[key] || {};
    const fresh = (c) => c && Date.now() - (c.t || 0) < (c.o ? (c.s ? 7 : 30) : 365) * 86400000;
    const todo = want.filter((x) => !fresh(cache[x.k]));
    let incomplete = !!(assets.cut || owned.cut);
    const tally = () => {
      const parts = new Set(); // assets that came inside an owned bundle count with the bundle
      for (const x of want) if (x.bundle) for (const a of cache[x.k]?.a || []) parts.add(String(a));
      const list = [];
      let scanned = 0;
      for (const x of want) {
        const c = cache[x.k];
        if (!c) continue;
        if (fresh(c)) scanned++;
        if (c.o && (x.bundle || !parts.has(x.k))) list.push({ id: x.id, name: c.n || x.name, bundle: !!x.bundle, onSale: !!c.s, price: c.p ?? null });
      }
      return { list, count: list.length, total: list.reduce((n, x) => n + (x.price || 0), 0), scanned, owned: want.length };
    };
    S.items = { ...tally(), done: false };
    draw();
    const detErrors = [];
    for (let i = 0; i < todo.length; i += 100) {
      if (!rcAlive()) return;
      const batch = todo.slice(i, i + 100);
      let det;
      try {
        det = await patient("https://catalog.roblox.com/v1/catalog/items/details", { items: batch.map((x) => ({ itemType: x.bundle ? "Bundle" : "Asset", id: x.id })) }, onWait);
      } catch (e) {
        detErrors.push(e.message);
        incomplete = true;
        break;
      }
      const got = new Set();
      for (const d of det.data || []) {
        const k = (d.itemType === "Bundle" ? "b" : "") + d.id;
        got.add(k);
        cache[k] = judge(d);
      }
      // items the catalog doesn't return (deleted or hidden) aren't asked about every visit
      for (const x of batch) if (!got.has(x.k)) cache[x.k] = { o: 0, t: Date.now() };
      if (!rcAlive()) return;
      await chrome.storage.local.set({ [key]: cache });
      S.items = { ...tally(), done: false };
      saveDiag(`batch ${i / 100 + 1}/${Math.ceil(todo.length / 100)}`, { official: S.items.count, detErrors });
      draw();
      if (i + 100 < todo.length) await sleep(1000);
    }
    S.items = { ...tally(), done: true, incomplete };
    const { list, ...rest } = S.items;
    chrome.storage.local.set({ [sumKey]: { ...rest, list: list.map(({ img, ...x }) => x), savedAt: Date.now() } }).catch(() => {});
    saveDiag("done", { owned: want.length, official: S.items.count, unknown: list.filter((x) => x.price == null).length, detErrors, fromCache: want.length - todo.length });
    await thumbs();
  }
  loaders.push(loadItems);

  // thumbnails for the items the current filter lists
  async function thumbs() {
    const it = S.items;
    if (!it?.list) return;
    const top = it.list.filter((x) => x.price && (!minPrice || x.price >= minPrice))
      .sort((a, b) => b.price - a.price).slice(0, minPrice ? 25 : 10).filter((x) => !x.img);
    if (!top.length) return;
    const ids = (bundle) => top.filter((x) => x.bundle === bundle).map((x) => x.id).join(",");
    const [assets, bundles] = await Promise.all([
      ids(false) && api(`https://thumbnails.roblox.com/v1/assets?assetIds=${ids(false)}&size=150x150&format=Png&isCircular=false`).catch(() => null),
      ids(true) && api(`https://thumbnails.roblox.com/v1/bundles/thumbnails?bundleIds=${ids(true)}&size=150x150&format=Png&isCircular=false`).catch(() => null),
    ]);
    for (const [r, bundle] of [[assets, false], [bundles, true]]) {
      for (const t of r?.data || []) {
        const x = top.find((y) => y.id === t.targetId && y.bundle === bundle);
        if (x) x.img = t.imageUrl;
      }
    }
    draw();
  }

  function start() {
    if (!build()) return false;
    for (const load of loaders) load().catch(() => {}).finally(draw);
    return true;
  }

  let cfg = {}; // which parts this copy includes (config.json, via background.js)
  chrome.storage.sync.get({ profile: true }, async (s) => {
    if (!s.profile) return;
    cfg = (await ask({ type: "rcx-config" })) || {};
    let tries = 0;
    const t = setInterval(() => {
      if (document.getElementById("rcp-panel") || start() || ++tries > 80) clearInterval(t);
    }, 250);
  });
})();
