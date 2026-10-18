/* RoCreate content script.
   Runs at document_start. Toggles classes on <html> that theme.css keys off,
   so enabling/disabling never needs a page reload. Settings live in
   chrome.storage.sync: { enabled: bool, declutter: bool, accent: name }. */

const DEFAULTS = { enabled: true, declutter: true, accent: "blue" };
// accent colours (normal, hover) for buttons and highlights; popup.js lists the same names
const ACCENTS = {
  blue: ["#0a84ff", "#2f9bff"], teal: ["#0fb5a3", "#2cc9b8"], purple: ["#8b5cf6", "#a07bff"],
  pink: ["#e84393", "#f062a8"], orange: ["#f2771a", "#ff8f3d"], green: ["#22a95a", "#33c26e"],
};

// When the extension updates itself, tabs that were already open keep running the old
// scripts, but every chrome.* call in them throws. The other scripts check rcAlive() and
// go quiet instead; a page refresh loads the new version.
globalThis.rcAlive = () => {
  try {
    return !!chrome.runtime?.id;
  } catch {
    return false;
  }
};

/* One MutationObserver for all of RoCreate's scripts. Each registers a callback with
   rcWatch(fn); a burst of page changes reaches all of them together, at most every 100 ms,
   instead of every script's own observer reacting to every change. Callbacks registered
   with { text: true } also hear about text-only changes; the rest skip those. */
const rcWatchers = [];
let rcRecords = [], rcTimer = 0, rcObserver = null;
function rcFlush() {
  rcTimer = 0;
  const records = rcRecords;
  rcRecords = [];
  if (!rcAlive()) return rcObserver?.disconnect();
  const textOnly = records.every((r) => r.type === "characterData");
  for (const w of rcWatchers) {
    if (textOnly && !w.text) continue;
    try {
      w.fn(records);
    } catch {}
  }
}
globalThis.rcWatch = (fn, opts = {}) => {
  rcWatchers.push({ fn, text: !!opts.text });
  if (rcObserver) return;
  rcObserver = new MutationObserver((records) => {
    // a huge burst only needs to be known about, not kept record by record
    if (rcRecords.length < 400) rcRecords.push(...records);
    else rcRecords.overflow = true;
    if (!rcTimer) rcTimer = setTimeout(rcFlush, 100);
  });
  rcObserver.observe(document.body, { childList: true, subtree: true, characterData: true });
};

let current = DEFAULTS;
let forcedDark = false;

// The theme is dark-only. Roblox ships both themes' CSS and switches by body
// class, so a light-mode account is flipped to dark (and back when disabled).
function syncBodyTheme() {
  const body = document.body;
  if (!body) return;
  if (current.enabled && body.classList.contains("light-theme")) {
    body.classList.replace("light-theme", "dark-theme");
    body.classList.replace("color-mode-light", "color-mode-dark");
    forcedDark = true;
  } else if (!current.enabled && forcedDark) {
    body.classList.replace("dark-theme", "light-theme");
    body.classList.replace("color-mode-dark", "color-mode-light");
    forcedDark = false;
  }
}

function apply(s) {
  current = s;
  const root = document.documentElement; // can still be null this early
  if (root) {
    root.classList.toggle("rocreate-on", !!s.enabled);
    root.classList.toggle("rc-declutter", !!s.enabled && !!s.declutter);
    const [accent, hover] = ACCENTS[s.accent] || ACCENTS.blue;
    root.style.setProperty("--rc-accent", accent);
    root.style.setProperty("--rc-accent-h", hover);
  }
  syncBodyTheme();
  queueScan();
}

/* ---- Friend tiles (Home carousel + profile "Friends" row) ----
   Native .friends-carousel-tile only shows the display name. Add the Plus /
   verified badges after it and "@username" underneath, like the friends-page
   cards. One batched get-profiles call per new set of tiles. RoValra's own
   tiles (.rovalra-user-card) already show both, so they are skipped. Added
   nodes carry .rc-ext, which theme.css hides while the theme is off. */
const PROFILE_API =
  "https://apis.roblox.com/user-profile-api/v1/user/profiles/get-profiles";
const profiles = new Map(); // userId -> profile, or null while in flight
let csrf = "";
let scanTimer = 0;

async function fetchProfiles(ids) {
  const body = JSON.stringify({
    userIds: ids,
    fields: ["names.username", "isVerified", "hasRobloxSubscription"],
  });
  const post = () =>
    fetch(PROFILE_API, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json", ...(csrf && { "x-csrf-token": csrf }) },
      body,
    });
  let res = await post();
  if (res.status === 403 && res.headers.get("x-csrf-token")) {
    csrf = res.headers.get("x-csrf-token");
    res = await post();
  }
  if (!res.ok) throw new Error("get-profiles " + res.status);
  return (await res.json()).profileDetails || [];
}

function badge(cls) {
  const s = document.createElement("span");
  s.className = `rc-ext grow-0 shrink-0 basis-auto icon ${cls} size-[var(--icon-size-small)]`;
  return s;
}

function decorate(tile, p) {
  // Never duplicate a badge Roblox or another extension (RoValra) already
  // rendered — match on the icon kind, not on who added it.
  const name = tile.querySelector(".friends-carousel-tile-name");
  if (name) {
    if (p.isVerified && !name.querySelector('[class*="verified"]')) {
      name.append(badge("icon-filled-verified-mono content-system-emphasis"));
    }
    if (p.hasRobloxSubscription && !name.querySelector('[class*="roblox-plus"]')) {
      name.append(badge("icon-regular-roblox-plus"));
    }
  }
  // @username only while nothing else (the game, or another extension) is there
  const sub = tile.querySelector(".friends-carousel-tile-sublabel");
  if (!sub) return;
  const own = sub.querySelector(".rc-username");
  const other = [...sub.childNodes].some((n) => n !== own && n.textContent.trim());
  if (other) own?.remove();
  else if (!own) {
    const u = document.createElement("span");
    u.className = "rc-ext rc-username";
    u.textContent = "@" + p.names.username;
    sub.append(u);
  }
}

function scan() {
  scanTimer = 0;
  if (!current.enabled) return;
  const want = [];
  for (const tile of document.querySelectorAll(".friends-carousel-tile")) {
    if (tile.querySelector(".rovalra-user-card")) continue;
    const m = tile.querySelector("a.avatar-card-link")?.href.match(/users\/(\d+)/);
    if (!m) continue;
    const id = Number(m[1]);
    const p = profiles.get(id);
    if (p) decorate(tile, p);
    else if (!profiles.has(id)) {
      profiles.set(id, null);
      want.push(id);
    }
  }
  for (let i = 0; i < want.length; i += 100) {
    const ids = want.slice(i, i + 100);
    fetchProfiles(ids)
      .then((list) => {
        for (const p of list) profiles.set(p.userId, p);
        queueScan();
      })
      .catch(() => ids.forEach((id) => profiles.delete(id)));
  }
}

function queueScan() {
  if (!scanTimer) scanTimer = setTimeout(scan, 150);
}

function onBody() {
  apply(current); // <html> exists now; also flips <body> to dark
  rcWatch(queueScan);
  // Roblox's JS rewrites the body class after load, undoing the dark flip
  new MutationObserver(syncBodyTheme).observe(document.body, {
    attributes: true,
    attributeFilter: ["class"],
  });
}

// Neither <body> nor always <html> exists yet at document_start.
if (document.body) onBody();
else {
  new MutationObserver((_, obs) => {
    if (!document.body) return;
    obs.disconnect();
    onBody();
  }).observe(document, { childList: true, subtree: true });
}

// Apply defaults immediately to avoid a flash of the un-themed site,
// then correct once stored settings load.
apply(DEFAULTS);

chrome.storage.sync.get(DEFAULTS, apply);

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "sync") return;
  chrome.storage.sync.get(DEFAULTS, apply);
});
