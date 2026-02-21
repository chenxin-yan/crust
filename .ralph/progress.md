# Progress Log

---

## Task: Initialize the @crustjs/create package with project scaffolding, build config, and barrel exports

### Completed

- Created `packages/create/package.json` following monorepo conventions (ESM, publishConfig, workspace deps, peer deps on @crustjs/core and typescript)
- Created `packages/create/tsconfig.json` extending `@crustjs/config/tsconfig.base.json` with declaration and isolatedDeclarations
- Created `packages/create/bunup.config.ts` with entry src/index.ts, ESM format, bun target, DTS enabled
- Created `packages/create/src/types.ts` with all public type definitions: `ScaffoldOptions`, `ScaffoldResult`, `PostScaffoldStep` union type
- Created `packages/create/src/index.ts` barrel file with section dividers and type re-exports
- Ran `bun install` to link the new workspace package
- Verified build succeeds (`bun run build --filter=@crustjs/create`)
- Verified type-check passes (`bun run check:types --filter=@crustjs/create`)
- Verified Biome lint/format passes (`bun run check`)

### Files Changed

- `packages/create/package.json` (new)
- `packages/create/tsconfig.json` (new)
- `packages/create/bunup.config.ts` (new)
- `packages/create/src/types.ts` (new)
- `packages/create/src/index.ts` (new)

### Decisions

- Used `readonly` on all interface fields and union type members as the SPEC and task notes require immutability
- `ScaffoldResult.files` is typed as `readonly string[]` for immutability
- `PostScaffoldStep` is a discriminated union on `type` field with 4 variants: install, git-init, open-editor, command
- Barrel file currently only exports types; value exports will be added as features are built in subsequent tasks
- `tsconfig.json` includes both `src` and `tests` directories (matching other packages)
- Version set to `0.0.1` (initial, pre-release)

### Notes for Future Agent

- The `packages/create/src/index.ts` barrel file has a "Types" section — add new sections (Template Engine, Scaffold, Steps, Utilities) as those modules are implemented
- The existing SPEC.md in `packages/create/` describes the full architecture including `scaffold()`, `runSteps()`, utilities, etc.
- The prd.json task notes say isBinary should NOT be re-exported publicly (only `interpolate` and types are public from task 2)
- All type definitions are in `src/types.ts` — future tasks should import from there

---

## Task: Implement the template interpolation engine with {{var}} replacement and binary file detection

### Completed

- Created `packages/create/src/interpolate.ts` with `interpolate(content, context)` function using `/\{\{\s*(\w+)\s*\}\}/g` regex
- Created `packages/create/src/isBinary.ts` with `isBinary(buffer)` function using null-byte heuristic on first 8192 bytes
- Wrote 11 unit tests for `interpolate` covering: single/multiple/repeated variables, missing variables left untouched, empty context, no placeholders, whitespace inside braces, malformed placeholders, empty content, empty replacement values, underscore variable names
- Wrote 8 unit tests for `isBinary` covering: text buffer, null bytes, empty buffer, null at start, null at boundary (8191), null beyond scan window (8192), printable ASCII, UTF-8 multibyte
- Exported `interpolate` from `src/index.ts` under a "Template Engine" section
- `isBinary` is NOT re-exported publicly — it's internal, imported directly by future `scaffold.ts`
- All 19 tests pass, type check passes, build succeeds, Biome lint/format passes

### Files Changed

- `packages/create/src/interpolate.ts` (new)
- `packages/create/src/isBinary.ts` (new)
- `packages/create/src/interpolate.test.ts` (new)
- `packages/create/src/isBinary.test.ts` (new)
- `packages/create/src/index.ts` (modified — added Template Engine section with `interpolate` export)

### Decisions

- `isBinary` is kept internal (not in barrel exports) per task notes — scaffold.ts will import it directly from `./isBinary.ts`
- Missing context variables are left untouched (no throw) — `{{unknown}}` stays as-is
- The regex allows optional whitespace inside braces: `{{ name }}` works
- JSDoc with `@example` added to both functions

### Notes for Future Agent

- `interpolate` is the only public export from the template engine — `isBinary` is internal
- The `scaffold()` function (task 3) should import `isBinary` from `./isBinary.ts` and `interpolate` from `./interpolate.ts` directly
- The barrel file now has two sections: "Template Engine" and "Types" — future sections to add: Scaffold, Steps, Utilities

---

## Task: Implement the core scaffold() function with template copying, interpolation, dotfile renaming, and conflict resolution

### Completed

- Created `packages/create/src/scaffold.ts` with `async scaffold(options: ScaffoldOptions): Promise<ScaffoldResult>`
- Implemented template path resolution using `fileURLToPath(new URL(template, importMeta))` pattern
- Implemented recursive directory walking via `walkDir()` helper using `readdirSync`/`statSync`
- Text files get `interpolate()` applied; binary files (detected via `isBinary`) are copied as-is
- Implemented dotfile renaming: files starting with `_` have the leading `_` replaced with `.` (e.g., `_gitignore` -> `.gitignore`)
- Implemented conflict resolution: `"abort"` (default) throws if dest is non-empty; `"overwrite"` proceeds
- Returns `ScaffoldResult` with list of all written file paths relative to dest
- Created `packages/create/tests/` directory for integration tests
- Wrote 13 integration tests in `packages/create/tests/scaffold.test.ts` covering:
  - Basic template scaffolding with text files and interpolation
  - Dotfile renaming (`_gitignore` -> `.gitignore`) including in subdirectories
  - Conflict abort (throws on non-empty dest)
  - Default conflict behavior is abort
  - Conflict overwrite (proceeds and overwrites files)
  - Binary file passthrough (copied without interpolation)
  - Templates with no interpolation placeholders
  - Scaffolding into non-existent dest (creates it)
  - Empty existing directory with abort is allowed
  - Composability: calling scaffold twice layers files correctly
  - Nested directory structure preservation
  - File listing in result
- Exported `scaffold` from `src/index.ts` under a new "Scaffold" section
- All 32 tests pass (19 existing + 13 new), type check passes, build succeeds, Biome lint/format passes

### Files Changed

- `packages/create/src/scaffold.ts` (new)
- `packages/create/tests/scaffold.test.ts` (new)
- `packages/create/src/index.ts` (modified — added Scaffold section with `scaffold` export)

### Decisions

- `scaffold()` is async even though current implementation uses sync fs operations — this matches the type signature in `types.ts` and allows future migration to async fs without breaking changes
- Helper functions (`walkDir`, `renameDotfile`, `isNonEmptyDir`) are module-private, not exported
- Dotfile renaming only affects the filename component, not parent directory names
- An empty existing directory is NOT considered a conflict — only non-empty directories trigger the abort
- The composability test uses `conflict: "overwrite"` for the second scaffold call since files from the first call already exist
- Template path can be absolute (resolved via `new URL(template, importMeta)`) — tests use absolute paths directly

### Notes for Future Agent

- The barrel file now has three sections: "Template Engine", "Scaffold", and "Types" — still need "Steps" and "Utilities"
- Integration tests create temp directories with unique names and clean up in `afterEach` — follow this pattern for future test files
- The `scaffold()` function uses `dirname()` trick with `mkdirSync({ recursive: true })` to create nested output directories
- For the dogfooding task (task 7), `create-crust` will need to use `import.meta.url` and a relative path to its `templates/` directory

---

## Task: Implement standalone utility functions: detectPackageManager, isGitInstalled, getGitUser

### Completed

- Created `packages/create/src/utils.ts` with all three utility functions
- `detectPackageManager(cwd?)` checks lockfiles in priority order (bun.lock/bun.lockb → pnpm-lock.yaml → yarn.lock → package-lock.json), falls back to `npm_config_user_agent` env var, defaults to `"npm"`
- `isGitInstalled()` uses `Bun.spawnSync(["git", "--version"])` with try/catch, returns boolean
- `getGitUser()` reads `git config user.name` and `git config user.email` via `Bun.spawnSync`, returns `{ name: string | null, email: string | null }`
- Internal `readGitConfig(key)` helper extracts single git config values
- Wrote 15 unit tests covering: lockfile detection for each package manager, priority ordering, npm_config_user_agent fallback for all 4 managers, default to npm, isGitInstalled returns true, getGitUser shape validation
- Exported all three functions from `src/index.ts` under new "Utilities" section
- All 47 tests pass (32 existing + 15 new), type check passes, build succeeds, Biome lint/format passes

### Files Changed

- `packages/create/src/utils.ts` (new)
- `packages/create/src/utils.test.ts` (new)
- `packages/create/src/index.ts` (modified — added Utilities section with 3 exports)

### Decisions

- Used `Bun.spawnSync` for git commands (Bun-native, simpler than `node:child_process`)
- Lockfile check order matches task notes: bun first (bun.lock + bun.lockb), then pnpm, yarn, npm
- `LOCKFILE_MAP` is a typed readonly array of tuples for clear, maintainable lockfile→manager mapping
- `readGitConfig()` is a private helper to DRY up git config reads — returns `null` on any failure
- Tests save and restore `npm_config_user_agent` env var to avoid test pollution
- Tests use temp directories with unique names (timestamp + random) for lockfile detection

### Notes for Future Agent

- The barrel file now has four sections: "Template Engine", "Scaffold", "Utilities", and "Types" — still need "Steps"
- `detectPackageManager` is used by the `runSteps` "install" step (task 5) to determine which install command to run
- All three utility functions are re-exported publicly from the barrel file
