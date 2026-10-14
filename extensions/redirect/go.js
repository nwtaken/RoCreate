const target = location.hash.slice(1).replace(/^http:/i, "https:");
const isRoblox = /^https:\/\/([a-z0-9-]+\.)*roblox\.com([/?#:]|$)/i.test(target);
const id = crypto.randomUUID();
const APP = "http://127.0.0.1:47653";
const $ = (x) => document.getElementById(x);

document.body.dataset.launchId = id;

function closeTab() {
  chrome.tabs.getCurrent((tab) => (tab ? chrome.tabs.remove(tab.id) : window.close()));
}

function launch() {
  location.href = "rocreate://open?u=" + encodeURIComponent(target) + "&id=" + id;
}

async function appGotIt() {
  try {
    return (await (await fetch(`${APP}/seen?id=${id}`)).text()) === "1";
  } catch {
    return false; // app not listening yet (still starting)
  }
}

async function waitForApp() {
  const start = Date.now();
  while (Date.now() - start < 30000) {
    if (await appGotIt()) return closeTab();
    if (Date.now() - start > 3000) $("hint").hidden = false;
    await new Promise((r) => setTimeout(r, 150));
  }
  $("msg").textContent = "RoCreate didn't answer.";
  $("hint").hidden = false;
}

if (!isRoblox) {
  $("msg").textContent = "Not a Roblox link.";
} else {
  $("url").textContent = target;
  $("again").hidden = false;
  $("again").onclick = launch;
  launch();
  waitForApp();
}
