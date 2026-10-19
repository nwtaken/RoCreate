const DEFAULTS = { enabled: true, declutter: true, streamer: false, reduceMotion: false, stats: true, watchlistTools: true, alerts: false, users: true, robux: true, sales: false, profile: true, profileNav: true, socials: true };
const boxes = Object.keys(DEFAULTS).map((id) => document.getElementById(id));
const version = chrome.runtime.getManifest().version;
document.getElementById("ver").textContent = "Version " + version;

chrome.storage.sync.get(DEFAULTS, (s) => {
  for (const b of boxes) b.checked = s[b.id];
  showWatchlistLink();
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
  b.setAttribute("aria-label", "Accent " + name);
  b.dataset.name = name;
  b.style.background = color;
  b.addEventListener("click", () => {
    chrome.storage.sync.set({ accent: name });
    showAccent(name);
  });
  swatches.append(b);
}
chrome.storage.sync.get({ accent: "blue" }, (s) => showAccent(s.accent));

function showWatchlistLink() {
  const link = document.getElementById("wl-open");
  if (link) link.hidden = !document.getElementById("watchlistTools").checked || !document.getElementById("stats").checked;
}

function save() {
  showWatchlistLink();
  chrome.storage.sync.set(Object.fromEntries(boxes.map((b) => [b.id, b.checked])));
}

for (const b of boxes) {
  b.addEventListener("change", save);
  // screen readers: name each switch after its row ("Theme", "Spike alerts", ...)
  b.setAttribute("aria-label", b.closest(".row")?.firstElementChild?.firstChild?.textContent.trim() || b.id);
}

// features this copy doesn't include (config.json, written by the download page) get no switch
fetch(chrome.runtime.getURL("config.json"))
  .then((r) => r.json())
  .then(({ features: f = {} }) => {
    const off = (name) => f[name] === false;
    const hide = (id) => document.getElementById(id)?.closest(".row")?.remove();
    if (off("reduceMotion")) hide("reduceMotion");
    if (off("watchlistTools") || off("stats")) { hide("watchlistTools"); document.getElementById("wl-open")?.remove(); }
    if (off("alerts") || off("stats")) hide("alerts");
    if (off("stats")) {
      hide("stats");
      document.getElementById("watchlist")?.remove();
    }
    if (off("robux")) hide("robux");
    if (off("sales") || off("robux")) hide("sales");
    if (off("profile")) hide("profile");
    if (off("profile") || off("profileNav")) hide("profileNav");
    if (off("profile") || off("socials")) hide("socials");
    if (off("admins") && off("flags")) hide("users");
    else if (off("admins") || off("flags")) {
      const sub = document.getElementById("users").closest(".row").querySelector(".sub");
      sub.textContent = off("flags") ? "Roblox admins" : "Flagged & ex-verified accounts";
    }
    if (!["stats", "alerts", "users", "profile", "socials", "robux", "sales"].some((id) => document.getElementById(id))) document.getElementById("features-head").remove();
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
  if (n == null || !isFinite(n)) return "-";
  for (const [v, s] of [[1e9, "B"], [1e6, "M"], [1e3, "K"]]) if (Math.abs(n) >= v) return +(n / v).toFixed(1) + s;
  return String(Math.round(n));
};
function el(tag, cls, text) {
  return Object.assign(document.createElement(tag), cls ? { className: cls } : {}, text != null ? { textContent: text } : {});
}

let watched = [], stats = {}, hist = {};
// a 7-day players line for a watched game
function spark(points) {
  const w = 56, h = 18, ys = points.map((p) => p[1]);
  const lo = Math.min(...ys), span = Math.max(...ys) - lo || 1;
  const t0 = points[0][0], tspan = points[points.length - 1][0] - t0 || 1;
  const d = points.map(([t, v], i) => `${i ? "L" : "M"}${(((t - t0) / tspan) * w).toFixed(1)},${(h - 2 - ((v - lo) / span) * (h - 4)).toFixed(1)}`).join("");
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
  svg.setAttribute("class", "spark " + (ys[ys.length - 1] >= ys[0] ? "up" : "down"));
  svg.innerHTML = `<path d="${d}"/>`;
  svg.append(Object.assign(document.createElementNS("http://www.w3.org/2000/svg", "title"), { textContent: "Players, last 7 days" }));
  return svg;
}
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
    const line = hist[g.id]?.points?.length >= 3 ? spark(hist[g.id].points) : el("span");
    const x = el("button", "", "×");
    x.title = "Remove from watchlist";
    x.addEventListener("click", () => chrome.storage.sync.set({ watch: watched.filter((w) => w.id !== g.id) }));
    const left = el("div", "info");
    const meta = el("div", "meta");
    meta.append(rev, players);
    left.append(a, meta);
    row.append(left, line, x);
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
        loadHistory();
      },
    );
  });
}
// sparklines for the first dozen games, three requests at a time (cached for an hour)
async function loadHistory() {
  const todo = watched.slice(0, 12).filter((g) => !hist[g.id]);
  for (let i = 0; i < todo.length; i += 3) {
    await Promise.all(todo.slice(i, i + 3).map((g) => new Promise((r) => {
      chrome.runtime.sendMessage({ type: "rcx-history", id: String(g.id) }, (h) => {
        if (!chrome.runtime.lastError && h) hist[g.id] = h;
        r();
      });
    })));
    render();
  }
}

// the watchlist as CSV, for spreadsheets
document.getElementById("wl-csv").addEventListener("click", (e) => {
  const q = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const rows = [["Name", "Universe ID", "Place ID", "Playing", "Est. revenue (R$)", "Revenue trend (%)"]].concat(
    watched.map((g) => { const s = stats[g.id] || {}; return [s.name || g.name, g.id, g.place, s.playing, s.revenue, s.revenueTrend]; }));
  navigator.clipboard.writeText(rows.map((r) => r.map(q).join(",")).join("\n")).then(() => {
    e.target.textContent = "Copied";
    setTimeout(() => (e.target.textContent = "Copy CSV"), 1200);
  });
});

chrome.storage.onChanged.addListener((c, area) => area === "sync" && c.watch && load());
load();

document.getElementById("options").addEventListener("click", (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});
