/* Badges next to people's names: Roblox's verified badge in red for accounts flagged on
   robloxverifieds.com or that lost their verified badge (reasons on hover; it replaces the
   blue one), and the Roblox logo for Roblox admins (people with Roblox's Administrator badge).
   Shown on friend rows (home, profiles), the Friends page, profile headers, and anywhere
   else Roblox puts its blue badge next to a name (search results, ...).
   Data from background.js. Setting: chrome.storage.sync { users: bool }. */
(() => {
  let on = true;
  const info = new Map(); // userId -> {flag, ex, admin} ({} = nothing), null while asked

  // Roblox's own verified badge (backplate + check icons), drawn red by stats.css
  const redVerified = (size) =>
    `<span class="icon icon-filled-verified-backplate size-[var(--icon-size-${size})]"></span>` +
    `<span class="icon icon-filled-verified-check size-[var(--icon-size-${size})] rcx-rv-check"></span>`;

  // the Roblox logo (tilted square with a square hole), white like the Premium icon
  const ROBLOX_LOGO = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" stroke="currentColor" stroke-width="1.6" ' +
    'stroke-linejoin="round" fill-rule="evenodd" d="M6.2 1.96 22.04 6.2 17.8 22.04 1.96 17.8Z M9.81 8.2 15.8 9.81 14.19 15.8 8.2 14.19Z"/></svg>';

  function badges(u, size) {
    let html = "";
    if (u.admin != null) {
      html += u.admin
        ? `<span class="rcx-ubadge rcx-admin" title="Roblox admin (has Roblox's Administrator badge)">${ROBLOX_LOGO}</span>`
        : "";
    }
    if (u.flag || u.ex) {
      const lines = [];
      if (u.flag) {
        lines.push("Flagged on RobloxVerifieds" + (u.flag.banned ? " (banned on Roblox)" : ""));
        for (const r of u.flag.reasons) lines.push("• " + r.reason + (r.note ? ": " + r.note : ""));
      }
      if (u.ex) lines.push("Previously verified: this account lost its verified badge");
      const title = lines.join("\n").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
      html += `<span class="rcx-ubadge rcx-rv" title="${title}">${redVerified(size)}</span>`;
    }
    return html;
  }

  // [element to append the badges to, user id, icon size] for every name on the page
  // Roblox's blue verified badge, in every form seen so far: the Foundation icon pair, a
  // single icon, or an image. Used to place the red badge and to size it.
  const BLUE = '.relative.flex:has(> [class*="icon-filled-verified"]), [class*="icon-filled-verified"], img[src*="verified" i], img[alt*="verified" i], img[class*="verified" i], svg[class*="verified" i], [class*="verified-badge" i]';
  const ours = (e) => e.closest(".rcx-ubadges");
  const idIn = (root) => root?.querySelector?.("a[href*='/users/']")?.getAttribute("href")?.match(/users\/(\d+)/)?.[1];
  const idNear = (e) => {
    const a = e.closest("a[href*='/users/']");
    if (a) return a.getAttribute("href").match(/users\/(\d+)/)?.[1];
    for (let p = e.parentElement, i = 0; p && i < 5; p = p.parentElement, i++) {
      const links = new Set([...p.querySelectorAll("a[href*='/users/']")].map((x) => x.getAttribute("href").match(/users\/(\d+)/)?.[1]).filter(Boolean));
      if (links.size === 1) return [...links][0];
      if (links.size > 1) return null; // a list of several people: not this badge's row
    }
    return null;
  };

  // [element to append the badges to, user id] for every name on the page
  function targets() {
    const out = new Map(); // element -> id
    for (const tile of document.querySelectorAll(".friends-carousel-tile")) {
      const id = tile.querySelector("a.avatar-card-link")?.getAttribute("href")?.match(/users\/(\d+)/)?.[1];
      const name = tile.querySelector(".friends-carousel-tile-name");
      if (id && name) out.set(name, id);
    }
    for (const box of document.querySelectorAll(".avatar-name-container")) {
      const id = idIn(box);
      if (id) out.set(box, id);
    }
    const header = document.getElementById("profile-header-title-container-name");
    const pid = location.pathname.match(/^\/users\/(\d+)\//)?.[1];
    if (header?.parentElement && pid) out.set(header.parentElement, pid);
    // anywhere else a blue badge sits next to a name (search results, cards, lists)
    for (const b of document.querySelectorAll(BLUE)) {
      if (ours(b) || b.parentElement?.closest(BLUE)) continue; // ours, or the inner half of a pair
      const host = b.parentElement;
      if (!host || [...out.keys()].some((k) => k === host || k.contains(host))) continue;
      const id = idNear(b);
      if (id) out.set(host, id);
    }
    return [...out];
  }

  // the size of the blue badge we stand in for (measured before it is hidden)
  function blueSize(el) {
    const b = [...el.querySelectorAll(BLUE)].find((x) => !ours(x));
    const w = b?.getBoundingClientRect().width || 0;
    return w >= 8 && w <= 64 ? Math.round(w) : 0;
  }

  function paint(el, id) {
    const u = info.get(id);
    let box = el.querySelector(":scope > .rcx-ubadges");
    const size = el.id === "profile-header-title-container-name" || el.querySelector("#profile-header-title-container-name") ? "large" : "small";
    const html = u ? badges(u, size) : "";
    if (!html) {
      box?.remove();
      return;
    }
    if (!box) {
      const px = blueSize(el);
      box = document.createElement("span");
      box.className = "rcx-ubadges";
      if (px) box.style.setProperty("--rcx-size", px + "px");
      el.appendChild(box);
    }
    if (box.innerHTML !== html) box.innerHTML = html;
  }

  function ask(ids) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ type: "rcx-users", ids }, (r) => resolve(chrome.runtime.lastError ? {} : r || {}));
      } catch {
        resolve({});
      }
    });
  }

  let timer = 0;
  function scan() {
    timer = 0;
    if (!on) return;
    const list = targets();
    const want = [];
    for (const [el, id] of list) {
      if (info.has(id)) {
        if (info.get(id)) paint(el, id);
      } else {
        info.set(id, null);
        want.push(id);
      }
    }
    for (let i = 0; i < want.length; i += 100) {
      const ids = want.slice(i, i + 100);
      ask(ids).then((got) => {
        for (const id of ids) info.set(id, got[id] || {});
        queue();
      });
    }
  }
  const queue = () => {
    if (!timer) timer = setTimeout(scan, 200);
  };

  function setOn(v) {
    on = v;
    document.documentElement.classList.toggle("rcx-users-on", on);
    queue();
  }
  chrome.storage.sync.get({ users: true }, (s) => setOn(!!s.users));
  chrome.storage.onChanged.addListener((c, area) => area === "sync" && c.users && setOn(!!c.users.newValue));

  function start() {
    new MutationObserver((records, obs) => {
      if (!rcAlive()) return obs.disconnect();
      if (records.every((r) => r.target.closest?.(".rcx-ubadges"))) return;
      queue();
    }).observe(document.body, { childList: true, subtree: true });
    queue();
  }
  if (document.body) start();
  else document.addEventListener("DOMContentLoaded", start, { once: true });
})();
