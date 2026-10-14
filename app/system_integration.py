"""Windows shell integration: rocreate:// protocol, shortcuts, uninstall entry."""
from __future__ import annotations

import os
import subprocess
import sys
import winreg
from pathlib import Path

PROTOCOL_KEY = r"Software\Classes\rocreate"
UNINSTALL_KEY = r"Software\Microsoft\Windows\CurrentVersion\Uninstall\RoCreate"
APP_ID = "RoCreate.Desktop"


def set_app_id() -> None:
    import ctypes
    ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID(APP_ID)


def register_protocol(command: str, icon: Path) -> None:
    """Make rocreate:// launch `command` (which must contain "%1"). Idempotent."""
    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, PROTOCOL_KEY + r"\shell\open\command") as k:
            if winreg.QueryValue(k, "") == command:
                return
    except OSError:
        pass
    with winreg.CreateKey(winreg.HKEY_CURRENT_USER, PROTOCOL_KEY) as k:
        winreg.SetValueEx(k, "", 0, winreg.REG_SZ, "URL:RoCreate")
        winreg.SetValueEx(k, "URL Protocol", 0, winreg.REG_SZ, "")
    with winreg.CreateKey(winreg.HKEY_CURRENT_USER, PROTOCOL_KEY + r"\DefaultIcon") as k:
        winreg.SetValueEx(k, "", 0, winreg.REG_SZ, str(icon))
    with winreg.CreateKey(winreg.HKEY_CURRENT_USER, PROTOCOL_KEY + r"\shell\open\command") as k:
        winreg.SetValueEx(k, "", 0, winreg.REG_SZ, command)


def _delete_tree(root, path: str) -> None:
    try:
        with winreg.OpenKey(root, path, 0, winreg.KEY_ALL_ACCESS) as k:
            while True:
                try:
                    sub = winreg.EnumKey(k, 0)
                except OSError:
                    break
                _delete_tree(root, path + "\\" + sub)
        winreg.DeleteKey(root, path)
    except OSError:
        pass


def unregister_protocol() -> None:
    _delete_tree(winreg.HKEY_CURRENT_USER, PROTOCOL_KEY)


def add_uninstall_entry(install_dir: Path, exe: Path, version: str, size_kb: int) -> None:
    with winreg.CreateKey(winreg.HKEY_CURRENT_USER, UNINSTALL_KEY) as k:
        for name, value in (
            ("DisplayName", "RoCreate"),
            ("DisplayVersion", version),
            ("Publisher", "RoCreate"),
            ("InstallLocation", str(install_dir)),
            ("DisplayIcon", str(exe)),
            ("UninstallString", f'"{exe}" --uninstall'),
        ):
            winreg.SetValueEx(k, name, 0, winreg.REG_SZ, value)
        winreg.SetValueEx(k, "NoModify", 0, winreg.REG_DWORD, 1)
        winreg.SetValueEx(k, "NoRepair", 0, winreg.REG_DWORD, 1)
        winreg.SetValueEx(k, "EstimatedSize", 0, winreg.REG_DWORD, size_kb)


def remove_uninstall_entry() -> None:
    _delete_tree(winreg.HKEY_CURRENT_USER, UNINSTALL_KEY)


def create_shortcut(lnk: Path, target: Path, icon: Path, description: str = "RoCreate") -> None:
    lnk.parent.mkdir(parents=True, exist_ok=True)
    # values travel through the environment, so no quoting/injection concerns
    env = dict(os.environ, RC_LNK=str(lnk), RC_TARGET=str(target), RC_ICON=str(icon),
               RC_DIR=str(target.parent), RC_DESC=description)
    script = (
        "$s=(New-Object -ComObject WScript.Shell).CreateShortcut($env:RC_LNK);"
        "$s.TargetPath=$env:RC_TARGET;$s.WorkingDirectory=$env:RC_DIR;"
        "$s.IconLocation=$env:RC_ICON;$s.Description=$env:RC_DESC;$s.Save()"
    )
    subprocess.run(
        ["powershell", "-NoProfile", "-NonInteractive", "-Command", script],
        env=env, check=True, creationflags=subprocess.CREATE_NO_WINDOW,
    )


def desktop_dir() -> Path:
    import ctypes
    from ctypes import wintypes
    buf = ctypes.create_unicode_buffer(wintypes.MAX_PATH)
    # CSIDL_DESKTOPDIRECTORY = 0x10 (follows OneDrive-redirected desktops)
    ctypes.windll.shell32.SHGetFolderPathW(None, 0x10, None, 0, buf)
    return Path(buf.value)


def start_menu_dir() -> Path:
    return Path(os.environ["APPDATA"]) / "Microsoft" / "Windows" / "Start Menu" / "Programs"


def kill_running(exe: Path) -> None:
    """Close any running copy of `exe` (only that exact path, never by image name)."""
    ps = (
        "Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq $env:RC_EXE } | "
        "ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"
    )
    subprocess.run(
        ["powershell", "-NoProfile", "-NonInteractive", "-Command", ps],
        env=dict(os.environ, RC_EXE=str(exe)), creationflags=subprocess.CREATE_NO_WINDOW,
    )
