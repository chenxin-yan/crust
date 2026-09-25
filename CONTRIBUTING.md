# Contributing to Crust

Check existing [issues](https://github.com/chenxin-yan/crust/issues) and pull requests before starting. For large changes, open an issue to discuss the approach first.

## Setup

Install [mise](https://mise.jdx.dev/getting-started.html), then from your cloned repository:

```sh
mise trust
mise install
```

Activate mise in your shell, or prefix the commands below with `mise exec --`. mise provides Node, Bun, Deno, and the pnpm version pinned in `package.json#packageManager`.

```sh
pnpm install
```

## Development

- `packages/` — published packages
- `apps/docs/` — documentation site
- `scripts/` — private workspace for repository automation and its tests
- `tools/` — private workspace for lint tooling

Run these commands from the repository root:

```sh
pnpm run build         # Build all packages and the docs site
pnpm run check         # Build packages, lint, and check formatting
pnpm run check:types   # Type-check workspaces, scripts, and build configuration
pnpm run test          # Build and test packages, tooling, and scripts
pnpm run dev:docs      # Start the docs site
```

Tasks run through Vite Task (`vp run`), which builds upstream packages first. Builds and type checks are cached; tests always rerun so environment-controlled smoke tests are not replayed from cache. Run one workspace's tasks with a filter. Docs tests remain separate:

```sh
pnpm exec vp run --filter ./scripts check:types:task
pnpm exec vp run --filter ./scripts test:task
pnpm --dir apps/docs exec vp test run
```

For specialized smoke-test setup and commands, see the [package](.github/workflows/ci-packages.yml) and [create-crust](.github/workflows/ci-create-crust.yml) CI workflows. Run opt-in suites directly with `vp test run <file>` in the owning package.

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
