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
