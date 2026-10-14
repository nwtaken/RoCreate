"""The RoCreate install / uninstall / Chrome-setup wizard (HTML UI in wizard_ui/).

`RoCreate-Setup.exe` runs it in install mode with the app bundled as payload.zip;
the installed `RoCreate.exe --uninstall` and `--chrome-setup` reuse the same window.
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import zipfile
from pathlib import Path

import paths
from version import __version__

PAYLOAD: Path | None = None   # set by installer/setup_main.py
EXE_NAME = "RoCreate.exe"
EXTENSIONS = (
    ("redirect", "RoCreate Redirect", "Sends every roblox.com link to the app instead of loading the site in Chrome."),
    ("theme", "RoCreate Theme", "The RoCreate look for roblox.com inside Chrome (the app already has it built in)."),
)


def default_install_dir() -> Path:
    return Path(os.environ.get("LOCALAPPDATA", str(Path.home()))) / "Programs" / "RoCreate"


class Wizard:
    def __init__(self, mode: str):
        self.mode = mode
        self._window = None
        self._install_dir = paths.ROOT if paths.FROZEN else default_install_dir()
        self._cleanup: list[Path] = []

    # ---- UI plumbing -----------------------------------------------------
    def _emit(self, **data) -> None:
        if self._window is not None:
            self._window.evaluate_js(f"window.onWizard({json.dumps(data)})")

    def get_info(self) -> dict:
        from chrome_setup import chrome_exe
        return {
            "mode": self.mode,
            "version": __version__,
            "defaultDir": str(self._install_dir),
            "chromeFound": chrome_exe() is not None,
            "payloadOk": bool(PAYLOAD and PAYLOAD.exists()),
            "extensions": self.installed_extensions(),
        }

    def installed_extensions(self) -> list[dict]:
        """The Chrome extensions that are actually on disk (the user may have skipped some)."""
        return [
            {"id": i, "name": n, "desc": d}
            for i, n, d in EXTENSIONS
            if (self._ext_path(i) / "manifest.json").exists()
        ]

    def open_url(self, key: str) -> None:
        import webbrowser
        urls = {"rovalra": "https://github.com/NotValra/RoValra"}
        if key in urls:
            webbrowser.open(urls[key])

    def browse(self, current: str = "") -> str | None:
        import webview
        picked = self._window.create_file_dialog(webview.FileDialog.FOLDER, directory=current or str(self._install_dir))
        return str(Path(picked[0]) / "RoCreate") if picked else None

    def close(self) -> None:
        self._window.destroy()

    # ---- Chrome setup ----------------------------------------------------
    def _ext_path(self, ext_id: str) -> Path:
        return self._install_dir / "extensions" / ext_id

    def chrome_status(self) -> list[dict]:
        import chrome_setup
        loaded = chrome_setup.loaded_unpacked()
        return [
            {"id": i, "loaded": chrome_setup._norm(str(self._ext_path(i))) in loaded}
            for i, _, _ in EXTENSIONS
        ]

    def open_chrome(self) -> bool:
        import chrome_setup
        return chrome_setup.open_extensions_page()

    def show_folder(self, ext_id: str) -> None:
        if ext_id in {i for i, _, _ in EXTENSIONS}:
            subprocess.Popen(["explorer.exe", str(self._ext_path(ext_id))])

    def launch_app(self) -> None:
        exe = self._install_dir / EXE_NAME
        if exe.exists():
            subprocess.Popen([str(exe)], cwd=str(self._install_dir), creationflags=subprocess.CREATE_NEW_PROCESS_GROUP)

    # ---- install ---------------------------------------------------------
    def start_install(self, opts: dict) -> None:
        threading.Thread(target=self._install, args=(opts,), daemon=True).start()

    def _install(self, opts: dict) -> None:
        import rovalra
        import system_integration as si
        try:
            target = Path(opts["dir"]).expanduser()
            if len(target.parts) < 3:
                raise RuntimeError("Please choose a folder, not a drive root.")
            if not (PAYLOAD and PAYLOAD.exists()):
                raise RuntimeError("This setup file is missing its payload. Please download it again.")
            self._install_dir = target
            exe = target / EXE_NAME

            self._emit(step="Closing RoCreate if it is running…", pct=3)
            if exe.exists():
                si.kill_running(exe)

            self._emit(step="Copying files…", pct=6)
            for stale in ("_internal", "extensions/theme", "extensions/redirect"):
                shutil.rmtree(target / stale, ignore_errors=True)
            target.mkdir(parents=True, exist_ok=True)
            skipped = tuple(
                f"extensions/{ext}/" for ext in ("redirect", "theme") if not opts.get(ext)
            )
            with zipfile.ZipFile(PAYLOAD) as z:
                names = [n for n in z.namelist() if not n.startswith(skipped)]
                root = target.resolve()
                for n, member in enumerate(names, 1):
                    dest = (target / member).resolve()
                    if root not in dest.parents and dest != root:
                        raise RuntimeError(f"unsafe path in payload: {member}")
                    z.extract(member, target)
                    if n % 40 == 0:
                        self._emit(pct=6 + int(64 * n / len(names)))

            if opts.get("rovalra"):
                self._emit(step="Downloading RoValra from the Chrome Web Store…", pct=72)
                try:
                    version = rovalra.install(paths.ROVALRA_DIR, lambda m: None)
                    self._emit(note=f"RoValra {version} installed")
                except Exception as e:  # offline etc: the app retries on first launch
                    self._emit(note=f"RoValra could not be downloaded now ({e}). It will be retried when RoCreate starts.")

            self._emit(step="Saving your choices…", pct=88)
            paths.SETTINGS.parent.mkdir(parents=True, exist_ok=True)
            try:
                settings = json.loads(paths.SETTINGS.read_text("utf-8"))
            except (OSError, ValueError):
                settings = {}
            settings["blockAds"] = bool(opts.get("blockAds", True))
            paths.SETTINGS.write_text(json.dumps(settings, indent=2), "utf-8")

            self._emit(step="Creating shortcuts…", pct=90)
            icon = exe
            if opts.get("desktop"):
                si.create_shortcut(si.desktop_dir() / "RoCreate.lnk", exe, icon)
            if opts.get("startmenu"):
                si.create_shortcut(si.start_menu_dir() / "RoCreate.lnk", exe, icon)

            self._emit(step="Registering RoCreate…", pct=95)
            si.register_protocol(f'"{exe}" "%1"', exe)
            size_kb = sum(f.stat().st_size for f in target.rglob("*") if f.is_file()) // 1024
            si.add_uninstall_entry(target, exe, __version__, size_kb)

            self._emit(done=True, pct=100, dir=str(target))
        except Exception as e:
            self._emit(error=str(e))

    # ---- uninstall -------------------------------------------------------
    def start_uninstall(self, opts: dict) -> None:
        threading.Thread(target=self._uninstall, args=(opts,), daemon=True).start()

    def _uninstall(self, opts: dict) -> None:
        import system_integration as si
        try:
            self._emit(step="Closing RoCreate…", pct=10)
            si.kill_running(self._install_dir / EXE_NAME)
            self._emit(step="Removing shortcuts and registry entries…", pct=40)
            for lnk in (si.desktop_dir() / "RoCreate.lnk", si.start_menu_dir() / "RoCreate.lnk"):
                lnk.unlink(missing_ok=True)
            si.unregister_protocol()
            si.remove_uninstall_entry()
            self._cleanup.append(self._install_dir)
            if opts.get("deleteData"):
                self._emit(step="Removing your RoCreate data…", pct=70)
                self._cleanup.append(paths.DATA_DIR)
            self._emit(done=True, pct=100)
        except Exception as e:
            self._emit(error=str(e))

    def finish_uninstall(self) -> None:
        """The wizard runs from the install folder, so delete it once this process has exited."""
        for d in self._cleanup:
            # CREATE_NO_WINDOW alone: combined with DETACHED_PROCESS it is ignored and a console opens
            subprocess.Popen(
                f'cmd.exe /c ping -n 4 127.0.0.1 >nul & rmdir /s /q "{d}"', shell=False,
                creationflags=subprocess.CREATE_NO_WINDOW | subprocess.CREATE_NEW_PROCESS_GROUP,
            )
        self.close()


def run(mode: str) -> int:
    import webview
    wiz = Wizard(mode)
    os.environ["WEBVIEW2_USER_DATA_FOLDER"] = str(Path(tempfile.gettempdir()) / "RoCreate-wizard")
    ui = paths.RES_DIR / "wizard_ui" / "index.html"
    wiz._window = webview.create_window(
        "RoCreate Setup" if mode == "install" else "RoCreate",
        str(ui), js_api=wiz, width=780, height=690, frameless=True, easy_drag=False,
        resizable=False, background_color="#0e0f11",
    )
    webview.start(private_mode=False, storage_path=os.environ["WEBVIEW2_USER_DATA_FOLDER"], debug=False)
    return 0
