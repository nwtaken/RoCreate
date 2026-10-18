const DEFAULTS = { enabled: true, declutter: true, stats: true, users: true, robux: true, profile: true };
const boxes = Object.keys(DEFAULTS).map((id) => document.getElementById(id));

chrome.storage.sync.get(DEFAULTS, (s) => {
  for (const b of boxes) b.checked = s[b.id];
});

function save() {
  chrome.storage.sync.set(Object.fromEntries(boxes.map((b) => [b.id, b.checked])));
}

for (const b of boxes) b.addEventListener("change", save);

/* ---- watchlist: games starred on their page, with live stats (background.js) ---- */
const fmt = (n) => {
  if (n == null || !isFinite(n)) return "–";
  for (const [v, s] of [[1e9, "B"], [1e6, "M"], [1e3, "K"]]) if (Math.abs(n) >= v) return +(n / v).toFixed(1) + s;
  return String(Math.round(n));
};
const el = (tag, cls, text) => Object.assign(document.createElement(tag), cls ? { className: cls } : {}, text != null ? { textContent: text } : {});

function render(list, stats = {}) {
  const box = document.getElementById("watch");
  if (!list.length) {
    box.replaceChildren(el("div", "empty", "Open a game and press ☆ Watch under its stats."));
    return;
  }
  box.replaceChildren(...list.map((g) => {
    const s = stats[g.id] || {};
    const row = el("div", "game");
    const a = el("a", "", s.name || g.name || g.id);
    a.href = g.place ? `https://www.roblox.com/games/${g.place}` : `https://creatorexchange.io/roblox-game/${g.id}`;
    a.target = "_blank";
    a.title = a.textContent;
    const players = el("span", "num", s.playing != null ? fmt(s.playing) + " playing" : "not tracked");
    const rev = el("span", "num rev", s.revenue != null ? "R$ " + fmt(s.revenue) : "");
    if (s.revenueTrend) rev.append(el("span", s.revenueTrend >= 0 ? "up" : "down", s.revenueTrend >= 0 ? " ↑" : " ↓"));
    const x = el("button", "", "×");
    x.title = "Remove from watchlist";
    x.addEventListener("click", () => chrome.storage.sync.set({ watch: list.filter((w) => w.id !== g.id) }));
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
    render(watch);
    if (!watch.length) return;
    chrome.runtime.sendMessage(
      { type: "rcx-stats", games: watch.map((g) => ({ id: g.id, name: g.name })), search: true },
      (stats) => render(watch, chrome.runtime.lastError ? {} : stats || {}),
    );
  });
}
chrome.storage.onChanged.addListener((c, area) => area === "sync" && c.watch && load());
load();
