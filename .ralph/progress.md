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

---

## Task: Implement deep merge and pruning primitives for defaults + persisted JSON

### Completed

- Rewrote `applyDefaults` in `merge.ts` from shallow-only merge to recursive deep merge
- Deep merge recurses into nested plain objects; persisted values override defaults at every level
- Arrays replace wholesale (not element-merged), matching SPEC and `DeepPartial<T>` semantics
- Added `isPlainObject` helper to distinguish recursible objects from arrays, null, etc.
- Added `deepClone` helper that recursively clones plain objects and shallow-copies arrays, ensuring no shared-reference mutation from defaults or parsed input
- Added `pruneUnknown` parameter (3rd arg, defaults to `true`): when `true`, keys not in `defaults` are dropped at every nesting level; when `false`, extra keys are preserved (deep-cloned for safety)
- Type-mismatch handling: if defaults has an object but persisted has a primitive (or vice versa), the persisted value wins without recursion
- Rewrote `merge.test.ts` with 5 test sections (40 tests total): shallow behavior, deep merge, array replacement, immutability guarantees, and `pruneUnknown` parameter

### Files Changed

- `packages/store/src/merge.ts` — complete rewrite with deep merge, `deepClone`, `isPlainObject`, and `pruneUnknown` support
- `packages/store/src/merge.test.ts` — complete rewrite with comprehensive test coverage across 5 categories

### Decisions

- `deepClone` shallow-copies arrays (elements not deep-cloned) since arrays are replaced wholesale — element identity doesn't matter
- `pruneUnknown` is propagated recursively to nested `applyDefaults` calls so unknown keys are pruned/preserved consistently at all depths
- No changes to `store.ts` — wiring `pruneUnknown` from `CreateStoreOptions` into the `applyDefaults` call is task 4's responsibility
- The `applyDefaults` function signature is now `applyDefaults<T>(persisted, defaults, pruneUnknown?)` — backward compatible since `pruneUnknown` defaults to `true`

### Notes for Future Agent

- `store.ts` currently calls `applyDefaults(persisted, defaults)` without passing `pruneUnknown` — task 4 should wire `options.pruneUnknown` through to get the `pruneUnknown=false` behavior working end-to-end
- The `patch` method in `store.ts` uses `applyDefaults` with `current` as defaults and `partial` as persisted — this should work correctly now for deep partial updates since `applyDefaults` does proper deep merge. Verify in task 4 tests.
- 212 tests pass, type checks and lint are clean

---

## Task: Refactor createStore runtime to support read/write/update/patch/reset with optional validation

### Completed

- Added `VALIDATION` error code to `StoreErrorDetailsMap` in `errors.ts` with `ValidationErrorDetails` interface (includes `operation` field: `"write" | "update" | "patch"`)
- Wired `validate` option in `createStore`: calls user-supplied `validate(state)` before `writeJson` in `write`, `update`, and `patch` — throws `CrustStoreError` with `VALIDATION` code on failure, wrapping the original error as `cause`
- Wired `pruneUnknown` option through to `applyDefaults` in `read()` — defaults to `true` when not provided
- Fixed `patch` method: uses `applyDefaults(partial, current, false)` so all current keys are preserved and partial values override via deep merge
- Rewrote `store.test.ts` with comprehensive test coverage:
  - New `store.patch` section (5 tests): deep partial merge, array replacement, nested updates
  - New `store validate option` section (11 tests): validate on write/update/patch, async validate, non-Error causes, no validate on read/reset, state not persisted on validation failure
  - New `store pruneUnknown option` section (4 tests): default pruning, explicit true/false, nested unknown keys
  - Updated lifecycle tests to include patch in the full cycle
  - Added deep merge nested defaults test to read section

### Files Changed

- `packages/store/src/errors.ts` — added `ValidationErrorDetails` interface and `VALIDATION` to `StoreErrorDetailsMap`
- `packages/store/src/store.ts` — wired `validate`, `pruneUnknown`, added `runValidate` helper, fixed `patch` with `pruneUnknown=false`
- `packages/store/src/store.test.ts` — comprehensive rewrite with validation, pruneUnknown, and patch test sections

### Decisions

- `validate` is called before `writeJson` in all mutation operations (write, update, patch) — never on read or reset
- Validation errors wrap the original thrown value as `cause` and use the error's `message` if it's an `Error` instance, otherwise use the generic `"Validation failed"` message
- `ValidationErrorDetails` includes the `operation` field so consumers can distinguish which operation triggered the validation failure
- `patch` uses `applyDefaults(partial, current, false)` — `pruneUnknown=false` ensures all current state keys are preserved even though the partial doesn't contain them
- The store-level `pruneUnknown` option is only applied during `read()` (when merging persisted data with defaults), not during `patch` (which always preserves current state keys)

### Notes for Future Agent

- `persistence.test.ts` and `index.test.ts` were not modified — they were already correct and didn't need changes for this task
- The `errors.test.ts` file tests generic `CrustStoreError` construction but doesn't have specific VALIDATION tests — the store.test.ts validation section covers VALIDATION behavior end-to-end
- 234 tests pass, type checks and lint are clean

---

## Task: Rewrite package documentation and metadata for the new multi-store DX model

### Completed

- Rewrote `packages/store/README.md` from scratch to document the new object-default API (`defaults` instead of `fields`), all four path helpers (`configDir`, `dataDir`, `stateDir`, `cacheDir`), `patch()` method, `validate` option, `pruneUnknown` option, `VALIDATION` error code, and `DeepPartial` type
- Rewrote `apps/docs/content/docs/modules/store.mdx` with new Storage Intent section explaining config vs data vs state vs cache with platform paths table, XDG-on-macOS callout, validation section, updated API reference, and updated exports tables
- Updated `packages/store/package.json` description from "config persistence" to "config/data/state/cache separation" and added keywords: `data`, `state`, `cache`, `xdg`
- Added `0.1.0` CHANGELOG entry summarizing all API redesign changes
- Removed all references to deprecated types (`FieldDef`, `FieldsDef`, `InferStoreConfig`, `ValueType`) and `fields` option from docs
- Updated macOS path examples from `~/Library/Application Support` to `~/.config` (XDG) throughout

### Files Changed

- `packages/store/README.md` — complete rewrite for new API
- `apps/docs/content/docs/modules/store.mdx` — complete rewrite for new API
- `packages/store/package.json` — updated description and keywords
- `packages/store/CHANGELOG.md` — added 0.1.0 entry

### Decisions

- README and docs both lead with CLI scenarios using separate config/state/cache/data stores, as specified in the task notes
- No `kind` option introduced — intent comes from choosing the appropriate path helper
- Quick start examples use `as string` type widening pattern (e.g., `"light" as string`) to avoid const narrowing issues, consistent with previous task notes
- CHANGELOG uses semver 0.1.0 (minor bump) since this is a breaking API change from field-definition to object-default schema
- Both README and MDX docs include a dedicated Validation section since `validate` is a new feature

### Notes for Future Agent

- All five tasks in prd.json are now complete
- 234 tests pass, type checks and lint are clean
- The docs reference `as string` type widening in examples — this is intentional for type inference correctness when literals would otherwise narrow to specific string values
