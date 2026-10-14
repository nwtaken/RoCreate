// A network rule (not a content script) so the Roblox page is never requested at all:
// the main-frame navigation is redirected to go.html, which hands the URL to the app.
// Sites that only exist on the web stay in Chrome.
const STAY_IN_CHROME = ["create.roblox.com", "devforum.roblox.com", "setup.roblox.com"];

async function sync() {
  const { enabled = true } = await chrome.storage.local.get("enabled");
  const rules = enabled
    ? [
        {
          id: 1,
          priority: 2,
          action: { type: "allow" },
          condition: { requestDomains: STAY_IN_CHROME, resourceTypes: ["main_frame"] },
        },
        {
          id: 2,
          priority: 1,
          action: {
            type: "redirect",
            redirect: { regexSubstitution: chrome.runtime.getURL("go.html") + "#\\1" },
          },
          condition: {
            regexFilter: "^(https?://.*)$",
            requestDomains: ["roblox.com"],
            resourceTypes: ["main_frame"],
          },
        },
      ]
    : [];
  await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: [1, 2], addRules: rules });
  await chrome.action.setBadgeText({ text: enabled ? "" : "OFF" });
}

chrome.runtime.onInstalled.addListener(sync);
chrome.runtime.onStartup.addListener(sync);

chrome.action.onClicked.addListener(async () => {
  const { enabled = true } = await chrome.storage.local.get("enabled");
  await chrome.storage.local.set({ enabled: !enabled });
  await sync();
});
