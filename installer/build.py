"""Build dist/RoCreate-Setup.exe.

    python installer/build.py

1. PyInstaller builds the app (onedir, windowed)            -> installer/build/app-dist/RoCreate
2. The app + the two Chrome extensions are zipped            -> installer/build/payload.zip
3. PyInstaller builds the wizard (onefile) with that payload -> dist/RoCreate-Setup.exe

Needs: pip install pyinstaller pywebview
"""
import os
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
APP = ROOT / "app"
BUILD = ROOT / "installer" / "build"
DIST = ROOT / "dist"


def pyinstaller(*args) -> None:
    subprocess.run([sys.executable, "-m", "PyInstaller", "--noconfirm", "--clean", *map(str, args)], check=True, cwd=ROOT)


def add_data(src: Path, dest: str) -> str:
    return f"--add-data={src}{os.pathsep}{dest}"


def build_app() -> Path:
    pyinstaller(
        "--windowed", "--name", "RoCreate", "--icon", APP / "icon.ico", "--paths", APP,
        "--distpath", BUILD / "app-dist", "--workpath", BUILD / "app-work", "--specpath", BUILD,
        add_data(APP / "blocklist.txt", "."), add_data(APP / "icon.ico", "."),
        add_data(APP / "wizard_ui", "wizard_ui"), add_data(ROOT / "extensions" / "theme", "theme"),
        APP / "app.py",
    )
    return BUILD / "app-dist" / "RoCreate"


def make_payload(app_dir: Path) -> Path:
    payload = BUILD / "payload.zip"
    payload.unlink(missing_ok=True)
    with zipfile.ZipFile(payload, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for f in app_dir.rglob("*"):
            if f.is_file():
                z.write(f, f.relative_to(app_dir))
        for name in ("theme", "redirect"):
            ext = ROOT / "extensions" / name
            for f in ext.rglob("*"):
                if f.is_file() and f.name != "make_icon.py" and "__pycache__" not in f.parts:
                    z.write(f, Path("extensions") / name / f.relative_to(ext))
    return payload


def build_setup(payload: Path) -> Path:
    pyinstaller(
        "--onefile", "--windowed", "--name", "RoCreate-Setup", "--icon", APP / "icon.ico", "--paths", APP,
        "--distpath", DIST, "--workpath", BUILD / "setup-work", "--specpath", BUILD,
        add_data(payload, "."), add_data(APP / "icon.ico", "."), add_data(APP / "wizard_ui", "wizard_ui"),
        ROOT / "installer" / "setup_main.py",
    )
    return DIST / "RoCreate-Setup.exe"


if __name__ == "__main__":
    shutil.rmtree(BUILD, ignore_errors=True)
    BUILD.mkdir(parents=True)
    payload = make_payload(build_app())
    setup = build_setup(payload)
    print(f"\nBuilt {setup} ({setup.stat().st_size / 1e6:.0f} MB)")
