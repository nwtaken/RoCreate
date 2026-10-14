const DEFAULTS = { enabled: true, declutter: true };
const enabled = document.getElementById("enabled");
const declutter = document.getElementById("declutter");

chrome.storage.sync.get(DEFAULTS, (s) => {
  enabled.checked = s.enabled;
  declutter.checked = s.declutter;
});

function save() {
  chrome.storage.sync.set({
    enabled: enabled.checked,
    declutter: declutter.checked,
  });
}

enabled.addEventListener("change", save);
declutter.addEventListener("change", save);
