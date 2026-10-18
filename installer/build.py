"""Build dist/RoCreate-Setup.exe (Windows) or dist/RoCreate.dmg (macOS).

    python installer/build.py

Windows:
1. PyInstaller builds the app (onedir, windowed)            -> installer/build/app-dist/RoCreate
2. The app + the two Chrome extensions are zipped            -> installer/build/payload.zip
3. PyInstaller builds the wizard (onefile) with that payload -> dist/RoCreate-Setup.exe

macOS:
1. PyInstaller builds RoCreate.app, registered for rocreate:// links
2. The app, an Applications link and the two Chrome extensions go into dist/RoCreate.dmg

Needs: pip install -r requirements.txt
"""
import json
import os
import plistlib
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
APP = ROOT / "app"
KEYS = ROOT / "installer" / "keys"   # signing keys fix the extension IDs (not in git)
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
    sys.path.insert(0, str(ROOT / "installer"))
    import crx

    payload = BUILD / "payload.zip"
    payload.unlink(missing_ok=True)
    with zipfile.ZipFile(payload, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for f in app_dir.rglob("*"):
            if f.is_file():
                z.write(f, f.relative_to(app_dir))
        registry = {}
        for name in ("theme", "redirect"):
            ext = ROOT / "extensions" / name
            for f in ext.rglob("*"):
                if f.is_file() and f.name != "make_icon.py" and "__pycache__" not in f.parts:
                    z.write(f, Path("extensions") / name / f.relative_to(ext))
            # Signed .crx so the installer can register it with Chrome (see app/chrome_setup.py)
            packed = BUILD / f"{name}.crx"
            registry[name] = crx.pack(ext, KEYS / f"{name}.pem", packed)
            z.write(packed, Path("extensions") / f"{name}.crx")
        z.writestr("extensions/registry.json", json.dumps(registry, indent=2))
    return payload


def build_setup(payload: Path) -> Path:
    pyinstaller(
        "--onefile", "--windowed", "--name", "RoCreate-Setup", "--icon", APP / "icon.ico", "--paths", APP,
        "--distpath", DIST, "--workpath", BUILD / "setup-work", "--specpath", BUILD,
        add_data(payload, "."), add_data(APP / "icon.ico", "."), add_data(APP / "wizard_ui", "wizard_ui"),
        ROOT / "installer" / "setup_main.py",
    )
    return DIST / "RoCreate-Setup.exe"


def make_icns() -> Path:
    iconset = BUILD / "RoCreate.iconset"
    iconset.mkdir()
    for size in (16, 32, 128, 256):
        for scale in (1, 2):
            px = size * scale
            if px > 256:  # docs/icon.png is 256 px; don't upscale
                continue
            name = f"icon_{size}x{size}{'@2x' if scale == 2 else ''}.png"
            subprocess.run(["sips", "-z", str(px), str(px), ROOT / "docs" / "icon.png", "--out", iconset / name],
                           check=True, capture_output=True)
    icns = BUILD / "RoCreate.icns"
    subprocess.run(["iconutil", "-c", "icns", iconset, "-o", icns], check=True)
    return icns


def build_mac_app() -> Path:
    sys.path.insert(0, str(APP))
    from version import __version__

    pyinstaller(
        "--windowed", "--name", "RoCreate", "--icon", make_icns(), "--paths", APP,
        "--osx-bundle-identifier", "com.nwtaken.rocreate",
        "--distpath", BUILD / "app-dist", "--workpath", BUILD / "app-work", "--specpath", BUILD,
        add_data(APP / "blocklist.txt", "."), add_data(APP / "icon.ico", "."),
        add_data(ROOT / "extensions" / "theme", "theme"),
        "--exclude-module", "webview", "--exclude-module", "tkinter",
        APP / "app.py",
    )
    bundle = BUILD / "app-dist" / "RoCreate.app"
    info = bundle / "Contents" / "Info.plist"
    plist = plistlib.loads(info.read_bytes())
    plist.update({
        "CFBundleDisplayName": "RoCreate",
        "CFBundleShortVersionString": __version__,
        "CFBundleVersion": __version__,
        "CFBundleURLTypes": [{"CFBundleURLName": "RoCreate link", "CFBundleURLSchemes": ["rocreate"]}],
        "LSApplicationCategoryType": "public.app-category.games",
        "NSHighResolutionCapable": True,
        "LSMinimumSystemVersion": "14.0",  # what the PySide6 wheels need
    })
    info.write_bytes(plistlib.dumps(plist))
    # editing Info.plist breaks PyInstaller's ad-hoc signature; sign the bundle again
    subprocess.run(["codesign", "--force", "--deep", "--sign", "-", bundle], check=True)
    return bundle


def build_dmg(bundle: Path) -> Path:
    stage = BUILD / "dmg"
    shutil.copytree(bundle, stage / bundle.name, symlinks=True)
    (stage / "Applications").symlink_to("/Applications")
    for name in ("redirect", "theme"):
        shutil.copytree(ROOT / "extensions" / name, stage / "Chrome extensions" / name,
                        ignore=shutil.ignore_patterns("make_icon.py", "__pycache__"))
    DIST.mkdir(exist_ok=True)
    dmg = DIST / "RoCreate.dmg"
    dmg.unlink(missing_ok=True)
    subprocess.run(["hdiutil", "create", "-volname", "RoCreate", "-srcfolder", stage,
                    "-format", "UDZO", "-ov", dmg], check=True, capture_output=True)
    return dmg


if __name__ == "__main__":
    shutil.rmtree(BUILD, ignore_errors=True)
    BUILD.mkdir(parents=True)
    if sys.platform == "darwin":
        dmg = build_dmg(build_mac_app())
        print(f"\nBuilt {dmg} ({dmg.stat().st_size / 1e6:.0f} MB)")
        raise SystemExit(0)
    payload = make_payload(build_app())
    setup = build_setup(payload)
    print(f"\nBuilt {setup} ({setup.stat().st_size / 1e6:.0f} MB)")
