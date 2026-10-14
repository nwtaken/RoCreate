# RoCreate

Roblox as a fast, clean desktop app: the Creator Hub look, ad and tracker blocking, one-click
game launch, and [RoValra](https://github.com/NotValra/RoValra) built in.

- **Looks like the Creator Hub.** Flat near-black surfaces, a rebuilt top bar, a time-aware
  greeting on the home page and your Robux balance always visible.
- **Lighter than a browser tab.** Uses the WebView2 runtime that ships with Windows instead of
  bundling Chromium. Ads and telemetry hosts are dropped at the network layer
  ([`app/blocklist.txt`](app/blocklist.txt)).
- **Launches games directly** into the Roblox player, no "open this link?" prompt.
- **RoValra included.** Downloaded from the Chrome Web Store at install time (it is GPL-3.0 and
  not redistributed here) and refreshed weekly.
- **Auto redirect for Chrome.** A small extension sends every `roblox.com` link you open in
  Chrome to the app instead, so profile and private-server links open there instantly.

## Install (Windows 10/11)

Download `RoCreate-Setup.exe` from the Releases page and run it. The wizard lets you choose:

- RoCreate app (required)
- Set up RoCreate with RoValra
- Include auto redirect (Chrome extension)
- Include the RoCreate theme for Chrome (optional; the app already has the theme built in)
- Block ads and trackers, desktop and Start menu shortcuts

Chrome only loads unpacked extensions in Developer mode, so the last wizard page opens
`chrome://extensions`, shows the extension folders, and ticks each one off as soon as Chrome
has loaded it. Run `RoCreate.exe --chrome-setup` any time to see that page again, and
`RoCreate.exe --uninstall` (or Windows Settings > Apps) to remove everything.

macOS and Linux are **not supported yet**. The two Chrome extensions are plain Manifest V3 and
work in any Chrome, but the app itself needs the Windows WebView2 runtime, and macOS's
WKWebView cannot host Chrome extensions such as RoValra. A macOS build would need a
Chromium-based shell.

## Privacy

Everything stays on your PC. There is no telemetry and no account other than your normal Roblox
login, which lives in a local browser profile at `%LOCALAPPDATA%\RoCreate\profile` (never in the
install folder or this repository). The app only contacts Roblox, and the Chrome Web Store when
it downloads RoValra.

## Layout

```
app/                 the desktop app (Python + pywebview) and the setup wizard UI
extensions/theme/    Chrome extension: the RoCreate theme (also injected by the app)
extensions/redirect/ Chrome extension: roblox.com links -> rocreate:// -> the app
installer/           build script for RoCreate-Setup.exe
```

## Develop

```
pip install -r requirements.txt
python app/app.py              # run from source
python installer/build.py      # build dist/RoCreate-Setup.exe
```

`rocreate://open?u=<https roblox.com url>` opens a page in the running app (or starts it).
Only https `roblox.com` URLs are accepted, from the command line or the local socket.

## License

MIT, see [LICENSE](LICENSE). Third-party notices are in [NOTICE.md](NOTICE.md).
