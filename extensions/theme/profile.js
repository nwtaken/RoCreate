/* Native RoCreate profile. Roblox stays offscreen as the action and RoValra data source. */
(() => {
  const uid = location.pathname.match(/^\/users\/(\d+)\/profile/)?.[1];
  if (!uid) return;

  /* ---- helpers ---- */
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const fmt = (n, d = 1) => {
    if (n == null || !isFinite(n)) return "-";
    const a = Math.abs(n);
    for (const [v, s] of [[1e12, "T"], [1e9, "B"], [1e6, "M"], [1e3, "K"]]) if (a >= v) return +(n / v).toFixed(d) + s;
    return Math.round(n).toLocaleString();
  };
  const full = (n) => (n == null ? "-" : Number(n).toLocaleString());
  const day = (t) => new Date(t).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  const month = (t) => new Date(t).toLocaleDateString(undefined, { month: "short", year: "numeric" });
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
  const clock = (sec) => {
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = Math.floor(sec % 60);
    return (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(s).padStart(2, "0");
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  let csrf = "";
  async function api(url, body, signal) {
    signal ||= AbortSignal.timeout(20000);
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
  const mine = () => me() === uid;

  // Roblox thumbnails, many kinds in one request; remembered for this page
  const thumbCache = new Map(), thumbPending = new Map();
  async function thumbs(list, size = "150x150") {
    const unique = [...new Map(list.map(item => [item[0]+":"+item[1],item])).values()];
    const want = [], waiting = [], resolve = new Map();
    for (const item of unique) {
      const k = item[0]+":"+item[1]+":"+size;
      if (thumbCache.has(k)) continue;
      if (!thumbPending.has(k)) {
        thumbPending.set(k, new Promise(done=>resolve.set(k,done)));
        want.push(item);
      }
      waiting.push(thumbPending.get(k));
    }
    for (let i = 0; i < want.length; i += 100) {
      const batch = want.slice(i, i + 100);
      try {
        const r = await api("https://thumbnails.roblox.com/v1/batch", batch.map(([type,id],n)=>({requestId:String(n),type,targetId:Number(id),size,format:"Png",isCircular:false}))).catch(()=>null);
        for (const t of r?.data || []) {
          const [type,id] = batch[Number(t.requestId)] || [];
          if (type && t.imageUrl && /^https:\/\/[\w.-]+\.rbxcdn\.com\//.test(t.imageUrl)) thumbCache.set(type+":"+id+":"+size,t.imageUrl);
        }
      } finally {
        for (const [type,id] of batch) {
          const k=type+":"+id+":"+size;
          resolve.get(k)?.();
          thumbPending.delete(k);
        }
      }
    }
    await Promise.all(waiting);
    return (type,id)=>thumbCache.get(type+":"+id+":"+size) || "";
  }

  /* ---- state ---- */
  const S = {
    user: null, presence: null, counts: {}, head: "", body: "", names: null, marks: null,
    groups: null, games: null, gameStats: {}, favorites: null, wearing: null, robloxBadges: null, badges: null,
    friends: null, mutuals: null, rol: null, rv: null, items: null,
    socials: null, yt: null, tw: null, x: null, custom: {}, avatar: null,
  };
  let cfg = {}, prefs = {};
  const on = (name) => cfg[name] !== false;
  const itemScanOn = () => on("profileItems") && prefs.profileItems !== false;
  let root = null;

  /* ---- markup pieces ---- */
  const tile = (label, value, sub = "", title = "") =>
    `<div class="rcp-tile"${title ? ` title="${esc(title)}"` : ""}><div class="rcp-label">${label}</div>` +
    `<div class="rcp-value">${value}</div>${sub ? `<div class="rcp-sub">${sub}</div>` : ""}</div>`;
  const tone = (score) => (score >= 65 ? "rcp-good" : score >= 45 ? "rcp-mid" : "rcp-bad");
  const skel = (n, cls = "rcp-skel-row") => `<div class="${cls}">${'<span class="rcp-skel"></span>'.repeat(n)}</div>`;
  const card = (sec, title, body, extra = "") =>
    `<div class="rcp-card-head"><h2>${title}</h2>${extra}</div><div class="rcp-card-body">${body}</div>`;
  // Roblox's verified badge shape (from its own icon set), in any colour, with a mark on top
  const BADGE = (fill, mark) => `<svg viewBox="0 0 32 32" aria-hidden="true"><path fill="${fill}" d="M7.72 4.48a2 2 0 0 1 2.44-1.41l17.36 4.65a2 2 0 0 1 1.41 2.44l-4.65 17.36a2 2 0 0 1-2.44 1.41L4.48 24.28a2 2 0 0 1-1.41-2.44Z"/>${mark}</svg>`;
  const ROBLOX_LOGO = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" fill-rule="evenodd" d="M6.2 1.96 22.04 6.2 17.8 22.04 1.96 17.8Z M9.81 8.2 15.8 9.81 14.19 15.8 8.2 14.19Z"/></svg>';
  const ICONS = {
    youtube: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M23 7.2a3 3 0 0 0-2.1-2.1C19 4.6 12 4.6 12 4.6s-7 0-8.9.5A3 3 0 0 0 1 7.2 31 31 0 0 0 .5 12a31 31 0 0 0 .5 4.8 3 3 0 0 0 2.1 2.1c1.9.5 8.9.5 8.9.5s7 0 8.9-.5a3 3 0 0 0 2.1-2.1 31 31 0 0 0 .5-4.8 31 31 0 0 0-.5-4.8ZM9.8 15.1V8.9l5.8 3.1Z"/></svg>',
    twitch: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M4.3 2 3 5.4v13.7h4.7V22h2.6l2.7-2.9h3.8L22 14V2Zm15.9 11.2-2.9 2.9h-4.7l-2.6 2.6v-2.6H6.1V3.8h14.1ZM17.1 6.9h-1.8v5.2h1.8Zm-4.9 0h-1.8v5.2h1.8Z"/></svg>',
    x: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M17.8 2.5h3.1l-6.8 7.8 8 10.6h-6.3l-4.9-6.4-5.6 6.4H2.2l7.3-8.3L1.8 2.5h6.4l4.4 5.9Zm-1.1 16.5h1.7L7.4 4.3H5.6Z"/></svg>',
    discord: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M19.6 5.3A18 18 0 0 0 15.2 4l-.6 1.2a16.7 16.7 0 0 0-5.2 0L8.8 4a18 18 0 0 0-4.4 1.3A18.6 18.6 0 0 0 1.2 17.8a18 18 0 0 0 5.4 2.7l1.2-1.9a11.6 11.6 0 0 1-1.8-.9l.4-.3a12.9 12.9 0 0 0 11.2 0l.4.3c-.6.3-1.2.6-1.8.9l1.2 1.9a18 18 0 0 0 5.4-2.7 18.5 18.5 0 0 0-3.2-12.5ZM8.7 15.3c-1 0-1.9-1-1.9-2.2s.8-2.2 1.9-2.2 1.9 1 1.9 2.2-.8 2.2-1.9 2.2Zm6.6 0c-1 0-1.9-1-1.9-2.2s.8-2.2 1.9-2.2 1.9 1 1.9 2.2-.8 2.2-1.9 2.2Z"/></svg>',
  };
  const SERVICE = { youtube: "YouTube", twitch: "Twitch", x: "X", discord: "Discord" };

  /* ---- header ---- */
  // the same badges for anyone in a list (friends): small, after the name
  function personBadges(p) {
    const m = p.marks || {};
    let html = "";
    if (m.flag || m.ex) html += `<b class="rcp-pb" title="${esc(m.flag ? "Flagged on RobloxVerifieds" : "Previously verified")}">${BADGE("#e5484d", '<path d="M11.6 11.6l8.8 8.8M20.4 11.6l-8.8 8.8" stroke="#fff" stroke-width="3.2" stroke-linecap="round"/>')}</b>`;
    else if (p.verified) html += `<b class="rcp-pb" title="Verified by Roblox">${BADGE("#335fff", '<path fill="#fff" d="M19.94 11.94a1.5 1.5 0 0 1 2.12 2.12l-7 7a1.5 1.5 0 0 1-2.12 0l-3-3a1.5 1.5 0 0 1 2.12-2.12L14 17.88Z"/>')}</b>`;
    if (m.admin) html += `<b class="rcp-pb rcp-pb-admin" title="Roblox admin">${ROBLOX_LOGO}</b>`;
    return html;
  }

  function nameBadges() {
    const u = S.user, m = S.marks || {};
    let html = "";
    if (m.flag || m.ex) {
      const why = m.flag ? "Flagged on RobloxVerifieds: " + m.flag.reasons.map((r) => r.reason).join(", ") : "Previously verified: this account lost its verified badge";
      html += `<span class="rcp-badge" title="${esc(why)}">${BADGE("#e5484d", '<path d="M11.6 11.6l8.8 8.8M20.4 11.6l-8.8 8.8" stroke="#fff" stroke-width="3.2" stroke-linecap="round"/>')}</span>`;
    } else if (u?.hasVerifiedBadge) {
      html += `<span class="rcp-badge" title="Verified by Roblox">${BADGE("#335fff", '<path fill="#fff" d="M19.94 11.94a1.5 1.5 0 0 1 2.12 2.12l-7 7a1.5 1.5 0 0 1-2.12 0l-3-3a1.5 1.5 0 0 1 2.12-2.12L14 17.88Z"/>')}</span>`;
    }
    if (m.admin) html += `<span class="rcp-badge rcp-admin" title="Roblox admin (has Roblox's Administrator badge)">${ROBLOX_LOGO}</span>`;
    return html;
  }

  function statusLine() {
    const P = S.presence, r = S.rol;
    if (S.user?.isBanned) return `<span class="rcp-status rcp-banned">Banned</span>`;
    if (P?.userPresenceType === 2) {
      const place = P.rootPlaceId || P.placeId;
      return `<span class="rcp-status rcp-ingame"><i></i>In game${P.lastLocation ? ": " + (place ? `<a href="/games/${Number(place)}">${esc(P.lastLocation)}</a>` : esc(P.lastLocation)) : ""}</span>`;
    }
    if (P?.userPresenceType === 3) return `<span class="rcp-status rcp-studio"><i></i>In Studio${P.lastLocation ? ": " + esc(P.lastLocation) : ""}</span>`;
    if (P?.userPresenceType === 1) return `<span class="rcp-status rcp-online"><i></i>Online</span>`;
    return `<span class="rcp-status"><i></i>Offline${r?.lastOnline ? " · seen " + ago(r.lastOnline) : ""}</span>`;
  }

  // Inventory value: official Roblox items (their known prices) plus collectibles (Rolimons)
  function inventoryStat(stat) {
    const items = itemScanOn() && S.items && !S.items.private && !S.items.error ? S.items.total || 0 : 0;
    const coll = on("profileValue") && S.rol && !(S.rol.privacy && !S.rol.value) ? S.rol.value || 0 : 0;
    if (!items && !coll) return "";
    const why = [itemScanOn() ? `Official Roblox items R$ ${full(items)}${S.items && !S.items.done ? " (still counting)" : ""}` : "Official Roblox item scan is off", on("profileValue") ? `Collectibles R$ ${full(coll)} (Rolimons)` : ""].filter(Boolean).join(" + ");
    return `<div class="rcp-stat rcp-inv" title="${esc(why)}"><b>R$ ${fmt(items + coll)}</b><span>${itemScanOn() ? "Inventory value" : "Collectibles value"}</span></div>`;
  }
  // while the item scan runs, only that number changes (repainting the header would reset it)
  function updateInventoryStat() {
    const el = root?.querySelector("#rcp-hero .rcp-inv");
    if (!el) return paint("hero");
    const fresh = inventoryStat(() => "");
    if (fresh && el.outerHTML !== fresh) el.outerHTML = fresh;
  }

  function heroHtml() {
    const u = S.user;
    if (!u && S.gone) {
      return `<div class="rcp-hero-top"><div class="rcp-avatar"><span></span></div><div class="rcp-ident">` +
        `<div class="rcp-name"><h1>This account isn't available</h1></div>` +
        `<div class="rcp-handle">Roblox didn't return this account. It may be deleted or terminated.<button type="button" class="rcp-id" data-copy="${uid}" title="Copy user ID">ID ${uid}</button></div></div></div>` +
        `<div class="rcp-links"><button type="button" class="rcp-chip rcp-quiet" data-classic>Roblox's layout</button></div>`;
    }
    const created = u ? Date.parse(u.created) : null;
    const c = S.counts;
    const stat = (value, label, href) =>
      href ? `<a class="rcp-stat" href="${href}"><b>${value}</b><span>${label}</span></a>` : `<div class="rcp-stat"><b>${value}</b><span>${label}</span></div>`;
    const revenue = on("profileRevenue") && S.games?.length ? S.games.reduce((n, g) => n + (S.gameStats[g.id]?.revenue || 0), 0) : 0;
    const stats = [
      stat(c.friends != null ? fmt(c.friends) : "-", "Friends", `/users/${uid}/friends#!/friends`),
      stat(c.followers != null ? fmt(c.followers) : "-", "Followers", `/users/${uid}/friends#!/followers`),
      stat(c.following != null ? fmt(c.following) : "-", "Following", `/users/${uid}/friends#!/following`),
      created ? stat(month(created), "Joined · " + age(created)) : "",
      S.games?.length ? stat(String(S.games.length), S.games.length === 1 ? "Experience" : "Experiences") : "",
      revenue >= 100 ? stat("R$ " + fmt(revenue), "Est. game revenue") : "",
      inventoryStat(stat),
      S.custom.views ? stat(esc(S.custom.views.replace(/ Profile Views/i, "")), "Profile views") : "",
    ].join("");
    const live = S.tw?.live;
    const socials = S.socials ? Object.entries(S.socials).filter(([, v]) => v) : [];
    const links = [
      ...socials.map(([k, v]) => `<a class="rcp-chip rcp-${k}" href="${esc(v.url)}" target="_blank" rel="noopener" title="${esc(SERVICE[k] + ", linked " + v.source)}">${ICONS[k]}${esc(v.label)}</a>`),
      `<button type="button" class="rcp-chip" data-copy="https://www.roblox.com/users/${uid}/profile">Copy profile link</button>`,
      `<a class="rcp-chip" href="/users/${uid}/inventory">Inventory</a>`,
      `<a class="rcp-chip" href="/users/${uid}/favorites">Favorites</a>`,
      me() && !mine() ? `<a class="rcp-chip" href="/users/${uid}/trade">Trade</a>` : "",
      on("profileValue") ? `<a class="rcp-chip" href="https://www.rolimons.com/player/${uid}" target="_blank" rel="noopener">Rolimons ↗</a>` : "",
      on("profileVerify") ? `<a class="rcp-chip" href="https://robloxverifieds.com/user/${uid}" target="_blank" rel="noopener">Verifieds ↗</a>` : "",
      `<button type="button" class="rcp-chip rcp-quiet" data-classic title="Show Roblox's own profile layout">Roblox's layout</button>`,
    ].join("");
    const bio = (u?.description || "").trim();
    return `<div class="rcp-hero-bg"${S.head ? ` style="background-image:url('${esc(S.head)}')"` : ""}></div>` +
      `<div class="rcp-hero-top">` +
        `<div class="rcp-avatar">${S.head ? `<img src="${esc(S.head)}" alt="">` : "<span></span>"}${S.custom.border ? `<img class="rcp-avatar-border" src="${esc(S.custom.border)}" alt="">` : ""}<i class="rcp-dot-${S.presence?.userPresenceType || 0}"></i></div>` +
        `<div class="rcp-ident">` +
          `<div class="rcp-name"><h1 class="rcp-effect-${S.custom.effect || "none"}"${S.custom.gradient ? ` style="background-image:${esc(S.custom.gradient)}"` : ""}>${esc(u?.displayName || u?.name || "")}</h1>${nameBadges()}${S.custom.badges?.map(b => `<span class="rcp-custom-badge" title="${esc(b.label)}">${b.image ? `<img src="${esc(b.image)}" alt="${esc(b.label)}">` : "✦"}</span>`).join("") || ""}</div>` +
          `<div class="rcp-handle">${u ? "@" + esc(u.name) : ""}${S.custom.pronouns ? `<span class="rcp-pronouns">${esc(S.custom.pronouns)}</span>` : ""}<button type="button" class="rcp-id" data-copy="${uid}" title="Copy user ID">ID ${uid}</button>${u ? `<button type="button" class="rcp-id" data-copy="${esc(u.name)}" title="Copy username">Copy name</button>` : ""}</div>` +
          `<div>${u ? statusLine() : skel(1)}</div>` +
          `${S.custom.status ? `<div class="rcp-speech">${esc(S.custom.status)}</div>` : ""}` +
        `</div>` +
        `<div class="rcp-actions">${(S.custom.actions || []).map(a => `<button type="button" data-proxy="${esc(a.id)}"${a.disabled ? " disabled" : ""}>${esc(a.label)}</button>`).join("")}<button type="button" data-actions aria-haspopup="menu" aria-expanded="false" aria-label="More profile actions">•••</button></div>` +
      `</div>` +
      (live ? `<button type="button" class="rcp-live" data-twitch-live><span class="rcp-live-dot">LIVE</span><span class="rcp-live-text"><b>${esc(S.tw.name)} is live on Twitch</b>${esc(live.title)}${live.game ? " · " + esc(live.game) : ""}</span><span class="rcp-live-count">${fmt(live.viewers)} watching</span><span class="rcp-live-go">Watch</span></button>` : "") +
      `<div class="rcp-stats">${stats}</div>` +
      (bio ? `<div class="rcp-bio${bio.length > 260 || bio.split("\n").length > 4 ? " rcp-clamp" : ""}"><p>${esc(bio)}</p><button type="button" data-more>Show more</button></div>` : "") +
      `<div class="rcp-links">${links}</div>`;
  }

  /* ---- Latest from them: YouTube, Twitch, X ---- */
  let socialTab = "", socialPicked = false;
  function socialsHtml() {
    const sx = S.socials;
    if (!sx) return "";
    const tabs = [
      sx.youtube && S.yt !== false ? ["youtube", "YouTube"] : null,
      sx.twitch && S.tw !== false && !S.tw?.missing ? ["twitch", "Twitch"] : null,
      sx.x && S.x?.posts?.length ? ["x", "X"] : null, // X often refuses: no tab unless posts came back
    ].filter(Boolean);
    if (!tabs.length) return "";
    if (!tabs.some(([k]) => k === socialTab)) socialTab = S.tw?.live && tabs.some(([k]) => k === "twitch") ? "twitch" : tabs[0][0];
    const v = sx[socialTab];
    const head = `<div class="rcp-tabs">${tabs.map(([k, t]) => `<button type="button" data-social="${k}" class="${k === socialTab ? "rcp-on" : ""}">${ICONS[k]}${t}</button>`).join("")}</div>`;
    let body = "";
    if (socialTab === "youtube") {
      const y = S.yt;
      if (!y) body = skel(3, "rcp-skel-grid");
      else if (!y.videos?.length) body = `<div class="rcp-player"><iframe src="https://www.youtube-nocookie.com/embed/videoseries?list=UU${esc(y.id.slice(2))}" allow="encrypted-media; picture-in-picture; fullscreen" allowfullscreen loading="lazy" title="${esc(y.channel || "YouTube uploads")}"></iframe></div>`;
      else body = `<div class="rcp-media-grid">${y.videos.slice(0, 8).map((x) =>
        `<button type="button" class="rcp-media" data-yt="${esc(x.id)}" title="${esc(x.title)}">` +
        `<span class="rcp-thumb"><img src="https://i.ytimg.com/vi/${esc(x.id)}/mqdefault.jpg" alt="" loading="lazy">${x.length ? `<i>${esc(x.length)}</i>` : x.short ? "<i>Short</i>" : ""}</span>` +
        `<span class="rcp-media-title">${esc(x.title)}</span>` +
        `<span class="rcp-media-meta">${x.viewsText ? esc(x.viewsText) : fmt(x.views) + " views"}${x.agoText ? " · " + esc(x.agoText) : x.at ? " · " + ago(x.at) : ""}</span></button>`).join("")}</div>`;
    } else if (socialTab === "twitch") {
      const t = S.tw;
      if (!t) body = skel(3, "rcp-skel-grid");
      else {
        const vod = (x) => `<button type="button" class="rcp-media" data-twitch-video="${esc(x.id)}" title="${esc(x.title)}"><span class="rcp-thumb">${x.img ? `<img src="${esc(x.img)}" alt="">` : ""}<i>${clock(x.length)}</i></span>` +
          `<span class="rcp-media-title">${esc(x.title)}</span><span class="rcp-media-meta">${fmt(x.views)} views${x.at ? " · " + ago(x.at) : ""}</span></button>`;
        const clip = (x) => `<button type="button" class="rcp-media" data-twitch-clip="${esc(x.slug)}" title="${esc(x.title)}"><span class="rcp-thumb">${x.img ? `<img src="${esc(x.img)}" alt="">` : ""}<i>Clip</i></span>` +
          `<span class="rcp-media-title">${esc(x.title)}</span><span class="rcp-media-meta">${fmt(x.views)} views${x.at ? " · " + ago(x.at) : ""}</span></button>`;
        body = (t.live ? `<button type="button" class="rcp-live-card" data-twitch-live><span class="rcp-thumb">${t.live.img ? `<img src="${esc(t.live.img)}" alt="">` : ""}<i class="rcp-live-dot">LIVE</i></span>` +
            `<span class="rcp-live-info"><b>${esc(t.live.title)}</b><span>${t.live.game ? esc(t.live.game) + " · " : ""}${fmt(t.live.viewers)} watching${t.live.since ? " · started " + ago(t.live.since) : ""}</span></span></button>` : "") +
          (t.videos.length ? `<div class="rcp-subhead">Past broadcasts</div><div class="rcp-media-grid">${t.videos.map(vod).join("")}</div>` : "") +
          (t.clips.length ? `<div class="rcp-subhead">Popular clips this month</div><div class="rcp-media-grid">${t.clips.map(clip).join("")}</div>` : "") +
          (!t.live && !t.videos.length && !t.clips.length ? '<div class="rcp-muted">Nothing on this channel lately.</div>' : "");
      }
    } else if (socialTab === "x") {
      const x = S.x;
      const bar = `<div class="rcp-x-bar"><span>${x.avatar ? `<img src="${esc(x.avatar)}" alt="">` : ICONS.x}<span><b>${esc(x.name || "@" + v.handle)}</b> @${esc(x.handle || v.handle)}</span></span>` +
        `<a class="rcp-chip" href="${esc(v.url)}" target="_blank" rel="noopener">Open on X ↗</a></div>`;
      body = bar + `<div class="rcp-posts">${x.posts.map((p) =>
        `<a class="rcp-post" href="https://x.com/${encodeURIComponent(p.by)}/status/${encodeURIComponent(p.id)}" target="_blank" rel="noopener">` +
        (p.by.toLowerCase() !== (x.handle || "").toLowerCase() ? `<span class="rcp-post-rt">Reposted from @${esc(p.by)}</span>` : "") +
        `<span class="rcp-post-text">${esc(p.text)}</span>` +
        (p.img ? `<span class="rcp-post-img"><img src="${esc(p.img)}" alt="">${p.video ? "<i>Video</i>" : ""}</span>` : p.sensitive ? '<span class="rcp-post-hidden">Sensitive media, open on X</span>' : "") +
        `<span class="rcp-post-meta">${p.at ? ago(p.at) : ""} · ${fmt(p.likes)} likes · ${fmt(p.replies)} replies</span></a>`).join("")}</div>`;
    }
    const open = v ? `<a class="rcp-open" href="${esc(v.url)}" target="_blank" rel="noopener">Open on ${SERVICE[socialTab]} ↗</a>` : "";
    return card("socials", `Latest from ${esc(S.user?.displayName || S.user?.name || "them")}`, head + body +
      (v ? `<div class="rcp-note">Linked ${esc(v.source)}${v.source.startsWith("from their bio") ? "" : ", so it may be the studio's channel rather than their own"}. ${open}</div>` : ""));
  }

  /* ---- main column sections ---- */
  const expanded = new Set();
  const more = (sec, total, shown) => total > shown ? `<button type="button" class="rcp-more" data-expand="${sec}">${expanded.has(sec) ? "Show less" : `Show all ${total}`}</button>` : "";

  const profileQueries = { games: "", groups: "", avatar: "" };
  const filtersOn = () => on("profileFilters") && prefs.profileFilters !== false;
  const filterHtml = (section, label) => filtersOn() ? `<label class="rcp-filter"><span class="rcp-sr-only">${label}</span><input type="search" data-profile-filter="${section}" value="${esc(profileQueries[section])}" placeholder="${label}" autocomplete="off"></label>` : "";
  const filterList = (section, list, name) => {
    const query = filtersOn() ? profileQueries[section].trim().toLocaleLowerCase() : "";
    return !query ? list : list.filter(item => String(name(item) || "").toLocaleLowerCase().includes(query));
  };

  let gameTab = "public", hiddenGames = null, hiddenLoading = false, hiddenError = "";
  async function loadHidden() {
    if (hiddenLoading || hiddenGames) return;
    hiddenLoading = true; paint("games");
    try {
      const access = await api(`https://inventory.roblox.com/v1/users/${uid}/can-view-inventory`);
      if (!access.canView) throw new Error("This inventory is private.");
      const owned = new Map(), publicIds = new Set();
      let cursor = "";
      do {
        const r = await api(`https://games.roblox.com/v2/users/${uid}/games?accessFilter=2&limit=50&sortOrder=Asc&cursor=${encodeURIComponent(cursor)}`);
        for (const g of r.data || []) publicIds.add(g.id);
        cursor = r.nextPageCursor || "";
      } while (cursor && rcAlive());
      cursor = "";
      do {
        const r = await api(`https://inventory.roblox.com/v1/users/${uid}/places/inventory?itemsPerPage=100&placesTab=Created&cursor=${encodeURIComponent(cursor)}`);
        for (const g of r.data || []) if (g.universeId && !publicIds.has(g.universeId)) owned.set(g.universeId,g);
        cursor = r.nextPageCursor || "";
      } while (cursor && rcAlive());
      hiddenGames = [];
      const ids = [...owned.keys()];
      for (let i=0;i<ids.length;i+=50) {
        const r = await api(`https://games.roblox.com/v1/games?universeIds=${ids.slice(i,i+50).join(",")}`);
        hiddenGames.push(...(r.data || []).map(g => ({...g, rootPlace:{id:g.rootPlaceId}, placeVisits:g.visits})));
      }
      await thumbs(hiddenGames.map(g => ["GameIcon",g.id]));
    } catch (e) { hiddenError = e.message === "This inventory is private." ? e.message : "Hidden experiences are unavailable right now."; }
    hiddenLoading = false; paint("games");
  }
  function gamesHtml() {
    const tabs = `<div class="rcp-tabs">${["public","hidden"].map(t => `<button type="button" class="${gameTab === t ? "rcp-on" : ""}" data-games="${t}">${t === "public" ? "Public" : "Hidden"}</button>`).join("")}</div>`;
    const all = gameTab === "hidden" ? hiddenGames : S.games;
    const list = all && filterList("games", all, g => g.name);
    const search = filterHtml("games", "Search experiences");
    if (gameTab === "hidden" && !list) return card("games", "Experiences", tabs + `<div class="rcp-empty">${esc(hiddenError || "Loading hidden experiences...")}</div>`);
    if (!list) return card("games", "Experiences", skel(4, "rcp-skel-grid"));
    if (!list.length) return card("games", "Experiences", tabs + (all.length ? search : "") + `<div class="rcp-empty">${all.length ? "No experiences match your search." : `No ${gameTab} experiences.`}</div>`);
    const show = expanded.has("games") ? list : list.slice(0, 6);
    const icon = (g) => thumbCache.get("GameIcon:" + g.id + ":150x150");
    return card("games", `Experiences <span class="rcp-count">${list.length}</span>`,
      tabs + search + `<div class="rcp-game-grid">${show.map((g) => {
        const st = S.gameStats[g.id] || {};
        return `<a class="rcp-game" href="/games/${g.rootPlace?.id || ""}">` +
          `<span class="rcp-game-icon">${icon(g) ? `<img src="${esc(icon(g))}" alt="" loading="lazy">` : ""}</span>` +
          `<span class="rcp-game-info"><b>${esc(g.name)}</b>` +
          `<span>${st.playing != null ? `<em class="rcp-live-n">${fmt(st.playing)}</em> playing · ` : ""}${fmt(st.visits ?? g.placeVisits)} visits</span>` +
          (on("profileRevenue") && st.revenue ? `<span class="rcp-rev">R$ ${fmt(st.revenue)} est. revenue</span>` : "") +
          `</span></a>`;
      }).join("")}</div>${more("games", list.length, 6)}`);
  }

  let groupSort = "members";
  function groupsHtml() {
    const list = S.groups && filterList("groups", S.groups, x => x.group.name).sort((a,b) => groupSort === "name" ? a.group.name.localeCompare(b.group.name) : groupSort === "rank" ? b.role.rank-a.role.rank : (b.group.memberCount || 0)-(a.group.memberCount || 0));
    if (!list) return card("groups", "Communities", skel(4, "rcp-skel-grid"));
    if (!list.length) return S.groups.length ? card("groups", "Communities", filterHtml("groups", "Search communities") + '<div class="rcp-empty">No communities match your search.</div>') : "";
    const show = expanded.has("groups") ? list : list.slice(0, 8);
    return card("groups", `Communities <span class="rcp-count">${list.length}</span>`,
      filterHtml("groups", "Search communities") + `<div class="rcp-tabs">${["members","name","rank"].map(t => `<button type="button" data-group-sort="${t}" class="${groupSort === t ? "rcp-on" : ""}">${t[0].toUpperCase()+t.slice(1)}</button>`).join("")}</div><div class="rcp-group-grid">${show.map((x) => {
        const img = thumbCache.get("GroupIcon:" + x.group.id + ":150x150");
        return `<a class="rcp-group" href="/communities/${x.group.id}">${img ? `<img src="${esc(img)}" alt="" loading="lazy">` : '<span class="rcp-group-ph"></span>'}` +
          `<span class="rcp-group-info"><b>${esc(x.group.name)}</b><span>${x.role?.rank === 255 ? '<em class="rcp-owner">Owner</em>' : esc(x.role?.name || "")} · ${fmt(x.group.memberCount)} members</span></span></a>`;
      }).join("")}</div>${more("groups", list.length, 8)}`);
  }

  function badgesHtml() {
    const rb = S.robloxBadges || [], pb = S.badges || [];
    if (!rb.length && !pb.length) return "";
    return card("badges", "Badges",
      (rb.length ? `<div class="rcp-subhead">Roblox badges</div><div class="rcp-badge-row">${rb.map((b) => `<span class="rcp-rbadge" title="${esc(b.name + ": " + b.description)}"><img src="${esc(b.imageUrl)}" alt=""><span>${esc(b.name)}</span></span>`).join("")}</div>` : "") +
      (pb.length ? `<div class="rcp-subhead">Recently earned</div><div class="rcp-badge-row">${pb.map((b) => {
        const img = thumbCache.get("BadgeIcon:" + b.id + ":150x150");
        return `<a class="rcp-rbadge" href="/badges/${b.id}" title="${esc(b.name)}${b.awarder?.name ? esc(" (" + b.awarder.name + ")") : ""}">${img ? `<img src="${esc(img)}" alt="">` : "<i></i>"}<span>${esc(b.name)}</span></a>`;
      }).join("")}</div>` : ""),
      `<a class="rcp-head-link" href="/users/${uid}/inventory/#!/badges">All badges</a>`);
  }

  function favoritesHtml() {
    const list = S.favorites;
    if (!list?.length) return "";
    return card("favorites", "Favorite experiences",
      `<div class="rcp-fav-row">${list.map((g) => {
        const img = thumbCache.get("GameIcon:" + g.id + ":150x150");
        return `<a class="rcp-fav" href="/games/${g.rootPlace?.id || ""}" title="${esc(g.name)}">${img ? `<img src="${esc(img)}" alt="" loading="lazy">` : "<span></span>"}<span>${esc(g.name)}</span></a>`;
      }).join("")}</div>`, `<a class="rcp-head-link" href="/users/${uid}/favorites">All favorites</a>`);
  }

  /* ---- sidebar ---- */
  let wearTab = "Items";
  function avatarHtml() {
    const assets = S.avatar ? [...(S.avatar.assets || []), ...(S.avatar.emotes || []).map(e => ({...e, id:e.assetId, assetType:{name:"Emote"}}))] : null;
    if (!assets) {
      const items = S.wearing || [];
      return items.length ? card("avatar", "Wearing", `<div class="rcp-wear">${items.map(id => `<a href="/catalog/${id}"><img src="${esc(thumbCache.get("Asset:"+id+":150x150") || "")}" alt="Item ${id}"></a>`).join("")}</div>`) : "";
    }
    const category = a => /Emote/.test(a.assetType?.name) ? "Emotes" : /Animation/.test(a.assetType?.name) ? "Animations" : /Head|Face|Torso|Arm|Leg/.test(a.assetType?.name) && !/Accessory/.test(a.assetType?.name) ? "Body" : "Items";
    const list = filterList("avatar", assets.filter(a => category(a) === wearTab), a => a.name);
    return card("avatar", "Currently wearing", filterHtml("avatar", "Search worn items") + `<div class="rcp-tabs">${["Items","Body","Animations","Emotes"].map(t => `<button type="button" class="${wearTab === t ? "rcp-on" : ""}" data-wear="${t}">${t}</button>`).join("")}</div><div class="rcp-wear">${list.map(a => `<a href="/catalog/${a.id}" title="${esc(a.name)}"><img src="${esc(thumbCache.get("Asset:"+a.id+":150x150") || "")}" alt="${esc(a.name)}" loading="lazy"></a>`).join("")}</div>`);
  }

  function sparkSvg(points) {
    const W = 260, H = 54;
    const pts = points.filter((p) => p[1] != null);
    if (pts.length < 2) return "";
    const t0 = pts[0][0], t1 = pts[pts.length - 1][0] || t0 + 1;
    const lo = Math.min(...pts.map((p) => p[1])), hi = Math.max(...pts.map((p) => p[1])), span = hi - lo || 1;
    const d = pts.map((p, i) => `${i ? "L" : "M"}${(((p[0] - t0) / (t1 - t0 || 1)) * W).toFixed(1)},${(H - 3 - ((p[1] - lo) / span) * (H - 6)).toFixed(1)}`).join("");
    return `<svg viewBox="0 0 ${W} ${H}" class="rcp-spark" preserveAspectRatio="none"><path d="${d}L${W},${H}L0,${H}Z" class="rcp-spark-area"/><path d="${d}" class="rcp-spark-line"/></svg>`;
  }

  function valueCardHtml() {
    if (!on("profileValue")) return "";
    const r = S.rol;
    if (!r) return card("value", "Collectibles value", skel(2));
    const year = (r.chart || []).filter((p) => p[0] >= Date.now() - 365 * 86400000);
    return card("value", "Collectibles value",
      `<div class="rcp-tiles rcp-tiles-2">${tile("Value", r.privacy && !r.value ? "Private" : "R$ " + fmt(r.value))}${tile("RAP", r.privacy && !r.rap ? "Private" : "R$ " + fmt(r.rap))}</div>` +
      (r.rank ? `<div class="rcp-muted rcp-line">Rank #${full(r.rank)} on Rolimons</div>` : "") +
      (year.length >= 2 ? sparkSvg(year) : ""),
      (r.chart || []).length >= 2 ? `<button type="button" class="rcp-head-link" data-modal="value">Full history</button>` : "");
  }

  function itemsCardHtml() {
    if (!itemScanOn()) return "";
    const it = S.items;
    if (!it) return card("items", "Roblox items", skel(2));
    if (it.private) return card("items", "Roblox items", '<div class="rcp-muted">This inventory is private.</div>');
    if (it.error) return card("items", "Roblox items", `<div class="rcp-muted">Couldn't load the inventory (${esc(it.error)}).</div>`);
    const top = it.list.filter((x) => x.price).sort((a, b) => b.price - a.price).slice(0, 3);
    return card("items", "Roblox items",
      `<div class="rcp-tiles rcp-tiles-2">${tile("Items", full(it.count), "official Roblox")}${tile("Known value", "R$ " + fmt(it.total))}</div>` +
      (!it.done && it.owned ? `<div class="rcp-progress"><i style="width:${Math.round((100 * (it.scanned || 0)) / it.owned)}%"></i></div><div class="rcp-muted rcp-line">Checking ${full(it.scanned || 0)} / ${full(it.owned)}${it.wait ? `, waiting ${it.wait} s for Roblox` : ""}</div>` : "") +
      (top.length ? `<div class="rcp-mini-list">${top.map((x) => `<a href="/${x.bundle ? "bundles" : "catalog"}/${x.id}"><span>${esc(x.name)}</span><b>R$ ${fmt(x.price)}</b></a>`).join("")}</div>` : ""),
      it.list.length ? `<button type="button" class="rcp-head-link" data-modal="items">See all</button>` : "");
  }

  function verifyCardHtml() {
    if (!on("profileVerify")) return "";
    const v = S.rv;
    if (!v || !(v.reason || v.flags?.length || v.history?.length)) return "";
    return card("verify", v.flags?.length ? '<span class="rcp-bad">Flagged</span>' : "Why verified?",
      (v.reason ? `<div class="rcp-reason-top"><span class="rcp-pill ${tone(v.reason.score)}">${esc(v.reason.label)}</span><span class="rcp-muted">${v.reason.score}/100</span></div>` : "") +
      (v.flags?.length ? `<div class="rcp-flag-mini">${v.flags.slice(0, 2).map((f) => `<b>${esc(f.reason)}</b>`).join("")}</div>` : "") +
      (!v.reason && !v.flags?.length && v.history?.length ? `<div class="rcp-muted">${(() => { const h = v.history.reduce((a, b) => (b.at > a.at ? b : a)); return (h.verified ? "Verified" : "Lost the badge") + " · " + day(h.at); })()}. No estimate of why yet.</div>` : ""),
      `<button type="button" class="rcp-head-link" data-modal="verify">Details</button>`);
  }

  function friendsHtml() {
    const f = S.friends, m = S.mutuals;
    if (!f && !m) return card("friends", "Friends", skel(2));
    const person = (p, mutual) => `<a href="/users/${p.id}/profile" title="@${esc(p.name)}${mutual ? " (you're both friends)" : ""}">${p.img ? `<img src="${esc(p.img)}" alt="" loading="lazy">` : "<span></span>"}` +
      `<span class="rcp-pname"><span>${esc(p.display || p.name)}</span>${personBadges(p)}</span>${mutual ? "<i>Mutual</i>" : ""}</a>`;
    const mutualIds = new Set((m?.list || []).map((p) => p.id));
    const rest = (f?.list || []).filter((p) => !mutualIds.has(p.id));
    const people = [...(m?.list || []).map((p) => person(p, true)), ...rest.map((p) => person(p, false))].slice(0, 9);
    if (!people.length) return card("friends", "Friends", '<div class="rcp-muted">No friends to show.</div>');
    return card("friends", `Friends <span class="rcp-count">${fmt(S.counts.friends ?? f?.total)}</span>`,
      (m?.total ? `<div class="rcp-muted rcp-line">${m.total} mutual friend${m.total > 1 ? "s" : ""}</div>` : "") + `<div class="rcp-people">${people.join("")}</div>`,
      `<a class="rcp-head-link" href="/users/${uid}/friends#!/friends">See all</a>`);
  }

  function aboutHtml() {
    const u = S.user;
    if (!u) return "";
    const rows = [
      ["User ID", `<button type="button" class="rcp-link" data-copy="${uid}">${uid}</button>`],
      ["Joined", day(Date.parse(u.created))],
      S.names?.length ? ["Previously", S.names.slice(0, 8).map((n) => `<button type="button" class="rcp-name-chip" data-copy="${esc(n)}" title="Copy">${esc(n)}</button>`).join("")] : null,
      u.isBanned ? ["Account", '<span class="rcp-bad">Banned</span>'] : null,
    ].filter(Boolean);
    return card("about", "Account", `<div class="rcp-facts">${rows.map(([k, v]) => `<div><span>${k}</span><div>${v}</div></div>`).join("")}</div>`);
  }

  /* ---- modal: players, the value chart, the full item list ---- */
  let modal = null, modalReturnFocus = null;
  function openModal(title, html, wide) {
    closeModal();
    modalReturnFocus = document.activeElement;
    modal = document.createElement("div");
    modal.id = "rcp-modal";
    modal.innerHTML = `<div class="rcp-modal-box${wide ? " rcp-wide" : ""}" role="dialog" aria-modal="true" aria-label="${esc(title)}">` +
      `<div class="rcp-modal-head"><b>${esc(title)}</b><button type="button" data-close aria-label="Close">×</button></div><div class="rcp-modal-body">${html}</div></div>`;
    modal.addEventListener("click", (e) => {
      if (e.target === modal || e.target.closest("[data-close]")) closeModal();
      else onModalClick(e);
    });
    document.body.append(modal);
    document.documentElement.classList.add("rcp-modal-open");
    modal.querySelector("[data-close]").focus({ preventScroll: true });
  }
  function closeModal() {
    modal?.remove(); // removing it also stops any player inside
    modal = null;
    document.documentElement.classList.remove("rcp-modal-open");
    if (modalReturnFocus?.isConnected) modalReturnFocus.focus({ preventScroll: true });
    modalReturnFocus = null;
  }
  addEventListener("keydown", (e) => {
    if (!modal) return;
    if (e.key === "Escape") { e.preventDefault(); closeModal(); return; }
    if (e.key !== "Tab") return;
    const focusable = [...modal.querySelectorAll('button:not(:disabled), a[href], input, select, textarea, iframe, [tabindex="0"]')].filter(el => el.getClientRects().length);
    const first = focusable[0], last = focusable[focusable.length - 1];
    if (e.shiftKey && (document.activeElement === first || !modal.contains(document.activeElement))) { e.preventDefault(); last?.focus(); }
    else if (!e.shiftKey && (document.activeElement === last || !modal.contains(document.activeElement))) { e.preventDefault(); first?.focus(); }
  });
  const player = (src, title) => `<div class="rcp-player"><iframe src="${src}" title="${esc(title)}" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe></div>`;
  const PARENT = encodeURIComponent(location.hostname);

  let rangeDays = 365, minPrice = 0;
  const MIN_PRICES = [[0, "All"], [100, "100+"], [1000, "1K+"], [10000, "10K+"]];

  function chartSvg(points) {
    const W = 640, H = 200, L = 48, B = 22, T = 8, R = 8;
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
  function valueModalHtml() {
    const r = S.rol;
    const peak = (r.chart || []).reduce((m, p) => (p[1] > (m?.[1] ?? -1) ? p : m), null);
    return `<div class="rcp-tiles">${tile("Value", r.privacy && !r.value ? "Private" : `R$ ${full(r.value)}`)}${tile("RAP", r.privacy && !r.rap ? "Private" : `R$ ${full(r.rap)}`)}` +
      `${tile("Rank", r.rank ? "#" + full(r.rank) : "-")}${peak ? tile("Peak value", `R$ ${fmt(peak[1])}`, day(peak[0])) : ""}</div>` +
      `<div class="rcp-chart-wrap"><div class="rcp-ranges">${[["1m", 30], ["3m", 91], ["1y", 365], ["All", 0]].map(([t, d]) => `<button type="button" data-days="${d}" class="${d === rangeDays ? "rcp-on" : ""}">${t}</button>`).join("")}` +
      `<span class="rcp-legend"><i class="rcp-val-key"></i>Value <i class="rcp-rap-key"></i>RAP</span></div>${chartSvg(chartPoints())}</div><div class="rcp-note">Source: Rolimons.</div>`;
  }
  function wireChart() {
    const svg = modal?.querySelector(".rcp-chart");
    if (!svg) return;
    const show = chartPoints();
    const tip = modal.querySelector(".rcp-tip"), cur = svg.querySelector(".rcp-cursor");
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
  function itemsModalHtml() {
    const it = S.items;
    const list = it.list.filter((x) => !minPrice || (x.price ?? 0) >= minPrice);
    const sum = (arr) => arr.reduce((n, x) => n + (x.price || 0), 0);
    const onSale = list.filter((x) => x.onSale), off = list.filter((x) => !x.onSale);
    const unknown = off.filter((x) => x.price == null).length;
    const rows = list.filter((x) => x.price).sort((a, b) => b.price - a.price).slice(0, 60).map((x) => {
      const img = thumbCache.get((x.bundle ? "BundleThumbnail" : "Asset") + ":" + x.id + ":150x150");
      return `<a class="rcp-row" href="/${x.bundle ? "bundles" : "catalog"}/${x.id}">${img ? `<img src="${esc(img)}" alt="">` : "<span class='rcp-ph'></span>"}` +
        `<span class="rcp-row-name">${esc(x.name)}</span><span class="rcp-row-meta">${x.bundle ? '<span class="rcp-tag">Bundle</span> ' : ""}${x.onSale ? "" : '<span class="rcp-off">Offsale</span> '}R$ ${full(x.price)}</span></a>`;
    }).join("");
    return `<div class="rcp-ranges"><span class="rcp-muted">Price</span>${MIN_PRICES.map(([p, t]) => `<button type="button" data-min="${p}" class="${p === minPrice ? "rcp-on" : ""}">${t}</button>`).join("")}</div>` +
      `<div class="rcp-tiles">${tile("Items", full(list.length), minPrice ? `of ${full(it.count)}` : "official")}${tile("Total", "R$ " + full(sum(list)), "known prices")}` +
      `${tile("On sale", full(onSale.length), "R$ " + fmt(sum(onSale)))}${tile("Off sale", full(off.length), "R$ " + fmt(sum(off)) + (unknown ? ` · ${unknown} unknown` : ""))}</div>` +
      (rows ? `<div class="rcp-list">${rows}</div>` : '<div class="rcp-muted">No items at this price.</div>') +
      `<div class="rcp-note">Official Roblox items only: limiteds are in Collectibles value. Bundles such as Korblox count once. Offsale items count at the last price Roblox lists; for most older ones it lists none.</div>`;
  }
  function verifyModalHtml() {
    const v = S.rv;
    let html = "";
    if (v.reason) {
      const s = Math.max(0, Math.min(100, v.reason.score ?? 0));
      html += `<div class="rcp-reason-top"><span class="rcp-pill ${tone(s)}">${esc(v.reason.label)}</span>` +
        `<span class="rcp-score ${tone(s)}"><span class="rcp-bar"><i style="width:${s}%"></i></span>${s}/100</span>` +
        (v.reason.confidence ? `<span class="rcp-muted">${esc(v.reason.confidence)} confidence</span>` : "") + `</div>` +
        `<p class="rcp-summary">${esc(v.reason.summary)}</p>` +
        (v.reason.evidence?.length ? `<ul class="rcp-evidence">${v.reason.evidence.map((e) => `<li>${esc(e)}</li>`).join("")}</ul>` : "");
    }
    if (v.flags?.length) html += `<div class="rcp-flags">${v.flags.map((f) => `<div class="rcp-flag"><b>${esc(f.reason)}</b>${f.note ? `<span>${esc(f.note)}</span>` : ""}<span class="rcp-muted">${f.at ? day(f.at) : ""}</span></div>`).join("")}</div>`;
    const extra = [
      ...(v.history || []).map((h) => `<span class="${h.verified ? "rcp-got" : "rcp-lost"}">${h.verified ? "Verified" : "Lost badge"} · ${day(h.at)}</span>`),
      ...(v.linked || []).map((l) => `<a href="/users/${encodeURIComponent(l.id)}/profile">Linked: ${esc(l.name || l.id)}</a>`),
    ];
    if (extra.length) html += `<div class="rcp-history">${extra.join("")}</div>`;
    return html + `<div class="rcp-note">An estimate: Roblox doesn't publish why accounts are verified. Source: RobloxVerifieds.</div>`;
  }
  function onModalClick(e) {
    const d = e.target.closest("[data-days]");
    if (d) { rangeDays = +d.dataset.days; modal.querySelector(".rcp-modal-body").innerHTML = valueModalHtml(); wireChart(); return; }
    const mp = e.target.closest("[data-min]");
    if (mp) { minPrice = +mp.dataset.min; modal.querySelector(".rcp-modal-body").innerHTML = itemsModalHtml(); itemThumbs(); }
    copy(e);
  }
  async function itemThumbs() {
    const top = (S.items?.list || []).filter((x) => x.price && (!minPrice || x.price >= minPrice)).sort((a, b) => b.price - a.price).slice(0, 60);
    await thumbs(top.map((x) => [x.bundle ? "BundleThumbnail" : "Asset", x.id]));
    if (modal?.querySelector(".rcp-list")) modal.querySelector(".rcp-modal-body").innerHTML = itemsModalHtml();
  }

  /* ---- drawing ---- */
  const LOAD_LABELS = { hero:"Profile", avatar:"Currently wearing", groups:"Communities", games:"Experiences", favorites:"Favorites", friends:"Friends" };
  const loadErrors = {}, loadingSections = new Set();
  const SECTIONS = { stage: stageHtml, note: noteHtml, hero: heroHtml, socials: socialsHtml, games: gamesHtml, groups: groupsHtml, badges: badgesHtml, favorites: favoritesHtml, avatar: avatarHtml, value: valueCardHtml, items: itemsCardHtml, verify: verifyCardHtml, friends: friendsHtml, about: aboutHtml };
  const painted = new Map(); // section -> the HTML it shows now
  function paint(...names) {
    if (!root) return;
    for (const n of names) {
      const el = root.querySelector(`[data-sec="${n}"]`);
      if (!el) continue;
      const failure = loadErrors[n];
      const html = failure ? card(n, LOAD_LABELS[n] || "Profile", `<div class="rcp-empty" role="status">${esc(failure.message)}</div><button type="button" class="rcp-more" data-retry="${n}"${failure.retryAt > Date.now() ? " disabled" : ""}>${failure.retryAt > Date.now() ? "Wait a minute before retrying" : "Try again"}</button>`) : SECTIONS[n]();
      if (painted.get(n) === html) continue; // unchanged: keep the DOM (and an open X timeline) as it is
      if (n === "hero") closeActions();
      painted.set(n, html);
      el.innerHTML = html;
      el.hidden = !html;

    }
    updateProfileNav();
    if (names.includes("items") && !names.includes("hero")) updateInventoryStat();

  }

  // Read values only. No Roblox or RoValra elements are displayed in our layout.
  const source = (sel) => document.querySelector(".profile-platform-container")?.querySelector(sel);
  function imageUrl(value) {
    try {
      const u = new URL(value);
      return u.protocol === "https:" && /(^|\.)(rbxcdn\.com|roblox\.com|rovalra\.com)$/.test(u.hostname) ? u.href : "";
    } catch { return ""; }
  }
  function readCustom() {
    const name = source("#profile-header-title-container-name");
    const bg = source(".profile-avatar-left");
    const note = source(".rovalra-profile-note-display");
    const c = {
      gradient: name?.style.backgroundImage?.includes("gradient(") ? name.style.backgroundImage : "",
      effect: /rovalra-display-name-(roll|shine)/.exec(name?.className || "")?.[1] || "",
      pronouns: source(".rovalra-profile-pronouns")?.textContent.trim() || "",
      views: source(".rovalra-profile-views-pill")?.textContent.trim() || "",
      status: source(".rovalra-status-bubble")?.textContent.trim() || "",
      frame: imageUrl(source("img.rovalra-profile-frame")?.src),
      border: imageUrl(source("img.rovalra-avatar-border")?.src),
      background: bg?.style.backgroundImage || "",
      render: imageUrl(source(".thumbnail-holder img:not(.rovalra-profile-frame)")?.src),
      note: note?.classList.contains("rovalra-profile-note-placeholder") ? "" : note?.textContent || "",
      notes: !!note,
      badges: [...(source(".profile-header-overlay")?.querySelectorAll(".rovalra-header-badge") || [])].map(b => ({
        image: imageUrl(b.matches("img") ? b.src : b.querySelector("img")?.src),
        label: b.dataset.badgeId || b.getAttribute("aria-label") || b.title || "RoValra supporter",
      })),
      actions: [...(source(".buttons-show-on-desktop")?.querySelectorAll('[id^="user-profile-header-"]') || [])]
        .filter(b => !b.id.includes("contextual") && b.textContent.trim()).map(b => ({id:b.id, label:b.textContent.trim(), disabled:b.disabled})),
    };
    if (JSON.stringify(c) === JSON.stringify(S.custom)) return;
    S.custom = c;
    paint("hero", "stage", "note");
  }
  function stageHtml() {
    const c = S.custom;
    const render = c.render || S.body;
    if (!render && !c.frame) return "";
    return card("stage", "Avatar", `<div class="rcp-stage${c.frame ? " rcp-framed" : ""}">` +
      `<div class="rcp-stage-scene" style="background-image:${esc(c.background || "none")}">` +
      (render ? `<img class="rcp-stage-avatar" src="${esc(render)}" alt="Avatar">` : "") +
      (c.frame ? `<img class="rcp-stage-frame" src="${esc(c.frame)}" alt="RoValra profile frame">` : "") + `</div></div>`,
      `<button type="button" class="rcp-head-link" data-outfits>View outfits</button>`);
  }
  function noteHtml() {
    return S.custom.notes ? card("note", "Private note", `<textarea class="rcp-note-input" maxlength="256" aria-label="Private RoValra note" placeholder="Only you can see this">${esc(S.custom.note)}</textarea><button type="button" class="rcp-more" data-save-note>Save note</button><p class="rcp-muted" role="status" data-note-status>Private to you. Stored by RoValra.</p>`) : "";
  }
  let outfitRequest = null;
  async function outfits() {
    openModal("Outfits", '<div class="rcp-empty">Loading outfits...</div>');
    const target = modal;
    const r = await (outfitRequest ||= api(`https://avatar.roblox.com/v1/users/${uid}/outfits?page=1&itemsPerPage=25`).catch(() => { outfitRequest = null; return null; }));
    const list = r?.data || [];
    await thumbs(list.map(o => ["Outfit", o.id]), "420x420");
    if (modal !== target) return;
    modal.querySelector(".rcp-modal-body").innerHTML = !r ? '<div class="rcp-empty">Outfits could not load. Close this window and try again.</div>' : list.length ? `<div class="rcp-outfits">${list.map(o => `<div><img src="${esc(thumbCache.get("Outfit:"+o.id+":420x420") || "")}" alt=""><b>${esc(o.name)}</b></div>`).join("")}</div>` : '<div class="rcp-empty">No public outfits available.</div>';
  }
  async function saveNote(button) {
    const value = root.querySelector(".rcp-note-input").value;
    source(".rovalra-profile-note-display")?.click();
    await sleep(40);
    const input = source("textarea.rovalra-profile-note-input");
    if (!input) { root.querySelector("[data-note-status]").textContent = "RoValra's editor is unavailable. Try again."; return; }
    input.value = value;
    input.dispatchEvent(new Event("input", {bubbles:true}));
    input.dispatchEvent(new Event("blur"));
    await sleep(350);
    readCustom();
    const status = root.querySelector("[data-note-status]");
    if (status) status.textContent = S.custom.note === value.trim() ? "Saved through RoValra." : "RoValra could not save the note. Try again.";
  }
  let actionMenu = null;
  function closeActions(restoreFocus = false) {
    if (!actionMenu) return;
    const { box, button, original, outside, keyboard } = actionMenu;
    actionMenu = null;
    box.remove();
    button.setAttribute("aria-expanded", "false");
    if (original.getAttribute("aria-expanded") === "true") original.click();
    document.documentElement.classList.remove("rcp-proxying");
    document.removeEventListener("click", outside);
    document.removeEventListener("keydown", keyboard);
    if (restoreFocus && button.isConnected) button.focus({ preventScroll: true });
  }
  async function showActions(button) {
    if (actionMenu) { closeActions(true); return; }
    const original = source("#user-profile-header-contextual-menu-button");
    if (!original) return;
    const box = document.createElement("div");
    box.className = "rcp-action-menu";
    box.id = "rcp-action-menu";
    box.setAttribute("role", "menu");
    const outside = e => { if (!button.parentElement.contains(e.target)) closeActions(); };
    const keyboard = e => {
      if (e.key === "Escape") { e.preventDefault(); closeActions(true); return; }
      if (e.key === "Tab") { closeActions(true); return; }
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
      e.preventDefault();
      const items = [...box.querySelectorAll("button:not(:disabled)")];
      const current = items.indexOf(document.activeElement);
      const index = e.key === "Home" ? 0 : e.key === "End" ? items.length - 1 : (current + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
      items[index]?.focus();
    };
    const state = actionMenu = { box, button, original, outside, keyboard };
    button.setAttribute("aria-expanded", "true");
    button.setAttribute("aria-controls", box.id);
    document.documentElement.classList.add("rcp-proxying");
    original.click();
    let menu;
    for (let i=0;i<10;i++) {
      await sleep(50);
      if (actionMenu !== state) return;
      menu = document.getElementById(original.getAttribute("aria-controls")) || document.querySelector("ul.new-dropdown-menu");
      if (menu?.querySelector('[role="menuitem"], a, button')) break;
    }
    const entries = [...(menu?.querySelectorAll('[role="menuitem"]') || [])];
    if (!entries.length) entries.push(...(menu?.querySelectorAll("a, button") || []));
    for (const item of entries) {
      const action = document.createElement("button");
      action.type = "button";
      action.setAttribute("role", "menuitem");
      action.textContent = item.textContent.trim();
      action.disabled = item.disabled || item.getAttribute("aria-disabled") === "true";
      action.addEventListener("click", () => { item.click(); closeActions(); });
      box.append(action);
    }
    if (!entries.length) { closeActions(true); return; }
    button.parentElement.append(box);
    box.querySelector("button:not(:disabled)")?.focus({ preventScroll: true });
    document.addEventListener("click", outside);
    document.addEventListener("keydown", keyboard);
  }

  const NAV_LABELS = { hero: "Overview", stage: "Avatar", socials: "Socials", games: "Experiences", groups: "Communities", badges: "Badges", favorites: "Favorites", items: "Roblox items", friends: "Friends", about: "Account" };
  let navHtml = "";
  function updateProfileNav() {
    const nav = root?.querySelector(".rcp-section-nav");
    if (!nav) return;
    nav.hidden = prefs.profileNav === false || !on("profileNav");
    if (nav.hidden) return;
    const html = Object.entries(NAV_LABELS).filter(([name]) => {
      const section = root.querySelector(`[data-sec="${name}"]`);
      return section && !section.hidden;
    }).map(([name, label]) => `<button type="button" data-jump="${name}">${label}</button>`).join("");
    if (html !== navHtml) { nav.innerHTML = html; navHtml = html; }
  }

  const paintAll = () => paint(...Object.keys(SECTIONS));

  function copy(e) {
    const c = e.target.closest("[data-copy]");
    if (!c) return false;
    const old = c.textContent;
    const feedback = text => { c.textContent = text; setTimeout(() => { if (c.isConnected) c.textContent = old; }, 1600); };
    if (!navigator.clipboard) { feedback("Copy unavailable"); return true; }
    navigator.clipboard.writeText(c.dataset.copy).then(() => feedback("Copied"), () => feedback("Copy unavailable"));
    return true;
  }

  function onClick(e) {
    const jump = e.target.closest("[data-jump]");
    if (jump) {
      const section = root.querySelector(`[data-sec="${jump.dataset.jump}"]`);
      section?.setAttribute("tabindex", "-1");
      section?.focus({ preventScroll: true });
      section?.scrollIntoView({ block: "start", behavior: (document.documentElement.classList.contains("rc-reduce-motion") || matchMedia("(prefers-reduced-motion: reduce)").matches) ? "instant" : "smooth" });
      return;
    }
    if (copy(e)) return;
    const t = e.target;
    if (t.closest("[data-classic]")) return classic(true);
    const retry = t.closest("[data-retry]");
    if (retry) {
      const key = retry.dataset.retry, load = loaders.find(fn => fn.name === key);
      if (load && (!loadErrors[key] || loadErrors[key].retryAt <= Date.now())) runLoader(load);
      return;
    }
    const games = t.closest("[data-games]");
    if (games) { gameTab = games.dataset.games; if (gameTab === "hidden") loadHidden(); paint("games"); return; }
    const sort = t.closest("[data-group-sort]");
    if (sort) { groupSort = sort.dataset.groupSort; paint("groups"); return; }
    const proxy = t.closest("[data-proxy]");
    if (proxy) return source("#" + CSS.escape(proxy.dataset.proxy))?.click();
    if (t.closest("[data-actions]")) return showActions(t.closest("[data-actions]"));
    if (t.closest("[data-outfits]")) return outfits();
    if (t.closest("[data-save-note]")) return saveNote(t.closest("[data-save-note]"));
    const wear = t.closest("[data-wear]");
    if (wear) { wearTab = wear.dataset.wear; paint("avatar"); return; }
    if (t.closest("[data-more]")) { t.closest(".rcp-bio").classList.toggle("rcp-open"); t.closest("[data-more]").textContent = t.closest(".rcp-bio").classList.contains("rcp-open") ? "Show less" : "Show more"; return; }
    const ex = t.closest("[data-expand]");
    if (ex) { expanded.has(ex.dataset.expand) ? expanded.delete(ex.dataset.expand) : expanded.add(ex.dataset.expand); paint(ex.dataset.expand); return; }
    const so = t.closest("[data-social]");
    if (so) { socialTab = so.dataset.social; socialPicked = true; paint("socials"); return; }
    const yt = t.closest("[data-yt]");
    if (yt && /^[\w-]{11}$/.test(yt.dataset.yt)) return openModal(yt.title || "YouTube", player(`https://www.youtube-nocookie.com/embed/${yt.dataset.yt}?autoplay=1&rel=0`, yt.title || "YouTube video"), true);
    if (t.closest("[data-twitch-live]") && S.tw?.login) return openModal(`${S.tw.name} on Twitch`, player(`https://player.twitch.tv/?channel=${encodeURIComponent(S.tw.login)}&parent=${PARENT}&autoplay=true`, "Twitch stream"), true);
    const tv = t.closest("[data-twitch-video]");
    if (tv && /^\d{1,15}$/.test(tv.dataset.twitchVideo)) return openModal(tv.title || "Twitch", player(`https://player.twitch.tv/?video=v${tv.dataset.twitchVideo}&parent=${PARENT}&autoplay=true`, tv.title || "Twitch video"), true);
    const tc = t.closest("[data-twitch-clip]");
    if (tc && /^[\w-]{1,120}$/.test(tc.dataset.twitchClip)) return openModal(tc.title || "Twitch clip", player(`https://clips.twitch.tv/embed?clip=${encodeURIComponent(tc.dataset.twitchClip)}&parent=${PARENT}&autoplay=true`, tc.title || "Twitch clip"), true);
    const md = t.closest("[data-modal]");
    if (md?.dataset.modal === "value" && S.rol) { openModal("Collectibles value", valueModalHtml(), true); wireChart(); return; }
    if (md?.dataset.modal === "items" && S.items) { openModal("Roblox items", itemsModalHtml(), true); itemThumbs(); return; }
    if (md?.dataset.modal === "verify" && S.rv) return openModal("Why verified?", verifyModalHtml());
  }

  /* ---- layout: next to Roblox's, which CSS hides ---- */
  function build() {
    const host = document.querySelector(".profile-platform-container");
    if (!host) return false;
    root = document.createElement("div");
    root.id = "rcp-root";
    root.innerHTML =
      `<section id="rcp-hero" data-sec="hero"></section>` +
      `<nav class="rcp-section-nav" aria-label="Profile sections" hidden></nav>` +
      `<div class="rcp-layout"><div class="rcp-main">` +
      `<section class="rcp-card" data-sec="stage" hidden></section>` +
      `<section class="rcp-card" data-sec="socials" hidden></section>` +
      ["games", "groups", "badges", "favorites"].map((n) => `<section class="rcp-card rcp-own" data-sec="${n}" hidden></section>`).join("") +
      `</div><aside class="rcp-side">` +
      ["avatar", "value", "items", "verify", "note", "friends", "about"].map((n) => `<section class="rcp-card${n === "avatar" ? " rcp-own" : ""}" data-sec="${n}" hidden></section>`).join("") +
      `</aside></div>`;
    root.addEventListener("click", onClick);
    root.addEventListener("input", e => {
      const input = e.target.closest("[data-profile-filter]");
      if (!input) return;
      const section = input.dataset.profileFilter;
      profileQueries[section] = input.value.slice(0, 120);
      const start = input.selectionStart, end = input.selectionEnd;
      paint(section);
      const next = root.querySelector(`[data-profile-filter="${section}"]`);
      next?.focus({ preventScroll: true });
      if (next && start != null) next.setSelectionRange(start, end);
    });
    host.after(root);
    document.documentElement.classList.add("rcp2");
    paintAll();
    readCustom();
    rcWatch(() => {
      if (!root || classicOn) return;
      const h = document.querySelector(".profile-platform-container");
      if (h && h.nextElementSibling !== root) h.after(root);
      readCustom();
    }, {text: true});
    return true;
  }

  // "Roblox's layout": for this visit only, with a button back
  let classicOn = false, back = null;
  function classic(v) {
    closeActions();
    if (v) closeModal();
    classicOn = v;
    document.documentElement.classList.toggle("rcp2", !v);
    if (root) root.hidden = v;
    if (v && !back) {
      back = Object.assign(document.createElement("button"), { type: "button", id: "rcp-back", textContent: "RoCreate profile" });
      back.addEventListener("click", () => classic(false));
      document.body.append(back);
    }
    if (back) back.hidden = !v;
    try { sessionStorage.setItem("rc-classic", v ? "1" : ""); } catch {}
  }

  /* ---- data ---- */
  const count = (url) => api(url).then((r) => r.count).catch(() => null);

  async function runLoader(load) {
    const section = LOAD_LABELS[load.name] ? load.name : null;
    if (section && loadingSections.has(section)) return;
    if (section) { loadingSections.add(section); delete loadErrors[section]; paint(section); }
    try { await load(); }
    catch (error) {
      if (!section || !rcAlive()) return;
      const limited = error.message === "429";
      loadErrors[section] = { message: limited ? "Roblox is limiting requests. Give it a minute, then try again." : "This section could not load. Your connection or this account's privacy settings may prevent it.", retryAt: limited ? Date.now() + 60000 : 0 };
      paint(section);
      if (limited) setTimeout(() => { if (rcAlive() && root) paint(section); }, 60050);
    } finally { if (section) loadingSections.delete(section); }
  }

  const loaders = [
    async function avatar() {
      S.avatar = await api(`https://avatar.roblox.com/v1/users/${uid}/avatar`);
      await thumbs([...(S.avatar.assets || []).map(a => ["Asset", a.id]), ...(S.avatar.emotes || []).map(a => ["Asset", a.assetId])]);
      paint("avatar");
    },
    // who they are
    async function hero() {
      const [user, pres] = await Promise.allSettled([
        api(`https://users.roblox.com/v1/users/${uid}`),
        api("https://presence.roblox.com/v1/presence/users", { userIds: [Number(uid)] }),
      ]);
      if (user.status === "fulfilled") { S.user = user.value; S.gone = false; }
      else if (user.reason?.message === "404") S.gone = true;
      else throw user.reason;
      S.presence = pres.value?.userPresences?.[0] || null;
      paint("hero", "about");
      discover();
    },
    async () => {
      const [friends, followers, following] = await Promise.all([
        count(`https://friends.roblox.com/v1/users/${uid}/friends/count`),
        count(`https://friends.roblox.com/v1/users/${uid}/followers/count`),
        count(`https://friends.roblox.com/v1/users/${uid}/followings/count`),
      ]);
      S.counts = { friends, followers, following };
      paint("hero", "friends");
    },
    async () => {
      const [head, body] = await Promise.all([
        api(`https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${uid}&size=150x150&format=Png&isCircular=false`).catch(() => null),
        api(`https://thumbnails.roblox.com/v1/users/avatar?userIds=${uid}&size=420x420&format=Png&isCircular=false`).catch(() => null),
      ]);
      S.head = head?.data?.[0]?.imageUrl || "";
      S.body = body?.data?.[0]?.imageUrl || "";
      paint("hero", "avatar", "stage");
    },
    async () => {
      const h = await api(`https://users.roblox.com/v1/users/${uid}/username-history?limit=100&sortOrder=Desc`);
      S.names = (h.data || []).map((x) => x.name);
      paint("about");
    },
    async () => {
      if (prefs.users === false) return;
      const got = await ask({ type: "rcx-users", ids: [uid] });
      S.marks = got?.[uid] || {};
      paint("hero");
    },
    // what they make and belong to
    async function groups() {
      const g = await api(`https://groups.roblox.com/v2/users/${uid}/groups/roles`);
      S.groups = (g.data || []).sort((a, b) => (b.role?.rank === 255) - (a.role?.rank === 255) || (b.group.memberCount || 0) - (a.group.memberCount || 0));
      paint("groups");
      await thumbs(S.groups.slice(0, 40).map((x) => ["GroupIcon", x.group.id]));
      paint("groups");
      discover();
    },
    async function games() {
      const g = await api(`https://games.roblox.com/v2/users/${uid}/games?accessFilter=2&limit=50&sortOrder=Desc`);
      S.games = (g.data || []).filter((x) => x.rootPlace?.id).sort((a, b) => (b.placeVisits || 0) - (a.placeVisits || 0));
      paint("games", "hero");
      discover();
      if (!S.games.length) return;
      const ids = S.games.slice(0, 50).map((x) => x.id);
      const [live, , ce] = await Promise.all([
        api(`https://games.roblox.com/v1/games?universeIds=${ids.join(",")}`).catch(() => null),
        thumbs(ids.map((id) => ["GameIcon", id])),
        on("profileRevenue") || on("stats") ? ask({ type: "rcx-stats", games: S.games.slice(0, 30).map((x) => ({ id: String(x.id), name: x.name })), search: true }) : null,
      ]);
      for (const x of live?.data || []) S.gameStats[x.id] = { ...S.gameStats[x.id], playing: x.playing, visits: x.visits };
      for (const [id, st] of Object.entries(ce || {})) if (st && !st.missing) S.gameStats[id] = { ...S.gameStats[id], revenue: st.revenue };
      paint("games", "hero");
    },
    async function favorites() {
      const f = await api(`https://games.roblox.com/v2/users/${uid}/favorite/games?accessFilter=2&limit=10&sortOrder=Desc`);
      S.favorites = (f.data || []).filter((x) => x.rootPlace?.id).slice(0, 8);
      if (!S.favorites.length) return;
      await thumbs(S.favorites.map((x) => ["GameIcon", x.id]));
      paint("favorites");
    },
    async () => {
      const w = await api(`https://avatar.roblox.com/v1/users/${uid}/currently-wearing`);
      S.wearing = (w.assetIds || []).slice(0, 12);
      paint("avatar");
      await thumbs(S.wearing.map((id) => ["Asset", id]));
      paint("avatar");
    },
    async () => {
      const [rb, pb] = await Promise.allSettled([
        api(`https://accountinformation.roblox.com/v1/users/${uid}/roblox-badges`),
        api(`https://badges.roblox.com/v1/users/${uid}/badges?limit=10&sortOrder=Desc`),
      ]);
      S.robloxBadges = (rb.value || []).filter((b) => /^https:\/\/[\w.-]+\.rbxcdn\.com\//.test(b.imageUrl || ""));
      S.badges = (pb.value?.data || []).slice(0, 8);
      paint("badges");
      if (S.badges.length) {
        await thumbs(S.badges.map((b) => ["BadgeIcon", b.id]));
        paint("badges");
      }
    },
    // people
    async function friends() {
      const viewer = me();
      const [theirs, yours] = await Promise.all([
        api(`https://friends.roblox.com/v1/users/${uid}/friends`),
        viewer && viewer !== uid ? api(`https://friends.roblox.com/v1/users/${viewer}/friends`).catch(() => null) : null,
      ]);
      const ids = (theirs.data || []).map((x) => String(x.id));
      const yoursSet = new Set((yours?.data || []).map((x) => String(x.id)));
      const mutual = yours ? ids.filter((id) => yoursSet.has(id)) : [];
      const show = [...mutual.slice(0, 9), ...ids.filter((id) => !yoursSet.has(id)).slice(0, 9)].slice(0, 18);
      const [names, heads] = show.length ? await Promise.all([
        api("https://users.roblox.com/v1/users", { userIds: show.map(Number), excludeBannedUsers: false }).catch(() => null),
        thumbs(show.map((id) => ["AvatarHeadShot", id])),
      ]) : [null, () => ""];
      const nm = Object.fromEntries((names?.data || []).map((u) => [String(u.id), u]));
      const person = (id) => ({ id, name: nm[id]?.name || id, display: nm[id]?.displayName, verified: !!nm[id]?.hasVerifiedBadge, img: heads("AvatarHeadShot", id) });
      S.mutuals = yours ? { total: mutual.length, list: mutual.slice(0, 9).map(person) } : null;
      S.friends = { total: ids.length, list: show.filter((id) => !mutual.includes(id)).map(person) };
      paint("friends");
      // RoCreate's own badges (flagged, formerly verified, Roblox admin) for the people shown
      if (prefs.users !== false && show.length) {
        const marks = (await ask({ type: "rcx-users", ids: show })) || {};
        for (const p of [...(S.mutuals?.list || []), ...S.friends.list]) p.marks = marks[p.id] || null;
        paint("friends");
      }
    },
    // value and verification
    async () => {
      if (!on("profileValue")) return;
      S.rol = await ask({ type: "rcx-rolimons", id: uid });
      paint("value", "hero");
    },
    async () => {
      if (!on("profileVerify")) return;
      S.rv = await ask({ type: "rcx-rvuser", id: uid });
      paint("verify");
    },
  ];

  /* ---- socials: where their links come from ---- */
  let discovering = false, discovered = false;
  function classify(raw, source, found) {
    let u;
    try { u = new URL(/^https?:\/\//i.test(raw) ? raw : "https://" + raw); } catch { return; }
    if (u.protocol !== "https:" && u.protocol !== "http:") return;
    const host = u.hostname.toLowerCase().replace(/^(www|m)\./, "");
    const seg = u.pathname.split("/").filter(Boolean);
    let hit = null;
    if (host === "youtube.com" && seg.length && /^(@[^/]{1,100}|channel|c|user)$/.test(seg[0].startsWith("@") ? "@x" : seg[0])) {
      const path = seg[0].startsWith("@") ? "/" + seg[0] : "/" + seg.slice(0, 2).join("/");
      hit = ["youtube", { url: "https://www.youtube.com" + path, label: seg[0].startsWith("@") ? seg[0] : seg[1] || "YouTube" }];
    } else if (host === "twitch.tv" && /^[a-z0-9_]{3,25}$/i.test(seg[0] || "") && !/^(directory|videos|p|search|settings|downloads|jobs)$/i.test(seg[0])) {
      hit = ["twitch", { url: "https://www.twitch.tv/" + seg[0].toLowerCase(), label: seg[0], login: seg[0].toLowerCase() }];
    } else if ((host === "x.com" || host === "twitter.com") && /^[A-Za-z0-9_]{1,15}$/.test(seg[0] || "") && !/^(home|i|intent|share|search|hashtag|explore|settings)$/i.test(seg[0])) {
      hit = ["x", { url: "https://x.com/" + seg[0], label: "@" + seg[0], handle: seg[0] }];
    } else if ((host === "discord.gg" && seg[0]) || (host === "discord.com" && seg[0] === "invite" && seg[1])) {
      const code = host === "discord.gg" ? seg[0] : seg[1];
      if (/^[\w-]{2,40}$/.test(code)) hit = ["discord", { url: "https://discord.gg/" + code, label: "Discord" }];
    }
    if (hit && !found[hit[0]]) found[hit[0]] = { ...hit[1], source };
  }

  async function discover() {
    if (!on("socials") || prefs.socials === false || discovered || discovering || !S.user || !S.groups || !S.games) return;
    discovering = true;
    const found = {};
    // 1. their own words: real links in the bio
    // (a boundary first, or "roblox.com/help" would read as x.com/help)
    for (const m of (S.user.description || "").matchAll(/(?<![\w.-])(?:https?:\/\/)?(?:www\.|m\.)?(?:youtube\.com\/[^\s<>"']+|twitch\.tv\/\w+|(?:x|twitter)\.com\/\w+|discord\.gg\/[\w-]+)/gi)) classify(m[0], "from their bio", found);
    // 2. their own experiences, then 3. the communities they own (Roblox keeps official links on both)
    if (me()) {
      for (const g of S.games.slice(0, 3)) {
        const r = await api(`https://games.roblox.com/v1/games/${g.id}/social-links/list`).catch(() => null);
        for (const l of r?.data || []) classify(l.url || "", `by their experience ${g.name}`, found);
      }
      for (const x of S.groups.filter((x) => x.role?.rank === 255).slice(0, 3)) {
        const r = await api(`https://groups.roblox.com/v1/groups/${x.group.id}/social-links`).catch(() => null);
        for (const l of r?.data || []) classify(l.url || "", `by their community ${x.group.name}`, found);
      }
    }
    discovered = true;
    discovering = false;
    if (!Object.keys(found).length) return;
    S.socials = found;
    paint("hero");
    // the feeds load once their card can be seen
    const sec = root?.querySelector('[data-sec="socials"]');
    const load = async () => {
      await Promise.all([
        found.youtube && on("socialsYoutube") ? ask({ type: "rcx-social", service: "youtube", url: found.youtube.url }).then((y) => (S.yt = y?.id ? y : false)) : null,
        found.twitch && on("socialsTwitch") ? ask({ type: "rcx-social", service: "twitch", login: found.twitch.login }).then((t) => (S.tw = t?.login ? t : false)) : null,
        found.x && on("socialsX") ? ask({ type: "rcx-social", service: "x", handle: found.x.handle }).then((x) => (S.x = x?.posts?.length ? x : false)) : null,
      ]);
      if (S.tw?.live && !socialPicked) socialTab = "twitch"; // live now beats the latest videos
      paint("socials", "hero");
    };
    paint("socials");
    if (!sec || sec.hidden) return; // only links without a feed (Discord): the header chips have them
    if (!("IntersectionObserver" in window)) return load();
    const io = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      io.disconnect();
      load();
    }, { rootMargin: "200px" });
    io.observe(sec);
  }

  /* ---- official Roblox items: inventory + bundles -> catalog details, cached per item ---- */
  const ITEM_TYPES = "Hat,HairAccessory,FaceAccessory,NeckAccessory,ShoulderAccessory,FrontAccessory,BackAccessory,WaistAccessory,Face,Gear,TShirtAccessory,ShirtAccessory,PantsAccessory,JacketAccessory,SweaterAccessory,ShortsAccessory,DressSkirtAccessory,LeftShoeAccessory,RightShoeAccessory,EmoteAnimation";
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
      if (!itemScanOn()) throw new Error("Item scan disabled");
      try {
        return await api(url, body);
      } catch (e) {
        if (e.message !== "429" || tries >= 5 || !rcAlive()) throw e;
        for (let s = 20; s > 0; s--) { if (!itemScanOn()) throw new Error("Item scan disabled"); onWait(s); await sleep(1000); }
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

  let itemScanRunning = false;
  async function loadItems() {
    if (!itemScanOn() || itemScanRunning) return;
    itemScanRunning = true;
    try {
      await whenVisible();
      if (!itemScanOn()) return;
      await loadItemsInner();
    } catch (e) {
      if (itemScanOn()) saveDiag("crashed", { error: String(e && (e.stack || e.message || e)).slice(0,400) });
    } finally { itemScanRunning = false; }
    paint("items", "hero");
  }

  async function loadItemsInner() {
    if (!rcAlive()) return;
    saveDiag("start");
    // the last result for this account shows at once, while the inventory loads
    const sumKey = "ois2:" + uid, key = "oic2";
    const last = (await chrome.storage.local.get(sumKey))[sumKey];
    if (last) { S.items = { ...last, scanned: 0, done: false, stale: true }; paint("items", "hero"); }
    const onWait = (s) => {
      if (S.items) S.items.wait = s;
      paint("items");
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
    paint("items");
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
      paint("items");
      if (i + 100 < todo.length) await sleep(1000);
    }
    S.items = { ...tally(), done: true, incomplete };
    const { list, ...rest } = S.items;
    chrome.storage.local.set({ [sumKey]: { ...rest, list, savedAt: Date.now() } }).catch(() => {});
    saveDiag("done", { owned: want.length, official: S.items.count, unknown: list.filter((x) => x.price == null).length, detErrors, fromCache: want.length - todo.length });
  }
  loaders.push(loadItems);

  chrome.storage.onChanged?.addListener((changes, area) => {
    if (area !== "sync") return;
    if (changes.profileItems) { prefs.profileItems = changes.profileItems.newValue !== false; paint("items", "hero"); if (itemScanOn()) loadItems(); }
    if (changes.profileNav) { prefs.profileNav = changes.profileNav.newValue !== false; updateProfileNav(); }
    if (changes.profileFilters) { prefs.profileFilters = changes.profileFilters.newValue !== false; paint("games", "groups", "avatar"); }
  });

  /* ---- start ---- */
  function start() {
    if (!build()) return false;
    if (sessionStorage.getItem("rc-classic") === "1") classic(true);
    for (const load of loaders) runLoader(load);
    return true;
  }

  chrome.storage.sync.get({ profile: true, users: true, socials: true, profileNav: true, profileFilters: true, profileItems: true }, async (s) => {
    if (!s.profile) return;
    prefs = s;
    cfg = (await ask({ type: "rcx-config" })) || {};
    if (cfg.profile === false) return;
    let tries = 0;
    const t = setInterval(() => {
      if (document.getElementById("rcp-root") || start() || ++tries > 80) clearInterval(t);
    }, 250);
  });
})();
