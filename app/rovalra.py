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
