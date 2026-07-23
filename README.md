# LevelingExile

Always-on-top Path of Exile campaign gem tracker. Import a Path of Building
build, see act / quest / vendor for each gem, and tick them off with remappable
hotkeys — including click-through overlay mode while you play.

**Unofficial fan project.** Not affiliated with or endorsed by Grinding Gear
Games. Path of Exile © Grinding Gear Games.

## Features

- Frameless transparent overlay (always on top; size / UI scale in Settings)
- PoB import from Pastebin, pobb.in, or raw export code
- Skill-set switcher when a build has multiple PoB skill sets
- Campaign enrichment: act, quest, vendor, required level
- **Next up** highlight for the next incomplete gem (toggleable)
- Remappable global hotkeys (complete next / edit mode)
- Click-through overlay when locked; interact mode for editing
- System tray (show when game is off, Exit)
- Persist progress and settings locally

## Players (release builds)

Download the release `.exe` from GitHub Releases. Icons are already bundled in
official builds — no extra setup.

1. Run LevelingExile
2. Open Settings (cog)
3. Paste a PoB Pastebin / pobb.in link or raw code → **Import Build**
4. Track gems in the list; use your hotkeys in-game

## Prerequisites (building from source)

1. [Node.js](https://nodejs.org/) 18+
2. [Rust](https://www.rust-lang.org/tools/install) (Tauri)
3. Windows: [WebView2](https://developer.microsoft.com/microsoft-edge/webview2/) (usually preinstalled)

## From source

```bash
npm install
npm run update:gems    # rebuild gem catalog + download icons (required for icons)
npm run tauri:dev      # desktop overlay
```

Frontend-only preview (no tray / global hotkeys / always-on-top):

```bash
npm run update:gems
npm run dev
```

Release build:

```bash
npm run update:gems
npm run tauri:build
```

### Icons: source vs release

| | Source repo | Release `.exe` |
|---|---|---|
| Gem icon **files** (`src/assets/gems/**`) | Not committed (gitignored) | Bundled after maintainer runs `update:gems` |
| Name→path map (`gemIcons.json`) | Committed | Included |

Run `npm run update:gems` after cloning and after major league / gem data updates.
That refreshes `gem-catalog.json`, `gemIcons.json`, and downloads icon files locally.

## Maintainer notes

- `npm run update:gems` — RePoE catalog + required levels + icon download
- See `gem data flows.txt` for how PoB names map to campaign data
- Version is **0.1.0** (`package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`)

## License & disclaimer

- **Source code:** [MIT](LICENSE)
- **Game art / icons / trademarks:** not MIT — © Grinding Gear Games. See [ASSETS.md](ASSETS.md).

MIT covers this project's code only. It does **not** grant ownership or a
license to Path of Exile assets.
