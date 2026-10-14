<p align="center"><img src="docs/banner.png" alt="RoCreate — Roblox, rebuilt as a fast, clean desktop app" width="100%"></p>

<p align="center">
  <a href="https://github.com/nwtaken/RoCreate/releases/latest"><img alt="Latest release" src="https://img.shields.io/github/v/release/nwtaken/RoCreate?style=flat-square&color=335fff"></a>
  <a href="https://github.com/nwtaken/RoCreate/releases"><img alt="Downloads" src="https://img.shields.io/github/downloads/nwtaken/RoCreate/total?style=flat-square&color=3b3b3b"></a>
  <img alt="Windows 10 and 11" src="https://img.shields.io/badge/Windows-10%20%7C%2011-3b3b3b?style=flat-square">
  <img alt="Python and WebView2" src="https://img.shields.io/badge/Python-WebView2-3b3b3b?style=flat-square">
  <a href="LICENSE"><img alt="MIT license" src="https://img.shields.io/badge/license-MIT-3b3b3b?style=flat-square"></a>
</p>

RoCreate is Roblox as a desktop app. It wraps roblox.com in a lightweight window, restyles it
to look like the Creator Hub, blocks ads and trackers, launches games straight into the Roblox
player, and loads [RoValra](https://github.com/NotValra/RoValra) so you keep all of its features.
It uses the WebView2 runtime that already ships with Windows, so there is no bundled browser.

<p align="center"><img src="docs/screenshots/home.jpg" alt="The RoCreate home page with a time-aware greeting" width="90%"></p>

## Download

**[Download RoCreate for Windows](https://github.com/nwtaken/RoCreate/releases/latest/download/RoCreate-Setup.exe)**,
then run the setup. It installs for your user only, so it doesn't need administrator rights.

> RoCreate isn't code-signed yet, so Windows SmartScreen may say it doesn't recognise the app
> the first time. Choose **More info → Run anyway**.

The setup wizard lets you pick what you want:

| Option | What it does |
|---|---|
| **RoCreate app** | The desktop app itself (required). |
| **Set up RoCreate with RoValra** | Downloads [RoValra](https://github.com/NotValra/RoValra) from the Chrome Web Store and loads it into the app. Kept up to date automatically. |
| **Include auto redirect?** | A small Chrome extension: every Roblox link you open in Chrome jumps straight into RoCreate instead. |
| **Include the RoCreate theme for Chrome?** | Optional. The same look on roblox.com inside Chrome. The app already has the theme built in. |
| **Block ads and trackers** | On by default. |
| **Shortcuts** | Desktop and Start menu. |

<p align="center"><img src="docs/screenshots/wizard-options.png" alt="The setup wizard options page" width="60%"></p>

Chrome only loads unpacked extensions in Developer mode, so the last page of the wizard opens
`chrome://extensions`, shows you each extension's folder, and ticks it off as soon as Chrome has
loaded it. You can bring that page back any time with `RoCreate.exe --chrome-setup`.

## What you get

<p align="center"><img src="docs/screenshots/before-after.jpg" alt="roblox.com compared with RoCreate" width="100%"></p>

- **The Creator Hub look.** Flat near-black surfaces, a rebuilt top bar, a gray pill for the
  active page, clean friend tiles with `@usernames`, tidy charts. RoValra's own interface picks
  up the same colours.
- **A greeting that knows the time.** The home title becomes things like *"Good morning,
  nwtaken!"* or *"Burning the midnight oil, nwtaken?"*: about 100 phrases for morning, afternoon,
  evening and night, using your display name (or your username if you have none).
- **Your Robux always visible** in the top bar, next to the icon.
- **Ad and tracker blocking** at the network layer. The list is a plain text file,
  [`app/blocklist.txt`](app/blocklist.txt), and nothing the site needs is on it.
- **One-click game launch.** Play goes straight into the Roblox player, no "open this link?"
  prompt.
- **RoValra, the real thing.** Not a copy of a few features: the actual extension, loaded into
  the app, so everything it does works.
- **Links open in the app.** With the redirect extension, a profile link or a private-server link
  opened in Chrome lands in RoCreate instantly; if the app isn't running it starts on that page.
- **Stays logged in**, with its own profile, so it never touches your browser's cookies.
- **Real window controls.** Frameless window with its own minimize / maximize / close, F11
  fullscreen, double-click the top edge to maximize, and thin dark scrollbars.

## Screenshots

| | |
|---|---|
| <img src="docs/screenshots/charts.jpg" alt="Charts"> | <img src="docs/screenshots/catalog.jpg" alt="Marketplace"> |
| Charts | Marketplace |
| <img src="docs/screenshots/wizard-welcome.png" alt="Setup welcome page"> | <img src="docs/screenshots/wizard-progress.png" alt="Setup progress"> |
| Setup | Installing, with RoValra downloaded for you |
| <img src="docs/screenshots/wizard-finish.png" alt="Chrome extension setup"> | <img src="docs/screenshots/wizard-options.png" alt="Setup options"> |
| Adding the Chrome extensions | Choosing what to install |

## Privacy and safety

- RoCreate has no account, server or telemetry. You sign in to Roblox exactly as you would in a
  browser, and that login stays in a local profile at `%LOCALAPPDATA%\RoCreate\profile`. It is
  never in the install folder or in this repository.
- The app talks to Roblox, and to the Chrome Web Store when it downloads or updates RoValra.
  That is all.
- The blocklist only drops third-party analytics and Roblox's own telemetry hosts.
- `rocreate://` links and the local socket only accept `https` links on `roblox.com`.
- Uninstalling (`RoCreate.exe --uninstall` or Windows Settings → Apps) removes the app, its
  shortcuts and its registry entries. Tick *Also delete my data* to remove the login profile too.

RoCreate isn't affiliated with Roblox Corporation or with RoValra. See [NOTICE.md](NOTICE.md).

## How it works

- **The window** is [pywebview](https://pywebview.flowrl.com) on Windows' own WebView2. The
  theme is injected before the page runs, so there is no flash of the unstyled site.
- **The theme** works by redefining Roblox's own design tokens (the Foundation CSS variables),
  plus explicit rules for the older top bar. The same `theme.css` powers the Chrome extension.
- **RoValra** is a Manifest V3 Chrome extension, which WebView2 can load unpacked. It is
  downloaded from the Chrome Web Store into your data folder, never bundled here, so it stays
  under its own GPL-3.0 licence and updates from its real source.
- **Opening links:** the redirect extension rewrites `roblox.com` navigations to
  `rocreate://open?u=…`; the app registers that protocol per user, forwards the link to an
  already-running window over a local socket, and the Chrome tab closes itself once the app has
  confirmed it got the link.

## macOS and Linux

Not supported yet. The app needs the Windows WebView2 runtime, and macOS's built-in web view
can't host Chrome extensions such as RoValra. The two Chrome extensions are plain Manifest V3 and
should work in Chrome on any system; a macOS app would need a Chromium-based shell.

## Building from source

Needs Python 3.12+ on Windows.

```sh
pip install -r requirements.txt
python app/app.py              # run from source
python installer/build.py      # build dist/RoCreate-Setup.exe
```

```
app/                   the desktop app and the setup wizard (wizard_ui/)
extensions/theme/      Chrome extension: the RoCreate theme (also injected by the app)
extensions/redirect/   Chrome extension: roblox.com links → rocreate:// → the app
installer/             build script that packs the app and wizard into RoCreate-Setup.exe
docs/                  banner and screenshots
```

## Credits

[RoValra](https://github.com/NotValra/RoValra) by NotValra. Thanks to the
[pywebview](https://github.com/r0x0r/pywebview) and
[pythonnet](https://github.com/pythonnet/pythonnet) projects.

## License

MIT, see [LICENSE](LICENSE). Third-party notices are in [NOTICE.md](NOTICE.md).
