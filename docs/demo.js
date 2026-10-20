/* The live demo on rocreate.org: a scripted browser window that plays RoCreate's features
   like a trailer, built from HTML and CSS (no video, no outside files). All names and
   numbers are example data. It pauses when off screen or hidden. With reduced motion it still
   steps through the scenes, but every change is instant (no sliding, fading or counting). */
(() => {
  const stage = document.getElementById("demo");
  if (!stage) return;
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const mac = /Mac|iPhone|iPad/.test(navigator.platform);
  const KEY = mac ? "⌘" : "Ctrl";
  const W = 1120;

  const GAMES = [
    { n: "Example Tycoon", l: "T", g: "#2563EB,#7C3AED", rev: 1.2e6, vis: "184M", play: 12.8e3 },
    { n: "Obby Rush", l: "O", g: "#16A34A,#0D9488", rev: 6.4e5, vis: "92M", play: 4.1e3 },
    { n: "Pet Valley", l: "P", g: "#DB2777,#F97316", rev: 2.9e6, vis: "410M", play: 31.2e3 },
    { n: "Speed Racers", l: "S", g: "#0EA5E9,#22D3EE", rev: 3.1e5, vis: "38M", play: 1.9e3 },
    { n: "Castle Defense", l: "C", g: "#F59E0B,#EF4444", rev: 4.1e6, vis: "655M", play: 48.6e3 },
    { n: "Ocean Quest", l: "Q", g: "#06B6D4,#3B82F6", rev: 9.5e4, vis: "12M", play: 640 },
    { n: "Mega Mansion", l: "M", g: "#8B5CF6,#EC4899", rev: 1.8e6, vis: "260M", play: 20.4e3 },
    { n: "Space Miners", l: "X", g: "#64748B,#0EA5E9", rev: 7.7e5, vis: "71M", play: 5.6e3 },
    { n: "Sword Legends", l: "L", g: "#B91C1C,#F59E0B", rev: 2.2e6, vis: "318M", play: 25.1e3 },
    { n: "Farm Life", l: "F", g: "#65A30D,#16A34A", rev: 4.6e5, vis: "54M", play: 3.2e3 },
    { n: "Zombie Run", l: "Z", g: "#334155,#65A30D", rev: 1.4e6, vis: "202M", play: 15.7e3 },
    { n: "Sky Islands", l: "I", g: "#38BDF8,#A78BFA", rev: 2.6e5, vis: "29M", play: 1.2e3 },
  ];
  const grad = (g) => `background:linear-gradient(135deg,${g})`;
  const k = (n) => (n >= 1e9 ? (n / 1e9).toFixed(1) + "B" : n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n >= 1e3 ? (n / 1e3).toFixed(1) + "K" : String(Math.round(n)));
  const comma = (n) => Math.round(n).toLocaleString("en-US");

  /* ---------- shell ---------- */
  stage.innerHTML = `<div class="demo" role="img" aria-label="An animated example of RoCreate on roblox.com, with example data">
    <div class="d-chrome"><div class="d-dots"><i></i><i></i><i></i></div>
      <div class="d-url"><svg width="12" height="12" viewBox="0 0 24 24"><rect x="5" y="10" width="14" height="10" rx="2" fill="none" stroke="#a3a7b0" stroke-width="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3" fill="none" stroke="#a3a7b0" stroke-width="2"/></svg><span><b>roblox.com</b><span class="d-path"></span></span></div>
      <span class="d-badge">Example data</span>
      <span class="d-ext" title="RoCreate"><svg width="20" height="20" viewBox="0 0 24 24"><rect x="2" y="2" width="20" height="20" rx="6" fill="#fff"/><rect x="9" y="9" width="6" height="6" rx="1.5" fill="#0b0c0e" transform="rotate(14 12 12)"/></svg></span>
    </div>
    <div class="d-screen"><div class="d-caption"><i></i><span></span></div></div>
    <div class="d-cursor"><svg width="22" height="22" viewBox="0 0 24 24"><path d="M4 2l15 10-7 1.5L8.5 21z" fill="#fff" stroke="#0b0c0e" stroke-width="1.5" stroke-linejoin="round"/></svg><span class="d-ring"></span></div></div>`;
  const demo = stage.firstElementChild;
  const screen = demo.querySelector(".d-screen");
  const caption = demo.querySelector(".d-caption");
  const cursorBox = demo.querySelector(".d-cursor");

  let scale = 1;
  const fit = () => { scale = stage.clientWidth / W; demo.style.transform = `scale(${scale})`; };
  new ResizeObserver(fit).observe(stage);
  fit();

  const top = (rbx = "48.2K") => `<div class="d-top"><div class="d-logo"><span></span>ROCREATE</div>
    <div class="d-nav"><span>Games</span><span>Marketplace</span><span>Create</span><span>Robux</span></div>
    <div class="d-search"><svg width="13" height="13" viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5" fill="none" stroke="#8b9099" stroke-width="2"/><path d="M16 16l4 4" stroke="#8b9099" stroke-width="2" stroke-linecap="round"/></svg>Search<kbd>${KEY} K</kbd></div>
    <div class="d-right"><span class="d-rbx"><i class="d-hex"></i>${rbx}</span><span class="d-ava"></span></div></div>`;
  const cards = (list, pills) => list.map((g, i) => `<div class="d-card" data-rev="${g.rev}" data-i="${i}"><div class="d-th" style="${grad(g.g)}">${g.l}${pills ? `<span class="d-pill top">R$ ${k(g.rev)}</span><span class="d-pill second">${g.vis}</span>` : ""}</div><b>${g.n}</b><small>${k(g.play)} playing</small></div>`).join("");

  /* ---------- timing ---------- */
  let token = 0, paused = false, offscreen = false, current = 0;
  const blocked = () => paused || offscreen || document.hidden;
  const wait = (ms, t) => new Promise((done, fail) => {
    let left = ms, last = performance.now();
    const tick = () => {
      if (t !== token) return fail(new Error("stop"));
      const now = performance.now();
      if (!blocked()) left -= now - last;
      last = now;
      if (left <= 0) return done();
      setTimeout(tick, Math.min(60, Math.max(16, left)));
    };
    tick();
  });
  const show = (el, cls = "on") => el && el.classList.add(cls);
  // centre of an element, in the unscaled coordinates of `box` (the screen or the whole window)
  function at(el, box = screen) {
    const s = box.getBoundingClientRect(), r = el.getBoundingClientRect();
    return [(r.left - s.left + r.width / 2) / scale, (r.top - s.top + r.height / 2) / scale];
  }
  async function moveTo(el, t, dx = 0, dy = 0) {
    const [x, y] = at(el, demo);
    cursorBox.classList.add("on");
    cursorBox.style.transform = `translate(${x + dx}px, ${y + dy}px)`;
    await wait(780, t);
  }
  async function click(t) {
    cursorBox.classList.remove("click");
    void cursorBox.offsetWidth;
    cursorBox.classList.add("click");
    await wait(260, t);
  }
  function count(el, to, format, ms, t) {
    if (reduce) { el.textContent = format(to); return; }
    const start = performance.now();
    const step = (now) => {
      if (t !== token) return;
      const p = Math.min(1, (now - start) / ms), e = 1 - Math.pow(1 - p, 3);
      el.textContent = format(to * e);
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
  function chart(svg, points, color, w, h) {
    const lo = Math.min(...points), hi = Math.max(...points);
    const X = (i) => (i / (points.length - 1)) * w, Y = (v) => h - 4 - ((v - lo) / Math.max(1, hi - lo)) * (h - 10);
    const d = points.map((v, i) => (i ? "L" : "M") + X(i).toFixed(1) + " " + Y(v).toFixed(1)).join(" ");
    const id = "g" + Math.random().toString(36).slice(2, 7);
    svg.innerHTML = `<defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity=".28"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs><path class="d-area" d="${d} L${w} ${h} L0 ${h} Z" fill="url(#${id})"/><path class="d-line" d="${d}" stroke="${color}"/>`;
    const line = svg.querySelector(".d-line");
    line.style.setProperty("--len", Math.ceil(line.getTotalLength()) + 1);
    return () => { line.getBoundingClientRect(); line.classList.add("draw"); svg.querySelector(".d-area").classList.add("draw"); };
  }
  const wave = (n, base, amp, seed) => Array.from({ length: n }, (_, i) => base + amp * (Math.sin(i / 2.6 + seed) * 0.6 + Math.sin(i / 1.3 + seed * 2) * 0.25 + i / n * 0.5));

  /* ---------- scenes ---------- */
  const SCENES = [
    {
      id: "look", label: "The look", url: "/home", cap: "<b>The Creator Hub look</b> on every Roblox page", dur: 5950,
      html: () => `<div class="d-before"><div class="b-top"><span class="b-logo"></span><span>Charts</span><span>Marketplace</span><span>Create</span><span class="b-search"></span></div>
        <div class="b-side"><span>Home</span><span>Profile</span><span>Messages</span><span>Friends</span><span>Avatar</span><span>Inventory</span><span>Trade</span><span>Communities</span></div>
        <div class="b-main"><div class="b-h">Home</div><div class="b-row">${GAMES.slice(0, 5).map((g) => `<div class="b-card"><div class="b-th" style="${grad(g.g)}"></div>${g.n}</div>`).join("")}</div>
        <div class="b-h">Continue</div><div class="b-row">${GAMES.slice(5, 10).map((g) => `<div class="b-card"><div class="b-th" style="${grad(g.g)}"></div>${g.n}</div>`).join("")}</div><span class="b-btn">Play</span></div><span class="d-tag before">Before</span></div>
        <div class="d-after">${top()}<div class="d-page"><div class="d-h1">Good evening, Example!</div>
          <div class="d-panel" style="margin-bottom:14px"><div style="font-weight:800;color:#fff;margin-bottom:10px">Favorites</div><div class="d-grid">${cards(GAMES.slice(0, 6), true).replace(/d-pill /g, "d-pill on ")}</div></div>
          <div class="d-panel"><div style="font-weight:800;color:#fff;margin-bottom:10px">Continue</div><div class="d-grid">${cards(GAMES.slice(6, 12), true).replace(/d-pill /g, "d-pill on ")}</div></div></div>
          <span class="d-tag after">RoCreate</span></div>
        <div class="d-wipe"></div>`,
      async run(t, s) {
        await wait(1500, t);
        show(s.querySelector(".d-after"), "show");
        show(s.querySelector(".d-wipe"), "go");
        await wait(4200, t);
      },
    },
    {
      id: "stats", label: "Game stats", url: "/charts", cap: "<b>Revenue and visits</b> on every game card", dur: 8400,
      html: () => `${top()}<div class="d-page"><div class="d-h1">Games</div>
        <div class="d-sort"><span class="on">Default</span><span data-k="rev">Revenue</span><span>Visits</span><span>Rising</span><span>Players</span><span>Per player</span></div>
        <div class="d-grid">${cards(GAMES, true)}</div>
        <div class="d-hover"><div class="d-htitle">Castle Defense</div><div class="d-facts"><span>Est. revenue<b>R$ 4.1M</b></span><span>Visits<b>655M</b></span><span>Playing<b>48.6K</b></span></div><small class="d-muted" style="font-size:11px">Players, last 7 days</small><svg width="268" height="56"></svg></div></div>`,
      async run(t, s) {
        const pills = [...s.querySelectorAll(".d-pill")];
        await wait(700, t);
        for (let i = 0; i < pills.length; i += 2) { show(pills[i]); show(pills[i + 1]); await wait(70, t); }
        await wait(700, t);
        const btn = s.querySelector('[data-k="rev"]');
        await moveTo(btn, t);
        await click(t);
        s.querySelector(".d-sort .on").classList.remove("on");
        btn.classList.add("on");
        const grid = s.querySelector(".d-grid");
        const list = [...grid.children], first = new Map(list.map((c) => [c, c.getBoundingClientRect()]));
        list.sort((a, b) => b.dataset.rev - a.dataset.rev).forEach((c) => grid.append(c));
        for (const c of list) { const a = first.get(c), b = c.getBoundingClientRect(); c.style.transition = "none"; c.style.transform = `translate(${(a.left - b.left) / scale}px, ${(a.top - b.top) / scale}px)`; }
        void grid.offsetWidth;
        for (const c of list) { c.style.transition = ""; c.style.transform = ""; }
        await wait(1300, t);
        const lead = grid.firstElementChild;
        await moveTo(lead.querySelector(".d-pill"), t);
        const hover = s.querySelector(".d-hover");
        const [x, y] = at(lead);
        hover.style.left = x + 70 + "px";
        hover.style.top = y - 70 + "px";
        const draw = chart(hover.querySelector("svg"), wave(28, 30, 18, 1), "#4ef0d1", 268, 56);
        show(hover);
        lead.style.borderColor = "rgba(255,255,255,.2)";
        draw();
        await wait(2600, t);
      },
    },
    {
      id: "jump", label: "Quick jump", url: "/charts", cap: `<b>${KEY} K</b>: jump anywhere, search everything`, dur: 6900,
      html: () => `${top()}<div class="d-page"><div class="d-h1">Games</div><div class="d-grid">${cards(GAMES.slice().sort((a, b) => b.rev - a.rev), false)}</div></div>
        <div class="d-dim"></div><div class="d-keys"><kbd>${KEY}</kbd><kbd>K</kbd></div>
        <div class="d-jump"><div class="j-field"><svg width="18" height="18" viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5" fill="none" stroke="#94A3B8" stroke-width="2"/><path d="M16 16l4 4" stroke="#94A3B8" stroke-width="2" stroke-linecap="round"/></svg><span class="j-text"></span><i class="j-caret"></i></div>
          <div class="j-list">
            <div class="j-head">Go to</div>
            <div class="j-row"><span class="j-ico" style="color:#60A5FA">▣</span><span><b>Example Tycoon</b><small>Your experience</small></span></div>
            <div class="j-row"><span class="j-ico" style="color:#38BDF8">⬡</span><span><b>Creator Hub: Example Tycoon</b><small>Manage, analytics and monetization</small></span></div>
            <div class="j-head">Experiences</div>
            <div class="j-row"><span class="j-ico" style="color:#60A5FA">▣</span><span><b>Tycoon Empire</b><small>Example Games · 3.1K playing</small></span></div>
            <div class="j-head">People</div>
            <div class="j-row"><span class="j-ico" style="color:#A78BFA">●</span><span><b>Tycoon Builder</b><small>@tycoonbuilder</small></span></div>
            <div class="j-head">Marketplace</div>
            <div class="j-row"><span class="j-ico" style="color:#F472B6">◆</span><span><b>Tycoon Hat</b><small>Item · Example Studio · R$ 75</small></span></div>
          </div></div>`,
      async run(t, s) {
        await wait(700, t);
        const keys = s.querySelector(".d-keys");
        show(s.querySelector(".d-dim"));
        show(keys);
        await wait(350, t);
        for (const kb of keys.children) kb.classList.add("press");
        await wait(380, t);
        keys.classList.remove("on");
        show(s.querySelector(".d-jump"));
        await wait(500, t);
        const text = s.querySelector(".j-text");
        for (const ch of "tycoon") { text.textContent += ch; await wait(110, t); }
        await wait(250, t);
        const parts = [...s.querySelectorAll(".j-head, .j-row")];
        for (const p of parts) { show(p, "show"); await wait(90, t); }
        const rows = [...s.querySelectorAll(".j-row")];
        rows[0].classList.add("sel");
        await wait(900, t);
        for (let i = 1; i < 3; i++) { rows[i - 1].classList.remove("sel"); rows[i].classList.add("sel"); await wait(500, t); }
        rows[2].classList.remove("sel"); rows[1].classList.remove("sel"); rows[0].classList.add("sel");
        await wait(900, t);
      },
    },
    {
      id: "game", label: "Game pages", url: "/games/1011/Example-Tycoon", cap: "<b>A stats strip</b> with revenue, players and a 7-day chart", dur: 6370,
      html: () => `${top()}<div class="d-page"><div class="d-game"><div class="d-hero" style="${grad(GAMES[0].g)}">T</div>
        <div class="d-gtitle"><div class="d-gname">Example Tycoon</div><span class="d-muted">By Example Studio</span><div class="d-play"></div>
          <div style="display:flex;gap:18px;margin-top:14px;font-size:12px" class="d-muted"><span>♥ 212K</span><span>▲ 91%</span><span>👥 12.8K</span></div></div></div>
        <div class="d-panel"><div class="d-tiles">
          <div class="d-tile"><span>Est. revenue</span><b data-to="1200000" data-f="rk">R$ 0</b><small>+9% trend</small></div>
          <div class="d-tile"><span>Playing</span><b data-to="12840" data-f="k">0</b><small>+14% this week</small></div>
          <div class="d-tile"><span>Per player</span><b data-to="94" data-f="r">R$ 0</b><small>right now</small></div>
          <div class="d-tile"><span>Visits</span><b data-to="184000000" data-f="k">0</b><small>+3% this week</small></div>
          <div class="d-tile"><span>Rating</span><b data-to="91" data-f="p">0%</b><small>212K favorites</small></div>
          <div class="d-tile"><span>Global rank</span><b data-to="212" data-f="n">#0</b><small>Rising</small></div></div>
          <div class="d-chart"><small>Players, last 7 days <b style="color:#34D399">+14%</b></small><svg width="1000" height="96"></svg></div></div></div>`,
      async run(t, s) {
        const F = { rk: (v) => "R$ " + k(v), k: (v) => k(v), r: (v) => "R$ " + Math.round(v), p: (v) => Math.round(v) + "%", n: (v) => "#" + Math.round(v) };
        await wait(600, t);
        for (const tile of s.querySelectorAll(".d-tile")) {
          show(tile);
          const b = tile.querySelector("b");
          count(b, +b.dataset.to, F[b.dataset.f], 1100, t);
          await wait(120, t);
        }
        const draw = chart(s.querySelector(".d-chart svg"), wave(42, 9000, 4200, 2), "#34D399", 1000, 96);
        await wait(300, t);
        draw();
        await wait(4400, t);
      },
    },
    {
      id: "mine", label: "Your experiences", url: "/home", cap: "<b>Your experiences</b>, live on Home", dur: 6380,
      html: () => {
        const rows = [["Example Tycoon", "You", "T", GAMES[0].g, 1284, "18.4M", "91%", "212K", 1], ["Obby Rush", "Example Studio", "O", GAMES[1].g, 436, "6.2M", "84%", "88K", 2], ["Mega Mansion", "Example Studio", "M", GAMES[6].g, 97, "2.1M", "75%", "31K", 3]];
        return `${top()}<div class="d-page"><div class="d-h1">Good evening, Example!</div><div class="d-panel">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px"><b style="color:#fff;font-size:17px">Your experiences</b><span class="d-muted" style="font-size:12px">⟳ Updated just now</span></div>
          <div class="d-kpis"><div class="d-kpi live"><span>Playing now</span><b data-to="1817">0</b></div><div class="d-kpi"><span>Visits</span><b data-to="27900000">0</b></div><div class="d-kpi"><span>Favorites</span><b data-to="347000">0</b></div><div class="d-kpi"><span>Experiences</span><b data-to="5">0</b></div></div>
          <div class="d-tr th"><span>Experience</span><span class="r">Playing</span><span>Last 2 h</span><span class="r">Visits</span><span class="r">Liked</span><span class="r">Favorites</span></div>
          ${rows.map((r) => `<div class="d-tr"><span class="nm"><i style="${grad(r[3])}">${r[2]}</i><span><b>${r[0]}</b><small>${r[1]}</small></span></span><span class="r"><i class="d-live"></i><b style="color:#fff">${comma(r[4])}</b></span><svg width="96" height="26" data-seed="${r[8]}"></svg><span class="r">${r[5]}</span><span class="r">${r[6]}</span><span class="r">${r[7]}</span></div>`).join("")}
          <div style="text-align:center;padding:12px 0 2px;font-size:12px" class="d-muted">Show 2 experiences with no players right now</div></div></div>`;
      },
      async run(t, s) {
        await wait(500, t);
        for (const b of s.querySelectorAll(".d-kpi b")) count(b, +b.dataset.to, (v) => (b.dataset.to > 99 ? k(v) : Math.round(v)), 1200, t);
        await wait(500, t);
        for (const row of s.querySelectorAll(".d-tr:not(.th)")) {
          show(row);
          const svg = row.querySelector("svg");
          chart(svg, wave(20, 50, 22, +svg.dataset.seed), "#34D399", 96, 26)();
          await wait(260, t);
        }
        await wait(4200, t);
      },
    },
    {
      id: "money", label: "Money tools", url: "/transactions", cap: "<b>DevEx estimate</b> and one-click CSV exports", dur: 7450,
      html: () => `${top()}<div class="d-page"><div class="d-h1">My Transactions</div>
        <div class="d-panel"><div class="d-money"><div class="col"><div class="d-eyebrow">DevEx estimate</div><div class="d-big" data-to="190.57">≈ $0.00</div>
          <div class="d-muted" style="font-size:13px">R$ 50,150 earned in the selected period, at $0.0038 per Robux</div><div class="d-bar"><i></i></div>
          <div class="d-muted" style="font-size:12.5px">Passes the R$ 30,000 cash-out minimum</div></div>
          <div class="col"><div class="d-eyebrow">Export to CSV</div><div><span class="d-select">Type<span>Sales</span></span><span class="d-select">Period<span>Past 90 days</span></span></div>
          <div style="display:flex;align-items:center;gap:12px"><span class="d-btn">Download CSV</span><span class="d-muted j-note" style="font-size:13px">Built on your device from Roblox's own records.</span></div></div></div></div>
        <div class="d-panel d-sum"><div><span>Sales of Goods</span><b>R$ 18,400</b></div><div><span>Creator Rewards</span><b>R$ 22,150</b></div><div><span>Community Payouts</span><b>R$ 9,600</b></div></div></div>
        <div class="d-toast"><i>✓</i><span><b style="color:#fff">rocreate-sales.csv</b><br><span class="d-muted">312 rows saved</span></span></div>`,
      async run(t, s) {
        await wait(500, t);
        const big = s.querySelector(".d-big");
        count(big, 190.57, (v) => "≈ $" + v.toFixed(2), 1300, t);
        s.querySelector(".d-bar i").style.width = "100%";
        await wait(1600, t);
        const btn = s.querySelector(".d-btn"), note = s.querySelector(".j-note");
        await moveTo(btn, t);
        await click(t);
        btn.textContent = "Cancel";
        btn.classList.add("busy");
        for (const n of [100, 200, 300]) { note.textContent = n + " rows so far…"; await wait(520, t); }
        btn.textContent = "Download CSV";
        btn.classList.remove("busy");
        note.textContent = "Saved 312 rows.";
        show(s.querySelector(".d-toast"));
        await wait(2400, t);
      },
    },
    {
      id: "profile", label: "Profiles", url: "/users/1/profile", cap: "<b>Rebuilt profiles</b> with their latest videos and streams", dur: 6000,
      html: () => `${top()}<div class="d-page"><div class="d-panel" style="margin-bottom:14px"><div class="d-prof"><div class="ava"></div><div><div class="d-pname">Example Creator</div><span class="d-muted">@examplecreator · Online</span>
          <div class="d-stats"><span><b>12.4K</b> followers</span><span><b>38</b> friends</span><span><b>6</b> experiences</span><span><b>R$ 1.4M</b> est. game revenue</span></div></div></div></div>
        <div class="d-panel"><b style="color:#fff;font-size:16px">Latest from them</b><div class="d-tabs"><span class="on">YouTube</span><span>Twitch</span><span>X</span></div>
          <div class="d-vids">${[["I built a tycoon in 24 hours", "2 days ago · 41K views", "#2563EB,#7C3AED", "18:42"], ["10 tycoon tricks nobody uses", "5 days ago · 22K views", "#F59E0B,#EF4444", "12:05"], ["Speedrunning my own obby", "1 week ago · 63K views", "#16A34A,#0D9488", "9:31"], ["Building with my fans, live", "2 weeks ago · 18K views", "#8B5CF6,#EC4899", "1:02:10"]].map((v) => `<div class="d-vid"><div class="t" style="${grad(v[2])}"><em>${v[3]}</em></div><b>${v[0]}</b><small>${v[1]}</small></div>`).join("")}</div></div></div>`,
      async run(t, s) {
        await wait(600, t);
        for (const v of s.querySelectorAll(".d-vid")) { show(v); await wait(180, t); }
        await moveTo(s.querySelector(".d-vid .t"), t);
        s.querySelector(".d-vid .t").style.boxShadow = "0 0 0 2px #fff";
        await wait(3600, t);
      },
    },
    {
      id: "streamer", label: "Streamer mode", url: "/transactions", cap: "<b>Streamer mode</b> blurs your Robux in one click", dur: 6650,
      html: () => `${top()}<div class="d-page"><div class="d-h1">My Transactions</div>
        <div class="d-panel d-sum"><div><span>Balance</span><b>R$ 48,250</b></div><div><span>Sales of Goods</span><b>R$ 18,400</b></div><div><span>Creator Rewards</span><b>R$ 22,150</b></div><div><span>Community Payouts</span><b>R$ 9,600</b></div><div><span>Pending Robux</span><b>R$ 1,240</b></div></div></div>
        <div class="d-menu"><div><span class="d-muted">Pending</span><b>R$ 1,240</b></div><div><span class="d-muted">Example Studio</span><b>R$ 12,950</b></div><div><span class="d-muted">Total</span><b>≈ $54 DevEx</b></div></div>
        <div class="d-popup"><div class="ph"><svg width="18" height="18" viewBox="0 0 24 24"><rect x="2" y="2" width="20" height="20" rx="6" fill="#fff"/><rect x="9" y="9" width="6" height="6" rx="1.5" fill="#0b0c0e" transform="rotate(14 12 12)"/></svg>RoCreate</div>
          <div class="d-sw"><span>Theme<small>Creator Hub reskin</small></span><i class="d-toggle on"></i></div>
          <div class="d-sw"><span>Workspace pages<small>Panels on every page</small></span><i class="d-toggle on"></i></div>
          <div class="d-sw"><span>Streamer mode<small>Blur your Robux</small></span><i class="d-toggle" data-k="streamer"></i></div>
          <div class="d-sw"><span>Quick jump<small>${KEY} K anywhere</small></span><i class="d-toggle on"></i></div></div>`,
      async run(t, s) {
        await wait(800, t);
        await moveTo(demo.querySelector(".d-ext"), t);
        await click(t);
        show(s.querySelector(".d-popup"));
        await wait(600, t);
        const sw = s.querySelector('[data-k="streamer"]');
        await moveTo(sw, t);
        await click(t);
        sw.classList.add("on");
        s.classList.add("d-streamer");
        await wait(2800, t);
      },
    },
  ];

  /* ---------- player ---------- */
  const layers = SCENES.map((sc) => {
    const el = document.createElement("div");
    el.className = "d-scene";
    el.dataset.scene = sc.id;
    screen.insertBefore(el, caption);
    return el;
  });
  const controls = document.getElementById("demo-controls");
  const chaps = SCENES.map((sc, i) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "demo-chap";
    b.innerHTML = `<span>${sc.label}</span><i class="fill"></i>`;
    b.addEventListener("click", () => { paused = false; go(i, true); });
    controls?.append(b);
    return b;
  });
  const playBtn = document.createElement("button");
  playBtn.type = "button";
  playBtn.className = "demo-play";
  const paint = () => {
    playBtn.innerHTML = paused ? '<svg width="12" height="12" viewBox="0 0 12 12"><path d="M2 1l9 5-9 5z" fill="currentColor"/></svg>' : '<svg width="12" height="12" viewBox="0 0 12 12"><rect x="2" y="1" width="3" height="10" fill="currentColor"/><rect x="7" y="1" width="3" height="10" fill="currentColor"/></svg>';
    playBtn.setAttribute("aria-label", paused ? "Play the demo" : "Pause the demo");
    for (const f of stage.parentElement.querySelectorAll(".fill")) f.style.animationPlayState = blocked() ? "paused" : "running";
  };
  playBtn.addEventListener("click", () => { paused = !paused; paint(); });
  controls?.prepend(playBtn);

  async function go(i, manual) {
    const t = ++token;
    current = i;
    const sc = SCENES[i], layer = layers[i];
    layer.innerHTML = sc.html();
    layer.className = "d-scene";
    layers.forEach((l, n) => l.classList.toggle("on", n === i));
    demo.querySelector(".d-path").textContent = sc.url;
    caption.classList.remove("on");
    caption.querySelector("span").innerHTML = sc.cap;
    cursorBox.classList.remove("on");
    chaps.forEach((c, n) => {
      c.classList.toggle("on", n === i);
      c.setAttribute("aria-pressed", n === i ? "true" : "false");
      const f = c.querySelector(".fill");
      f.style.animation = "none";
      void f.offsetWidth;
      f.style.animation = n === i ? `demo-fill ${sc.dur}ms linear forwards` : "";
    });
    paint();
    requestAnimationFrame(() => caption.classList.add("on"));
    try {
      await sc.run(t, layer);
      await wait(300, t);
      go((i + 1) % SCENES.length);
    } catch {}
  }

  const style = document.createElement("style");
  style.textContent = "@keyframes demo-fill { from { width: 0 } to { width: 100% } }";
  document.head.append(style);

  new IntersectionObserver(([e]) => { offscreen = !e.isIntersecting; paint(); }, { threshold: 0.2 }).observe(stage);
  document.addEventListener("visibilitychange", paint);
  for (const a of document.querySelectorAll("[data-chapter]")) {
    a.addEventListener("click", (e) => {
      const i = SCENES.findIndex((s) => s.id === a.dataset.chapter);
      if (i < 0) return;
      e.preventDefault();
      stage.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "center" });
      paused = false;
      go(i, true);
    });
  }
  go(0);
})();

/* screenshot strip: previous and next buttons */
(() => {
  const strip = document.querySelector(".gallery");
  if (!strip) return;
  for (const b of document.querySelectorAll("[data-go]")) {
    b.addEventListener("click", () => strip.scrollBy({ left: +b.dataset.go * strip.clientWidth * 0.8, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }));
  }
})();
