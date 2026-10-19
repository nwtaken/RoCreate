"""Build the Chrome Web Store ZIP without changing the unpacked development copy.

    python3 installer/build_extension.py

Output: dist/chrome-web-store/RoCreate-<version>.zip, with manifest.json at its root.
"""
import hashlib
import json
import re
import subprocess
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "extensions" / "theme"
DEST = ROOT / "dist" / "chrome-web-store"


def build():
    manifest = json.loads((SOURCE / "manifest.json").read_text())
    manifest["name"] = "RoCreate: Roblox, Rebuilt"
    manifest["description"] = (
        "A cleaner Roblox with creator stats, rebuilt profiles, social feeds, "
        "watchlists and optional alerts. Works alongside RoValra."
    )
    manifest["homepage_url"] = "https://rocreate.org"
    manifest["host_permissions"] = [
        host for host in manifest["host_permissions"] if "robloxverifieds.com" not in host
    ]
    assert len(manifest["description"]) <= 132
    config = json.loads((SOURCE / "config.json").read_text())
    config["features"].update(flags=False, profileVerify=False)

    worker = (SOURCE / "background.js").read_text()
    start = worker.index("/* ---- auto-update for the unpacked copy ----")
    end = worker.index("// 0.8.12 rescans Roblox items", start)
    worker = worker[:start] + worker[end:]
    worker, count = re.subn(
        r'\nchrome\.alarms\.create\("rc-update-check", \{ periodInMinutes: 1 \}\);\n'
        r'chrome\.alarms\.onAlarm\.addListener\(\(a\) => a\.name === "rc-update-check" && checkForUpdate\(\)\);\n'
        r'checkForUpdate\(\);',
        "",
        worker,
    )
    assert count == 1, "Development updater changed; review the store build transform"
    assert "checkForUpdate" not in worker and "chrome.runtime.reload()" not in worker
    subprocess.run(["node", "--check", "-"], input=worker, text=True, check=True)

    files = {
        path.relative_to(SOURCE).as_posix(): path.read_bytes()
        for path in SOURCE.rglob("*")
        if path.is_file() and path.suffix in {".js", ".css", ".html", ".json", ".png"}
        and "__pycache__" not in path.parts
    }
    files["manifest.json"] = (json.dumps(manifest, indent=2) + "\n").encode()
    files["config.json"] = (json.dumps(config, indent=2) + "\n").encode()
    files["background.js"] = worker.encode()
    files["LICENSE"] = (ROOT / "LICENSE").read_bytes()
    for script in [*manifest["content_scripts"][0]["js"], "popup.js", "options.js", "watchlist.js"]:
        subprocess.run(["node", "--check", str(SOURCE / script)], check=True)
    assert not any(path.endswith((".pem", ".py", ".log")) for path in files)

    DEST.mkdir(parents=True, exist_ok=True)
    output = DEST / f'RoCreate-{manifest["version"]}.zip'
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
        for name, data in sorted(files.items()):
            info = zipfile.ZipInfo(name, (2026, 10, 19, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            archive.writestr(info, data)
    with zipfile.ZipFile(output) as archive:
        assert archive.testzip() is None
        assert "manifest.json" in archive.namelist()
    digest = hashlib.sha256(output.read_bytes()).hexdigest()
    output.with_suffix(".sha256").write_text(f"{digest}  {output.name}\n")
    print(f"Built {output} ({output.stat().st_size:,} bytes, {len(files)} files)")
    print(f"SHA-256: {digest}")
    return output


if __name__ == "__main__":
    build()
