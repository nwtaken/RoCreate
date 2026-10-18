/* Robux menu (the balance dropdown in the top bar): adds your Pending Robux and the funds
   of every group whose funds you can see (owner, or a role allowed to view them).
   Roblox renders the menu only while it is open and removes it on close, so the rows are
   added each time it opens. Results are kept in chrome.storage.local and shown at once,
   then refreshed. Setting: chrome.storage.sync { robux: bool }. */
(() => {
  let on = true;
  let cache = null; // { at, rows, empty } — also kept in chrome.storage.local, so it survives reloads
  let loading = null;
  const FRESH = 10 * 60 * 1000;      // refresh in the background after 10 minutes
  const DENIED_TTL = 6 * 3600 * 1000; // groups whose funds you can't see: ask again after 6 hours

  const fmt = (n) => Number(n).toLocaleString();
  let uidCache = null;
  const userId = () => uidCache || (uidCache = document.querySelector('meta[name="user-data"]')?.dataset.userid || null);
  // some pages don't carry the user-data meta tag: ask Roblox who is signed in
  async function resolveUser() {
    if (userId()) return uidCache;
    try {
      const r = await fetch("https://users.roblox.com/v1/users/authenticated", { credentials: "include" });
      if (r.ok) uidCache = String((await r.json()).id);
    } catch {}
    return uidCache;
  }
  const key = () => "rbx:" + userId();
  // what the last load did, readable from the extension's storage when something looks wrong
  const diag = (d) => rcAlive() && chrome.storage.local.set({ "rbx:diag": { ...d, at: new Date().toISOString(), page: location.pathname } });

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function getJson(url, tries = 4) {
    const res = await fetch(url, { credentials: "include" });
    if (res.status === 429 && tries > 1) {
      // rate limited: wait as long as Roblox asks (or 3 s, 6 s, 9 s), then retry
      const after = Number(res.headers.get("retry-after")) * 1000;
      await sleep(after > 0 && after < 30000 ? after : (5 - tries) * 3000);
      return getJson(url, tries - 1);
    }
    if (!res.ok) throw Object.assign(new Error(res.status), { status: res.status });
    return res.json();
  }

  async function saved() {
    if (cache) return cache;
    if (!(await resolveUser()) || !rcAlive()) return null;
    const k = key();
    const got = (await chrome.storage.local.get(k))[k];
    if (got) cache = got;
    return cache;
  }

  let onProgress = null; // set while the menu is open, so rows appear as they arrive

  function load() {
    if (loading) return loading;
    if (!rcAlive()) return Promise.resolve(cache);
    loading = (async () => {
      const uid = await resolveUser();
      if (!uid) {
        diag({ step: "no user id" });
        return cache;
      }
      const t0 = Date.now();
      const statuses = {};
      const k = key();
      const prev = (await chrome.storage.local.get(k))[k] || {};
      const denied = prev.denied || {};
      const [totals, groups] = await Promise.allSettled([
        getJson(`https://economy.roblox.com/v2/users/${uid}/transaction-totals?timeFrame=Year&transactionType=summary`),
        getJson(`https://groups.roblox.com/v2/users/${uid}/groups/roles`),
      ]);
      const rows = [];
      let empty = 0;
      if (totals.status === "fulfilled") rows.push({ label: "Pending", robux: totals.value.pendingRobuxTotal ?? 0, cls: "rcx-pending" });
      else if (prev.rows?.[0]?.cls === "rcx-pending") rows.push(prev.rows[0]);
      if (groups.status === "fulfilled") {
        // Every group, highest rank first, one at a time: Roblox rate-limits this endpoint
        // hard (four in parallel got most of them a 429). Roles that can't see funds answer
        // 403 and are skipped for a while. Each result is shown and saved as it comes in.
        const list = (groups.value.data || [])
          .filter((g) => !(denied[g.group.id] > Date.now() - DENIED_TTL))
          .sort((a, b) => (b.role?.rank ?? 0) - (a.role?.rank ?? 0));
        const funds = [];
        const publish = () => {
          const have = funds.filter(Boolean);
          const partial = {
            at: prev.at || 0, // still "old" until the run finishes
            rows: [...rows, ...have.filter((f) => f.robux > 0).sort((a, b) => b.robux - a.robux)],
            empty: have.filter((f) => !(f.robux > 0)).length,
            denied,
          };
          cache = partial;
          onProgress?.(partial);
        };
        for (const g of list) {
          let row = null;
          try {
            const c = await getJson(`https://economy.roblox.com/v1/groups/${g.group.id}/currency`);
            delete denied[g.group.id];
            row = { label: g.group.name, robux: c.robux ?? 0, href: `https://www.roblox.com/communities/configure?id=${g.group.id}#!/revenue` };
          } catch (e) {
            const code = e.status || String(e.message).slice(0, 40);
            statuses[code] = (statuses[code] || 0) + 1;
            if (e.status === 403 || e.status === 401) denied[g.group.id] = Date.now();
            // anything else (network, still rate limited): keep the last known value
            else row = prev.rows?.find((r) => r.href?.includes(`id=${g.group.id}#`)) || null;
          }
          funds.push(row);
          if (row) publish();
          await sleep(350);
        }
        const have = funds.filter(Boolean);
        empty = have.filter((f) => !(f.robux > 0)).length;
        rows.push(...have.filter((f) => f.robux > 0).sort((a, b) => b.robux - a.robux));
      } else if (prev.rows) {
        rows.push(...prev.rows.filter((r) => r.href));
        empty = prev.empty || 0;
      }
      cache = { at: Date.now(), rows, empty, denied };
      await chrome.storage.local.set({ [k]: cache });
      diag({
        step: "done", ms: Date.now() - t0, uid,
        totals: totals.status === "fulfilled" ? "ok" : String(totals.reason?.status || totals.reason),
        groupsCall: groups.status === "fulfilled" ? (groups.value.data || []).length + " groups" : String(groups.reason?.status || groups.reason),
        skippedDenied: Object.keys(prev.denied || {}).length, funded: rows.length - (rows[0]?.cls === "rcx-pending" ? 1 : 0), empty, errors: statuses,
      });
      return cache;
    })().finally(() => (loading = null));
    return loading;
  }

  const ICON = '<span aria-hidden="true" class="icon icon-regular-robux rcx-rbx-icon"></span>';

  function render(menu, data) {
    menu.querySelector(".rcx-robux")?.remove();
    const rows = data?.rows || [];
    if (!rows.length && !loading) return;
    const box = document.createElement("div");
    box.className = "rcx-robux";
    box.setAttribute("role", "none");
    box.innerHTML = rows
      .map((r) => {
        const inner = `<span class="rcx-rbx-label">${r.label.replace(/</g, "&lt;")}</span><span class="rcx-rbx-amount">${ICON}${fmt(r.robux)}</span>`;
        return r.href
          ? `<a class="rcx-rbx-row ${r.cls || ""}" href="${r.href}" title="Open this group's revenue">${inner}</a>`
          : `<div class="rcx-rbx-row ${r.cls || ""}" title="Robux from sales that haven't cleared yet">${inner}</div>`;
      })
      .join("") +
      (data.empty ? `<div class="rcx-rbx-row rcx-rbx-empty">+${data.empty} group${data.empty > 1 ? "s" : ""} with 0 Robux</div>` : "") +
      (rows.length > 1 ? totalRow(rows) : "") +
      (loading ? '<div class="rcx-rbx-row rcx-rbx-empty">Updating…</div>'
        : data.at ? `<div class="rcx-rbx-row rcx-rbx-fresh"><span>Updated ${ago(data.at)}</span><button type="button" class="rcx-rbx-refresh">Refresh</button></div>` : "") +
      '<div role="separator" class="foundation-web-menu-separator"></div>';
    // right below the balance row at the top of the menu
    const first = menu.firstElementChild;
    if (first) first.after(box);
    else menu.prepend(box);
    const refresh = box.querySelector(".rcx-rbx-refresh");
    if (refresh) {
      // clicks stay inside: the menu would otherwise treat them as picking an item and close
      refresh.addEventListener("pointerdown", (e) => e.stopPropagation());
      refresh.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        onProgress = (partial) => menu.isConnected && render(menu, partial);
        const p = load();
        render(menu, cache || data);
        p.then((fresh) => menu.isConnected && render(menu, fresh)).catch(() => {}).finally(() => (onProgress = null));
      });
    }
  }
  // everything above added up, and roughly what it's worth through Developer Exchange
  const DEVEX_USD = 0.0038; // per Robux, Roblox's DevEx rate since September 2025
  function totalRow(rows) {
    const total = rows.reduce((n, r) => n + (Number(r.robux) || 0), 0);
    const usd = Math.round(total * DEVEX_USD).toLocaleString();
    return `<div class="rcx-rbx-row rcx-rbx-total" title="Pending Robux plus every group's funds. DevEx estimate at $${DEVEX_USD} per Robux; Roblox's eligibility rules and minimums apply.">` +
      `<span class="rcx-rbx-label">Total <span class="rcx-rbx-usd">≈ $${usd} DevEx</span></span><span class="rcx-rbx-amount">${ICON}${fmt(total)}</span></div>`;
  }

  function ago(t) {
    const m = Math.round((Date.now() - t) / 60000);
    return m < 1 ? "just now" : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`;
  }

  // the menu mounts a moment after the button flips to aria-expanded="true"
  async function onOpen(button, tries = 0) {
    const menu = document.getElementById(button.getAttribute("aria-controls"))?.querySelector('[role="menu"]');
    if (!menu) {
      if (tries < 20 && button.getAttribute("aria-expanded") === "true") setTimeout(() => onOpen(button, tries + 1), 50);
      return;
    }
    if (menu.querySelector(".rcx-robux")) return;
    const have = await saved();
    if (!on) return;
    if (have) render(menu, have); // instant, from the last visit
    if (!have || Date.now() - have.at > FRESH || loading) {
      onProgress = (partial) => menu.isConnected && render(menu, partial);
      const p = load();
      if (menu.isConnected) render(menu, cache || { rows: [] }); // shows "Updating…"
      try {
        const fresh = await p;
        if (menu.isConnected) render(menu, fresh);
      } catch {}
      onProgress = null;
    }
  }

  // only the button's aria-expanded is watched, not the whole page
  new MutationObserver((records, obs) => {
    if (!rcAlive()) return obs.disconnect();
    if (!on) return;
    for (const r of records) {
      if (r.target.matches?.('#navbar-robux button[aria-expanded="true"]')) onOpen(r.target);
    }
  }).observe(document.documentElement, { subtree: true, attributes: true, attributeFilter: ["aria-expanded"] });

  chrome.storage.sync.get({ robux: true }, (s) => {
    on = !!s.robux;
    // warm up shortly after the page loads, so the menu is ready before it is opened
    if (on) setTimeout(async () => {
      const have = await saved();
      if (on && userId() && (!have || Date.now() - have.at > FRESH)) load().catch(() => {});
    }, 3000);
  });
  chrome.storage.onChanged.addListener((c, area) => area === "sync" && c.robux && (on = !!c.robux.newValue));
})();
