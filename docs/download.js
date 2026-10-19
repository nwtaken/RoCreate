/* Download page: builds RoCreate.zip in the browser from the extension's files on GitHub.
   Unticked features are left out of the zip together with their site permissions, and
   config.json tells the extension what it includes. Nothing about the choices is sent
   anywhere. */
(() => {
  const RAW = "https://raw.githubusercontent.com/nwtaken/RoCreate/main/extensions/theme/";
  const ALL = { moneyTools: true, palette: true, workspace: true, friendsPage: true, groupsPage: true, reduceMotion: true, stats: true, watchlistTools: true, gameNotes: true, alerts: true, robux: true, sales: true, profile: true, profileNav: true, profileFilters: true, profileItems: true, profileValue: true, profileRevenue: true, profileVerify: true, socials: true, socialsYoutube: true, socialsTwitch: true, socialsX: true, admins: true, flags: true };
  const $ = (s) => document.querySelector(s);
  const boxes = [...document.querySelectorAll("input[data-f]")];

  const chosen = () => {
    const f = Object.fromEntries(boxes.map((b) => [b.dataset.f, b.checked]));
    if (!f.profile) f.profileNav = f.profileFilters = f.profileItems = f.profileValue = f.profileRevenue = f.profileVerify = f.socialsYoutube = f.socialsTwitch = f.socialsX = false;
    f.socials = !!(f.socialsYoutube || f.socialsTwitch || f.socialsX);
    if (!f.stats) f.alerts = f.watchlistTools = f.gameNotes = false;
    if (!f.watchlistTools) f.gameNotes = false;
    if (!f.robux) f.sales = false;
    return f;
  };
  // which outside services a set of features talks to
  const services = (f) => ({
    creatorexchange: f.stats || (f.profile && f.profileRevenue),
    rolimons: f.profile && f.profileValue,
    robloxverifieds: f.flags || (f.profile && f.profileVerify),
    youtube: f.socialsYoutube,
    twitch: f.socialsTwitch,
    x: f.socialsX,
  });

  function refresh() {
    const f = chosen();
    $("#profile-parts").classList.toggle("off", !f.profile);
    $("#stats-parts").classList.toggle("off", !f.stats);
    $("#robux-parts").classList.toggle("off", !f.robux);
    for (const b of $("#robux-parts").querySelectorAll("input")) b.disabled = !f.robux;
    for (const b of $("#stats-parts").querySelectorAll("input")) b.disabled = !f.stats || (b.dataset.f === "gameNotes" && !f.watchlistTools);
    for (const b of $("#profile-parts").querySelectorAll("input")) b.disabled = !f.profile;
    const s = services(f);
    for (const c of document.querySelectorAll("#services [data-s]")) {
      if (c.dataset.s !== "roblox") c.classList.toggle("on", !!s[c.dataset.s]);
    }
  }
  // a link can preselect features: download.html#f=stats,robux (also remembered in this browser)
  const fromHash = new URLSearchParams(location.hash.slice(1)).get("f");
  const saved = fromHash != null ? fromHash : localStorage.getItem("rc-build");
  if (saved != null) {
    const on = new Set(saved.split(",").filter(Boolean));
    for (const b of boxes) b.checked = on.has(b.dataset.f);
  }
  const remember = () => {
    const f = chosen();
    const list = Object.keys(f).filter((k) => f[k]).join(",");
    localStorage.setItem("rc-build", list);
    return list;
  };
  boxes.forEach((b) => b.addEventListener("change", () => { refresh(); remember(); }));
  // presets: Creator = the money and stats side; Roblox only = nothing outside roblox.com
  const PRESETS = {
    all: Object.keys(ALL),
    creator: ["moneyTools", "palette", "workspace", "friendsPage", "groupsPage", "reduceMotion", "stats", "watchlistTools", "gameNotes", "alerts", "robux", "sales", "profile", "profileNav", "profileFilters", "profileItems", "profileValue", "profileRevenue", "socialsYoutube", "socialsTwitch", "socialsX", "admins"],
    roblox: ["moneyTools", "palette", "workspace", "friendsPage", "groupsPage", "reduceMotion", "robux", "sales", "profile", "profileNav", "profileFilters", "profileItems", "admins"],
    theme: ["workspace"],
  };
  $("#presets").addEventListener("click", (e) => {
    const list = PRESETS[e.target.closest("[data-preset]")?.dataset.preset];
    if (!list) return;
    for (const b of boxes) b.checked = list.includes(b.dataset.f);
    refresh();
    remember();
  });
  refresh();
  $("#share").addEventListener("click", (e) => {
    const list = remember();
    const url = `${location.origin}${location.pathname}#f=${list}`;
    const done = (text) => {
      e.target.textContent = text;
      setTimeout(() => (e.target.textContent = "Copy a link to this build"), 1800);
    };
    history.replaceState(null, "", "#f=" + list); // the address bar always has it too
    if (navigator.clipboard) navigator.clipboard.writeText(url).then(() => done("Link copied"), () => done("Link is in the address bar"));
    else done("Link is in the address bar");
  });

  /* ---- fetching the extension ---- */
  async function get(path) {
    const res = await fetch(RAW + path, { cache: "no-store" });
    if (!res.ok) throw new Error(`${path}: ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  }
  const text = (bytes) => new TextDecoder().decode(bytes);
  const bytes = (str) => new TextEncoder().encode(str);

  async function build(features) {
    const manifest = JSON.parse(text(await get("manifest.json")));
    const leave = new Set();
    if (!features.stats) leave.add("stats.js");
    if (!features.stats || !features.watchlistTools) leave.add("watchlist.html").add("watchlist.css").add("watchlist.js");
    if (!features.robux) leave.add("robux.js");
    if (!features.friendsPage && !features.groupsPage) leave.add("directories.js").add("directories.css");
    if (!features.workspace) leave.add("workspace.css");
    if (!features.palette) leave.add("palette.js").add("palette.css");
    if (!features.moneyTools) leave.add("money.js").add("money.css");
    if (!features.profile) leave.add("profile.js").add("profile.css");
    if (!features.admins && !features.flags) leave.add("users.js");
    for (const cs of manifest.content_scripts) {
      cs.js = (cs.js || []).filter((f) => !leave.has(f));
      if (cs.css) cs.css = cs.css.filter((f) => !leave.has(f));
    }
    if (!features.alerts && !features.sales) manifest.permissions = (manifest.permissions || []).filter((p) => p !== "notifications");
    const s = services(features);
    manifest.host_permissions = (manifest.host_permissions || []).filter((h) =>
      h.includes("creatorexchange.io") ? s.creatorexchange
        : h.includes("rolimons.com") ? s.rolimons
        : h.includes("robloxverifieds.com") ? s.robloxverifieds
        : h.includes("accountinformation.roblox.com") ? features.admins
        : h.includes("youtube.com") ? s.youtube
        : h.includes("twitch.tv") || h.includes("jtvnw.net") ? s.twitch
        : h.includes("twitter.com") || h.includes("twimg.com") ? s.x
        : true);
    // only YouTube's feed needs the request rule (background.js)
    if (!s.youtube) manifest.permissions = (manifest.permissions || []).filter((p) => p !== "declarativeNetRequestWithHostAccess");

    // every file the manifest and the popup refer to
    const files = new Set();
    for (const cs of manifest.content_scripts) for (const f of [...cs.js, ...(cs.css || [])]) files.add(f);
    files.add(manifest.background.service_worker);
    for (const f of Object.values(manifest.icons || {})) files.add(f);
    for (const f of Object.values(manifest.action?.default_icon || {})) files.add(f);
    files.add("changelog.json"); // read by the popup's What's new card
    const popupPath = manifest.action?.default_popup;
    const popup = popupPath ? await get(popupPath) : null;
    if (popup) for (const m of text(popup).matchAll(/(?:src|href)="([\w./-]+)"/g)) files.add(m[1]);
    if (features.stats && features.watchlistTools) { files.add("watchlist.html"); files.add("watchlist.js"); files.add("watchlist.css"); }
    const optionsPath = manifest.options_ui?.page;
    if (optionsPath) {
      files.add(optionsPath);
      for (const m of text(await get(optionsPath)).matchAll(/(?:src|href)="([\w./-]+)"/g)) files.add(m[1]);
    }

    const out = [
      { name: "RoCreate/manifest.json", data: bytes(JSON.stringify(manifest, null, 2) + "\n") },
      { name: "RoCreate/config.json", data: bytes(JSON.stringify({ features }, null, 2) + "\n") },
    ];
    if (popup) out.push({ name: "RoCreate/" + popupPath, data: popup });
    const rest = [...files].filter((f) => f !== popupPath && f !== "manifest.json" && f !== "config.json" && !leave.has(f));
    out.push(...(await Promise.all(rest.map(async (f) => ({ name: "RoCreate/" + f, data: await get(f) })))));
    return zip(out);
  }

  /* ---- a minimal zip writer (stored, no compression) ---- */
  const CRC = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(buf) {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }
  function zip(files) {
    const now = new Date();
    const time = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
    const date = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
    const parts = [], central = [];
    let offset = 0;
    for (const f of files) {
      const name = bytes(f.name), crc = crc32(f.data), size = f.data.length;
      const local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true);
      local.setUint16(4, 20, true);
      local.setUint16(6, 0x0800, true); // UTF-8 names
      local.setUint16(10, time, true);
      local.setUint16(12, date, true);
      local.setUint32(14, crc, true);
      local.setUint32(18, size, true);
      local.setUint32(22, size, true);
      local.setUint16(26, name.length, true);
      parts.push(new Uint8Array(local.buffer), name, f.data);
      const entry = new DataView(new ArrayBuffer(46));
      entry.setUint32(0, 0x02014b50, true);
      entry.setUint16(4, 20, true);
      entry.setUint16(6, 20, true);
      entry.setUint16(8, 0x0800, true);
      entry.setUint16(12, time, true);
      entry.setUint16(14, date, true);
      entry.setUint32(16, crc, true);
      entry.setUint32(20, size, true);
      entry.setUint32(24, size, true);
      entry.setUint16(28, name.length, true);
      entry.setUint32(42, offset, true);
      central.push(new Uint8Array(entry.buffer), name);
      offset += 30 + name.length + size;
    }
    const centralSize = central.reduce((n, p) => n + p.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, files.length, true);
    end.setUint16(10, files.length, true);
    end.setUint32(12, centralSize, true);
    end.setUint32(16, offset, true);
    return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type: "application/zip" });
  }

  /* ---- buttons ---- */
  async function download(button, features) {
    const label = button.textContent;
    button.disabled = true;
    button.textContent = "Building…";
    $("#status").textContent = "";
    try {
      const blob = await build(features);
      const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: "RoCreate.zip" });
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 60000);
      const rovalra = document.querySelector('input[name="rovalra"]:checked').value;
      $("#rovalra-step").hidden = button.id === "get-custom" ? rovalra !== "add" : false;
      $("#done").hidden = false;
      $("#done").scrollIntoView({ behavior: "smooth" });
    } catch (e) {
      $("#status").innerHTML = `Couldn't reach GitHub to build your copy (${String(e.message).replace(/</g, "&lt;")}). Try again in a moment.`;
      if (button.id !== "get-custom") $("#custom").scrollIntoView({ behavior: "smooth" });
    } finally {
      button.disabled = false;
      button.textContent = label;
    }
  }
  $("#get-all").addEventListener("click", (e) => download(e.currentTarget, { ...ALL }));
  $("#get-custom").addEventListener("click", (e) => download(e.currentTarget, chosen()));

  // show which version a download gets, and what's new in it
  get("manifest.json")
    .then((m) => ($("#version").textContent = "Version " + JSON.parse(text(m)).version))
    .catch(() => {});
  get("changelog.json")
    .then((c) => {
      const latest = JSON.parse(text(c))[0];
      if (!latest) return;
      const box = $("#whatsnew");
      const ul = document.createElement("ul");
      for (const line of latest.changes) ul.append(Object.assign(document.createElement("li"), { textContent: line }));
      const head = Object.assign(document.createElement("b"), { textContent: `New in ${latest.version}` });
      const more = Object.assign(document.createElement("a"), { href: "changelog.html", textContent: "Full changelog" });
      box.replaceChildren(head, ul, more);
      box.hidden = false;
    })
    .catch(() => {});
})();
