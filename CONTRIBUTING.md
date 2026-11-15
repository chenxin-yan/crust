# Contributing to Crust

Check existing [issues](https://github.com/chenxin-yan/crust/issues) and pull requests before starting. For large changes, open an issue to discuss the approach first.

## Setup

Install [mise](https://mise.jdx.dev/getting-started.html), then from your cloned repository:

```sh
mise trust
mise install
```

Activate mise in your shell, or prefix the commands below with `mise exec --`. mise provides Node, Bun, and the pnpm version pinned in `package.json#packageManager`.

```sh
pnpm install
```

## Development

- `packages/` — published packages
- `apps/docs/` — documentation site
- `scripts/` — private workspace for repository automation and its tests

Run these commands from the repository root:

```sh
pnpm run build         # Build all packages and the docs site
pnpm run check         # Build packages, lint, and check formatting
pnpm run check:types   # Type-check workspaces, scripts, and build configuration
pnpm run test          # Build packages, then run every test (packages, scripts, docs)
pnpm run dev:docs      # Start the docs site
```

Tasks run through Vite Task (`vp run`), which builds upstream packages first. Package builds, type checks, and the combined `vp check` lint/format task are cached. The docs build and dev server are uncached.

Use `pnpm run check` for the package prebuild followed by `vp check`; bare `vp check` runs the built-in command without that prerequisite. `pnpm run check:fix` applies formatting and lint fixes without caching the fix step. Keep `pnpm run check:types` separate: type-aware lint rules do not replace workspace compiler checks or docs source generation.

The build, test, and type-check commands are defined once as `build:task`, `test:task`, and `check:types:task` in [`vite.shared.ts`](vite.shared.ts); a package with a different command overrides it in its own `vite.config.ts`. Each workspace's `build`, `test`, and `check:types` scripts run `vp run <name>:task`, so running a script inside a package also builds its upstream packages. Arguments after the script name reach the underlying command. Run one workspace's tasks with a filter or from its directory:

```sh
pnpm exec vp run --filter ./scripts check:types:task
pnpm --dir packages/core run test --run
pnpm exec vp test run packages/store   # after a package build, from the root
```

`pnpm run test` runs every project from the root [`vite.config.ts`](vite.config.ts) in one Vitest run, so arguments after it reach Vitest. CI runs the same command. Linux runs every test; the macOS and Windows jobs run the tests tagged for them. Every project declares the same tags from `testTags` in [`vite.shared.ts`](vite.shared.ts), so a tagged file also runs from its package. They are set per file with a `@module-tag` comment, or per suite with the `tags` option:

| Tag       | Meaning                                                                                   |
| --------- | ----------------------------------------------------------------------------------------- |
| `windows` | Also runs in the Windows CI job                                                           |
| `macos`   | Also runs in the macOS CI job                                                             |
| `network` | Installs packages from a registry; `pnpm run test --tags-filter '!network'` skips them    |
| `mise`    | Runs the oldest supported Node.js or Bun through mise; skipped without mise, except on CI |

For documentation changes, run the docs gates in [`apps/docs/README.md`](apps/docs/README.md#validation).

A test that needs a tool which may be missing locally skips itself (`skipIf`, or `context.skip(condition, reason)`). On CI every tool is installed, so a missing one fails instead of passing by skipping.

## Pull Requests

Open PRs against `main` and keep each change focused.

- Follow existing TypeScript/ESM conventions; let Oxlint and Oxfmt handle style. Use `pnpm run check:fix` to apply fixes.
- Add or update tests for changed behavior. Unit tests import from `vite-plus/test` (Vitest) in colocated `*.test.ts` files; type tests use `*.test-d.ts` and run through `check:types`. Integration tests belong in the package's `tests/` directory.
- Update documentation when public behavior or APIs change.
- Run `pnpm run check`, `pnpm run check:types`, and relevant tests before submitting.
- Explain what changed, why, and how you tested it in the PR description.

## Changesets

For user-visible changes to published packages, add a changeset:

```sh
pnpm run changeset
```

Choose the smallest accurate version bump and describe the user-facing change, including migration steps if needed. Do not edit package versions or changelogs manually.

Docs, tests, internal refactors, and maintenance without user-facing impact do not need a changeset.

## Reporting Issues

[File an issue](https://github.com/chenxin-yan/crust/issues) with a minimal reproduction, expected and actual behavior, and your Bun, Node.js, and OS versions.

Report security vulnerabilities privately through [GitHub Security Advisories](https://github.com/chenxin-yan/crust/security/advisories/new), not public issues.
