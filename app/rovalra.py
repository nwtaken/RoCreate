"""RoValra is GPL-3.0 and not redistributed here: it is downloaded from the Chrome Web
Store's update endpoint on the user's own machine and loaded into the app unpacked."""
from __future__ import annotations

import io
import json
import shutil
import struct
import time
import urllib.request
import zipfile
from pathlib import Path

EXT_ID = "njcickgebhnpgmoodjdgohkclfplejli"
_URL = (
    "https://clients2.google.com/service/update2/crx?response=redirect&os=win&arch=x64"
    "&os_arch=x86_64&nacl_arch=x86-64&prod=chromecrx&prodchannel=&prodversion=155.0.0.0"
    f"&lang=en-US&acceptformat=crx2,crx3&x=id%3D{EXT_ID}%26installsource%3Dondemand%26uc"
)


def installed_version(dest: Path) -> str | None:
    try:
        return json.loads((dest / "manifest.json").read_text("utf-8"))["version"]
    except (OSError, ValueError, KeyError):
        return None


def _download_zip() -> zipfile.ZipFile:
    req = urllib.request.Request(_URL, headers={"User-Agent": "Mozilla/5.0"})
    data = urllib.request.urlopen(req, timeout=60).read()
    if data[:4] != b"Cr24":
        raise RuntimeError("the Chrome Web Store did not return an extension package")
    version, header_len = struct.unpack("<II", data[4:12])
    if version != 3:
        raise RuntimeError(f"unsupported CRX version {version}")
    return zipfile.ZipFile(io.BytesIO(data[12 + header_len:]))


def install(dest: Path, log=print) -> str:
    """Download the current RoValra into `dest` (replacing any older copy); returns its version."""
    log("Downloading RoValra from the Chrome Web Store…")
    z = _download_zip()
    tmp = dest.with_name(dest.name + ".tmp")
    shutil.rmtree(tmp, ignore_errors=True)
    tmp.mkdir(parents=True)
    root = tmp.resolve()
    for member in z.infolist():
        target = (tmp / member.filename).resolve()
        if root not in target.parents and target != root:
            raise RuntimeError(f"unsafe path in package: {member.filename}")
        if member.filename.startswith("_metadata"):  # reserved folder, breaks unpacked loading
            continue
        z.extract(member, tmp)
    version = installed_version(tmp)
    if not version:
        shutil.rmtree(tmp, ignore_errors=True)
        raise RuntimeError("downloaded package has no manifest")
    old = dest.with_name(dest.name + ".old")
    shutil.rmtree(old, ignore_errors=True)
    if dest.exists():
        dest.rename(old)
    tmp.rename(dest)
    shutil.rmtree(old, ignore_errors=True)
    log(f"RoValra {version} ready.")
    return version


# Qt WebEngine (the macOS app) has no chrome.permissions or chrome.contextMenus, and RoValra's
# service worker stops at the first line that touches them. Stubs keep it running; the
# features behind those optional permissions just report "not granted".
_QT_SHIM_MARK = "/* rocreate-qt-shim */"
_QT_WORKER_SHIM = _QT_SHIM_MARK + """
(() => {
  const ev = () => ({ addListener() {}, removeListener() {}, hasListener: () => false });
  const done = (v, cb) => (typeof cb === "function" ? (cb(v), undefined) : Promise.resolve(v));
  if (!chrome.permissions) chrome.permissions = {
    contains: (_p, cb) => done(false, cb), request: (_p, cb) => done(false, cb),
    remove: (_p, cb) => done(false, cb), getAll: (cb) => done({ permissions: [], origins: [] }, cb),
    onAdded: ev(), onRemoved: ev(),
  };
  if (!chrome.contextMenus) chrome.contextMenus = {
    create: () => 0, update: (_i, _p, cb) => done(undefined, cb),
    remove: (_i, cb) => done(undefined, cb), removeAll: (cb) => done(undefined, cb), onClicked: ev(),
  };
})();
"""
# Qt WebEngine also refuses to let roblox.com load the extension's web-accessible files
# (images, CSS), so the content script gets its URLs from the app's own scheme instead.
QT_SCHEME = "rocreate-ext"
_QT_CONTENT_SHIM = _QT_SHIM_MARK + """
try { chrome.runtime.getURL = (p) => "%s://rovalra/" + String(p).replace(/^\\/+/, ""); } catch (e) {}
""" % QT_SCHEME


def _prepend(path: Path, shim: str) -> None:
    try:
        code = path.read_text("utf-8")
    except OSError:
        return
    if not code.startswith(_QT_SHIM_MARK):
        path.write_text(shim + code, "utf-8")


def patch_for_qt(dest: Path) -> None:
    """Prepend the stubs to RoValra's service worker and content scripts (idempotent)."""
    try:
        manifest = json.loads((dest / "manifest.json").read_text("utf-8"))
    except (OSError, ValueError):
        return
    worker = (manifest.get("background") or {}).get("service_worker")
    if worker:
        _prepend(dest / worker, _QT_WORKER_SHIM)
    for script in manifest.get("content_scripts") or []:
        if script.get("world", "ISOLATED") == "ISOLATED" and script.get("js"):
            _prepend(dest / script["js"][0], _QT_CONTENT_SHIM)


def update_if_stale(dest: Path, stamp: Path, days: int = 7, log=print) -> None:
    """Weekly background refresh; the new copy is picked up on the next launch."""
    try:
        if stamp.exists() and time.time() - stamp.stat().st_mtime < days * 86400:
            return
        stamp.parent.mkdir(parents=True, exist_ok=True)
        install(dest, log)
        stamp.write_text(str(time.time()))
    except Exception as e:  # offline / store hiccup: keep what we have
        log(f"RoValra update skipped: {e}")
