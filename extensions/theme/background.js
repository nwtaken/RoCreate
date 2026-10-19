/* Game stats from Creator Exchange (creatorexchange.io), for stats.js.

   Its API doesn't allow requests from roblox.com pages (no CORS), so the content
   script asks this worker, which has host permission for it. Everything is cached
   in chrome.storage.local so a page full of cards costs a handful of requests:
     1. the top games by CCU in a few pages of /v2/roblox/discover (one warm-up)
     2. a name search per game that wasn't in those pages
   Game pages also get /games/roblox/<id> (rank, momentum) and kpi_trends (week %). */

/* What this copy includes. config.json lists the features; the download page on
   rocreate.org writes it and leaves out the scripts and site permissions of anything
   unticked. A service is only contacted when a feature that needs it is on. */
const config = fetch(chrome.runtime.getURL("config.json"))
  .then((r) => r.json())
  .then((c) => c.features || {})
  .catch(() => ({}));

const API = "https://creatorexchange.io/api";
const TTL = 30 * 60 * 1000;         // stats are refreshed every 30 minutes
const MISS_TTL = 6 * 60 * 60 * 1000; // a game Creator Exchange doesn't track: ask again in 6 hours
const WARM_PAGES = 6;                // 6 x 48 = the top 288 games
const MAX_SEARCHES = 4;              // concurrent name searches

async function getJson(path) {
  const res = await fetch(API + path, { credentials: "omit" });
  if (!res.ok) throw new Error(`${res.status} ${path}`);
  const data = await res.json();
  if (!data.ok) throw new Error(`not ok: ${path}`);
  return data;
}

// Only what the page shows, so the cache stays small.
const slim = (g) => ({
  universeId: String(g.universeId),
  name: g.name,
  playing: g.playing ?? null,
  visits: g.visits ?? null,
  likeRatio: g.likeRatio ?? null,
  favorites: g.favoritedCount ?? null,
  revenue: g.revenue ?? null,
  revenueTrend: g.revenueIndicator ?? null,
  genre: g.genre_l1 || null,
  at: Date.now(),
});

// ---- cache (chrome.storage.local, one key per game) ----
const key = (id) => "cx:" + id;

async function cached(ids) {
  const got = await chrome.storage.local.get(ids.map(key));
  const out = {};
  for (const id of ids) {
    const v = got[key(id)];
    if (v && Date.now() - v.at < (v.missing ? MISS_TTL : TTL)) out[id] = v;
  }
  return out;
}

const store = (games) =>
  chrome.storage.local.set(Object.fromEntries(games.map((g) => [key(g.universeId), g])));

// ---- 1. warm-up: the top games ----
let warming = null;
function warm() {
  if (warming) return warming;
  warming = (async () => {
    const { "cx:warmAt": at = 0 } = await chrome.storage.local.get("cx:warmAt");
    if (Date.now() - at < TTL) return;
    let cursor;
    for (let page = 0; page < WARM_PAGES; page++) {
      const q = new URLSearchParams({ tab: "all", sortBy: "ccu", sortDir: "desc", limit: "48" });
      if (cursor) q.set("cursor", cursor);
      const data = await getJson("/v2/roblox/discover?" + q);
      await store(data.games.map(slim));
      cursor = data.cursor;
      if (!cursor) break;
    }
    await chrome.storage.local.set({ "cx:warmAt": Date.now() });
    // drop entries nobody has looked at for a day (hover history adds up)
    const all = await chrome.storage.local.get(null);
    const old = Object.keys(all).filter((k) => /^((cx[dh]?|rvu|rol):\d|(ytf|twf|xf):)/.test(k) && Date.now() - (all[k]?.at || 0) > 86400 * 1000);
    if (old.length) await chrome.storage.local.remove(old);
  })()
    .catch(() => {}) // offline or rate limited: warmed up on a later request
    .finally(() => (warming = null));
  return warming;
}

// ---- 2. one game by name ----
// Titles carry event tags ("[🎃] Adopt Me!", "Sell Fries! [Anomaly] 🍟") that the search
// may not match, so a second try drops anything in brackets and the emoji.
const plainName = (name) =>
  name.replace(/[[(【][^\])】]*[\])】]/g, " ").replace(/[^\p{L}\p{N}' &!?:.-]/gu, " ").replace(/\s+/g, " ").trim();

async function search(id, name) {
  const tries = [...new Set([name, plainName(name)].filter((n) => n && n.length > 1))];
  for (const q of tries) {
    const data = await getJson("/v2/roblox/discover?" + new URLSearchParams({ tab: "all", q, limit: "48" }));
    const hit = data.games.find((g) => String(g.universeId) === id);
    if (hit) return slim(hit);
  }
  return { universeId: id, missing: true, at: Date.now() };
}

// Small pool, so a page of 100 cards never fires 100 requests at once.
let active = 0;
const waiting = [];
const inFlight = new Map(); // id -> promise, so two tabs share one search

function lookup(id, name) {
  if (inFlight.has(id)) return inFlight.get(id);
  const p = new Promise((resolve) => waiting.push({ id, name, resolve }));
  inFlight.set(id, p);
  pump();
  return p;
}

function pump() {
  while (active < MAX_SEARCHES && waiting.length) {
    const { id, name, resolve } = waiting.shift();
    active++;
    search(id, name)
      .then(async (g) => (await store([g]), g))
      .catch(() => null) // network / rate limit: not cached, tried again next time
      .then((g) => {
        active--;
        inFlight.delete(id);
        resolve(g);
        pump();
      });
  }
}

// search: false answers from the cache and the top-games warm-up only (fast);
// the page then asks again with search: true for whatever was left.
async function statsFor(games, search) {
  const ids = games.map((g) => g.id);
  let have = await cached(ids);
  if (Object.keys(have).length < ids.length) {
    await warm();
    have = await cached(ids);
  }
  if (!search) return have;
  const missing = games.filter((g) => !have[g.id] && g.name);
  const found = await Promise.all(missing.map((g) => lookup(g.id, g.name)));
  for (const g of found) if (g) have[g.universeId] = g;
  return have;
}

// ---- game page extras ----
async function details(id) {
  const k = "cxd:" + id;
  const { [k]: hit } = await chrome.storage.local.get(k);
  if (hit && Date.now() - hit.at < TTL) return hit;
  const [info, kpi] = await Promise.allSettled([
    getJson("/games/roblox/" + id),
    getJson("/v2/metrics/latest/kpi_trends?universeIds=" + id),
  ]);
  const g = info.status === "fulfilled" ? info.value.game : {};
  const k0 = kpi.status === "fulfilled" ? (kpi.value.kpiData || [])[0] || {} : {};
  const week = (m) => k0[m]?.week?.percent_change ?? null;
  const out = {
    rank: g.globalRank ?? null,
    momentum: g.momentum ?? null,
    creator: g.creator ?? null,
    playersWeek: week("playing"),
    visitsWeek: week("visits"),
    session: k0.session_length?.current?.value ?? null,
    at: Date.now(),
  };
  await chrome.storage.local.set({ [k]: out });
  return out;
}

// ---- player count over the last 7 days, hourly (the hover sparkline) ----
async function history(id) {
  const k = "cxh:" + id;
  const { [k]: hit } = await chrome.storage.local.get(k);
  if (hit && Date.now() - hit.at < 60 * 60 * 1000) return hit;
  const end = new Date(), start = new Date(end - 7 * 86400 * 1000);
  const q = new URLSearchParams({ universeIds: id, granularity: "HOUR", start: start.toISOString(), end: end.toISOString() });
  const data = await getJson("/v2/metrics/historical/ccu?" + q);
  const out = {
    points: (data.kpiData || []).map((p) => [Date.parse(p.timestamp), p.playing ?? 0]),
    at: Date.now(),
  };
  await chrome.storage.local.set({ [k]: out });
  return out;
}

/* ---- user badges (users.js) ----
   Flagged and previously-verified accounts come from robloxverifieds.com. Its API needs
   a key, so this reads the same public lists its website shows (the page embeds them as
   data), a handful of page loads every 6 hours. Roblox admins are the accounts holding
   Roblox's own Administrator badge (id 1); its image URL is passed on for the icon. */
const RV = "https://robloxverifieds.com";
const RV_TTL = 6 * 60 * 60 * 1000;
const ADMIN_TTL = 7 * 86400 * 1000;

const unq = (s) => s.replace(/\\(.)/g, "$1");

// one listing page -> its user records; `more` is whether a next page exists
async function rvPage(path, page) {
  const res = await fetch(`${RV}/${path}?page=${page}`, { credentials: "omit" });
  if (!res.ok) throw new Error(`${res.status} ${path}`);
  const html = await res.text();
  const users = [];
  for (const chunk of html.split(/\{User:\{|(?=\{UserId:\d+,Username:)/).slice(1)) {
    const id = chunk.match(/^\{?UserId:(\d+)/)?.[1];
    if (!id) continue;
    const reasons = [...chunk.matchAll(/Reason:"((?:[^"\\]|\\.)*)",Note:(null|"((?:[^"\\]|\\.)*)")/g)].map((m) => ({
      reason: unq(m[1]),
      note: m[3] ? unq(m[3]) : null,
    }));
    users.push({
      id,
      verified: /IsVerified:true/.test(chunk.slice(0, 400)),
      banned: /IsBanned:true/.test(chunk.slice(0, 400)),
      optedOut: /OptedOut:true/.test(chunk.slice(0, 400)),
      reasons,
    });
  }
  return { users, more: html.includes(`?page=${page + 1}`) };
}

async function rvList(path, maxPages) {
  const out = [];
  for (let page = 1; page <= maxPages; page++) {
    const { users, more } = await rvPage(path, page);
    out.push(...users);
    if (!more) break;
  }
  return out;
}

let rvLoading = null;
function rvData() {
  if (rvLoading) return rvLoading;
  rvLoading = (async () => {
    const { "rv:data": hit } = await chrome.storage.local.get("rv:data");
    if (hit && Date.now() - hit.at < RV_TTL) return hit;
    const [flagged, ex] = await Promise.all([rvList("flagged", 10), rvList("recently-unverified", 30)]);
    const data = { flagged: {}, ex: {}, at: Date.now() };
    for (const u of flagged) if (!u.optedOut && u.reasons.length) data.flagged[u.id] = { reasons: u.reasons, banned: u.banned };
    for (const u of ex) if (!u.optedOut && !u.verified) data.ex[u.id] = 1;
    await chrome.storage.local.set({ "rv:data": data });
    return data;
  })()
    .catch(async () => {
      // unreachable or blocked: use the lists from last time
      return (await chrome.storage.local.get("rv:data"))["rv:data"] || { flagged: {}, ex: {} };
    })
    .finally(() => (rvLoading = null));
  return rvLoading;
}

async function admins(ids) {
  const keys = ids.map((id) => "adm:" + id);
  const got = await chrome.storage.local.get(keys);
  const out = {}, todo = [];
  for (const id of ids) {
    const v = got["adm:" + id];
    if (v && v.admin !== true && Date.now() - v.at < ADMIN_TTL) out[id] = v.admin; // `true` = 0.7.0 entry without the image
    else todo.push(id);
  }
  for (let i = 0; i < todo.length; i += 6) {
    await Promise.all(todo.slice(i, i + 6).map(async (id) => {
      try {
        const res = await fetch(`https://accountinformation.roblox.com/v1/users/${id}/roblox-badges`, { credentials: "omit" });
        if (!res.ok) return;
        // keep the badge's own image, so the page shows Roblox's real Administrator icon
        const admin = (await res.json()).find((b) => b.id === 1)?.imageUrl || false;
        out[id] = admin;
        await chrome.storage.local.set({ ["adm:" + id]: { admin, at: Date.now() } });
      } catch {}
    }));
  }
  return out;
}

async function usersInfo(ids, withFlags, withAdmins) {
  const [rv, adm] = await Promise.all([withFlags ? rvData() : { flagged: {}, ex: {} }, withAdmins ? admins(ids) : {}]);
  const out = {};
  for (const id of ids) {
    const u = {};
    if (rv.flagged[id]) u.flag = rv.flagged[id];
    if (rv.ex[id]) u.ex = true;
    if (adm[id]) u.admin = adm[id]; // the badge's image URL
    if (Object.keys(u).length) out[id] = u;
  }
  return out;
}

/* ---- one account's robloxverifieds.com page (profile.js) ----
   The page embeds its data as a JavaScript object literal (SvelteKit). It is cut out with
   a small scanner that respects strings, its bare keys are quoted, and the result is read
   as JSON. Only accounts the site tracks (verified now or before) have data. */
function jsObjectToJson(src, start) {
  let out = "", depth = 0, i = start, inStr = false;
  for (; i < src.length; i++) {
    const c = src[i];
    if (inStr) {
      out += c;
      if (c === "\\") out += src[++i];
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; out += c; continue; }
    if (c === "{" || c === "[") depth++;
    if (c === "}" || c === "]") depth--;
    // a bare key right after { or , : quote it
    if ((c === "{" || c === ",") && /^[A-Za-z_$][\w$]*:/.test(src.slice(i + 1, i + 80))) {
      const key = src.slice(i + 1).match(/^[A-Za-z_$][\w$]*/)[0];
      out += c + JSON.stringify(key);
      i += key.length;
      continue;
    }
    out += c;
    if (depth === 0) break;
  }
  return out.replace(/\bvoid 0\b/g, "null");
}

async function rvUser(id) {
  const k = "rvu:" + id;
  const { [k]: hit } = await chrome.storage.local.get(k);
  if (hit && Date.now() - hit.at < RV_TTL) return hit.data;
  const res = await fetch(`${RV}/user/${id}`, { credentials: "omit" });
  if (!res.ok) throw new Error(res.status);
  const html = await res.text();
  const at = html.indexOf("data:{User:");
  let data = null;
  if (at >= 0) {
    const raw = JSON.parse(jsObjectToJson(html, at + 5));
    if (raw.User && !raw.User.OptedOut) {
      const st = raw.Stats?.Stats || {};
      data = {
        verified: !!raw.User.IsVerified,
        banned: !!raw.User.IsBanned,
        history: (raw.History || []).map((h) => ({ verified: !!h.IsVerified, at: h.ObservedAt })),
        flags: (raw.Flags || []).map((f) => ({ reason: f.Reason, note: f.Note, at: f.CreatedAt })),
        inherited: raw.InheritedFlag || null,
        linked: (raw.LinkedAccounts || []).map((l) => ({ id: String(l.UserId ?? l.LinkedUserId ?? l.Id ?? ""), name: l.Username || l.Name || "" })).filter((l) => l.id),
        reason: st.Reason?.Primary
          ? { label: st.Reason.Primary.Label, score: st.Reason.Primary.Score, summary: st.Reason.Primary.Summary, evidence: st.Reason.Primary.Evidence || [], confidence: st.Reason.Confidence || null }
          : null,
      };
    }
  }
  await chrome.storage.local.set({ [k]: { data, at: Date.now() } });
  return data;
}

/* ---- Rolimons (profile.js): inventory value, RAP, rank, and their value history ----
   The summary comes from Rolimons' public API; the history chart is the data their player
   page embeds (chart_data). Both are cached for 6 hours. */
async function rolimons(id) {
  const k = "rol:" + id;
  const { [k]: hit } = await chrome.storage.local.get(k);
  if (hit && Date.now() - hit.at < RV_TTL) return hit.data;
  const [info, page] = await Promise.allSettled([
    fetch(`https://api.rolimons.com/players/v1/playerinfo/${id}`, { credentials: "omit" }).then((r) => (r.ok ? r.json() : null)),
    fetch(`https://www.rolimons.com/player/${id}`, { credentials: "omit" }).then((r) => (r.ok ? r.text() : "")),
  ]);
  const p = info.status === "fulfilled" && info.value?.success ? info.value : null;
  let chart = null;
  const html = page.status === "fulfilled" ? page.value : "";
  const m = html.match(/var chart_data\s*=\s*(\{[\s\S]*?\});/);
  if (m) {
    try {
      const c = JSON.parse(m[1]);
      chart = (c.nominal_scan_time || []).map((t, i) => [t * 1000, c.value?.[i] ?? null, c.rap?.[i] ?? null]);
    } catch {}
  }
  // the API sits behind a Cloudflare check on some networks; the player page has the same numbers
  let pd = null;
  const d = html.match(/var player_details_data\s*=\s*(\{[\s\S]*?\});/);
  if (d) try { pd = JSON.parse(d[1]); } catch {}
  const latest = chart?.[chart.length - 1];
  const data = p || chart ? {
    value: p?.value ?? latest?.[1] ?? null, rap: p?.rap ?? latest?.[2] ?? null, rank: p?.rank ?? pd?.rank ?? null,
    privacy: !!p?.privacy_enabled, terminated: !!p?.terminated,
    lastOnline: p?.last_online ? p.last_online * 1000 : pd?.last_roblox_activity_ts ? pd.last_roblox_activity_ts * 1000 : null, lastLocation: p?.last_location || null,
    chart,
  } : null;
  await chrome.storage.local.set({ [k]: { data, at: Date.now() } });
  return data;
}

/* ---- social feeds for profiles (profile.js) ----
   YouTube: the channel link is resolved to its channel ID with YouTube's own URL resolver
   (kept for good), then its public RSS feed gives the latest uploads. Twitch: the public
   web API twitch.tv itself uses (live status, past broadcasts, clips); its images are
   handed over as data URLs, because roblox.com's page policy only allows YouTube's image
   host; the same goes for X, below. Every request goes
   out without cookies, and any of these can change without notice, so each one fails
   quietly and the profile just leaves that feed out. */
const SOCIAL_TTL = 60 * 60 * 1000, LIVE_TTL = 5 * 60 * 1000;

async function remember(k, ttl, make) {
  const { [k]: hit } = await chrome.storage.local.get(k);
  if (hit && Date.now() - hit.at < ttl) return hit.data;
  const data = await make();
  if (data) {
    await chrome.storage.local.set({ [k]: { data, at: Date.now() } });
    prune(k.slice(0, k.indexOf(":") + 1), ttl).catch(() => {});
  }
  return data;
}

// expired feed entries go as soon as there are a few of them, not once a day
async function prune(prefix, ttl) {
  const keys = (await chrome.storage.local.getKeys?.()) ?? Object.keys(await chrome.storage.local.get(null));
  const mine = keys.filter((k) => k.startsWith(prefix));
  if (mine.length < 15) return;
  const got = await chrome.storage.local.get(mine);
  const old = mine.filter((k) => Date.now() - (got[k]?.at || 0) > ttl);
  if (old.length) await chrome.storage.local.remove(old);
}

// Pictures are stored as their URLs and only turned into data URLs when a profile asks,
// through a small in-memory cache, so they never pile up in storage.
const pictures = new Map();
async function inline(url) {
  if (!url) return null;
  if (pictures.has(url)) return pictures.get(url);
  const d = await dataUrl(url);
  pictures.set(url, d);
  if (pictures.size > 80) pictures.delete(pictures.keys().next().value);
  return d;
}

async function dataUrl(url) {
  try {
    const r = await fetch(url, { credentials: "omit" });
    if (!r.ok) return null;
    const blob = await r.blob();
    if (!/^image\/(png|jpe?g|webp|gif)$/.test(blob.type) || blob.size > 250000) return null;
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return `data:${blob.type};base64,${btoa(bin)}`;
  } catch {
    return null;
  }
}

const unXml = (s) => String(s || "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");

async function youtube(link) {
  let u;
  try { u = new URL(link); } catch { return null; }
  if (!/^((www|m)\.)?youtube\.com$/i.test(u.hostname)) return null;
  const path = decodeURIComponent(u.pathname).replace(/\/+$/, "");
  if (!/^\/(channel\/UC[\w-]{22}|@[^/\s]{1,100}|c\/[^/\s]{1,100}|user\/[^/\s]{1,100})$/.test(path)) return null;
  const idKey = "ytid:" + path.toLowerCase();
  let id = path.match(/^\/channel\/(UC[\w-]{22})$/)?.[1] || (await chrome.storage.local.get(idKey))[idKey];
  if (!id) {
    const r = await fetch("https://www.youtube.com/youtubei/v1/navigation/resolve_url", {
      method: "POST",
      credentials: "omit",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ context: { client: { clientName: "WEB", clientVersion: "2.20251001.00.00", hl: "en" } }, url: "https://www.youtube.com" + path }),
    });
    if (!r.ok) return null;
    id = (await r.text()).match(/"browseId"\s*:\s*"(UC[\w-]{22})"/)?.[1];
    if (!id) return null;
    await chrome.storage.local.set({ [idKey]: id });
  }
  return remember("ytf:" + id, SOCIAL_TTL, async () => (await ytRss(id)) || (await ytBrowse(id)) || { id, channel: "", videos: [] });
}

// YouTube's own API refuses requests whose origin is an extension (403), and fetch can't
// change that header, so this rule sets it for RoCreate's own requests (tabIds -1 means
// requests that don't come from any tab) to youtube.com's API, and nothing else.
chrome.declarativeNetRequest?.updateSessionRules({
  removeRuleIds: [1],
  addRules: [{
    id: 1,
    priority: 1,
    condition: { urlFilter: "||www.youtube.com/youtubei/", resourceTypes: ["xmlhttprequest"], tabIds: [-1] },
    action: { type: "modifyHeaders", requestHeaders: [{ header: "origin", operation: "set", value: "https://www.youtube.com" }] },
  }],
}).catch(() => {});

async function ytRss(id) {
  const r = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${id}`, { credentials: "omit" }).catch(() => null);
  if (!r?.ok) return null; // YouTube's feeds answer 404 for hours at a time
  const xml = await r.text();
  const videos = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].slice(0, 12).map(([, e]) => ({
    id: e.match(/<yt:videoId>([\w-]{11})<\/yt:videoId>/)?.[1],
    title: unXml(e.match(/<title>([^<]*)<\/title>/)?.[1]),
    at: Date.parse(e.match(/<published>([^<]*)<\/published>/)?.[1] || "") || null,
    views: Number(e.match(/<media:statistics views="(\d+)"/)?.[1]) || 0,
    short: /youtube\.com\/shorts\//.test(e.match(/<link rel="alternate" href="([^"]*)"/)?.[1] || ""),
  })).filter((v) => v.id);
  return videos.length ? { id, channel: unXml(xml.match(/<title>([^<]*)<\/title>/)?.[1]), videos } : null;
}

// the Videos tab as youtube.com loads it; both the newer "lockup" and the older layout
async function ytBrowse(id) {
  const r = await fetch("https://www.youtube.com/youtubei/v1/browse", {
    method: "POST",
    credentials: "omit",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ context: { client: { clientName: "WEB", clientVersion: "2.20251001.00.00", hl: "en" } }, browseId: id, params: "EgZ2aWRlb3PyBgQKAjoA" }),
  }).catch(() => null);
  if (!r?.ok) return null;
  const data = await r.json().catch(() => null);
  if (!data) return null;
  const videos = [];
  const walk = (o, depth) => {
    if (!o || typeof o !== "object" || depth > 40 || videos.length >= 12) return;
    const l = o.lockupViewModel;
    if (l && l.contentType === "LOCKUP_CONTENT_TYPE_VIDEO" && /^[\w-]{11}$/.test(l.contentId || "")) {
      const md = l.metadata?.lockupMetadataViewModel;
      const parts = (md?.metadata?.contentMetadataViewModel?.metadataRows || []).flatMap((row) => (row.metadataParts || []).map((x) => x.text?.content || ""));
      const badge = JSON.stringify(l.contentImage?.thumbnailViewModel?.overlays || []).match(/"thumbnailBadgeViewModel":\{"text":"([\d:]{3,9})"/)?.[1];
      videos.push({ id: l.contentId, title: md?.title?.content || "", viewsText: parts.find((x) => /view/i.test(x)) || "", agoText: parts.find((x) => /ago/i.test(x)) || "", length: badge || "" });
      return;
    }
    const v = o.videoRenderer;
    if (v && /^[\w-]{11}$/.test(v.videoId || "")) {
      videos.push({ id: v.videoId, title: (v.title?.runs || []).map((x) => x.text).join(""), viewsText: v.viewCountText?.simpleText || "", agoText: v.publishedTimeText?.simpleText || "", length: v.lengthText?.simpleText || "" });
      return;
    }
    for (const k in o) walk(o[k], depth + 1);
  };
  walk(data, 0);
  return videos.length ? { id, channel: data.metadata?.channelMetadataRenderer?.title || "", videos } : null;
}

const TWITCH_QUERY = `query RoCreateProfile($login: String!) {
  user(login: $login) {
    login displayName profileImageURL(width: 70)
    stream { title viewersCount createdAt game { displayName } previewImageURL(width: 440, height: 248) }
    videos(first: 4, sort: TIME) { edges { node { id title publishedAt lengthSeconds viewCount previewThumbnailURL(width: 320, height: 180) } } }
    clips(first: 4, criteria: { period: LAST_MONTH }) { edges { node { slug title viewCount createdAt thumbnailURL(width: 480, height: 272) } } }
  }
}`;
const twitchUrl = (x) => (typeof x === "string" && /^https:\/\/static-cdn\.jtvnw\.net\//.test(x) ? x : null);

async function twitch(login) {
  if (!/^[a-z0-9_]{3,25}$/.test(login)) return null;
  const d = await remember("twf:" + login, LIVE_TTL, async () => {
    const r = await fetch("https://gql.twitch.tv/gql", {
      method: "POST",
      credentials: "omit",
      headers: { "Client-Id": "kimne78kx3ncx6brgo4mv6wki5h1ko", "content-type": "application/json" },
      body: JSON.stringify({ query: TWITCH_QUERY, variables: { login } }),
    });
    if (!r.ok) return null;
    const u = (await r.json())?.data?.user;
    if (!u) return { missing: true };
    const vids = (u.videos?.edges || []).map((e) => e.node).filter((v) => /^\d{1,15}$/.test(v?.id));
    const clips = (u.clips?.edges || []).map((e) => e.node).filter((c) => /^[\w-]{1,120}$/.test(c?.slug || ""));
    return {
      login: u.login, name: u.displayName, avatar: twitchUrl(u.profileImageURL),
      live: u.stream ? { title: u.stream.title || "", viewers: u.stream.viewersCount || 0, since: Date.parse(u.stream.createdAt) || null, game: u.stream.game?.displayName || "", img: twitchUrl(u.stream.previewImageURL) } : null,
      videos: vids.map((v) => ({ id: v.id, title: v.title || "", at: Date.parse(v.publishedAt) || null, length: v.lengthSeconds || 0, views: v.viewCount || 0, img: twitchUrl(v.previewThumbnailURL) })),
      // clip thumbnails come at 1920x1080 whatever the query asks; the CDN serves a small one too
      clips: clips.map((c) => ({ slug: c.slug, title: c.title || "", at: Date.parse(c.createdAt) || null, views: c.viewCount || 0, img: twitchUrl(c.thumbnailURL)?.replace(/-\d+x\d+\.jpg$/, "-480x272.jpg") || null })),
    };
  });
  if (!d || d.missing) return d;
  const pics = await Promise.all([d.avatar, d.live?.img, ...d.videos.map((v) => v.img), ...d.clips.map((c) => c.img)].map(inline));
  return {
    ...d,
    avatar: pics[0],
    live: d.live ? { ...d.live, img: pics[1] } : null,
    videos: d.videos.map((v, i) => ({ ...v, img: pics[2 + i] })),
    clips: d.clips.map((c, i) => ({ ...c, img: pics[2 + d.videos.length + i] })),
  };
}

// X: the public feed X's own embedded timeline loads, fetched once an hour per account.
// X refuses most requests from many connections; one refusal pauses every X request for
// an hour, so RoCreate doesn't keep asking, and the profile just leaves X's tab out.
const X_PAUSE = 60 * 60 * 1000;
async function xPosts(handle) {
  if (!/^[A-Za-z0-9_]{1,15}$/.test(handle)) return null;
  const k = handle.toLowerCase();
  const { "xl": paused } = await chrome.storage.local.get("xl");
  if (paused && Date.now() - paused < X_PAUSE) return { handle, limited: true };
  return (await remember("xf:" + k, SOCIAL_TTL, async () => {
    const r = await fetch(`https://syndication.twitter.com/srv/timeline-profile/screen-name/${handle}`, { credentials: "omit" }).catch(() => null);
    if (!r) return null;
    if (r.status === 429) {
      await chrome.storage.local.set({ "xl": Date.now() });
      return null;
    }
    if (!r.ok) return null;
    const m = (await r.text()).match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
    if (!m) return null;
    let tweets = [];
    try {
      tweets = (JSON.parse(m[1])?.props?.pageProps?.timeline?.entries || []).map((e) => e?.content?.tweet).filter((t) => t?.id_str);
    } catch {}
    if (!tweets.length) return { handle, empty: true, posts: [] };
    const own = tweets.find((t) => t.user?.screen_name?.toLowerCase() === k)?.user || tweets[0].user || {};
    const posts = tweets.slice(0, 6).map((t) => {
      const media = (t.extended_entities?.media || t.entities?.media || [])[0];
      const sensitive = !!t.possibly_sensitive;
      return {
        id: String(t.id_str),
        text: String(t.full_text || t.text || "").replace(/\s*https:\/\/t\.co\/\w+\s*$/, ""),
        at: Date.parse(t.created_at) || null,
        likes: t.favorite_count || 0,
        replies: t.reply_count || 0,
        reposts: t.retweet_count || 0,
        by: t.user?.screen_name || handle,
        byName: t.user?.name || "",
        video: media?.type === "video" || media?.type === "animated_gif",
        // media X marks as possibly sensitive is left out (it stays on X)
        sensitive: sensitive && !!media,
        img: !sensitive && typeof media?.media_url_https === "string" && /^https:\/\/pbs\.twimg\.com\/[^?#]+$/.test(media.media_url_https) ? media.media_url_https + "?name=small" : null,
      };
    });
    const avatar = typeof own.profile_image_url_https === "string" && /^https:\/\/pbs\.twimg\.com\//.test(own.profile_image_url_https) ? own.profile_image_url_https : null;
    return { handle: own.screen_name || handle, name: own.name || handle, avatar, posts };
  })) || { handle, limited: true };
}

// what a profile gets: the stored posts with their pictures inlined (the avatar and up to 4)
async function xFeed(handle) {
  const d = await xPosts(handle);
  if (!d?.posts) return d;
  const pics = await Promise.all([d.avatar, ...d.posts.slice(0, 4).map((p) => p.img)].map(inline));
  return { ...d, avatar: pics[0], posts: d.posts.map((p, i) => ({ ...p, img: i < 4 ? pics[i + 1] : null })) };
}

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  const id = String(msg?.id);
  const okId = /^\d{1,15}$/.test(id);
  const job = (async () => {
    const f = await config;
    const on = (name) => f[name] !== false;
    const profile = (part) => on("profile") && on(part);
    switch (msg?.type) {
      case "rcx-config":
        return f;
      case "rcx-rolimons":
        return okId && profile("profileValue") ? rolimons(id) : null;
      case "rcx-rvuser":
        return okId && profile("profileVerify") ? rvUser(id) : null;
      case "rcx-users": {
        if (!Array.isArray(msg.ids)) return {};
        const ids = [...new Set(msg.ids.map(String).filter((x) => /^\d{1,15}$/.test(x)))].slice(0, 200);
        return usersInfo(ids, on("flags"), on("admins"));
      }
      case "rcx-history":
        return okId && on("stats") ? history(id) : null;
      case "rcx-details":
        return okId && on("stats") ? details(id) : null;
      case "rcx-social": {
        if (!on("profile") || !on("socials")) return null;
        if (msg.service === "youtube" && on("socialsYoutube")) return youtube(String(msg.url || ""));
        if (msg.service === "twitch" && on("socialsTwitch")) return twitch(String(msg.login || "").toLowerCase());
        if (msg.service === "x" && on("socialsX")) return xFeed(String(msg.handle || ""));
        return null;
      }
      case "rcx-stats": {
        // game cards and the watchlist, or the revenue tile on profiles
        if (!Array.isArray(msg.games) || !(on("stats") || profile("profileRevenue"))) return {};
        const games = msg.games
          .filter((g) => /^\d{1,15}$/.test(String(g.id)))
          .slice(0, 200)
          .map((g) => ({ id: String(g.id), name: String(g.name || "").slice(0, 120) }));
        return statsFor(games, !!msg.search);
      }
    }
    return null;
  })();
  job.then(reply, () => reply(msg?.type === "rcx-users" || msg?.type === "rcx-stats" ? {} : null));
  return true; // async reply
});

/* ---- auto-update for the unpacked copy ----
   Chrome only re-reads an unpacked extension's files when you press reload. The folder on
   disk is updated in place, so check its manifest once a minute and reload when the
   version changed (a no-op for a packed install, where the two always match). */
async function checkForUpdate() {
  try {
    const res = await fetch(chrome.runtime.getURL("manifest.json"), { cache: "no-store" });
    const onDisk = (await res.json()).version;
    if (onDisk && onDisk !== chrome.runtime.getManifest().version) {
      console.log(`RoCreate: ${chrome.runtime.getManifest().version} -> ${onDisk}, reloading`);
      chrome.runtime.reload();
    }
  } catch {}
}
// 0.8.12 rescans Roblox items with offsale prices and bundles: drop the old item caches once
chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  // a NEW badge on the toolbar icon until the popup (and its What's new card) is opened
  if (reason === "update") {
    chrome.action.setBadgeBackgroundColor({ color: "#0a84ff" });
    chrome.action.setBadgeText({ text: "NEW" });
  }
  const all = await chrome.storage.local.get(null);
  const old = Object.keys(all).filter((k) => k === "oic" || k === "oic:retryAfter" || k.startsWith("ois:"));
  if (old.length) await chrome.storage.local.remove(old);
});
/* ---- spike alerts: a notification when a watched game's players jump ----
   Off until switched on in the popup (sync setting `alerts`). Every 15 minutes the
   watchlist's player counts (Creator Exchange, cached) are compared with the last check. */
const SPIKE_RATIO = 1.5, SPIKE_MIN = 100;
const short = (n) => {
  for (const [v, x] of [[1e9, "B"], [1e6, "M"], [1e3, "K"]]) if (n >= v) return +(n / v).toFixed(1) + x;
  return String(Math.round(n));
};
async function checkWatchlist() {
  const f = await config;
  if (f.stats === false || f.alerts === false) return;
  const { alerts, stats, watch } = await chrome.storage.sync.get({ alerts: false, stats: true, watch: [] });
  if (!alerts || !stats || !watch.length) return; // alerts follow the Game stats switch too
  const st = await statsFor(watch.map((g) => ({ id: String(g.id), name: String(g.name || "") })), true);
  const { "rc:alertSnap": before = {} } = await chrome.storage.local.get("rc:alertSnap");
  const now = {};
  for (const g of watch) {
    const playing = st[g.id]?.playing;
    if (playing == null) continue;
    now[g.id] = playing;
    const was = before[g.id];
    if (was != null && playing >= was * SPIKE_RATIO && playing - was >= SPIKE_MIN) {
      chrome.notifications.create(`rc-spike:${g.id}:${Date.now()}`, {
        type: "basic",
        iconUrl: "icons/icon-128.png",
        title: `${st[g.id].name || g.name} is spiking`,
        message: `${short(playing)} playing, up ${Math.round((playing / was - 1) * 100)}% since the last check.`,
        priority: 1,
      });
    }
  }
  await chrome.storage.local.set({ "rc:alertSnap": now });
}
chrome.notifications?.onClicked.addListener(async (nid) => {
  const id = nid.startsWith("rc-spike:") && nid.split(":")[1];
  if (!id) return;
  const { watch } = await chrome.storage.sync.get({ watch: [] });
  const g = watch.find((w) => String(w.id) === id);
  chrome.tabs.create({ url: g?.place ? `https://www.roblox.com/games/${g.place}` : `https://creatorexchange.io/roblox-game/${id}` });
  chrome.notifications.clear(nid);
});
/* ---- sales alerts: a notification when your pending Robux or a group's funds go up ----
   Off until switched on in the popup (sync setting `sales`). Every 15 minutes, for the
   signed-in account: the pending Robux, and the funds of the groups that had Robux at the
   last Robux-menu load (robux.js keeps those in rbx:<userId>), one request at a time. */
const robloxJson = (url) => fetch(url, { credentials: "include" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
async function checkSales() {
  const f = await config;
  if (f.robux === false || f.sales === false) return;
  const { sales, robux } = await chrome.storage.sync.get({ sales: false, robux: true });
  if (!sales || !robux) return;
  const me = await robloxJson("https://users.roblox.com/v1/users/authenticated");
  if (!me?.id) return;
  const menu = (await chrome.storage.local.get("rbx:" + me.id))["rbx:" + me.id];
  const groups = (menu?.rows || [])
    .map((r) => ({ id: r.href?.match(/[?&]id=(\d+)/)?.[1], name: r.label }))
    .filter((g) => g.id)
    .slice(0, 10);
  const now = {};
  const totals = await robloxJson(`https://economy.roblox.com/v2/users/${me.id}/transaction-totals?timeFrame=Year&transactionType=summary`);
  if (totals) now.pending = totals.pendingRobuxTotal ?? 0;
  for (const g of groups) {
    const c = await robloxJson(`https://economy.roblox.com/v1/groups/${g.id}/currency`);
    if (c) now["g" + g.id] = c.robux ?? 0;
    await new Promise((r) => setTimeout(r, 400));
  }
  const key = "rc:salesSnap:" + me.id;
  const before = (await chrome.storage.local.get(key))[key];
  if (before) {
    const lines = [];
    const gain = (k) => (now[k] != null && before[k] != null && now[k] > before[k] ? now[k] - before[k] : 0);
    if (gain("pending")) lines.push(`Pending +R$ ${gain("pending").toLocaleString()}`);
    for (const g of groups) if (gain("g" + g.id)) lines.push(`${g.name} +R$ ${gain("g" + g.id).toLocaleString()}`);
    if (lines.length) {
      chrome.notifications.create(`rc-sales:${Date.now()}`, {
        type: "basic", iconUrl: "icons/icon-128.png", title: "You made sales", message: lines.slice(0, 4).join("\n"), priority: 1,
      });
    }
  }
  await chrome.storage.local.set({ [key]: { ...before, ...now } }); // a failed request keeps its last value
}
chrome.notifications?.onClicked.addListener((nid) => {
  if (!nid.startsWith("rc-sales:")) return;
  chrome.tabs.create({ url: "https://www.roblox.com/transactions" });
  chrome.notifications.clear(nid);
});
chrome.alarms.onAlarm.addListener((a) => a.name === "rc-watch-check" && checkSales().catch(() => {}));
chrome.storage.onChanged.addListener(async (c, area) => {
  if (area !== "sync" || !c.sales?.newValue) return;
  // switching on starts from a fresh baseline
  const all = await chrome.storage.local.get(null);
  await chrome.storage.local.remove(Object.keys(all).filter((k) => k.startsWith("rc:salesSnap:")));
  checkSales().catch(() => {});
});

chrome.alarms.create("rc-watch-check", { periodInMinutes: 15 });
chrome.alarms.onAlarm.addListener((a) => a.name === "rc-watch-check" && checkWatchlist().catch(() => {}));
// turning alerts on starts from a fresh baseline instead of comparing with an old one
chrome.storage.onChanged.addListener((c, area) => {
  if (area === "sync" && c.alerts?.newValue) chrome.storage.local.remove("rc:alertSnap").then(() => checkWatchlist().catch(() => {}));
});

chrome.alarms.create("rc-update-check", { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener((a) => a.name === "rc-update-check" && checkForUpdate());
checkForUpdate();
