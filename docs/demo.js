/* The live demo on rocreate.org. Every frame in img/trailer/ is a real render of roblox.com
   with RoCreate running (signed in as the official Roblox account; transaction amounts are
   examples). This script plays them like a trailer: crossfades, a before and after wipe,
   camera zooms into sharp close-ups, a cursor that clicks the real buttons where they are,
   and RoCreate's real popup. It pauses when off screen or hidden; with reduced motion it
   still steps through the scenes, without any movement. */
(() => {
  const stage = document.getElementById("demo");
  if (!stage) return;
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const mac = /Mac|iPhone|iPad/.test(navigator.platform);
  const KEY = mac ? "⌘" : "Ctrl";
  const BASE = "img/trailer/";
  const W = 1440, H = 900, CHROME = 40;
  let M = { targets: {}, zooms: {}, popupW: 320, popupH: 440 };

  stage.innerHTML = `<div class="demo" role="img" aria-label="RoCreate running on roblox.com, shown with real pages">
    <div class="d-chrome"><div class="d-dots"><i></i><i></i><i></i></div>
      <div class="d-url"><svg width="12" height="12" viewBox="0 0 24 24"><rect x="5" y="10" width="14" height="10" rx="2" fill="none" stroke="#9aa0a9" stroke-width="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3" fill="none" stroke="#9aa0a9" stroke-width="2"/></svg><span><b>roblox.com</b><span class="d-path"></span></span></div>
      <span class="d-badge">Example amounts</span>
      <span class="d-ext" title="RoCreate"><svg width="18" height="18" viewBox="0 0 24 24"><rect x="2" y="2" width="20" height="20" rx="6" fill="#fff"/><rect x="9" y="9" width="6" height="6" rx="1.5" fill="#0b0c0e" transform="rotate(14 12 12)"/></svg></span></div>
    <div class="d-screen"><div class="d-cam"><img class="d-layer" alt=""><img class="d-layer" alt=""></div><img class="d-sharp" alt="">
      <div class="d-glow"></div><div class="d-popup"><img alt=""></div>
      <div class="d-keys"><kbd>${KEY}</kbd><kbd>K</kbd></div>
      <div class="d-caption"><i></i><span></span></div></div>
    <div class="d-cursor"><svg width="26" height="26" viewBox="0 0 24 24"><path d="M4 2l15 10-7 1.5L8.5 21z" fill="#fff" stroke="#0b0c0e" stroke-width="1.5" stroke-linejoin="round"/></svg><span class="d-ring"></span></div></div>`;
  const demo = stage.firstElementChild;
  const $ = (s) => demo.querySelector(s);
  const layers = [...demo.querySelectorAll(".d-layer")];
  const cam = $(".d-cam"), sharp = $(".d-sharp"), glow = $(".d-glow"), popup = $(".d-popup"), keys = $(".d-keys");
  const caption = $(".d-caption"), cursor = $(".d-cursor"), badge = $(".d-badge"), ext = $(".d-ext");

  let scale = 1;
  const fit = () => { scale = stage.clientWidth / W; demo.style.transform = `scale(${scale})`; };
  new ResizeObserver(fit).observe(stage);
  fit();

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
  const live = (t) => { if (t !== token) throw new Error("stop"); };

  /* ---------- pictures ---------- */
  const cache = new Map();
  function load(name) {
    if (!cache.has(name)) {
      const img = new Image();
      img.src = BASE + name + ".webp";
      cache.set(name, img.decode().catch(() => {}).then(() => img));
    }
    return cache.get(name);
  }
  let front = 0;
  async function show(name, fade, t) {
    await load(name);
    live(t);
    const next = layers[1 - front], prev = layers[front];
    next.src = BASE + name + ".webp";
    next.className = "d-layer";
    next.style.transitionDuration = fade + "ms";
    prev.style.zIndex = 1;
    next.style.zIndex = 2;
    void next.offsetWidth;
    next.classList.add("on");
    front = 1 - front;
    await wait(fade, t);
    prev.classList.remove("on");
  }
  async function wipe(name, t) {
    await load(name);
    live(t);
    const next = layers[1 - front], prev = layers[front];
    next.src = BASE + name + ".webp";
    next.style.transitionDuration = "0ms";
    next.className = "d-layer wipe";
    prev.style.zIndex = 1;
    next.style.zIndex = 2;
    glow.className = "d-glow";
    void next.offsetWidth;
    next.classList.add("go");
    glow.classList.add("go");
    front = 1 - front;
    await wait(1850, t);
    glow.classList.add("done");
    next.className = "d-layer on";
    prev.classList.remove("on");
  }
  let zoom = null;
  async function zoomIn(key, picture, t) {
    const z = M.zooms[key];
    if (!z) return;
    zoom = z;
    const s = W / z.w;
    cam.style.transform = `translate(${-z.x * s}px, ${-z.y * s}px) scale(${s})`;
    load(picture);
    await wait(1000, t);
    await setSharp(picture, t);
    sharp.classList.add("on");
    await wait(300, t);
  }
  async function setSharp(picture, t) { await load(picture); live(t); sharp.src = BASE + picture + ".webp"; }
  async function zoomOut(t) {
    sharp.classList.remove("on");
    await wait(260, t);
    cam.style.transform = "";
    zoom = null;
    await wait(950, t);
  }
  function resetView() {
    cam.style.transition = "none";
    cam.style.transform = "";
    void cam.offsetWidth;
    cam.style.transition = "";
    zoom = null;
    sharp.classList.remove("on");
    popup.classList.remove("on");
    keys.classList.remove("on");
    glow.className = "d-glow";
    ext.classList.remove("on");
    cursor.classList.remove("on");
  }

  /* ---------- cursor ---------- */
  // a point in frame pixels -> window pixels (the cursor lives over the whole window)
  function pt(p) {
    let x = p.x, y = p.y;
    if (zoom) { x = (x - zoom.x) * W / zoom.w; y = (y - zoom.y) * H / zoom.h; }
    return [x, y + CHROME];
  }
  async function cursorAt(x, y, t) {
    cursor.classList.add("on");
    cursor.style.transform = `translate(${x - 4}px, ${y - 2}px)`;
    await wait(800, t);
  }
  const cursorTo = (key, t) => { const p = M.targets[key]; return p ? cursorAt(...pt(p), t) : wait(0, t); };
  async function click(t) {
    cursor.classList.remove("click");
    void cursor.offsetWidth;
    cursor.classList.add("click");
    await wait(280, t);
  }
  function center(el) {
    const d = demo.getBoundingClientRect(), r = el.getBoundingClientRect();
    return [(r.left - d.left + r.width / 2) / scale, (r.top - d.top + r.height / 2) / scale];
  }

  /* ---------- scenes ---------- */
  const SCENES = [
    {
      id: "look", label: "The look", url: "/charts", cap: "<b>The Creator Hub look</b> on every Roblox page", dur: 6000,
      frames: ["look-before", "look-after"],
      async run(t) {
        await show("look-before", 0, t);
        await wait(1500, t);
        await wipe("look-after", t);
        await wait(2400, t);
      },
    },
    {
      id: "stats", label: "Game stats", url: "/charts", cap: "<b>Revenue and visits</b> on every game card, sorted in one click", dur: 9500,
      frames: ["stats-nopills", "stats-pills", "stats-sorted", "stats-zoom"],
      async run(t) {
        await show("stats-nopills", 350, t);
        await wait(600, t);
        await show("stats-pills", 500, t);
        await wait(700, t);
        await cursorTo("stats-revenue", t);
        await click(t);
        await show("stats-sorted", 420, t);
        await wait(700, t);
        cursor.classList.remove("on");
        await zoomIn("stats-zoom", "stats-zoom", t);
        await wait(2300, t);
        await zoomOut(t);
      },
    },
    {
      id: "jump", label: "Quick jump", url: "/charts", cap: `<b>${KEY} K</b>: jump anywhere, search all of Roblox`, dur: 6850,
      frames: ["jump-bg", "jump-open", "jump-a", "jump-ad", "jump-ado", "jump-adop", "jump-adopt", "jump-down"],
      async run(t) {
        await show("jump-bg", 350, t);
        await wait(500, t);
        keys.classList.add("on");
        await wait(380, t);
        for (const k of keys.children) k.classList.add("press");
        await wait(320, t);
        keys.classList.remove("on");
        for (const k of keys.children) k.classList.remove("press");
        await show("jump-open", 160, t);
        await wait(1000, t);
        for (const f of ["jump-a", "jump-ad", "jump-ado", "jump-adop"]) { await show(f, 0, t); await wait(150, t); }
        await show("jump-adopt", 220, t);
        await wait(1700, t);
        await show("jump-down", 0, t);
        await wait(1300, t);
      },
    },
    {
      id: "game", label: "Game pages", url: "/games/920587237/Adopt-Me", cap: "<b>Revenue, players and a 7-day chart</b> on every experience", dur: 8150,
      frames: ["game-before", "game-after", "game-zoom"],
      async run(t) {
        await show("game-before", 400, t);
        await wait(900, t);
        await show("game-after", 500, t);
        await wait(800, t);
        await zoomIn("game-zoom", "game-zoom", t);
        await wait(2700, t);
        await zoomOut(t);
      },
    },
    {
      id: "mine", label: "Your experiences", url: "/home", cap: "<b>Your experiences</b>, live on Home", dur: 7000,
      frames: ["mine", "mine-zoom"],
      async run(t) {
        await show("mine", 450, t);
        await wait(1100, t);
        await zoomIn("mine-zoom", "mine-zoom", t);
        await wait(2700, t);
        await zoomOut(t);
      },
    },
    {
      id: "money", label: "Money tools", url: "/transactions", cap: "<b>DevEx estimate</b> and one-click CSV exports", dur: 9250, badge: true,
      frames: ["money-idle", "money-idle-z", "money-progress", "money-progress-z", "money-done", "money-done-z"],
      async run(t) {
        await show("money-idle", 450, t);
        await wait(700, t);
        await zoomIn("money-zoom", "money-idle-z", t);
        await wait(500, t);
        await cursorTo("money-export", t);
        await click(t);
        await setSharp("money-progress-z", t);
        show("money-progress", 0, t).catch(() => {});
        await wait(1500, t);
        await setSharp("money-done-z", t);
        show("money-done", 0, t).catch(() => {});
        await wait(2200, t);
        cursor.classList.remove("on");
        await zoomOut(t);
      },
    },
    {
      id: "profile", label: "Profiles", url: "/users/1/profile", cap: "<b>Rebuilt profiles</b> with their latest videos", dur: 6800,
      frames: ["profile-top", "profile-feed"],
      async run(t) {
        await show("profile-top", 450, t);
        await wait(1900, t);
        await show("profile-feed", 650, t);
        await wait(500, t);
        await cursorTo("profile-video", t);
        await wait(2200, t);
      },
    },
    {
      id: "streamer", label: "Streamer mode", url: "/transactions", cap: "<b>Streamer mode</b> blurs your Robux in one click", dur: 7100, badge: true,
      frames: ["streamer-off", "streamer-on", "popup-off", "popup-on"],
      async run(t) {
        await show("streamer-off", 450, t);
        await wait(600, t);
        await cursorAt(...center(ext), t);
        await click(t);
        ext.classList.add("on");
        await load("popup-off");
        const img = popup.querySelector("img");
        img.src = BASE + "popup-off.webp";
        img.width = M.popupW;
        popup.classList.add("on");
        await wait(500, t);
        const s = M.targets["popup-streamer"];
        if (s) await cursorAt(W - 10 - M.popupW + s.x, CHROME + 4 + s.y, t);
        await click(t);
        await load("popup-on");
        img.src = BASE + "popup-on.webp";
        await show("streamer-on", 350, t);
        await wait(2400, t);
        popup.classList.remove("on");
        ext.classList.remove("on");
        await wait(300, t);
      },
    },
  ];

  /* ---------- player ---------- */
  const controls = document.getElementById("demo-controls");
  const chaps = SCENES.map((sc, i) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "demo-chap";
    b.innerHTML = `<span>${sc.label}</span><i class="fill"></i>`;
    b.addEventListener("click", () => { paused = false; go(i); });
    controls?.append(b);
    return b;
  });
  const playBtn = document.createElement("button");
  playBtn.type = "button";
  playBtn.className = "demo-play";
  const paint = () => {
    playBtn.innerHTML = paused ? '<svg width="12" height="12" viewBox="0 0 12 12"><path d="M2 1l9 5-9 5z" fill="currentColor"/></svg>' : '<svg width="12" height="12" viewBox="0 0 12 12"><rect x="2" y="1" width="3" height="10" fill="currentColor"/><rect x="7" y="1" width="3" height="10" fill="currentColor"/></svg>';
    playBtn.setAttribute("aria-label", paused ? "Play the demo" : "Pause the demo");
    for (const c of chaps) c.querySelector(".fill").style.animationPlayState = blocked() ? "paused" : "running";
  };
  playBtn.addEventListener("click", () => { paused = !paused; paint(); });
  controls?.prepend(playBtn);

  async function go(i) {
    const t = ++token;
    current = i;
    const sc = SCENES[i];
    resetView();
    sc.frames.forEach(load);
    SCENES[(i + 1) % SCENES.length].frames.forEach(load);
    demo.querySelector(".d-path").textContent = sc.url;
    badge.classList.toggle("on", !!sc.badge);
    caption.classList.remove("on");
    caption.querySelector("span").innerHTML = sc.cap;
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
      await sc.run(t);
      await wait(250, t);
      go((i + 1) % SCENES.length);
    } catch {}
  }

  new IntersectionObserver(([e]) => { offscreen = !e.isIntersecting; paint(); }, { threshold: 0.2 }).observe(stage);
  document.addEventListener("visibilitychange", paint);
  for (const a of document.querySelectorAll("[data-chapter]")) {
    a.addEventListener("click", (e) => {
      const i = SCENES.findIndex((s) => s.id === a.dataset.chapter);
      if (i < 0) return;
      e.preventDefault();
      stage.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "center" });
      paused = false;
      go(i);
    });
  }
  fetch(BASE + "frames.json").then((r) => r.json()).then((m) => { M = m; }).catch(() => {}).finally(() => go(0));
})();

/* screenshot strip: previous and next buttons */
(() => {
  const strip = document.querySelector(".gallery");
  if (!strip) return;
  for (const b of document.querySelectorAll("[data-go]")) {
    b.addEventListener("click", () => strip.scrollBy({ left: +b.dataset.go * strip.clientWidth * 0.8, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }));
  }
})();
