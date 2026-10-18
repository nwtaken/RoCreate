const DEFAULTS = { enabled: true, declutter: true, stats: true, alerts: false, users: true, robux: true, profile: true };
const boxes = Object.keys(DEFAULTS).map((id) => document.getElementById(id));
const version = chrome.runtime.getManifest().version;
document.getElementById("ver").textContent = "Version " + version;

chrome.storage.sync.get(DEFAULTS, (s) => {
  for (const b of boxes) b.checked = s[b.id];
});

// accent colour (content.js applies it to Roblox; the popup's switches follow it too)
const ACCENTS = { blue: "#0a84ff", teal: "#0fb5a3", purple: "#8b5cf6", pink: "#e84393", orange: "#f2771a", green: "#22a95a" };
const swatches = document.getElementById("accent");
function showAccent(name) {
  document.body.style.setProperty("--acc", ACCENTS[name] || ACCENTS.blue);
  for (const b of swatches.children) b.classList.toggle("on", b.dataset.name === name);
}
for (const [name, color] of Object.entries(ACCENTS)) {
  const b = Object.assign(document.createElement("button"), { type: "button", title: name[0].toUpperCase() + name.slice(1) });
  b.dataset.name = name;
  b.style.background = color;
  b.addEventListener("click", () => {
    chrome.storage.sync.set({ accent: name });
    showAccent(name);
  });
  swatches.append(b);
}
chrome.storage.sync.get({ accent: "blue" }, (s) => showAccent(s.accent));

function save() {
  chrome.storage.sync.set(Object.fromEntries(boxes.map((b) => [b.id, b.checked])));
}

for (const b of boxes) b.addEventListener("change", save);

// features this copy doesn't include (config.json, written by the download page) get no switch
fetch(chrome.runtime.getURL("config.json"))
  .then((r) => r.json())
  .then(({ features: f = {} }) => {
    const off = (name) => f[name] === false;
    const hide = (id) => document.getElementById(id)?.closest(".row")?.remove();
    if (off("alerts") || off("stats")) hide("alerts");
    if (off("stats")) {
      hide("stats");
      document.getElementById("watchlist")?.remove();
    }
    if (off("robux")) hide("robux");
    if (off("profile")) hide("profile");
    if (off("admins") && off("flags")) hide("users");
    else if (off("admins") || off("flags")) {
      const sub = document.getElementById("users").closest(".row").querySelector(".sub");
      sub.textContent = off("flags") ? "Roblox admins" : "Flagged & ex-verified accounts";
    }
    if (!["stats", "alerts", "users", "profile", "robux"].some((id) => document.getElementById(id))) document.getElementById("features-head").remove();
  })
  .catch(() => {});

/* ---- what's new: the changelog entry for this version, until dismissed ---- */
chrome.action?.setBadgeText({ text: "" }); // the NEW badge background.js sets after an update
Promise.all([fetch(chrome.runtime.getURL("changelog.json")).then((r) => r.json()), chrome.storage.local.get("rc:seen")])
  .then(([log, { "rc:seen": seen }]) => {
    const entry = log.find((e) => e.version === version);
    if (!entry || seen === version) return;
    const box = document.getElementById("news");
    const list = el("ul");
    for (const c of entry.changes) list.append(el("li", "", c));
    const ok = el("button", "", "Got it");
    ok.addEventListener("click", () => {
      chrome.storage.local.set({ "rc:seen": version });
      box.hidden = true;
    });
    box.replaceChildren(el("b", "", `What's new in ${version}`), list, ok);
    box.hidden = false;
  })
  .catch(() => {});

/* ---- watchlist: games starred on their page, with live stats (background.js) ---- */
const fmt = (n) => {
  if (n == null || !isFinite(n)) return "–";
  for (const [v, s] of [[1e9, "B"], [1e6, "M"], [1e3, "K"]]) if (Math.abs(n) >= v) return +(n / v).toFixed(1) + s;
  return String(Math.round(n));
};
function el(tag, cls, text) {
  return Object.assign(document.createElement(tag), cls ? { className: cls } : {}, text != null ? { textContent: text } : {});
}

let watched = [], stats = {};
const search = document.getElementById("wl-search"), sorter = document.getElementById("wl-sort");
chrome.storage.local.get({ "rc:wlSort": "added" }, (s) => (sorter.value = s["rc:wlSort"]));
search.addEventListener("input", () => render());
sorter.addEventListener("change", () => {
  chrome.storage.local.set({ "rc:wlSort": sorter.value });
  render();
});

function render() {
  const box = document.getElementById("watch");
  if (!box) return;
  document.getElementById("wl-count").textContent = watched.length ? `(${watched.length})` : "";
  document.getElementById("wl-tools").hidden = watched.length < 4;
  if (!watched.length) {
    box.replaceChildren(el("div", "empty", "Open a game and press ☆ Watch under its stats."));
    return;
  }
  const name = (g) => stats[g.id]?.name || g.name || g.id;
  const q = search.value.trim().toLowerCase();
  let list = watched.filter((g) => !q || String(name(g)).toLowerCase().includes(q));
  const by = { revenue: (g) => -(stats[g.id]?.revenue ?? -1), playing: (g) => -(stats[g.id]?.playing ?? -1) };
  if (by[sorter.value]) list = [...list].sort((a, b) => by[sorter.value](a) - by[sorter.value](b));
  else if (sorter.value === "name") list = [...list].sort((a, b) => String(name(a)).localeCompare(String(name(b))));
  if (!list.length) {
    box.replaceChildren(el("div", "empty", "No watched game matches that."));
    return;
  }
  box.replaceChildren(...list.map((g) => {
    const s = stats[g.id] || {};
    const row = el("div", "game");
    const a = el("a", "", name(g));
    a.href = g.place ? `https://www.roblox.com/games/${g.place}` : `https://creatorexchange.io/roblox-game/${g.id}`;
    a.target = "_blank";
    a.title = a.textContent;
    const players = el("span", "num", s.playing != null ? fmt(s.playing) + " playing" : "not tracked");
    const rev = el("span", "num rev", s.revenue != null ? "R$ " + fmt(s.revenue) : "");
    if (s.revenueTrend) rev.append(el("span", s.revenueTrend >= 0 ? "up" : "down", s.revenueTrend >= 0 ? " ↑" : " ↓"));
    const x = el("button", "", "×");
    x.title = "Remove from watchlist";
    x.addEventListener("click", () => chrome.storage.sync.set({ watch: watched.filter((w) => w.id !== g.id) }));
    const left = el("div", "info");
    const meta = el("div", "meta");
    meta.append(rev, players);
    left.append(a, meta);
    row.append(left, x);
    return row;
  }));
}

function load() {
  chrome.storage.sync.get({ watch: [] }, ({ watch }) => {
    watched = watch;
    render();
    if (!watch.length) return;
    chrome.runtime.sendMessage(
      { type: "rcx-stats", games: watch.map((g) => ({ id: g.id, name: g.name })), search: true },
      (got) => {
        stats = chrome.runtime.lastError ? {} : got || {};
        render();
      },
    );
  });
}
chrome.storage.onChanged.addListener((c, area) => area === "sync" && c.watch && load());
load();
