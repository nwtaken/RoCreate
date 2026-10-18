"""RoCreate on macOS: the same shell on Qt WebEngine.

macOS's own web view (WKWebView) can't host Chrome extensions, so the Mac app uses
Qt WebEngine, which is Chromium and loads RoValra unpacked. Everything else matches
the Windows app: the theme is injected before the page runs, ads and trackers are
dropped at the network layer, games open straight in the Roblox player, and
rocreate:// links (from the Chrome redirect extension) reuse the running window.
"""
from __future__ import annotations

import ctypes
import ctypes.util
import json
import mimetypes
import os
import re
import subprocess
import sys
import threading
import time
from pathlib import Path

import app as shared
import paths
import rovalra
from paths import PROFILE, RES_DIR, ROVALRA_DIR, SETTINGS, THEME_DIR

GAME_SCHEMES = ("roblox-player:", "roblox:", "roblox-studio:")

# Same switches as the Windows build; Chromium reads them when Qt WebEngine starts.
os.environ.setdefault(
    "QTWEBENGINE_CHROMIUM_FLAGS", "--disable-features=ElasticOverscroll --force-prefers-reduced-motion"
)

from PySide6.QtCore import QBuffer, QByteArray, QEvent, QObject, Qt, QTimer, QUrl, Signal, Slot  # noqa: E402
from PySide6.QtGui import QColor, QDesktopServices, QIcon, QKeySequence, QShortcut  # noqa: E402
from PySide6.QtWebEngineCore import (  # noqa: E402
    QWebEnginePage,
    QWebEngineProfile,
    QWebEngineProfileBuilder,
    QWebEngineScript,
    QWebEngineUrlRequestInterceptor,
    QWebEngineUrlRequestJob,
    QWebEngineUrlScheme,
    QWebEngineUrlSchemeHandler,
)
from PySide6.QtWebEngineWidgets import QWebEngineView  # noqa: E402
from PySide6.QtWidgets import QApplication, QMainWindow  # noqa: E402

_log = shared._log


_watcher = None  # GameWatcher, set in main()


def launch_game(uri: str) -> None:
    """The Roblox app registers roblox:// and roblox-player:// with macOS, so hand the link to it."""
    _log("[rocreate] launching game")
    subprocess.Popen(["open", uri], close_fds=True)
    if _watcher is not None and not uri.startswith("roblox-studio:"):
        _watcher.watch()


class GameWatcher:
    """Follows the Roblox app's log after a launch and calls on_left() (from its own thread)
    once the game has started and then ended. The app itself keeps running in its own home
    screen, which is why the log is the only signal."""

    LOGS = Path.home() / "Library" / "Logs" / "Roblox"
    STARTED = "[FLog::SingleSurfaceApp] launchUGCGameInternal"
    ENDED = (
        "[FLog::SingleSurfaceApp] leaveUGCGameInternal",
        "[FLog::SingleSurfaceApp] returnToLuaApp",
        "[FLog::SingleSurfaceApp] shutDown",
    )

    def __init__(self, on_left):
        self._on_left = on_left
        self._gen = 0

    def watch(self) -> None:
        self._gen += 1  # a newer launch replaces the running watch
        threading.Thread(target=self._run, args=(self._gen,), daemon=True).start()

    def _logs(self) -> list[Path]:
        cutoff = time.time() - 6 * 3600
        out = []
        for f in self.LOGS.glob("*Player*.log"):
            try:
                if "CrashHandler" not in f.name and f.stat().st_mtime > cutoff:
                    out.append(f)
            except OSError:
                pass
        return out

    def _run(self, gen: int) -> None:
        offsets = {}  # logs that already exist: only what is written from now on counts
        for f in self._logs():
            offsets[f] = f.stat().st_size
        give_up = time.time() + 180  # the game never started (not logged in, cancelled, ...)
        in_game = False
        while gen == self._gen:
            for f in self._logs():
                try:
                    size = f.stat().st_size
                    pos = offsets.get(f, 0)
                    if size <= pos:
                        continue
                    with f.open("rb") as fh:
                        fh.seek(pos)
                        chunk = fh.read(size - pos)
                except OSError:
                    continue
                end = chunk.rfind(b"\n") + 1  # a half-written line is read next time
                offsets[f] = pos + end
                for line in chunk[:end].decode("utf-8", "replace").splitlines():
                    if self.STARTED in line:
                        in_game = True
                    elif in_game and any(m in line for m in self.ENDED):
                        self._on_left()
                        return
            if not in_game and time.time() > give_up:
                return
            time.sleep(0.5)


def hide_app(bundle_id: str) -> None:
    """NSRunningApplication.hide for every running copy of bundle_id (AppKit via the ObjC runtime)."""
    objc = ctypes.cdll.LoadLibrary(ctypes.util.find_library("objc"))
    ctypes.cdll.LoadLibrary(ctypes.util.find_library("AppKit"))
    objc.objc_getClass.restype = objc.sel_registerName.restype = ctypes.c_void_p
    send = ctypes.cast(objc.objc_msgSend, ctypes.c_void_p).value

    def msg(restype, *argtypes):
        return ctypes.CFUNCTYPE(restype, ctypes.c_void_p, ctypes.c_void_p, *argtypes)(send)

    def sel(name):
        return objc.sel_registerName(name.encode())

    name = msg(ctypes.c_void_p, ctypes.c_char_p)(
        objc.objc_getClass(b"NSString"), sel("stringWithUTF8String:"), bundle_id.encode())
    apps = msg(ctypes.c_void_p, ctypes.c_void_p)(
        objc.objc_getClass(b"NSRunningApplication"), sel("runningApplicationsWithBundleIdentifier:"), name)
    for i in range(msg(ctypes.c_ulong)(apps, sel("count"))):
        app = msg(ctypes.c_void_p, ctypes.c_ulong)(apps, sel("objectAtIndex:"), i)
        msg(ctypes.c_bool)(app, sel("hide"))


class Blocker(QWebEngineUrlRequestInterceptor):
    def __init__(self, hosts: list[str]):
        super().__init__()
        self._hosts = hosts

    def interceptRequest(self, info):
        host = info.requestUrl().host().lower()
        if any(b in host for b in self._hosts):
            info.block(True)


def register_scheme() -> None:
    """Must run before the QApplication exists."""
    scheme = QWebEngineUrlScheme(rovalra.QT_SCHEME.encode())
    scheme.setSyntax(QWebEngineUrlScheme.Syntax.Host)
    scheme.setFlags(
        QWebEngineUrlScheme.Flag.SecureScheme
        | QWebEngineUrlScheme.Flag.CorsEnabled
        | QWebEngineUrlScheme.Flag.FetchApiAllowed
        | QWebEngineUrlScheme.Flag.ContentSecurityPolicyIgnored  # roblox.com's CSP would block it
    )
    QWebEngineUrlScheme.registerScheme(scheme)
    # Qt silently drops script navigations to schemes it doesn't know (the site's Play button
    # sets location.href = "roblox-player:..."), so the game links are registered as well and
    # end up in Page.acceptNavigationRequest / GameLinks.
    for name in GAME_SCHEMES:
        game = QWebEngineUrlScheme(name.rstrip(":").encode())
        game.setSyntax(QWebEngineUrlScheme.Syntax.Path)
        game.setFlags(QWebEngineUrlScheme.Flag.ContentSecurityPolicyIgnored)
        QWebEngineUrlScheme.registerScheme(game)


class ExtensionFiles(QWebEngineUrlSchemeHandler):
    """Serves rocreate-ext://rovalra/<path> from RoValra's folder (see rovalra.patch_for_qt)."""

    def requestStarted(self, job):
        root = ROVALRA_DIR.resolve()
        path = (root / job.requestUrl().path().lstrip("/")).resolve()
        if job.requestUrl().host() != "rovalra" or root not in path.parents or not path.is_file():
            job.fail(QWebEngineUrlRequestJob.Error.UrlNotFound)
            return
        buf = QBuffer(job)
        buf.setData(QByteArray(path.read_bytes()))
        buf.open(QBuffer.OpenModeFlag.ReadOnly)
        job.setAdditionalResponseHeaders({QByteArray(b"Access-Control-Allow-Origin"): QByteArray(b"*")})
        mime = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        job.reply(mime.encode(), buf)


class GameLinks(QWebEngineUrlSchemeHandler):
    """Game links that reach the network layer (iframes, fetches) instead of a navigation."""

    def requestStarted(self, job):
        launch_game(job.requestUrl().toString())
        job.fail(QWebEngineUrlRequestJob.Error.RequestAborted)


class Page(QWebEnginePage):
    def acceptNavigationRequest(self, url, nav_type, is_main_frame):
        if url.toString().startswith(GAME_SCHEMES):
            launch_game(url.toString())
            return False
        return super().acceptNavigationRequest(url, nav_type, is_main_frame)

    def createWindow(self, _type):
        return _Popup(self)

    def route(self, url: QUrl) -> None:
        """Where a window.open / target=_blank link goes (same rules as the Windows app)."""
        s = url.toString()
        if s.startswith(GAME_SCHEMES):
            launch_game(s)
        elif "roblox.com" in url.host():
            self.load(url)
        else:
            QDesktopServices.openUrl(url)


class _Popup(QWebEnginePage):
    """Catches the first real URL a new window asks for, hands it to the opener, and goes away."""

    def __init__(self, opener: Page):
        super().__init__(opener.profile(), opener)
        self._opener = opener

    def acceptNavigationRequest(self, url, _nav_type, _is_main_frame):
        if url.scheme() == "about":
            return True
        self._opener.route(url)
        self.deleteLater()
        return False


class Window(QMainWindow):
    def __init__(self, profile: QWebEngineProfile):
        super().__init__()
        self.setWindowTitle("RoCreate")
        self.setMinimumSize(900, 600)
        saved = shared.load_settings()
        self.resize(saved.get("width", 1400), saved.get("height", 900))
        if saved.get("x") is not None and saved.get("y") is not None:
            self.move(saved["x"], saved["y"])

        self.view = QWebEngineView(self)
        self.page = Page(profile, self.view)
        self.page.setBackgroundColor(QColor("#0e0f11"))
        self.view.setPage(self.page)
        self.setCentralWidget(self.view)

        for keys, action in (
            ("Ctrl+R", self.view.reload),
            ("Ctrl+[", self.view.back),
            ("Ctrl+]", self.view.forward),
            ("Ctrl+Meta+F", lambda: self.showNormal() if self.isFullScreen() else self.showFullScreen()),
        ):  # Qt maps Ctrl to the Command key on macOS
            QShortcut(QKeySequence(keys), self, action)

    def front(self) -> None:
        if self.isMinimized():
            self.showNormal()
        self.show()
        self.raise_()
        self.activateWindow()

    def closeEvent(self, event):
        if not self.isFullScreen():
            try:
                SETTINGS.parent.mkdir(parents=True, exist_ok=True)
                data = shared.load_settings()  # keep the other keys (e.g. blockAds)
                g = self.geometry()
                data.update({"x": g.x(), "y": g.y(), "width": g.width(), "height": g.height()})
                SETTINGS.write_text(json.dumps(data, indent=2), "utf-8")
            except Exception:
                pass
        super().closeEvent(event)


class App(QApplication):
    """Also receives rocreate:// links: macOS delivers them as an Apple Event, not argv."""

    link = Signal(object)  # a roblox.com URL, or None to just come to the front

    def event(self, e):
        if e.type() == QEvent.Type.FileOpen and e.url().scheme() == "rocreate":
            arg = e.url().toString()
            rid = shared.parse_id([arg])
            if rid:
                shared._seen.add(rid)
            self.link.emit(shared.parse_target([arg]))
            return True
        return super().event(e)


class Bridge(QObject):
    """Moves results from worker threads onto the UI thread (its slots run there)."""

    link = Signal(object)
    rovalra_ready = Signal()
    game_left = Signal()

    def __init__(self, on_link, on_rovalra, on_game_left):
        super().__init__()
        self._on_link, self._on_rovalra, self._on_game_left = on_link, on_rovalra, on_game_left
        self.link.connect(self._link)
        self.rovalra_ready.connect(self._rovalra)
        self.game_left.connect(self._game_left)

    @Slot()
    def _game_left(self):
        self._on_game_left()

    @Slot(object)
    def _link(self, url):
        self._on_link(url)

    @Slot()
    def _rovalra(self):
        self._on_rovalra()


_scheme_handler = _game_links = None


def make_profile() -> QWebEngineProfile:
    global _scheme_handler, _game_links
    _scheme_handler, _game_links = ExtensionFiles(), GameLinks()
    # The path has to be set through the builder: changing it on a live profile leaves the
    # extension manager on the old one, and enabling an extension then crashes.
    builder = QWebEngineProfileBuilder()
    builder.setPersistentStoragePath(str(PROFILE))
    builder.setCachePath(str(paths.DATA_DIR / "cache"))
    builder.setPersistentCookiesPolicy(QWebEngineProfile.PersistentCookiesPolicy.ForcePersistentCookies)
    profile = builder.createProfile("RoCreate")
    # Qt's user agent carries "QtWebEngine/x.y", which RoValra's servers rate-limit as an
    # unknown client; the plain Chrome user agent underneath is the honest engine name.
    profile.setHttpUserAgent(re.sub(r" QtWebEngine/\S+", "", profile.httpUserAgent()))
    profile.installUrlSchemeHandler(rovalra.QT_SCHEME.encode(), _scheme_handler)
    for name in GAME_SCHEMES:
        profile.installUrlSchemeHandler(name.rstrip(":").encode(), _game_links)

    script = QWebEngineScript()
    script.setName("rocreate")
    script.setSourceCode(shared.build_payload(window_controls=False, instant_play=True))
    script.setInjectionPoint(QWebEngineScript.InjectionPoint.DocumentCreation)
    script.setWorldId(QWebEngineScript.ScriptWorldId.MainWorld)
    script.setRunsOnSubFrames(False)
    profile.scripts().insert(script)
    return profile


def main() -> int:
    target = shared.parse_target(sys.argv[1:])
    rid = shared.parse_id(sys.argv[1:])
    if shared.forward_to_running(target, rid):
        return 0
    server = shared.bind_ipc()
    if server is None and shared.forward_to_running(target, rid):
        return 0
    if rid:
        shared._seen.add(rid)

    if not (THEME_DIR / "theme.css").exists():
        _log(f"[rocreate] theme not found at {THEME_DIR}")
        return 1
    PROFILE.mkdir(parents=True, exist_ok=True)

    register_scheme()
    qt = App(sys.argv[:1])
    qt.setApplicationName("RoCreate")
    qt.setWindowIcon(QIcon(str(RES_DIR / "icon.ico")))
    qt.styleHints().setColorScheme(Qt.ColorScheme.Dark)  # dark native title bar

    profile = make_profile()
    blocked = shared.load_blocklist() if shared.load_settings().get("blockAds", True) else []
    blocker = Blocker(blocked)
    profile.setUrlRequestInterceptor(blocker)

    win = Window(profile)
    # Links that come in before the first page (a link that launched the app arrives as a
    # FileOpen event right after startup) replace the start page instead of racing it.
    state = {"url": target or shared.START_URL, "started": False}

    def open_link(url):
        if not state["started"]:
            state["url"] = url or state["url"]
            return
        if url:
            win.page.load(QUrl(url))
        win.front()

    def go():
        if state["started"]:
            return
        state["started"] = True
        _log(f"[rocreate] ready, blocking {len(blocked)} hosts")
        win.page.load(QUrl(state["url"]))
        threading.Thread(
            target=rovalra.update_if_stale,
            args=(ROVALRA_DIR, stamp, 7, _log),
            daemon=True,
        ).start()

    stamp = paths.DATA_DIR / "rovalra-checked"

    # RoValra is loaded and switched on before the first page, so it runs on that page too.
    manager = profile.extensionManager()

    def on_loaded(info):
        if info.isLoaded():
            if not info.isEnabled():
                manager.setExtensionEnabled(info, True)
            _log("[rocreate] extension loaded: rovalra")
        else:
            _log(f"[rocreate] extension rovalra failed: {info.error()}")
        go()

    def load_rovalra():
        if not rovalra.installed_version(ROVALRA_DIR):
            go()
            return
        rovalra.patch_for_qt(ROVALRA_DIR)
        manager.loadFinished.connect(on_loaded)
        manager.loadExtension(str(ROVALRA_DIR))

    def fetch_rovalra():  # downloaded on first launch, retried if that was offline
        if not rovalra.installed_version(ROVALRA_DIR):
            try:
                rovalra.install(ROVALRA_DIR, _log)
                stamp.parent.mkdir(parents=True, exist_ok=True)
                stamp.write_text(str(time.time()))  # fresh: skip the weekly check this launch
            except Exception as e:
                _log(f"[rocreate] RoValra download failed, continuing without it: {e}")
        bridge.rovalra_ready.emit()

    def back_from_game():
        """Left a game: put the Roblox app away (still running, so the next launch is instant)."""
        _log("[rocreate] game ended, back to RoCreate")
        try:
            hide_app("com.roblox.RobloxPlayer")
        except Exception as e:
            _log(f"[rocreate] could not hide Roblox: {e}")
        win.front()

    global _watcher
    bridge = Bridge(open_link, load_rovalra, back_from_game)
    _watcher = GameWatcher(bridge.game_left.emit)
    qt.link.connect(open_link)
    QTimer.singleShot(20000, go)  # never wait forever on the download or the extension
    threading.Thread(target=fetch_rovalra, daemon=True).start()
    if server is not None:
        threading.Thread(target=shared.serve_ipc, args=(server, bridge.link.emit), daemon=True).start()

    win.show()
    code = qt.exec()
    if server is not None:
        server.close()
    return code
