"""Entry point of RoCreate-Setup.exe: the wizard with the app bundled as payload.zip."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "app"))  # dev runs; frozen has them bundled

import wizard

if getattr(sys, "frozen", False):
    wizard.PAYLOAD = Path(sys._MEIPASS) / "payload.zip"
else:
    wizard.PAYLOAD = Path(__file__).resolve().parent / "build" / "payload.zip"

raise SystemExit(wizard.run("install"))
