## Tests

- Vitest via Vite+: `import { describe, expect, it, beforeEach, afterEach, vi } from "vite-plus/test"`; `pnpm run test` from the root runs every project (CI runs the same command), `pnpm exec vp test run [file]` in a package. CI host selection and slow-test categories are Vitest tags (`testTags` in `vite.shared.ts`); mark a file with a `@module-tag` comment, not a CI file list or an environment switch.
- Tests run on Node. Exercise Bun-only behavior (`Bun.build`, compile, PTY) by spawning `bun` as a subprocess with an explicit timeout.
- Unit tests: co-located (`src/foo.test.ts` beside `src/foo.ts`)
- Compile-only type tests: co-located `src/foo.test-d.ts`; enforced by `pnpm run check:types` (tsc), not collected by `vp test`.
- Integration/smoke tests: package-local `packages/<pkg>/tests/`

## Performance

Performance targets the shipped artifact (after `crust build` bundling or compilation); unbundled dev-mode startup is not an optimization goal.

## Documentation

Update relevant docs/code comments in the same change as the code. Stale docs = bug.

Doc surfaces:

- `apps/docs/content/docs/guide/*.mdx` — conceptual guides
- `apps/docs/content/docs/modules/*.mdx` — per-package reference
- `apps/docs/content/docs/api/*.mdx` — public API reference

Package READMEs are npm landing pages that point at the hosted docs, the source of truth: the `package.json` description, the command that installs or runs the package, and a `## Documentation` link to its page. Behavior, API, options, and examples go in `apps/docs`; edit a README only when its description, command, or docs link changes. Exception: `create-crust`'s README owns the initializer's options, and the docs link to it.

Before submitting:

- Examples in changed docs compile against the new API
- Cross-links resolve; `meta.json` updated if pages added/removed/reordered

## Changesets

Do not edit `CHANGELOG.md` manually. Run `pnpm run changeset` to record user-visible changes; release tooling consumes them. Skip changesets for changes with no end-user behavior impact (internal refactors, tests, docs, CI, tooling).
