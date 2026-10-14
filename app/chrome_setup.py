"""Chrome only loads unpacked extensions when the user turns on Developer mode, so the
best we can do is open the right pages and watch Chrome's own profile files to tick
each extension off as soon as it is loaded."""
from __future__ import annotations

import json
import os
import subprocess
import winreg
from pathlib import Path


def chrome_exe() -> Path | None:
    for root in (winreg.HKEY_CURRENT_USER, winreg.HKEY_LOCAL_MACHINE):
        try:
            with winreg.OpenKey(root, r"Software\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe") as k:
                p = Path(winreg.QueryValue(k, ""))
                if p.exists():
                    return p
        except OSError:
            pass
    for base in (os.environ.get("ProgramFiles"), os.environ.get("ProgramFiles(x86)"), os.environ.get("LOCALAPPDATA")):
        if base:
            p = Path(base) / "Google" / "Chrome" / "Application" / "chrome.exe"
            if p.exists():
                return p
    return None


def _norm(path: str) -> str:
    return os.path.normcase(os.path.normpath(path))


def loaded_unpacked() -> set[str]:
    """Folders Chrome currently has loaded as unpacked extensions, in any profile."""
    base = Path(os.environ.get("LOCALAPPDATA", "")) / "Google" / "Chrome" / "User Data"
    found: set[str] = set()
    for prefs in list(base.glob("*/Preferences")) + list(base.glob("*/Secure Preferences")):
        try:
            data = json.loads(prefs.read_text("utf-8"))
        except (OSError, ValueError):
            continue
        for ext in (data.get("extensions", {}).get("settings", {}) or {}).values():
            path = ext.get("path") if isinstance(ext, dict) else None
            if isinstance(path, str) and os.path.isabs(path):
                found.add(_norm(path))
    return found


def is_loaded(folder: Path) -> bool:
    return _norm(str(folder)) in loaded_unpacked()


def open_extensions_page() -> bool:
    exe = chrome_exe()
    if not exe:
        return False
    subprocess.Popen([str(exe), "chrome://extensions"])
    return True


# --------------------------------------------------------------------------
# Installing an extension without the user hunting through Developer mode:
# Chrome picks up a signed .crx registered under this key the next time it starts,
# then asks the user to approve it with the "Action required" button in its toolbar.
# --------------------------------------------------------------------------
EXTENSION_KEY = r"Software\Google\Chrome\Extensions"


def register_crx(ext_id: str, crx_path: Path, version: str) -> None:
    with winreg.CreateKey(winreg.HKEY_CURRENT_USER, f"{EXTENSION_KEY}" + "\\" + ext_id) as k:
        winreg.SetValueEx(k, "path", 0, winreg.REG_SZ, str(crx_path))
        winreg.SetValueEx(k, "version", 0, winreg.REG_SZ, version)


def unregister_crx(ext_id: str) -> None:
    try:
        winreg.DeleteKey(winreg.HKEY_CURRENT_USER, f"{EXTENSION_KEY}" + "\\" + ext_id)
    except OSError:
        pass


def _profile_files():
    base = Path(os.environ.get("LOCALAPPDATA", "")) / "Google" / "Chrome" / "User Data"
    return list(base.glob("*/Preferences")) + list(base.glob("*/Secure Preferences"))


def extension_state(ext_id: str) -> str:
    """'enabled', 'pending' (installed, waiting for the user's OK), or 'missing'."""
    best = "missing"
    for prefs in _profile_files():
        try:
            data = json.loads(prefs.read_text("utf-8"))
        except (OSError, ValueError):
            continue
        entry = (data.get("extensions", {}).get("settings", {}) or {}).get(ext_id)
        if not isinstance(entry, dict):
            continue
        if entry.get("state") == 1 and not entry.get("disable_reasons"):
            return "enabled"
        best = "pending"
    return best


def is_running() -> bool:
    """Chrome only reads the registry at startup, so a running Chrome must be restarted."""
    out = subprocess.run(
        ["tasklist", "/FI", "IMAGENAME eq chrome.exe", "/NH"],
        capture_output=True, text=True, creationflags=subprocess.CREATE_NO_WINDOW,
    ).stdout.lower()
    return "chrome.exe" in out
