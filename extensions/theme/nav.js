/* Replaces Roblox's left sidebar with a dropdown under the logo.

   The entries are cloned straight out of the sidebar, so their links, icons and
   unread counts stay Roblox's own and keep working after the site changes them.
   Messages moves up next to the notification bell; Newsroom, the store and gift
   cards are dropped. */
(() => {
  // pathname -> order in the menu. Everything else in the sidebar is left out.
  const WANTED = [
    "/home", "/users/profile", "/plus", "/users/friends",
    "/my/avatar", "/users/inventory", "/trades", "/communities",
  ];
  const MESSAGES = "/my/messages";
  // paths we relabel in the dropdown (Roblox renamed Groups -> Communities; we keep "Groups")
  const RELABEL = { "/communities": "Groups" };

  // swap the first non-empty text node under a node for new text (keeps the icon)
  function relabel(root, text) {
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = w.nextNode())) {
      if (n.nodeValue.trim()) { n.nodeValue = text; return; }
    }
  }

  const pathOf = (a) => {
    try {
      return new URL(a.getAttribute("href"), location.origin).pathname.replace(/\/+$/, "") || "/";
    } catch {
      return "";
    }
  };

  const sidebarLinks = () => [...document.querySelectorAll(".left-nav a[href]")];

  // The account row at the top of the sidebar points at /users/profile as well, but it
  // shows the avatar and display name rather than a nav entry, so skip it.
  // Every sidebar link shares the same classes, so the avatar thumbnail is the only tell.
  const isAccountRow = (a) => !!a.querySelector('img, [class*="thumbnail"]');

  function strip(node) {
    node.removeAttribute("class");
    node.removeAttribute("style");
    node.querySelectorAll("[style]").forEach((e) => e.removeAttribute("style"));
    return node;
  }

  /* ---- the dropdown ---- */
  function buildMenu() {
    const links = sidebarLinks();
    if (!links.length) return null;

    const items = [];
    for (const want of WANTED) {
      const found = links.find((a) => pathOf(a) === want && !isAccountRow(a) && !a.search.includes("referrals"));
      if (found) items.push(found);
    }
    if (!items.length) return null;

    const menu = document.createElement("div");
    menu.id = "rc-menu";
    menu.setAttribute("role", "menu");
    items.forEach((src, i) => {
      const item = strip(src.cloneNode(true));
      item.className = "rc-menu-item";
      item.querySelectorAll('[class*="badge" i], .notification-blue').forEach((b) => b.classList.add("rc-badge"));
      item.style.setProperty("--i", i);
      if (RELABEL[pathOf(src)]) relabel(item, RELABEL[pathOf(src)]);
      if (pathOf(src) === (location.pathname.replace(/\/+$/, "") || "/")) item.classList.add("rc-here");
      item.addEventListener("click", () => close());
      menu.appendChild(item);
    });
    return menu;
  }

  let open = false;
  function close() {
    open = false;
    document.getElementById("rc-menu")?.classList.remove("rc-open");
    document.getElementById("nav-logo-link")?.classList.remove("rc-trigger-open");
  }

  function toggle(ev) {
    ev.preventDefault();
    ev.stopPropagation();
    let menu = document.getElementById("rc-menu");
    if (!menu) {
      menu = buildMenu();
      if (!menu) return;
      document.body.appendChild(menu);
    }
    open = !open;
    // next frame, so the transition runs on first open too
    requestAnimationFrame(() => {
      menu.classList.toggle("rc-open", open);
      document.getElementById("nav-logo-link")?.classList.toggle("rc-trigger-open", open);
    });
  }

  function wireTrigger() {
    const logo = document.getElementById("nav-logo-link");
    if (!logo || logo.dataset.rcNav) return;
    logo.dataset.rcNav = "1";
    if (!logo.querySelector(".rc-chev")) {
      const chev = document.createElement("span");
      chev.className = "rc-chev";
      chev.innerHTML = '<svg viewBox="0 0 10 10"><path d="M2.5 4L5 6.5L7.5 4"/></svg>';
      logo.appendChild(chev);
    }
    logo.addEventListener("click", toggle);
  }

  /* ---- Messages, moved next to the bell ---- */
  function moveMessages() {
    const group = document.querySelector("#right-navigation-header ul.rbx-navbar-icon-group");
    if (!group || group.querySelector("#rc-messages")) return;
    const src = sidebarLinks().find((a) => pathOf(a).startsWith(MESSAGES));
    if (!src) return;

    const li = document.createElement("li");
    li.id = "rc-messages";
    li.className = "navbar-icon-item";
    const a = document.createElement("a");
    a.href = src.getAttribute("href");
    a.title = "Messages";
    a.innerHTML =
      '<svg viewBox="0 0 24 24" class="rc-msg-icon"><path d="M4 5.5h16a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-11a1 1 0 0 1 1-1Z"/><path d="m3.6 6.4 7.7 5.6a1.2 1.2 0 0 0 1.4 0l7.7-5.6"/></svg>';
    const b = document.createElement("span");
    b.className = "rc-msg-badge";
    a.appendChild(b);
    li.appendChild(a);
    const bell = group.querySelector("#navbar-stream");
    group.insertBefore(li, bell || group.firstChild);
  }

  const countOf = (a) => (a ? (a.textContent.match(/\d[\d,.KkMm+]*/) || [])[0] || "" : "");

  let lastSig = "";
  function refreshCounts() {
    const links = sidebarLinks();

    // Rebuilding writes to the DOM, which wakes our own observer, so do it only when
    // the sidebar text actually changed — otherwise this loops forever and tanks the fps.
    const sig = links.map((a) => pathOf(a) + ":" + a.textContent.trim()).join("|");
    if (sig !== lastSig) {
      lastSig = sig;
      const menu = document.getElementById("rc-menu");
      if (menu && !open) {
        const fresh = buildMenu();
        if (fresh) menu.replaceChildren(...fresh.children);
      }
      const badge = document.querySelector("#rc-messages .rc-msg-badge");
      if (badge) {
        const c = countOf(links.find((a) => pathOf(a).startsWith(MESSAGES)));
        badge.textContent = c;
        badge.hidden = !c;
      }
    }
  }

  // Roblox calls them Communities; this theme keeps "Groups". The list is React-owned, and
  // rewriting its text or attributes crashes the page ("500 Something went wrong"), so only a
  // data attribute is set here and theme.css paints the replacement label over the original.
  function renameGroups() {
    const root = document.querySelector(".groups-list-new");
    if (!root) return;
    root.querySelectorAll("span, a, button").forEach((el) => {
      if (el.children.length || el.closest("a.groups-list-item")) return; // never touch real group names
      const label = el.textContent.trim().replace(/Communities/g, "Groups").replace(/^(Create )Community$/, "$1Group");
      if (label !== el.textContent.trim() && el.dataset.rcText !== label) el.dataset.rcText = label;
    });
  }

  let timer = 0;
  const queue = () => {
    if (!timer) {
      timer = setTimeout(() => {
        timer = 0;
        if (!document.documentElement.classList.contains("rocreate-on")) return;
        wireTrigger();
        moveMessages();
        refreshCounts();
        renameGroups();
      }, 150);
    }
  };

  function start() {
    new MutationObserver(queue).observe(document.body, { childList: true, subtree: true });
    document.addEventListener("click", (e) => {
      if (open && !e.target.closest("#rc-menu") && !e.target.closest("#nav-logo-link")) close();
    });
    document.addEventListener("keydown", (e) => e.key === "Escape" && open && close());
    window.addEventListener("blur", close);
    queue();
  }

  if (document.body) start();
  else {
    new MutationObserver((_, obs) => {
      if (!document.body) return;
      obs.disconnect();
      start();
    }).observe(document, { childList: true, subtree: true });
  }
})();
