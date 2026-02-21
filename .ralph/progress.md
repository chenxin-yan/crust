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
