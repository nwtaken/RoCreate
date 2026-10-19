/* Money tools.
   - My transactions: a DevEx estimate card (read from the summary Roblox already shows,
     no extra requests) and CSV export of sales, purchases, community payouts and Robux
     purchases for a chosen period.
   - Community admin (Configure): CSV export of the community's sales on the Revenue tab
     and of the audit log on the Audit log tab.
   Exports page through Roblox's own APIs at about one request per second, wait when
   Roblox asks them to slow down, and build the file on your device. */
(() => {
  if (location.hostname !== "www.roblox.com") return;
  const DEVEX_RATE = 0.0038; // USD per earned Robux (rate since September 2025)
  const DEVEX_MIN = 30000;
  const EARNED = ["Sales of Goods", "Creator Rewards", "Community Payouts", "Group Payouts", "Immersive Ads Payout", "Premium Payouts", "Engagement Payouts", "Affiliate", "Commissions", "Subscription"];
  let prefs = { enabled: true, moneyTools: true };
  let job = null; // the running export, one at a time

  const uid = () => document.querySelector('meta[name="user-data"]')?.dataset.userid || "";
  const num = (t) => { const m = String(t || "").replace(/[^\d-]/g, ""); return m ? parseInt(m, 10) : 0; };
  const usd = (n) => "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const robux = (n) => "R$ " + n.toLocaleString("en-US");
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const day = () => new Date().toLocaleDateString("sv-SE"); // local YYYY-MM-DD
  // only touch text that changed: RoCreate's page watcher would otherwise see our own update
  const setText = (el, t) => { if (el && el.textContent !== t) el.textContent = t; };

  /* ---- CSV ---- */
  function cell(v) {
    let s = v == null ? "" : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // stop spreadsheets reading a name as a formula
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function download(name, header, rows) {
    const text = "﻿" + [header, ...rows].map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
    a.download = name;
    document.body.append(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
  }

  /* ---- paging with polite pacing ---- */
  async function pageAll(baseUrl, { since = 0, max = 10000, onProgress, signal }) {
    const out = [];
    let cursor = "", waits = 0;
    while (out.length < max) {
      if (signal.aborted) throw new Error("cancelled");
      const url = baseUrl + (baseUrl.includes("?") ? "&" : "?") + "limit=100" + (cursor ? "&cursor=" + encodeURIComponent(cursor) : "");
      const res = await fetch(url, { credentials: "include", signal });
      if (res.status === 429) {
        if (++waits > 6) throw new Error("Roblox kept rate limiting; try again in a few minutes.");
        for (let s = 20; s > 0; s--) { if (signal.aborted) throw new Error("cancelled"); onProgress(out.length, `Roblox asked to slow down, continuing in ${s} s`); await sleep(1000); }
        continue;
      }
      if (!res.ok) throw new Error(res.status === 403 ? "You don't have permission to read this." : "Roblox answered " + res.status + ".");
      const j = await res.json();
      let stop = false;
      for (const row of j.data || []) {
        if (since && row.created && Date.parse(row.created) < since) { stop = true; break; }
        out.push(row);
      }
      onProgress(out.length);
      cursor = j.nextPageCursor;
      if (stop || !cursor) break;
      await sleep(1100);
    }
    return out.slice(0, max);
  }

  function txRows(list) {
    return list.map((t) => [
      t.created ? new Date(t.created).toISOString() : "",
      t.transactionType || "",
      t.isPending ? "yes" : "no",
      t.currency?.amount ?? "",
      t.details?.name ?? "",
      t.details?.type ?? "",
      t.details?.id ?? "",
      t.agent?.name ?? "",
      t.agent?.type ?? "",
      t.agent?.id ?? "",
    ]);
  }
  const TX_HEADER = ["Date (UTC)", "Type", "Pending", "Robux", "Item", "Item type", "Item ID", "Other party", "Other party type", "Other party ID"];

  function startJob(button, label, run) {
    if (job) { job.controller.abort(); return; }
    const controller = new AbortController();
    job = { controller };
    const note = button.parentElement.querySelector(".rc-money-note");
    button.textContent = "Cancel";
    button.classList.add("rc-busy");
    const progress = (n, msg) => setText(note, msg || `${n.toLocaleString("en-US")} rows so far…`);
    progress(0, "Starting…");
    run(controller.signal, progress)
      .then((count) => { if (note) note.textContent = count ? `Saved ${count.toLocaleString("en-US")} rows.` : "Nothing in that period."; })
      .catch((e) => { if (note) note.textContent = e.message === "cancelled" || e.name === "AbortError" ? "Cancelled." : e.message; })
      .finally(() => { job = null; button.textContent = label; button.classList.remove("rc-busy"); });
  }

  /* ---- My transactions ---- */
  const PERIODS = { 30: "Past 30 days", 90: "Past 90 days", 365: "Past year", 0: "Everything (up to 10,000 rows)" };
  const TYPES = { Sale: "Sales", Purchase: "Purchases", GroupPayout: "Community payouts", CurrencyPurchase: "Robux purchases" };

  function summary() {
    const rows = [...document.querySelectorAll("#transactions-web-app .summary tr")];
    let earned = 0, found = false, incoming = true;
    for (const tr of rows) {
      const label = tr.querySelector(".summary-transaction-label")?.textContent.trim() || "";
      if (tr.querySelector(".outgoing-robux-label")) incoming = false;
      if (!label || !incoming) continue;
      if (EARNED.some((e) => label.startsWith(e))) { earned += num(tr.querySelector(".amount-display")?.textContent); found = true; }
    }
    const balance = num(document.querySelector("#transactions-web-app .balance-label")?.textContent);
    return { earned, found, balance };
  }

  function txCard() {
    const card = document.createElement("section");
    card.id = "rc-money";
    card.className = "rc-ext";
    card.innerHTML = `
      <div class="rc-money-col">
        <div class="rc-money-eyebrow">DevEx estimate</div>
        <div class="rc-money-big" data-k="usd">$0.00</div>
        <div class="rc-money-sub" data-k="earned">Earned in the selected period</div>
        <div class="rc-money-bar" role="progressbar" aria-valuemin="0" aria-valuemax="${DEVEX_MIN}"><i></i></div>
        <div class="rc-money-sub" data-k="min"></div>
        <a class="rc-money-link" href="https://create.roblox.com/dashboard/devex" target="_blank" rel="noopener">Open the DevEx portal</a>
      </div>
      <div class="rc-money-col">
        <div class="rc-money-eyebrow">Export to CSV</div>
        <div class="rc-money-row">
          <label>Type <select data-k="type">${Object.entries(TYPES).map(([v, t]) => `<option value="${v}">${t}</option>`).join("")}</select></label>
          <label>Period <select data-k="period">${Object.entries(PERIODS).map(([v, t]) => `<option value="${v}"${v === "90" ? " selected" : ""}>${t}</option>`).join("")}</select></label>
        </div>
        <div class="rc-money-row"><button type="button" class="rc-money-btn" data-k="export">Download CSV</button><span class="rc-money-note" aria-live="polite">Built on your device from Roblox's own records.</span></div>
      </div>`;
    card.querySelector('[data-k="export"]').addEventListener("click", (e) => {
      const type = card.querySelector('[data-k="type"]').value, days = +card.querySelector('[data-k="period"]').value;
      startJob(e.currentTarget, "Download CSV", async (signal, progress) => {
        const list = await pageAll(`https://economy.roblox.com/v2/users/${uid()}/transactions?transactionType=${type}`, { since: days ? Date.now() - days * 864e5 : 0, signal, onProgress: progress });
        if (list.length) download(`rocreate-${TYPES[type].toLowerCase().replace(/\s+/g, "-")}-${day()}.csv`, TX_HEADER, txRows(list));
        return list.length;
      });
    });
    return card;
  }

  function paintDevex(card) {
    const s = summary();
    setText(card.querySelector('[data-k="usd"]'), s.found ? "≈ " + usd(s.earned * DEVEX_RATE) : "No earnings shown");
    setText(card.querySelector('[data-k="earned"]'), s.found ? `${robux(s.earned)} earned in the period selected above, at $${DEVEX_RATE} per Robux` : "Pick the Summary view above to see earned Robux");
    const pct = Math.min(1, s.balance / DEVEX_MIN);
    card.querySelector(".rc-money-bar i").style.width = (pct * 100).toFixed(1) + "%";
    card.querySelector(".rc-money-bar").setAttribute("aria-valuenow", String(Math.min(s.balance, DEVEX_MIN)));
    setText(card.querySelector('[data-k="min"]'), s.balance >= DEVEX_MIN
      ? `Your balance passes the ${robux(DEVEX_MIN)} cash-out minimum. Only earned Robux count; the DevEx portal shows the exact amount.`
      : `${robux(Math.max(0, DEVEX_MIN - s.balance))} to go until the ${robux(DEVEX_MIN)} cash-out minimum (counting your whole balance).`);
  }

  function syncTransactions() {
    const host = document.querySelector("#transactions-web-app .user-transactions-container");
    const old = document.getElementById("rc-money");
    if (!host || !on()) { old?.remove(); return; }
    let card = old;
    if (!card || !host.contains(card)) {
      card?.remove();
      card = txCard();
      const anchor = host.querySelector(":scope > .summary, :scope > .transactions-table, :scope > table") || null;
      host.insertBefore(card, anchor);
    }
    paintDevex(card);
  }

  /* ---- Community admin ---- */
  const AUDIT_HEADER = ["Date (UTC)", "User", "User ID", "Role", "Action", "Details"];
  function auditRows(list) {
    return list.map((r) => [
      r.created ? new Date(r.created).toISOString() : "",
      r.actor?.user?.username ?? "",
      r.actor?.user?.userId ?? "",
      r.actor?.role?.name ?? "",
      r.actionType ?? "",
      r.description && typeof r.description === "object" ? Object.entries(r.description).map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`).join("; ") : r.description ?? "",
    ]);
  }
  function groupBar(kind, gid) {
    const bar = document.createElement("div");
    bar.id = "rc-money-group";
    bar.className = "rc-ext";
    bar.dataset.kind = kind;
    const what = kind === "audit" ? "audit log" : "community sales";
    bar.innerHTML = `<div class="rc-money-eyebrow">Export ${what}</div>
      <div class="rc-money-row">
        <label>Period <select data-k="period">${Object.entries(PERIODS).map(([v, t]) => `<option value="${v}"${v === "90" ? " selected" : ""}>${t}</option>`).join("")}</select></label>
        <button type="button" class="rc-money-btn" data-k="export">Download CSV</button>
        <span class="rc-money-note" aria-live="polite">Needs the matching permission in this community.</span>
      </div>`;
    bar.querySelector('[data-k="export"]').addEventListener("click", (e) => {
      const days = +bar.querySelector('[data-k="period"]').value;
      startJob(e.currentTarget, "Download CSV", async (signal, progress) => {
        const url = kind === "audit"
          ? `https://groups.roblox.com/v1/groups/${gid}/audit-log?sortOrder=Desc`
          : `https://economy.roblox.com/v2/groups/${gid}/transactions?transactionType=Sale`;
        const list = await pageAll(url, { since: days ? Date.now() - days * 864e5 : 0, signal, onProgress: progress });
        if (list.length) download(`rocreate-community-${gid}-${kind === "audit" ? "audit-log" : "sales"}-${day()}.csv`, kind === "audit" ? AUDIT_HEADER : TX_HEADER, kind === "audit" ? auditRows(list) : txRows(list));
        return list.length;
      });
    });
    return bar;
  }
  function syncGroupAdmin() {
    const old = document.getElementById("rc-money-group");
    const gid = new URLSearchParams(location.search).get("id");
    const tab = (location.hash.match(/#!\/([^/?]+)/) || [])[1] || "";
    const kind = /^auditlog$/i.test(tab) ? "audit" : /^revenue$/i.test(tab) ? "sales" : "";
    const host = document.querySelector("#configure-group-web-app .tab-content-group");
    if (!kind || !gid || !host || !on() || !/^\/(communities|groups)\/configure/.test(location.pathname)) { old?.remove(); return; }
    if (old && old.dataset.kind === kind && host.contains(old)) return;
    old?.remove();
    host.prepend(groupBar(kind, gid));
  }

  const on = () => prefs.enabled !== false && prefs.moneyTools !== false && rcAlive();
  function sync() {
    if (/^\/transactions/.test(location.pathname)) syncTransactions();
    else if (/\/configure/.test(location.pathname)) syncGroupAdmin();
  }

  const load = () => chrome.storage.sync.get({ enabled: true, moneyTools: true }, (s) => { if (!chrome.runtime.lastError) { prefs = s; sync(); } });
  load();
  chrome.storage.onChanged.addListener((changes, area) => { if (area === "sync" && rcAlive()) load(); });
  addEventListener("hashchange", sync);
  const start = () => rcWatch(sync, { text: true });
  if (document.body) start(); else addEventListener("DOMContentLoaded", start, { once: true });
})();
