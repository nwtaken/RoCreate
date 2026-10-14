"""RoCreate — a lightweight Roblox website shell (Windows, WebView2).

Uses the WebView2 runtime that is already installed on Windows, so the app
itself is small instead of bundling Chromium like Electron would.

What it does that a browser tab can't:
  * injects the RoCreate theme at document-create time (no unstyled flash)
  * drops ad / telemetry requests at the network layer (see blocklist.txt)
  * launches games straight into RobloxPlayerBeta.exe, skipping the
    "open this link?" protocol prompt
  * keeps its own persistent profile, so you stay logged in
  * loads the real RoValra extension (downloaded at install time, see rovalra.py)

Run from a checkout: python app/app.py
"""
from __future__ import annotations

import base64
import json
import os
import re
import socket
import subprocess
import sys
import threading
import time
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

import paths
from paths import PROFILE, RES_DIR, ROVALRA_DIR, SETTINGS, THEME_DIR

START_URL = "https://www.roblox.com/home"

_handlers = []  # keep .NET delegates alive; GC'd handlers silently stop firing

# Same mark as icon.ico (tilted rounded square, square cut out), white on transparent.
LOGO_SVG = (
    "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><defs><mask id='m'>"
    "<rect width='100' height='100' fill='black'/><g transform='rotate(-15 50 50)'>"
    "<rect x='14' y='14' width='72' height='72' rx='12' fill='white'/>"
    "<rect x='37' y='37' width='26' height='26' rx='6' fill='black'/></g></mask></defs>"
    "<rect width='100' height='100' fill='#f7f7f8' mask='url(#m)'/></svg>"
)
LOGO_B64 = base64.b64encode(LOGO_SVG.encode()).decode()
# Sized variant used as the "O" of the wordmark (a CSS content image needs an intrinsic size).
LOGO_O_B64 = base64.b64encode(
    LOGO_SVG.replace("viewBox='0 0 100 100'", "width='18' height='12' viewBox='-5 8 126 84'", 1).encode()
).decode()


# --------------------------------------------------------------------------
# settings (window geometry)
# --------------------------------------------------------------------------
def load_settings() -> dict:
    try:
        return json.loads(SETTINGS.read_text("utf-8"))
    except Exception:
        return {}


def save_settings(window) -> None:
    try:
        SETTINGS.parent.mkdir(parents=True, exist_ok=True)
        data = load_settings()  # keep the other keys (e.g. blockAds from the installer)
        data.update({"x": window.x, "y": window.y, "width": window.width, "height": window.height})
        SETTINGS.write_text(json.dumps(data, indent=2), "utf-8")
    except Exception:
        pass


# --------------------------------------------------------------------------
# injected payload: the RoCreate theme (same files as the Chrome extension)
# --------------------------------------------------------------------------
def build_payload() -> str:
    css = (THEME_DIR / "theme.css").read_text("utf-8")
    content_js = (THEME_DIR / "content.js").read_text("utf-8")
    greeting_js = (THEME_DIR / "greeting.js").read_text("utf-8")

    # content.js is written as a Chrome content script; give it the tiny slice
    # of the extension API it uses so the same file runs unmodified here.
    return ("""(() => {
  if (window.__rocreate) return;
  window.__rocreate = true;

  window.chrome = window.chrome || {};
  chrome.storage = {
    sync: { get: (d, cb) => cb(d), set: () => {} },
    onChanged: { addListener: () => {} },
  };

  const css = %s;

  const TITLEBAR_CSS = `
    #rc-titlebar {
      position: fixed; top: 0; right: 0; height: 56px; z-index: 2147483647;
      display: flex; align-items: center; gap: 4px; padding-right: 10px; user-select: none;
    }
    #rc-titlebar button {
      background: none; border: none; color: #a3a5ad; width: 34px; height: 34px;
      border-radius: 9px; display: flex; align-items: center; justify-content: center;
      cursor: default; padding: 0; transition: background .12s, color .12s, transform .08s;
    }
    #rc-titlebar button:hover { background: rgba(255,255,255,.09); color: #fff; }
    #rc-titlebar button:active { transform: scale(.92); }
    #rc-titlebar .rc-close:hover { background: #e5484d; color: #fff; }
    #rc-titlebar svg {
      width: 14px; height: 14px; fill: none; stroke: currentColor;
      stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round;
    }
    #rc-titlebar:not(.rc-max) .i-restore, #rc-titlebar.rc-max .i-max { display: none; }
    #rc-drag-region {
      position: fixed; top: 0; left: 0; right: 132px; height: 10px;
      z-index: 2147483646;
    }
    #right-navigation-header { margin-right: 132px !important; }
    #header #nav-logo-link { display: flex !important; align-items: center; gap: 10px; text-decoration: none; }
    #header ul.nav.rbx-navbar { margin-left: 28px !important; }
    #header #nav-logo-link > * { display: none !important; }
    #header #nav-logo-link::before {
      content: ""; width: 26px; height: 26px; flex: none;
      background: url(data:image/svg+xml;base64,__LOGO__) center / contain no-repeat;
    }
    #header #nav-logo-link::after {
      content: "R" url(data:image/svg+xml;base64,__LOGO_O__) "CREATE";
      font-weight: 800; font-size: 17px; letter-spacing: .14em; color: #fff; line-height: 1; white-space: nowrap; flex: none;
    }
  `;

  function injectStyle() {
    if (document.getElementById('rocreate-theme')) return;
    var s = document.createElement('style');
    s.id = 'rocreate-theme';
    s.textContent = css + TITLEBAR_CSS;
    var target = document.head || document.documentElement;
    if (target) { target.appendChild(s); return; }
    new MutationObserver(function(_, obs) {
      var t = document.head || document.documentElement;
      if (t) { obs.disconnect(); t.appendChild(s); }
    }).observe(document, {childList: true, subtree: true});
  }

  function injectTitlebar() {
    if (document.getElementById('rc-titlebar')) return;
    var bar = document.createElement('div');
    bar.id = 'rc-titlebar';
    bar.innerHTML =
      '<button data-a="minimize" title="Minimize"><svg viewBox="0 0 14 14"><path d="M3 7h8"/></svg></button>' +
      '<button data-a="toggle_maximize" title="Maximize">' +
        '<svg class="i-max" viewBox="0 0 14 14"><rect x="2.5" y="2.5" width="9" height="9" rx="2.5"/></svg>' +
        '<svg class="i-restore" viewBox="0 0 14 14"><rect x="2.5" y="4.5" width="7" height="7" rx="2"/>' +
        '<path d="M5 3.8A1.3 1.3 0 0 1 6.3 2.5H10.2A1.3 1.3 0 0 1 11.5 3.8V7.7A1.3 1.3 0 0 1 10.2 9H9.5"/></svg></button>' +
      '<button data-a="close" class="rc-close" title="Close"><svg viewBox="0 0 14 14"><path d="M3.2 3.2l7.6 7.6M10.8 3.2l-7.6 7.6"/></svg></button>';
    bar.addEventListener('click', function(e) {
      var b = e.target.closest('button');
      var api = window.pywebview && window.pywebview.api;
      if (!b || !api) return;
      var r = api[b.dataset.a]();
      if (b.dataset.a === 'toggle_maximize' && r && r.then) r.then(syncState);
    });
    document.body.appendChild(bar);

    var drag = document.createElement('div');
    drag.id = 'rc-drag-region';
    drag.className = 'pywebview-drag-region';
    drag.addEventListener('dblclick', function() {
      if (window.pywebview && window.pywebview.api) window.pywebview.api.toggle_maximize().then(syncState);
    });
    document.body.appendChild(drag);
  }

  // The window's real state is the source of truth (Win+Up, snapping, F11 all change it).
  function syncState(s) {
    var bar = document.getElementById('rc-titlebar');
    if (bar && s) bar.classList.toggle('rc-max', !!s.maximized);
  }
  var syncTimer = 0;
  window.addEventListener('resize', function() {
    clearTimeout(syncTimer);
    syncTimer = setTimeout(function() {
      if (window.pywebview && window.pywebview.api) window.pywebview.api.get_state().then(syncState);
    }, 150);
  });

  window.addEventListener('keydown', function(e) {
    if (e.key !== 'F11' || !window.pywebview || !window.pywebview.api) return;
    e.preventDefault();
    window.pywebview.api.toggle_fullscreen().then(syncState);
  }, true);

  injectStyle();
  if (document.body) injectTitlebar();
  else new MutationObserver(function(_, obs) {
    if (!document.body) return;
    obs.disconnect();
    injectTitlebar();
  }).observe(document, {childList: true, subtree: true});

  // Re-inject if Roblox rebuilds the header (SPA navigation)
  new MutationObserver(function() {
    if (!document.getElementById('rc-titlebar')) injectTitlebar();
  }).observe(document, {childList: true, subtree: true});

  %s

  %s
})();""" % (json.dumps(css), content_js, greeting_js)).replace("__LOGO__", LOGO_B64).replace("__LOGO_O__", LOGO_O_B64)


# --------------------------------------------------------------------------
# blocklist
# --------------------------------------------------------------------------
def load_blocklist() -> list[str]:
    try:
        lines = (RES_DIR / "blocklist.txt").read_text("utf-8").splitlines()
    except FileNotFoundError:
        return []
    return [s.strip() for s in lines if s.strip() and not s.lstrip().startswith("#")]


# --------------------------------------------------------------------------
# launching games
# --------------------------------------------------------------------------
def find_player() -> str | None:
    versions = Path(os.environ["LOCALAPPDATA"]) / "Roblox" / "Versions"
    newest, newest_mtime = None, -1.0
    for exe in versions.glob("*/RobloxPlayerBeta.exe"):
        mtime = exe.stat().st_mtime
        if mtime > newest_mtime:
            newest, newest_mtime = exe, mtime
    return str(newest) if newest else None


def launch_game(uri: str) -> None:
    """Hand a roblox-player:// URI to the real client."""
    player = find_player()
    if not player:
        _log("[rocreate] RobloxPlayerBeta.exe not found; falling back to the shell")
        os.startfile(uri)  # noqa: S606 - let Windows resolve the protocol
        return
    _log("[rocreate] launching game")
    subprocess.Popen([player, unquote(uri)], close_fds=True)


# --------------------------------------------------------------------------
# native WebView2 wiring (all CoreWebView2 calls must run on the UI thread)
# --------------------------------------------------------------------------
def _log(msg: str) -> None:
    """Console when there is one (dev), otherwise a small log file (windowed build has no stdout)."""
    if sys.stdout is not None and sys.stdout.isatty():
        print(msg, flush=True)
        return
    try:
        log = paths.DATA_DIR / "rocreate.log"
        log.parent.mkdir(parents=True, exist_ok=True)
        if log.exists() and log.stat().st_size > 256 * 1024:
            log.unlink()
        with log.open("a", encoding="utf-8") as f:
            f.write(f"{time.strftime('%Y-%m-%d %H:%M:%S')} {msg}\n")
    except OSError:
        pass


def enable_extensions() -> None:
    """pywebview creates WebView2 with default environment options, which have
    browser extensions switched off. Swap in a control whose environment has
    them on, so real Chrome extensions (RoValra) can be loaded."""
    from webview.platforms import winforms  # noqa: F401 - loads clr + WebView2 assemblies
    from webview.platforms import edgechromium
    from System import Action
    from System.Threading.Tasks import Task, TaskScheduler
    from Microsoft.Web.WebView2.Core import CoreWebView2Environment, CoreWebView2EnvironmentOptions
    from Microsoft.Web.WebView2.WinForms import WebView2

    class RcWebView2(WebView2):
        __namespace__ = "RoCreate"

        def EnsureCoreWebView2Async(self, env=None):
            opts = CoreWebView2EnvironmentOptions()
            opts.AreBrowserExtensionsEnabled = True
            # reduced motion: Roblox's UI drops its transitions, so menus/sidebar feel instant
            opts.AdditionalBrowserArguments = "--disable-features=ElasticOverscroll --force-prefers-reduced-motion"
            sched = TaskScheduler.FromCurrentSynchronizationContext()

            def go(task):
                try:
                    WebView2.EnsureCoreWebView2Async(self, task.Result)
                except Exception as e:
                    _log(f"[rocreate] environment init failed: {e}")

            cont = Action[Task[CoreWebView2Environment]](go)
            _handlers.append(cont)
            CoreWebView2Environment.CreateAsync(None, str(PROFILE), opts).ContinueWith(cont, sched)

    edgechromium.WebView2 = RcWebView2


def load_extensions(core, done: threading.Event) -> None:
    """Install the downloaded RoValra extension into this profile (UI thread)."""
    from System import Action
    from System.Threading.Tasks import Task
    from Microsoft.Web.WebView2.Core import CoreWebView2BrowserExtension

    manifests = [m for m in (ROVALRA_DIR / "manifest.json",) if m.exists()]
    pending = [len(manifests)]
    if not manifests:
        done.set()
        return

    def finish():
        pending[0] -= 1
        if pending[0] <= 0:
            done.set()

    for manifest in manifests:
        folder = manifest.parent

        def cb(task, folder=folder):
            try:
                task.Result  # raises if the install failed; ext.Name is unusable on this runtime
                _log(f"[rocreate] extension loaded: {folder.name}")
            except Exception as e:
                _log(f"[rocreate] extension {folder.name} failed: {e}")
            finish()

        cont = Action[Task[CoreWebView2BrowserExtension]](cb)
        _handlers.append(cont)
        core.Profile.AddBrowserExtensionAsync(str(folder)).ContinueWith(cont)


def attach(window) -> None:
    from webview.platforms import winforms
    from System import Func, Object

    _log("[rocreate] attach: waiting for BrowserForm...")

    # Wait for BrowserForm instance
    inst = None
    for _ in range(200):
        for i in list(winforms.BrowserView.instances.values()):
            inst = i
            break
        if inst is not None:
            break
        time.sleep(0.1)

    if inst is None:
        _log("[rocreate] BrowserForm never appeared")
        return

    # Set the window/taskbar icon
    ico_path = RES_DIR / "icon.ico"
    if ico_path.exists():
        from System.Drawing import Icon as WinIcon
        def _set_icon():
            try:
                inst.Icon = WinIcon(str(ico_path))
            except Exception as e:
                _log(f"[rocreate] icon failed: {e}")
            return None
        inst.Invoke(Func[Object](_set_icon))

    _log("[rocreate] attach: BrowserForm found, waiting for CoreWebView2...")

    # Poll until CoreWebView2 is ready (check must happen on UI thread)
    core_box = [None]
    for _ in range(200):
        def _check():
            try:
                c = inst.browser.webview.CoreWebView2
                if c is not None:
                    core_box[0] = c
            except Exception:
                pass
            return None
        inst.Invoke(Func[Object](_check))
        if core_box[0] is not None:
            break
        time.sleep(0.1)

    if core_box[0] is None:
        _log("[rocreate] CoreWebView2 never became ready; loading unthemed")
        window.load_url(START_URL)
        return

    _log("[rocreate] attach: CoreWebView2 ready, setting up...")

    payload = build_payload()
    blocked = load_blocklist() if load_settings().get("blockAds", True) else []

    def _setup():
        core = core_box[0]
        # 1. theme — runs on every future document creation (before page JS)
        core.AddScriptToExecuteOnDocumentCreatedAsync(payload)

        # 2. block ad / telemetry requests
        env = core.Environment

        def on_request(sender, args):
            try:
                host = (urlparse(str(args.Request.Uri)).hostname or "").lower()
                if any(b in host for b in blocked):
                    args.Response = env.CreateWebResourceResponse(None, 403, "Blocked", "")
            except Exception:
                pass

        _handlers.append(on_request)
        core.WebResourceRequested += on_request

        # 3. intercept game-launch protocol URIs
        def on_navigating(sender, args):
            uri = str(args.Uri)
            if uri.startswith(("roblox-player:", "roblox:", "roblox-studio:")):
                args.Cancel = True
                threading.Thread(target=launch_game, args=(uri,), daemon=True).start()

        _handlers.append(on_navigating)
        core.NavigationStarting += on_navigating

        # 4. new-window handling (replace pywebview's default handler)
        try:
            core.NewWindowRequested -= inst.browser.on_new_window_request
        except Exception:
            pass

        def on_new_window(sender, args):
            uri = str(args.Uri)
            args.Handled = True
            if uri.startswith(("roblox-player:", "roblox:", "roblox-studio:")):
                threading.Thread(target=launch_game, args=(uri,), daemon=True).start()
            elif "roblox.com" in (urlparse(uri).hostname or ""):
                core.Navigate(uri)
            else:
                threading.Thread(target=lambda: os.startfile(uri), daemon=True).start()

        _handlers.append(on_new_window)
        core.NewWindowRequested += on_new_window

        # 5. tweak browser settings
        settings = core.Settings
        settings.AreDefaultContextMenusEnabled = True
        settings.IsStatusBarEnabled = False
        settings.AreBrowserAcceleratorKeysEnabled = True

        # 6. real Chrome extensions (RoValra)
        try:
            load_extensions(core, ext_done)
        except Exception as e:
            _log(f"[rocreate] extension loading unavailable: {e}")
            ext_done.set()
        return None

    import rovalra
    if not rovalra.installed_version(ROVALRA_DIR):  # installer normally did this; retry if it was offline
        try:
            rovalra.install(ROVALRA_DIR, _log)
        except Exception as e:
            _log(f"[rocreate] RoValra download failed, continuing without it: {e}")

    ext_done = threading.Event()
    inst.Invoke(Func[Object](_setup))
    ext_done.wait(15)   # navigate only once extensions are installed
    _log(f"[rocreate] ready — blocking {len(blocked)} hosts")
    window.load_url(START_URL)
    threading.Thread(
        target=rovalra.update_if_stale,
        args=(ROVALRA_DIR, paths.DATA_DIR / "rovalra-checked", 7, _log),
        daemon=True,
    ).start()
    if _ipc_server is not None:
        threading.Thread(target=serve_ipc, args=(_ipc_server, window, inst), daemon=True).start()


class WindowApi:
    """Window buttons. Drives the real WinForms window so the page can never drift out of sync."""

    def __init__(self, win):
        self._win = win
        self._fullscreen = False
        self._restore = None  # (was maximized, normal bounds) saved when entering fullscreen

    def _ui(self, fn):
        from System import Func, Object
        form = self._win.native
        out = []

        def run():
            try:
                out.append(fn(form))
            except Exception as e:
                _log(f"[rocreate] window action failed: {e!r}")
                out.append(None)
            return None

        form.Invoke(Func[Object](run))
        return out[0]

    def _state(self, f) -> dict:
        from System.Windows.Forms import FormWindowState
        return {"maximized": f.WindowState == FormWindowState.Maximized, "fullscreen": self._fullscreen}

    def _maximize(self, f) -> None:
        from System.Windows.Forms import FormWindowState, Screen
        # a frameless form maximizes over the taskbar unless told the work area
        f.MaximizedBounds = Screen.FromControl(f).WorkingArea
        f.WindowState = FormWindowState.Maximized

    def _leave_fullscreen(self, f) -> None:
        maximized, bounds = self._restore
        f.Bounds = bounds
        if maximized:
            self._maximize(f)
        self._fullscreen = False

    def get_state(self):
        return self._ui(self._state)

    def minimize(self):
        from System.Windows.Forms import FormWindowState
        self._ui(lambda f: setattr(f, "WindowState", FormWindowState.Minimized))

    def toggle_maximize(self):
        from System.Windows.Forms import FormWindowState

        def go(f):
            if self._fullscreen:
                self._leave_fullscreen(f)
            elif f.WindowState == FormWindowState.Maximized:
                f.WindowState = FormWindowState.Normal
            else:
                self._maximize(f)
            return self._state(f)

        return self._ui(go)

    def toggle_fullscreen(self):
        from System.Windows.Forms import FormWindowState, Screen

        def go(f):
            if self._fullscreen:
                self._leave_fullscreen(f)
            else:
                normal = f.WindowState == FormWindowState.Normal
                self._restore = (f.WindowState == FormWindowState.Maximized, f.Bounds if normal else f.RestoreBounds)
                f.WindowState = FormWindowState.Normal  # bounds can't be set while maximized
                f.Bounds = Screen.FromControl(f).Bounds
                self._fullscreen = True
            return self._state(f)

        return self._ui(go)

    def close(self):
        self._win.destroy()


# --------------------------------------------------------------------------
# opening links: rocreate://open?u=<url> (from the Chrome redirect extension) or a
# plain roblox.com URL. A running instance is reused so the link opens instantly.
# --------------------------------------------------------------------------
IPC_PORT = 47653


def is_roblox_url(url: str) -> bool:
    p = urlparse(url)
    host = (p.hostname or "").lower()
    return p.scheme == "https" and (host == "roblox.com" or host.endswith(".roblox.com"))


def parse_target(args) -> str | None:
    for arg in args:
        url = arg
        if arg.lower().startswith("rocreate:"):
            url = (parse_qs(urlparse(arg).query).get("u") or [""])[0]
        if is_roblox_url(url):
            return url
    return None


def parse_id(args) -> str:
    """Launch id the Chrome tab put in the link; it polls /seen?id= to learn the app got it."""
    for arg in args:
        if arg.lower().startswith("rocreate:"):
            rid = (parse_qs(urlparse(arg).query).get("id") or [""])[0]
            if re.fullmatch(r"[A-Za-z0-9-]{8,64}", rid):
                return rid
    return ""


_seen: set[str] = set()


def forward_to_running(url: str | None, rid: str = "") -> bool:
    import ctypes
    try:
        with socket.create_connection(("127.0.0.1", IPC_PORT), timeout=10) as s:
            ctypes.windll.user32.AllowSetForegroundWindow(-1)  # lets the running window come to front
            s.sendall(f"{url or ''}\t{rid}\n".encode())
            return s.recv(16) == b"rocreate\n"
    except OSError:
        return False


def bind_ipc():
    server = socket.socket()
    try:
        server.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        server.bind(("127.0.0.1", IPC_PORT))
        server.listen(8)
        return server
    except OSError:
        server.close()
        return None


def serve_ipc(server, window, inst) -> None:
    from System import Func, Object

    def front():
        from System.Windows.Forms import FormWindowState
        if inst.WindowState == FormWindowState.Minimized:
            inst.WindowState = FormWindowState.Normal
        inst.Activate()
        inst.TopMost = True
        inst.TopMost = False
        return None

    while True:
        try:
            conn, _ = server.accept()
        except OSError:
            return
        with conn:
            conn.settimeout(2)
            try:
                f = conn.makefile()
                line = f.readline().strip()
                if line.startswith("GET "):  # the Chrome tab asking "did the app get my link?"
                    while f.readline() not in ("\r\n", "\n", ""):
                        pass
                    rid = (parse_qs(urlparse(line.split(" ")[1]).query).get("id") or [""])[0]
                    body = b"1" if rid in _seen else b"0"
                    conn.sendall(
                        b"HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nConnection: close\r\n"
                        b"Content-Length: " + str(len(body)).encode() + b"\r\n\r\n" + body
                    )
                    continue
                url, _, rid = line.partition("\t")
                conn.sendall(b"rocreate\n")
            except OSError:
                continue
        if url and is_roblox_url(url):
            window.load_url(url)
        if rid:
            _seen.add(rid)
        inst.Invoke(Func[Object](front))


def register_protocol() -> None:
    """Make rocreate:// launch this app (per-user, HKCU)."""
    import system_integration
    if paths.FROZEN:
        cmd = f'"{sys.executable}" "%1"'
    else:
        exe = Path(sys.executable).with_name("pythonw.exe")
        cmd = f'"{exe if exe.exists() else sys.executable}" "{Path(__file__).resolve()}" "%1"'
    system_integration.register_protocol(cmd, RES_DIR / "icon.ico")


_ipc_server = None


def main() -> int:
    global START_URL, _ipc_server
    if sys.platform != "win32":
        _log("RoCreate currently runs on Windows only (it needs the WebView2 runtime).")
        return 1
    if "--uninstall" in sys.argv or "--chrome-setup" in sys.argv:
        import wizard
        return wizard.run("uninstall" if "--uninstall" in sys.argv else "chrome")

    import webview

    target = parse_target(sys.argv[1:])
    rid = parse_id(sys.argv[1:])
    if forward_to_running(target, rid):
        return 0
    _ipc_server = bind_ipc()
    if _ipc_server is None and forward_to_running(target, rid):
        return 0
    if target:
        START_URL = target
    if rid:
        _seen.add(rid)

    if not (THEME_DIR / "theme.css").exists():
        _log(f"[rocreate] theme not found at {THEME_DIR}")
        return 1

    import system_integration
    register_protocol()
    PROFILE.mkdir(parents=True, exist_ok=True)
    # pywebview's UserDataFolder is not honoured here; the runtime reads this instead
    os.environ["WEBVIEW2_USER_DATA_FOLDER"] = str(PROFILE)
    system_integration.set_app_id()
    enable_extensions()
    saved = load_settings()

    # js_api must exist before the window does; the window is attached right after creation.
    api = WindowApi(None)

    window = webview.create_window(
        "RoCreate",
        "about:blank",
        js_api=api,
        width=saved.get("width", 1400),
        height=saved.get("height", 900),
        x=saved.get("x"),
        y=saved.get("y"),
        min_size=(900, 600),
        frameless=True,
        easy_drag=False,
        background_color="#0e0f11",
    )
    api._win = window
    window.events.closing += lambda: None if api._fullscreen else save_settings(window)
    threading.Thread(target=attach, args=(window,), daemon=True).start()
    webview.start(private_mode=False, storage_path=str(PROFILE), debug=False)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
