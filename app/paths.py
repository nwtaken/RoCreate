"""Where everything lives: a dev checkout, or the installed (PyInstaller) build."""
from __future__ import annotations

import os
import sys
from pathlib import Path

FROZEN = bool(getattr(sys, "frozen", False))
APP_DIR = Path(sys.executable).resolve().parent if FROZEN else Path(__file__).resolve().parent
RES_DIR = Path(getattr(sys, "_MEIPASS", APP_DIR))   # read-only resources bundled into the app
ROOT = APP_DIR if FROZEN else APP_DIR.parent        # install dir, or the repo root

# The two Chrome extensions live next to the app so Chrome can load them unpacked.
EXT_DIR = ROOT / "extensions"
REDIRECT_DIR = EXT_DIR / "redirect"
# The app injects the theme from its own bundled copy, so it works whether or not the
# user chose to install the Chrome theme extension.
THEME_DIR = RES_DIR / "theme" if FROZEN else EXT_DIR / "theme"


def _data_dir() -> Path:
    if sys.platform == "win32":
        base = Path(os.environ.get("LOCALAPPDATA") or Path.home() / "AppData" / "Local")
    elif sys.platform == "darwin":
        base = Path.home() / "Library" / "Application Support"
    else:
        base = Path(os.environ.get("XDG_DATA_HOME") or Path.home() / ".local" / "share")
    return base / "RoCreate"


# Per-user data: the browser profile holds the Roblox login cookies, so it never
# lives in the install dir or the repo.
DATA_DIR = _data_dir()
PROFILE = DATA_DIR / "profile"
SETTINGS = DATA_DIR / "settings.json"
ROVALRA_DIR = DATA_DIR / "extensions" / "rovalra"
