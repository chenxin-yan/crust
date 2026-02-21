# Progress Log

---

## Task: Scaffold `@crustjs/validate` package with dual entrypoints and monorepo wiring

### Completed

- Created `packages/validate/` with full monorepo-consistent structure
- Set up `package.json` with dual exports (`.` and `./zod`), peer deps for `@crustjs/core` and `typescript`, dev deps for `@standard-schema/spec` and `zod@^4.0.0`, and optional peer dep metadata for `zod`
- Created `tsconfig.json` extending `@crustjs/config/tsconfig.base.json` with `declaration` and `isolatedDeclarations`
- Created `bunup.config.ts` with dual entry (`src/index.ts`, `src/zod/index.ts`), ESM format, Bun target, and DTS generation
- Set up barrel exports with section comments in `src/index.ts` and `src/zod/index.ts` (placeholder TODOs for future APIs)
- Added `.gitignore` consistent with other packages
- Added scaffold smoke test (`src/scaffold.test.ts`) verifying both entrypoints are importable
- Verified: build passes, tests pass (2/2), type check clean, biome lint/format clean

### Files Changed

- `packages/validate/package.json` — package manifest with dual exports
- `packages/validate/tsconfig.json` — TypeScript config
- `packages/validate/bunup.config.ts` — build config with dual entry
- `packages/validate/.gitignore` — git ignore rules
- `packages/validate/src/index.ts` — root entrypoint barrel (placeholder)
- `packages/validate/src/zod/index.ts` — zod entrypoint barrel (placeholder)
- `packages/validate/src/scaffold.test.ts` — scaffold verification test

### Decisions

- Used `zod@^4.0.0` as dev dependency (Zod 4 is the target per SPEC, installed as 4.3.6)
- `@standard-schema/spec` is a dev/type-only dependency (v1.1.0 installed), not a runtime dependency — keeps zero runtime deps constraint
- Zod is listed as optional peer dependency via `peerDependenciesMeta` since only the `/zod` entrypoint needs it
- Started version at `0.0.1` to reflect experimental status per SPEC
- Scaffold test uses dynamic `import()` to verify both entrypoints without requiring actual exports yet

### Notes for Future Agent

- The barrel files (`src/index.ts`, `src/zod/index.ts`) have TODO comments marking where exports should be added
- The build currently produces minimal output (8B per entry) since there are no exports yet — DTS files will be generated once actual types are exported
- The `tests/` directory exists for integration tests; unit tests should be co-located in `src/` as `*.test.ts`
- The `scaffold.test.ts` can be kept or removed once real tests exist — it serves as a build/wiring verification

---

## Task: Implement shared validation internals for issue normalization, path formatting, and Crust error mapping

### Completed

- Created `src/types.ts` with internal type aliases for Standard Schema types (`AnySchema`, `SchemaResult`, `SchemaIssue`, `SchemaPathSegment`) and the normalized `ValidationIssue` interface
- Implemented `formatPath()` in `src/validation.ts` that normalizes Standard Schema path segments (mixed `PropertyKey | PathSegment`) into dot-path strings with bracket notation for numeric indexes
- Implemented `normalizeIssue()` and `normalizeIssues()` to convert Standard Schema issues into canonical `ValidationIssue` form with flattened string paths
- Implemented `renderBulletList()` for CLI-friendly multi-line bullet-list message rendering with prefix and indented issue lines
- Implemented `throwValidationError()` that throws `CrustError("VALIDATION")` with formatted bullet-list message and raw normalized issues attached as `error.cause`
- Implemented `assertSyncResult()` sync-only guard that rejects `Promise` results from async schemas with a clear `CrustError("VALIDATION")` message
- Added 33 unit tests covering all edge cases in `src/validation.test.ts`
- Verified: build passes, all 35 tests pass, type check clean, biome lint/format clean

### Files Changed

- `packages/validate/src/types.ts` — Internal type aliases for Standard Schema types and normalized `ValidationIssue` interface
- `packages/validate/src/validation.ts` — Core validation utilities: path formatting, issue normalization, bullet-list rendering, CrustError mapping, sync guard
- `packages/validate/src/validation.test.ts` — 33 unit tests for all validation internals

### Decisions

- Kept all helpers as named `function` declarations (not arrow functions) per codebase conventions
- `types.ts` re-exports Standard Schema types as internal aliases so other modules don't import directly from `@standard-schema/spec` — centralizes type dependency
- `ValidationIssue.path` is a plain string (dot-path) rather than keeping the heterogeneous path array — simpler for rendering and programmatic use
- `throwValidationError` always attaches the normalized `ValidationIssue[]` as `error.cause` (not raw Standard Schema issues) for consistent downstream consumption
- `assertSyncResult` checks via `instanceof Promise` — simple and reliable for the v1 sync-only constraint
- Path formatter renders numeric keys with bracket notation (`[0]`) and string keys with dot notation — matches JavaScript property access conventions

### Notes for Future Agent

- `types.ts` and `validation.ts` are internal modules — they are NOT exported from the barrel files yet. Task 3 (generic wrapper mode) should import from these directly and decide what to re-export publicly
- The `ValidationIssue` type may need to be publicly exported for consumers who want to inspect `error.cause` — this decision should be made in Task 3 or Task 5
- `renderBulletList` with empty issues array produces `"prefix\n"` (trailing newline after prefix) — this is acceptable since validation failures should always have at least one issue
- All utilities are sync-only and side-effect-free, suitable for use in both entrypoints
