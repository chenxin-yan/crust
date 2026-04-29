# AGENTS.md — Crust CLI Framework

Bun-native, TypeScript-first CLI framework. Turborepo monorepo, Bun runtime, Biome lint/format, bunup builds. All packages ESM.

## Commands

```sh
bun install              # install deps
bun run build            # build all packages
bun run check            # Biome lint + format
bun run check:types      # type-check
bun run test             # run all tests
```

Run `bun run check` and `bun run check:types` before submitting.

## Tests

- `bun:test`: `import { describe, expect, it, beforeEach, afterEach } from "bun:test"`
- Unit tests: co-located (`src/foo.test.ts` beside `src/foo.ts`)
- Integration/smoke tests: `tests/`

## Documentation

Update docs in the same change as the code. Stale docs = bug.

Doc surfaces:

- `apps/docs/content/docs/guide/*.mdx` — conceptual guides
- `apps/docs/content/docs/modules/*.mdx` — per-package reference
- `apps/docs/content/docs/api/*.mdx` — public API reference
- `packages/<pkg>/README.md` — npm landing page

Before submitting:

- Examples in changed docs compile against the new API
- Cross-links resolve; `meta.json` updated if pages added/removed/reordered
- Package README and `modules/<pkg>.mdx` agree on install, exports, quick example

## Changesets

Do not edit `CHANGELOG.md` manually. Run `bunx changeset` to record user-visible changes; release tooling consumes them.
