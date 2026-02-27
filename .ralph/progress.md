# Progress Log

---

## Task: Implement intent-based path helpers for config/data/state/cache with XDG conventions on Linux and macOS

### Completed

- Added `dataDir`, `stateDir`, and `cacheDir` path helpers alongside existing `configDir`
- Changed macOS (`darwin`) from `~/Library/Application Support` to XDG conventions (`~/.config`, `~/.local/share`, `~/.local/state`, `~/.cache`) for consistency with Linux per SPEC
- Extracted shared `resolveUnixDir` internal helper to deduplicate XDG env-var + fallback logic across all four helpers
- Linux and macOS share the same XDG code path (`case "linux": case "darwin":`)
- Windows uses `%APPDATA%` for config and `%LOCALAPPDATA%` with `Data`/`State`/`Cache` bucket subdirectories for the other three
- Updated `index.ts` to export all four helpers
- Rewrote `path.test.ts` with comprehensive tests covering all 4 helpers across Linux/macOS/Windows, env overrides, empty/whitespace fallbacks, unsupported platform errors, and appName validation
- Updated `index.test.ts` to verify all four helpers are exported

### Files Changed

- `packages/store/src/path.ts` — refactored with 4 path helpers and shared `resolveUnixDir`
- `packages/store/src/path.test.ts` — comprehensive tests for all helpers
- `packages/store/src/index.ts` — added `dataDir`, `stateDir`, `cacheDir` exports
- `packages/store/src/index.test.ts` — added export tests for new helpers

### Decisions

- macOS uses XDG conventions (same as Linux), not native `~/Library/...` paths, per SPEC constraint
- Windows config has no bucket subdirectory (`%APPDATA%/<appName>`), while data/state/cache use bucket subdirectories (`%LOCALAPPDATA%/<appName>/Data`, etc.) following env-paths conventions
- All four helpers share `validateAppName` and `PlatformEnv` injection pattern for deterministic testing
- Extracted `throwUnsupportedPlatform` helper to ensure consistent error shape

### Notes for Future Agent

- The macOS `configDir` behavior has changed from `~/Library/Application Support` to `~/.config` — existing tests and README examples referencing the old macOS path will need updating in the docs task
- All path helpers accept optional `PlatformEnv` for testing; no need to mutate `process.env`
- The `resolveStorePath` function is unchanged and composes cleanly with all four dir helpers
- 184 tests pass, type checks and lint are clean
