/* Trader tools on the Marketplace. Collectible cards get Rolimons' value and RAP, a deal
   percentage against the price already on the card, and flags (projected, hyped, rare). A bar
   over the results sorts by best deal and hides projected or overpriced items. Item pages get
   the same facts next to Best Price. Prices come from the page itself, so this adds no Roblox
   requests; Rolimons is asked once for its public item list (cached 10 minutes). */
(() => {
  if (location.hostname !== "www.roblox.com") return;
  let prefs = { enabled: true, traders: true, tradeSort: "default", hideProjected: false, belowValue: false };
  const data = new Map(); // id -> facts, or null when Rolimons doesn't list it
  const asked = new Set();
  let timer = 0;

  const short = (v, d) => (v / d).toFixed(1).replace(/\.0$/, "");
  const fmt = (n) => (n >= 1e9 ? short(n, 1e9) + "B" : n >= 1e6 ? short(n, 1e6) + "M" : n >= 1e4 ? Math.round(n / 1e3) + "K" : n >= 1e3 ? short(n, 1e3) + "K" : String(n));
  const num = (t) => { const m = String(t || "").replace(/,/g, "").match(/\d+/); return m ? +m[0] : null; };
  const idOf = (href) => (String(href || "").match(/\/catalog\/(\d+)/) || [])[1];
  const on = () => prefs.enabled !== false && prefs.traders !== false && rcAlive();
  const DEMAND = ["Terrible", "Low", "Normal", "High", "Amazing"];
  const TREND = ["Lowering", "Unstable", "Stable", "Raising", "Fluctuating"];
  const worth = (f) => (f.value > 0 ? f.value : f.rap > 0 ? f.rap : 0);
  const deal = (f, price) => (price && worth(f) ? (worth(f) - price) / worth(f) : null);

  function ask(ids) {
    const fresh = ids.filter((id) => !asked.has(id));
    if (!fresh.length) return;
    fresh.forEach((id) => asked.add(id));
    chrome.runtime.sendMessage({ type: "rcx-items", ids: fresh }, (res) => {
      if (chrome.runtime.lastError || !res) return;
      for (const id of fresh) data.set(id, res[id] || null);
      paint();
    });
  }

  const flags = (f) => [f.projected && '<b class="rcm-flag rcm-proj" title="Projected: the RAP is inflated, so the value is unreliable">P</b>', f.hyped && '<b class="rcm-flag rcm-hyped" title="Hyped">H</b>', f.rare && '<b class="rcm-flag rcm-rare" title="Rare">R</b>'].filter(Boolean).join("");
  function dealHtml(d) {
    if (d == null) return "";
    const pct = Math.round(d * 100);
    return `<span class="rcm-deal ${pct >= 5 ? "rcm-good" : pct <= -5 ? "rcm-bad" : ""}" title="Price compared with ${pct >= 0 ? "value" : "value"} (RAP when there is no value)">${pct > 0 ? pct + "% under" : pct < 0 ? -pct + "% over" : "at value"}</span>`;
  }

  /* ---- result cards ---- */
  function cards() {
    return [...document.querySelectorAll(".catalog-item-container")].map((c) => {
      const a = c.querySelector("a.item-card-link[href*='/catalog/']");
      const id = a && idOf(a.getAttribute("href"));
      return id ? { c, id, price: num(c.querySelector(".item-card-price")?.textContent) } : null;
    }).filter(Boolean);
  }
  function paintCards() {
    const list = cards();
    ask(list.map((x) => x.id));
    for (const { c, id, price } of list) {
      const f = data.get(id);
      let tag = c.querySelector(".rcm-tag");
      if (!f || !on()) { tag?.remove(); c.classList.remove("rcm-hide"); c.style.order = ""; continue; }
      const d = deal(f, price);
      const html = `<span class="rcm-val">${f.value > 0 ? "Value " + fmt(f.value) : "RAP " + fmt(f.rap)}</span>${f.value > 0 && f.rap > 0 ? `<span class="rcm-rap">RAP ${fmt(f.rap)}</span>` : ""}${dealHtml(d)}${flags(f)}`;
      if (!tag) { tag = document.createElement("div"); tag.className = "rcm-tag rc-ext"; (c.querySelector(".item-card-caption") || c).append(tag); }
      if (tag.innerHTML !== html) tag.innerHTML = html;
      c.dataset.rcmDeal = d == null ? "" : String(d);
      c.classList.toggle("rcm-hide", (prefs.hideProjected && f.projected) || (prefs.belowValue && !(d > 0)));
    }
    // best deals first: order every card by its deal (cards without one go last)
    if (on() && prefs.tradeSort === "deal") {
      const ranked = list.map((x) => [x.c, x.c.dataset.rcmDeal === "" || x.c.dataset.rcmDeal == null ? -Infinity : +x.c.dataset.rcmDeal]).sort((a, b) => b[1] - a[1]);
      ranked.forEach(([c], i) => { const o = String(i); if (c.style.order !== o) c.style.order = o; });
      // anything that isn't a listed collectible (bundles, unknown items) goes after them
      for (const c of document.querySelectorAll(".catalog-item-container")) if (!list.some((x) => x.c === c) && c.style.order !== "99999") c.style.order = "99999";
    } else for (const c of document.querySelectorAll(".catalog-item-container")) if (c.style.order) c.style.order = "";
    paintBar(list);
  }
  function paintBar(list) {
    const host = document.querySelector("#react-items-container, .catalog-results");
    let bar = document.getElementById("rcm-bar");
    const any = list.some((x) => data.get(x.id));
    if (!host || !on() || !any) { bar?.remove(); return; }
    if (!bar) {
      bar = document.createElement("div");
      bar.id = "rcm-bar";
      bar.className = "rc-ext";
      bar.innerHTML = `<span class="rcm-title">Trader tools</span>
        <button type="button" data-k="tradeSort">Best deals first</button>
        <button type="button" data-k="belowValue">Only under value</button>
        <button type="button" data-k="hideProjected">Hide projected</button>
        <a class="rcm-credit" href="https://www.rolimons.com/" target="_blank" rel="noopener">Values by Rolimons</a>`;
      bar.addEventListener("click", (e) => {
        const k = e.target.closest("button")?.dataset.k;
        if (!k) return;
        const next = k === "tradeSort" ? { tradeSort: prefs.tradeSort === "deal" ? "default" : "deal" } : { [k]: !prefs[k] };
        Object.assign(prefs, next);
        chrome.storage.sync.set(next);
        paintCards();
      });
      host.prepend(bar);
    }
    bar.querySelector('[data-k="tradeSort"]').classList.toggle("rcm-on", prefs.tradeSort === "deal");
    bar.querySelector('[data-k="belowValue"]').classList.toggle("rcm-on", !!prefs.belowValue);
    bar.querySelector('[data-k="hideProjected"]').classList.toggle("rcm-on", !!prefs.hideProjected);
  }

  /* ---- item page ---- */
  function paintItem() {
    const id = idOf(location.pathname);
    const box = document.getElementById("rcm-item");
    if (!id || !on()) { box?.remove(); return; }
    ask([id]);
    const f = data.get(id);
    const label = document.querySelector("#item-details-container .price-label") || [...document.querySelectorAll("#item-details-container .row-label")].find((e) => /price/i.test(e.textContent));
    const row = label?.closest(".item-info-row-container");
    if (!f || !row) { box?.remove(); return; }
    const price = num(row.querySelector(".text-robux-lg, .item-price-value")?.textContent);
    const html = `<span class="rcm-val">Value ${f.value > 0 ? fmt(f.value) : "none"}</span><span class="rcm-rap">RAP ${fmt(f.rap)}</span>${dealHtml(deal(f, price))}${f.demand >= 0 ? `<span class="rcm-rap">Demand ${DEMAND[f.demand] || "?"}</span>` : ""}${f.trend >= 0 ? `<span class="rcm-rap">Trend ${TREND[f.trend] || "?"}</span>` : ""}${flags(f)}<a class="rcm-credit" href="https://www.rolimons.com/item/${id}" target="_blank" rel="noopener">Rolimons</a>`;
    let el = box;
    if (!el) { el = document.createElement("div"); el.id = "rcm-item"; el.className = "rcm-tag rc-ext"; }
    if (el.innerHTML !== html) el.innerHTML = html;
    if (el.previousElementSibling !== row) row.after(el);
  }

  function paint() {
    if (/^\/catalog\/\d+/.test(location.pathname)) paintItem();
    else if (/^\/catalog\/?$/.test(location.pathname)) paintCards();
  }
  const queue = () => { clearTimeout(timer); timer = setTimeout(paint, 150); };
  const load = () => chrome.storage.sync.get({ enabled: true, traders: true, tradeSort: "default", hideProjected: false, belowValue: false }, (s) => { if (!chrome.runtime.lastError) { prefs = s; paint(); } });
  const start = () => { load(); rcWatch((records) => { if (!records.every((r) => r.target.closest?.(".rcm-tag, #rcm-bar"))) queue(); }); };
  if (document.body) start(); else addEventListener("DOMContentLoaded", start, { once: true });
  chrome.storage.onChanged.addListener((changes, area) => { if (area === "sync" && rcAlive()) load(); });
})();
