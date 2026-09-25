## Tests

- Vitest via Vite+: `import { describe, expect, it, beforeEach, afterEach, vi } from "vite-plus/test"`; `pnpm run test` from the root, `pnpm exec vp test run [file]` in a package.
- Tests run on Node. Exercise Bun-only behavior (`Bun.build`, compile, PTY) by spawning `bun` as a subprocess with an explicit timeout.
- Unit tests: co-located (`src/foo.test.ts` beside `src/foo.ts`)
- Compile-only type tests: co-located `src/foo.test-d.ts`; enforced by `pnpm run check:types` (tsc), not collected by `vp test`.
- Integration/smoke tests: package-local `packages/<pkg>/tests/`

## Documentation

Update relevant docs/code comments in the same change as the code. Stale docs = bug.

Doc surfaces:

- `apps/docs/content/docs/guide/*.mdx` — conceptual guides
- `apps/docs/content/docs/modules/*.mdx` — per-package reference
- `apps/docs/content/docs/api/*.mdx` — public API reference

Before submitting:

- Examples in changed docs compile against the new API
- Cross-links resolve; `meta.json` updated if pages added/removed/reordered

## Changesets

Do not edit `CHANGELOG.md` manually. Run `pnpm run changeset` to record user-visible changes; release tooling consumes them. Skip changesets for changes with no end-user behavior impact (internal refactors, tests, docs, CI, tooling).
