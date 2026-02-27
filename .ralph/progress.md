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

---

## Task: Redesign store public types from field-definition schema to object-default schema for nested app state

### Completed

- Replaced all field-centric type contracts (`FieldDef`, `FieldsDef`, `InferStoreConfig`, `ValueType`) with generic object contracts
- New types: `CreateStoreOptions<T>` (takes `defaults: T`, optional `validate`, optional `pruneUnknown`), `Store<T>` (adds `patch` method), `StoreUpdater<T>`, `DeepPartial<T>`
- `Store<T>` now has 5 methods: `read`, `write`, `update`, `patch`, `reset`
- Updated `store.ts` to use new `defaults`-based options and added `patch` method stub
- Updated `merge.ts` from `applyFieldDefaults` to `applyDefaults` — now takes a plain defaults object instead of `FieldsDef`
- Updated `index.ts` exports: removed `FieldDef`, `FieldsDef`, `InferStoreConfig`, `ValueType`; added `DeepPartial`
- Rewrote `types.test.ts` with comprehensive compile-time type assertions for `DeepPartial`, `CreateStoreOptions`, `Store`, `StoreUpdater`
- Rewrote `store.test.ts` and `merge.test.ts` to use the new `defaults`-based API

### Files Changed

- `packages/store/src/types.ts` — complete rewrite with new generic object contracts
- `packages/store/src/types.test.ts` — complete rewrite with type-level inference tests
- `packages/store/src/store.ts` — updated to use `defaults` instead of `fields`, added `patch` method
- `packages/store/src/store.test.ts` — rewritten for new `defaults`-based API
- `packages/store/src/merge.ts` — renamed `applyFieldDefaults` → `applyDefaults`, now takes plain objects
- `packages/store/src/merge.test.ts` — rewritten for new `applyDefaults` API
- `packages/store/src/index.ts` — updated type exports

### Decisions

- `DeepPartial<T>` treats arrays as atomic (replaced wholesale, not element-merged) — this matches SPEC's "arrays replace wholesale" requirement
- `CreateStoreOptions<T>` uses `T extends Record<string, unknown>` constraint for the defaults object
- `validate` is typed as `(state: T) => void | Promise<void>` to support both sync and async validators
- `pruneUnknown` defaults to `true` (prune unknown keys on read) — matches existing field-based behavior
- `patch` method added to `Store<T>` interface now; runtime implementation is a placeholder that will be properly implemented in tasks 3/4
- `merge.ts` was minimally updated to compile with new types — full deep merge rewrite is task 3

### Notes for Future Agent

- The `patch` implementation in `store.ts` is a placeholder — it uses `applyDefaults` which does shallow merge with `current` as "defaults" and `partial` as "persisted". Task 3 (deep merge) should implement proper deep merge logic that `patch` will use
- `validate` and `pruneUnknown` options are accepted in `CreateStoreOptions` types but NOT yet wired into the runtime — task 4 (store refactor) should implement these
- `applyDefaults` in `merge.ts` only does shallow merge — task 3 must implement deep merge with array-replace and unknown-key pruning semantics
- When writing tests with `createStore`, use `as string` / `as boolean` type widening on defaults to avoid `const` narrowing issues (e.g., `{ theme: "light" as string }` not `{ theme: "light" } as const`)
- 189 tests pass, type checks and lint are clean
