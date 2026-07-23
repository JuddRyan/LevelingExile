# Third-party game assets

Path of Exile and all related art, icons, trademarks, and other materials are
© Grinding Gear Games.

**LevelingExile is an unofficial fan project.** It is not affiliated with,
endorsed by, or sponsored by Grinding Gear Games.

## Gem icons

Gem icon image files (typically under `src/assets/gems/`) are **not** covered
by this project's MIT license. They remain the property of Grinding Gear Games
(or their respective rights holders) and are used only for personal / community
tooling convenience when building or releasing the overlay.

- The MIT license applies to LevelingExile **source code** only.
- Do **not** treat downloaded gem icons as free to relicense or redistribute
  outside of normal use of this tool.
- Release `.exe` builds may bundle icons for players after the maintainer runs
  `npm run update:gems`. The public source repository prefers **not** to commit
  those image files.

## Data used by the app

Campaign / gem metadata (`gem-catalog.json`, `quest-gem-rewards.json`,
`quest-order.json`, `gemIcons.json` name→path mapping) is derived from community
and third-party data sources (for example RePoE). That mapping is kept in-repo
so the app knows which files to load after icons are downloaded.
