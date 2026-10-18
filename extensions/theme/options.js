/* Options page: backup and restore (chrome.storage.sync: settings and the watchlist),
   clearing cached data (chrome.storage.local), and a full reset. */
const $ = (id) => document.getElementById(id);
$("ver").textContent = "Version " + chrome.runtime.getManifest().version;

// the settings a backup may carry, and what each must look like
const KEYS = {
  enabled: "boolean", declutter: "boolean", streamer: "boolean", stats: "boolean", alerts: "boolean", users: "boolean",
  robux: "boolean", sales: "boolean", profile: "boolean", accent: "string", sort: "string", watch: "object",
};

function say(id, text, err = false) {
  const el = $(id);
  el.textContent = text;
  el.classList.toggle("err", err);
}

$("export").addEventListener("click", async () => {
  const data = await chrome.storage.sync.get(null);
  const backup = { app: "RoCreate", version: chrome.runtime.getManifest().version, saved: new Date().toISOString(), settings: data };
  const a = Object.assign(document.createElement("a"), {
    href: URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" })),
    download: `rocreate-backup-${new Date().toISOString().slice(0, 10)}.json`,
  });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 30000);
  say("backup-status", `Saved ${(data.watch || []).length} watched games and your settings.`);
});

$("import").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  try {
    const backup = JSON.parse(await file.text());
    if (backup?.app !== "RoCreate" || typeof backup.settings !== "object") throw new Error("not a RoCreate backup");
    const clean = {};
    for (const [k, type] of Object.entries(KEYS)) {
      const v = backup.settings[k];
      if (v === undefined) continue;
      if (k === "watch") {
        if (!Array.isArray(v)) continue;
        clean.watch = v
          .filter((g) => g && /^\d{1,15}$/.test(String(g.id)))
          .slice(0, 60)
          .map((g) => ({ id: String(g.id), place: /^\d{1,15}$/.test(String(g.place)) ? String(g.place) : "", name: String(g.name || "").slice(0, 120) }));
      } else if (typeof v === type) clean[k] = type === "string" ? v.slice(0, 40) : v;
    }
    await chrome.storage.sync.set(clean);
    say("backup-status", `Restored ${(clean.watch || []).length} watched games and ${Object.keys(clean).filter((k) => k !== "watch").length} settings.`);
  } catch (err) {
    say("backup-status", "That file isn't a RoCreate backup.", true);
  }
});

async function cacheInfo() {
  const all = await chrome.storage.local.get(null);
  const keys = Object.keys(all).filter((k) => !k.startsWith("rc:"));
  const bytes = await chrome.storage.local.getBytesInUse(keys);
  return { keys, bytes };
}
cacheInfo().then(({ keys, bytes }) => say("cache-status", `${keys.length} entries, ${(bytes / 1024).toFixed(0)} KB`));

$("clear-cache").addEventListener("click", async () => {
  const { keys } = await cacheInfo();
  await chrome.storage.local.remove(keys); // rc:* (seen version, sort choice, alert baseline) stays
  say("cache-status", `Cleared ${keys.length} entries.`);
});

$("reset").addEventListener("click", async () => {
  if (!confirm("Reset all RoCreate settings and empty your watchlist?")) return;
  await chrome.storage.sync.clear();
  say("reset-status", "Everything is back to the defaults.");
});
