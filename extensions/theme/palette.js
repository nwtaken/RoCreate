/* Quick jump: Ctrl+K (Cmd+K on a Mac) opens a Creator Hub style command palette on
   www.roblox.com. It searches RoCreate's list of pages, your communities (with their
   admin pages when you own them) and Roblox's own search for experiences, people,
   communities and Marketplace items. Only Roblox is asked, and only while you type
   (debounced, cached, one request per source per query). */
(() => {
  if (location.hostname !== "www.roblox.com" || window.top !== window) return;

  let prefs = { enabled: true, palette: true };
  let root = null, input = null, list = null;
  let items = [], active = 0, timer = 0, controller = null, lastFocus = null;
  const cache = new Map();
  const RECENT_KEY = "rcJumpRecent";
  const MOD = /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl";
  const RATE_NOTE = "Roblox is rate limiting search right now. Try again in a moment.";

  const uid = () => document.querySelector('meta[name="user-data"]')?.dataset.userid || "";
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const fmt = (n) => (n >= 1e9 ? (n / 1e9).toFixed(1) + "B" : n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n >= 1e3 ? (n / 1e3).toFixed(1) + "K" : String(n ?? 0));

  const ICONS = {
    page: '<path d="M4 4h10l6 6v10H4z" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M14 4v6h6" fill="none" stroke="currentColor" stroke-width="1.8"/>',
    settings: '<circle cx="12" cy="12" r="3.2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
    create: '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M12 12l8-4.5M12 12v9M12 12L4 7.5" stroke="currentColor" stroke-width="1.8"/>',
    game: '<rect x="3" y="7" width="18" height="11" rx="4" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M8 10.5v4M6 12.5h4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="16" cy="11.5" r="1.1" fill="currentColor"/><circle cx="17.5" cy="14" r="1.1" fill="currentColor"/>',
    person: '<circle cx="12" cy="8.5" r="3.8" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M4.5 20c1.2-3.8 4-5.5 7.5-5.5s6.3 1.7 7.5 5.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
    group: '<circle cx="9" cy="9" r="3.2" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="16.5" cy="10" r="2.6" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M3.5 19c.9-3.2 3-4.8 5.5-4.8s4.6 1.6 5.5 4.8M15 14.6c2.6-.3 4.6 1.1 5.5 4.4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
    admin: '<path d="M12 3l7 3v5.5c0 4.4-3 7.6-7 9.5-4-1.9-7-5.1-7-9.5V6z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M9 12l2.2 2.2L15.5 10" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
    item: '<path d="M6 8h12l-1 12H7z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M9 8V6.5a3 3 0 0 1 6 0V8" fill="none" stroke="currentColor" stroke-width="1.8"/>',
    search: '<circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M16 16l4 4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
    recent: '<circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 7.5V12l3 2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  };
  const icon = (k) => `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">${ICONS[k] || ICONS.page}</svg>`;

  function pages() {
    const u = uid();
    const set = (hash, title, words) => ({ kind: "settings", title: "Settings: " + title, sub: "Settings", url: "/my/account#!/" + hash, words });
    const list = [
      { kind: "page", title: "Home", url: "/home", words: "start dashboard" },
      { kind: "page", title: "Games", url: "/charts", words: "charts experiences discover popular top" },
      { kind: "page", title: "Marketplace", url: "/catalog", words: "avatar shop catalog items clothing accessories" },
      { kind: "page", title: "Avatar editor", url: "/my/avatar", words: "outfit character customize" },
      { kind: "page", title: "Trades", url: "/trades", words: "trade inbound outbound completed" },
      { kind: "page", title: "My transactions", url: "/transactions", words: "robux sales summary purchases payouts devex money" },
      { kind: "page", title: "Messages", url: "/my/messages/#!/inbox", words: "inbox mail" },
      { kind: "page", title: "Friends", url: "/users/friends#!/friends", words: "connections followers following requests" },
      { kind: "page", title: "Communities", url: "/communities", words: "groups" },
      { kind: "page", title: "Buy Robux", url: "/upgrades/robux", words: "currency purchase" },
      { kind: "page", title: "Roblox Plus", url: "/plus", words: "premium subscription membership" },
      { kind: "page", title: "Redeem codes", url: "/redeem", words: "gift card promo" },
      set("info", "Account info", "username email phone"),
      set("security", "Security", "2fa two step verification password passkey"),
      set("privacy", "Privacy & content restrictions", "privacy chat"),
      set("notifications", "Notifications", "alerts"),
      set("billing", "Spending", "billing payment"),
      set("robux", "Robux", "balance"),
      set("subscriptions", "Subscriptions", "plus premium"),
      set("parental-controls", "Parental controls", "parent"),
      set("app-permissions", "App permissions", "apps"),
      set("browser-preferences", "Browser preferences", "browser"),
      { kind: "create", title: "Creator Hub: Creations", url: "https://create.roblox.com/dashboard/creations", words: "create studio games develop" },
      { kind: "create", title: "Creator Hub: DevEx", url: "https://create.roblox.com/dashboard/devex", words: "developer exchange cash out" },
      { kind: "create", title: "Creator Hub: Docs", url: "https://create.roblox.com/docs", words: "documentation api luau" },
      { kind: "create", title: "Creator Store", url: "https://create.roblox.com/store", words: "models plugins audio toolbox" },
    ];
    if (u) {
      list.splice(5, 0,
        { kind: "page", title: "Inventory", url: `/users/${u}/inventory`, words: "items owned" },
        { kind: "page", title: "Favorites", url: `/users/${u}/favorites`, words: "saved" },
        { kind: "page", title: "My profile", url: `/users/${u}/profile`, words: "me" });
    }
    return list.map((p) => ({ ...p, sub: p.sub || (p.kind === "create" ? "Creator Hub" : "Page") }));
  }

  let groupsPromise = null, groupsCache = [], recentCache = [], gamesCache = [];
  // your experiences, as last read by the Home panel (mygames.js); nothing is fetched for this
  function gameItems() {
    const out = [];
    for (const g of gamesCache) {
      if (!g.place) continue;
      out.push({ kind: "game", title: g.name, sub: (g.owner === "You" ? "Your experience" : g.owner), url: `/games/${g.place}`, words: "my experience game mine" });
      out.push({ kind: "create", title: "Creator Hub: " + g.name, sub: "Manage, analytics and monetization", url: `https://create.roblox.com/dashboard/creations/experiences/${g.id}/overview`, words: "manage analytics configure monetization" });
    }
    return out;
  }
  function myGroups() {
    const u = uid();
    if (!u) return Promise.resolve([]);
    groupsPromise ||= fetch(`https://groups.roblox.com/v2/users/${u}/groups/roles`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : { data: [] }))
      .then((j) => (j.data || []).sort((a, b) => b.role.rank - a.role.rank))
      .catch(() => []);
    return groupsPromise;
  }
  function groupItems() {
    const out = [];
    for (const g of groupsCache) {
      const owner = g.role.rank === 255, id = g.group.id, name = g.group.name;
      out.push({ kind: "group", title: name, sub: `${owner ? "Owner" : g.role.name} · ${fmt(g.group.memberCount)} members`, url: `/communities/${id}/`, words: "community group" });
      if (!owner) continue;
      for (const [hash, label, words] of [["information", "Configure", "settings admin manage"], ["revenue", "Revenue", "payouts funds money sales"], ["auditLog", "Audit log", "history actions log"], ["members", "Members", "ranks users"], ["roles", "Roles", "ranks permissions"]]) {
        out.push({ kind: "admin", title: `${label}: ${name}`, sub: "Community admin", url: `/communities/configure?id=${id}#!/${hash}`, words: words + " " + label.toLowerCase() });
      }
    }
    return out;
  }

  function score(item, q) {
    const title = item.title.toLowerCase(), hay = (title + " " + (item.words || "") + " " + (item.sub || "")).toLowerCase();
    const tokens = q.split(/\s+/).filter(Boolean);
    if (!tokens.every((t) => hay.includes(t))) return 0;
    if (title.startsWith(q)) return 3;
    if (title.split(/[\s:]+/).some((w) => w.startsWith(tokens[0]))) return 2;
    return 1;
  }

  async function getJSON(url, signal) {
    const r = await fetch(url, { credentials: "include", signal });
    if (r.status === 429) throw new Error("rate");
    if (!r.ok) throw new Error(String(r.status));
    return r.json();
  }
  const SOURCES = [
    {
      label: "Experiences", min: 2,
      run: async (q, signal) => {
        const j = await getJSON(`https://apis.roblox.com/search-api/omni-search?searchQuery=${encodeURIComponent(q)}&pageType=all&sessionId=rocreate-jump`, signal);
        const games = (j.searchResults || []).filter((g) => g.contentGroupType === "Game").flatMap((g) => g.contents || []);
        return games.filter((g) => g.rootPlaceId).slice(0, 5).map((g) => ({ kind: "game", title: g.name, sub: `${g.creatorName || "Experience"} · ${fmt(g.playerCount)} playing`, url: `/games/${g.rootPlaceId}` }));
      },
    },
    {
      label: "People", min: 3,
      run: async (q, signal) => {
        const j = await getJSON(`https://users.roblox.com/v1/users/search?keyword=${encodeURIComponent(q)}&limit=10`, signal);
        return (j.data || []).slice(0, 4).map((u) => ({ kind: "person", title: u.displayName, sub: "@" + u.name + (u.hasVerifiedBadge ? " · Verified" : ""), url: `/users/${u.id}/profile` }));
      },
    },
    {
      label: "Communities", min: 2,
      run: async (q, signal) => {
        const j = await getJSON(`https://groups.roblox.com/v1/groups/search?keyword=${encodeURIComponent(q)}&prioritizeExactMatch=true&limit=10`, signal);
        return (j.data || []).slice(0, 4).map((g) => ({ kind: "group", title: g.name, sub: `${fmt(g.memberCount)} members${g.hasVerifiedBadge ? " · Verified" : ""}`, url: `/communities/${g.id}/` }));
      },
    },
    {
      label: "Marketplace", min: 2,
      run: async (q, signal) => {
        const j = await getJSON(`https://catalog.roblox.com/v2/search/items/details?keyword=${encodeURIComponent(q)}&limit=10`, signal);
        return (j.data || []).slice(0, 4).map((i) => ({ kind: "item", title: i.name, sub: `${i.itemType === "Bundle" ? "Bundle" : "Item"}${i.creatorName ? " · " + i.creatorName : ""}${i.price != null ? " · R$ " + fmt(i.price) : ""}`, url: `/${i.itemType === "Bundle" ? "bundles" : "catalog"}/${i.id}` }));
      },
    },
  ];

  async function recent() {
    return new Promise((done) => chrome.storage.local.get({ [RECENT_KEY]: [] }, (r) => done(chrome.runtime.lastError ? [] : r[RECENT_KEY] || [])));
  }
  function remember(item) {
    if (!rcAlive()) return;
    recent().then((list) => {
      const next = [{ kind: item.kind, title: item.title, sub: item.sub, url: item.url }, ...list.filter((r) => r.url !== item.url)].slice(0, 6);
      chrome.storage.local.set({ [RECENT_KEY]: next });
    });
  }

  function build() {
    root = document.createElement("div");
    root.id = "rc-jump";
    root.innerHTML = `<div class="rc-jump-box" role="dialog" aria-modal="true" aria-label="Quick jump">
      <div class="rc-jump-field">${icon("search")}
        <input type="text" role="combobox" aria-expanded="true" aria-controls="rc-jump-list" aria-autocomplete="list" autocomplete="off" spellcheck="false" placeholder="Jump to a page, experience, person, community or item">
        <kbd>Esc</kbd></div>
      <div class="rc-jump-list" id="rc-jump-list" role="listbox"></div>
      <div class="rc-jump-foot"><span><kbd>↑</kbd><kbd>↓</kbd> move <kbd>Enter</kbd> open <kbd>${MOD}</kbd>+<kbd>Enter</kbd> new tab</span></div>
    </div>`;
    input = root.querySelector("input");
    list = root.querySelector(".rc-jump-list");
    root.addEventListener("mousedown", (e) => { if (e.target === root) close(); });
    input.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(refresh, 220); renderLocal(); });
    input.addEventListener("keydown", onKey);
    for (const t of ["keyup", "keypress"]) input.addEventListener(t, (e) => e.stopPropagation());
    list.addEventListener("mousemove", (e) => { const row = e.target.closest("[data-i]"); if (row && +row.dataset.i !== active) select(+row.dataset.i, false); });
    list.addEventListener("click", (e) => { const row = e.target.closest("[data-i]"); if (row) go(items[+row.dataset.i], e.ctrlKey || e.metaKey); });
    root.addEventListener("keydown", (e) => { if (e.key === "Tab") { e.preventDefault(); input.focus(); } });
  }

  function onKey(e) {
    if (e.key === "Escape") { e.preventDefault(); close(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); select(Math.min(items.length - 1, active + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); select(Math.max(0, active - 1)); }
    else if (e.key === "Enter" && items[active]) { e.preventDefault(); go(items[active], e.ctrlKey || e.metaKey); }
    e.stopPropagation(); // keep Roblox's own page shortcuts out of the search box
  }

  function select(i, scroll = true) {
    active = i;
    for (const row of list.querySelectorAll("[data-i]")) {
      const on = +row.dataset.i === i;
      row.classList.toggle("rc-on", on);
      row.setAttribute("aria-selected", on ? "true" : "false");
      if (on) { input.setAttribute("aria-activedescendant", row.id); if (scroll) row.scrollIntoView({ block: "nearest" }); }
    }
  }

  function go(item, newTab) {
    if (!item) return;
    remember(item);
    const url = new URL(item.url, location.origin).href;
    if (newTab) { window.open(url, "_blank", "noopener"); return; }
    close();
    location.href = url;
  }

  let sections = [];
  function paint() {
    items = [];
    let html = "";
    for (const s of sections) {
      if (!s.items.length && !s.note) continue;
      html += `<div class="rc-jump-head">${esc(s.label)}${s.loading ? '<span class="rc-jump-spin" aria-hidden="true"></span>' : ""}</div>`;
      if (s.note) html += `<div class="rc-jump-note">${esc(s.note)}</div>`;
      for (const it of s.items) {
        const i = items.push(it) - 1;
        html += `<div class="rc-jump-row" role="option" id="rc-jump-${i}" data-i="${i}" aria-selected="false"><span class="rc-jump-ico rc-k-${it.kind}">${icon(it.kind)}</span><span class="rc-jump-text"><b>${esc(it.title)}</b><small>${esc(it.sub || "")}</small></span>${/^https?:/.test(it.url) ? '<span class="rc-jump-ext">Creator Hub</span>' : ""}</div>`;
      }
    }
    list.innerHTML = html || `<div class="rc-jump-empty">No matches${input.value.trim().length < 2 ? "" : " yet"}.</div>`;
    select(Math.min(active, Math.max(0, items.length - 1)), false);
  }

  function renderLocal() {
    const q = input.value.trim().toLowerCase();
    const local = [...pages(), ...gameItems(), ...groupItems()];
    const remote = sections.filter((s) => s.remote && s.q === q);
    if (!q) {
      const rec = recentCache.map((r) => ({ ...r, kind: r.kind === "game" || r.kind === "person" || r.kind === "item" || r.kind === "group" ? r.kind : "recent" }));
      sections = [
        { label: "Recent", items: rec },
        { label: "Pages", items: local.filter((i) => i.kind === "page").slice(0, 8) },
        { label: "Your experiences", items: local.filter((i) => i.kind === "game").slice(0, 5) },
        { label: "Your communities", items: local.filter((i) => i.kind === "group").slice(0, 5) },
      ];
    } else {
      const hits = local.map((i) => [score(i, q), i]).filter(([s]) => s > 0).sort((a, b) => b[0] - a[0]).map(([, i]) => i).slice(0, 8);
      sections = [{ label: "Go to", items: hits }, ...remote];
    }
    active = 0;
    paint();
  }

  async function refresh() {
    const q = input.value.trim().toLowerCase();
    controller?.abort();
    if (q.length < 2) return;
    controller = new AbortController();
    const signal = controller.signal;
    for (const src of SOURCES) {
      if (q.length < src.min) continue;
      const key = src.label + "\n" + q;
      let sec = sections.find((s) => s.label === src.label);
      if (!sec) { sec = { label: src.label, items: [], remote: true, q }; sections.push(sec); }
      if (cache.has(key)) { Object.assign(sec, { items: cache.get(key), loading: false, note: "", q }); continue; }
      Object.assign(sec, { loading: true, q });
      src.run(q, signal).then((found) => {
        if (cache.size > 60) cache.delete(cache.keys().next().value);
        cache.set(key, found);
        if (input.value.trim().toLowerCase() !== q) return;
        Object.assign(sec, { items: found, loading: false, note: "" });
        paint();
      }).catch((err) => {
        if (signal.aborted || input.value.trim().toLowerCase() !== q) return;
        Object.assign(sec, { items: [], loading: false, note: err.message === "rate" ? RATE_NOTE : "" });
        paint();
      });
    }
    paint();
  }

  function open() {
    if (!prefs.enabled || prefs.palette === false || !rcAlive()) return;
    if (!root) build();
    if (root.isConnected) return input.focus();
    lastFocus = document.activeElement;
    document.body.append(root);
    document.documentElement.classList.add("rc-jump-open");
    input.value = "";
    sections = [];
    renderLocal();
    input.focus();
    // your communities and recent picks arrive once; the list redraws when they do
    myGroups().then((g) => { groupsCache = g; if (root.isConnected && !input.value.trim()) renderLocal(); else if (root.isConnected) renderLocal(); });
    recent().then((r) => { recentCache = r; if (root.isConnected && !input.value.trim()) renderLocal(); });
    chrome.storage.local.get({ rcMyGamesList: null }, (r) => {
      const list = !chrome.runtime.lastError && r.rcMyGamesList?.uid === uid() ? r.rcMyGamesList.games || [] : [];
      if (list.length !== gamesCache.length) { gamesCache = list; if (root.isConnected) renderLocal(); }
    });
  }
  function close() {
    controller?.abort();
    root?.remove();
    document.documentElement.classList.remove("rc-jump-open");
    if (lastFocus?.isConnected) lastFocus.focus?.();
  }

  window.addEventListener("keydown", (e) => {
    if (e.key?.toLowerCase() !== "k" || !(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) return;
    if (prefs.palette === false || !prefs.enabled) return;
    e.preventDefault();
    e.stopPropagation();
    if (root?.isConnected) close(); else open();
  }, true);

  const load = () => chrome.storage.sync.get({ enabled: true, palette: true }, (s) => { if (!chrome.runtime.lastError) { prefs = s; if (!s.enabled || s.palette === false) close(); } });
  load();
  chrome.storage.onChanged.addListener((changes, area) => { if (area === "sync" && rcAlive()) load(); });
})();
