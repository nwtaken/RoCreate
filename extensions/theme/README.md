# RoCreate — Roblox Like the Creator Hub

Chrome (MV3) extension that reskins the main Roblox website to the clean,
lightweight **Create tab / Creator Hub** look: near-black flat surfaces,
bright bold labels, rounded gray active pills, Roblox-blue accents, and
ads/upsells hidden.

`create.roblox.com` and the DevForum are excluded so the extension never
fights Roblox's own Creator Hub design.

## How it works
Roblox's current site runs on the **Foundation** design system, which is
driven by CSS custom properties. RoCreate re-defines those tokens
(`--color-surface-0..300`, `--color-content-*`, `--color-state-hover/press`,
`--divider-color`, …) with `!important`, which reskins the whole new UI at
once — left nav, cards, dialogs, settings — instead of chasing per-component
class names that Roblox renames often.

The **topbar is still the legacy Bootstrap navbar** (`#header`,
`ul.nav.rbx-navbar`, `#navbar-robux/settings`) and doesn't read those tokens,
so it gets explicit overrides. Older non-Foundation pages (legacy cards,
`.btn-primary-md`, settings) also get explicit fallbacks.

## RoValra compatibility
RoValra styles its own injected UI with the **same Roblox tokens**
(`var(--color-surface-*)`, `var(--color-state-hover)`, …), so the token
override restyles RoValra to match automatically. RoCreate:
- never redefines RoValra's private `--rovalra-theme-*` variables, so RoValra's
  own theme features (custom theme editor, Plus themes) still work;
- never hides any `rovalra-*` / `roseal-*` element — declutter only targets ads
  and Plus upsells;
- lets a RoValra custom background image show through RoCreate's base.

## Load it
1. `chrome://extensions`
2. Enable **Developer mode** (top right).
3. **Load unpacked** → pick this folder.
4. Open roblox.com. Click the RoCreate toolbar icon to toggle Theme or
   Declutter on/off (no reload needed).

## Files
- `manifest.json` — MV3, injects `theme.css` + `content.js` on roblox.com.
- `theme.css` — token override + legacy fallbacks, all gated behind
  `html.rocreate-on`.
- `content.js` — flips the `rocreate-on` / `rc-declutter` classes from stored
  settings at `document_start` (no flash, no reload).
- `popup.html` / `popup.js` — two toggles stored in `chrome.storage.sync`.
- `icons/` — toolbar icon (16/48/128). Regenerate with
  `python icons/make_icon.py` after editing its colours.

## Tuning
If a Foundation subtree stays unthemed, Roblox may be scoping its tokens to a
wrapper element rather than `:root`. Fix by adding a universal fallback at the
top of section 1 in `theme.css`:

```css
html.rocreate-on * { --color-surface-0: #0e0f11 !important; /* …etc… */ }
```

For legacy sections, grab the element's classes (DevTools → Inspect) and add a
selector to the matching labelled block.
