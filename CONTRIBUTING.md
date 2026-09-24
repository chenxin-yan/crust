# Contributing to Crust

Check existing [issues](https://github.com/chenxin-yan/crust/issues) and pull requests before starting. For large changes, open an issue to discuss the approach first.

## Setup

Install [mise](https://mise.jdx.dev/getting-started.html), then from your cloned repository:

```sh
mise trust
mise install
```

Activate mise in your shell, or prefix the commands below with `mise exec --`.

```

bun install
```

## Development

- `packages/` — published packages
- `apps/docs/` — documentation site

Run these commands from the repository root:

```sh
bun run build         # Build all packages and the docs site
bun run check         # Build packages, lint, and check formatting
bun run check:types   # Type-check workspaces, scripts, and build configuration
bun run test          # Build and test packages, tooling, and scripts
bun run dev:docs      # Start the docs site
```

Use `bun run test`, not bare root `bun test`: the tooling tests require Node.

Scripts checks can also run independently. Docs tests remain separate:

```sh
bun test scripts/*.test.ts
bunx tsc --noEmit -p scripts
bun run --cwd apps/docs test
```

For specialized smoke-test setup and commands, see the [package](.github/workflows/ci-packages.yml) and [create-crust](.github/workflows/ci-create-crust.yml) CI workflows. Run opt-in suites directly, not through cached Turbo tasks.

## Pull Requests

Open PRs against `main` and keep each change focused.

- Follow existing TypeScript/ESM conventions; let Oxlint and Oxfmt handle style. Use `bun run check:fix` to apply fixes.
- Add or update tests for changed behavior. Unit tests use `bun:test` in colocated `*.test.ts` files; type tests use `*.test-d.ts` and run through `check:types`. Integration tests belong in the package's `tests/` directory.
- Update documentation when public behavior or APIs change.
- Run `bun run check`, `bun run check:types`, and relevant tests before submitting.
- Explain what changed, why, and how you tested it in the PR description.

## Changesets

For user-visible changes to published packages, add a changeset:

```sh
bun run changeset
```

Choose the smallest accurate version bump and describe the user-facing change, including migration steps if needed. Do not edit package versions or changelogs manually.

Docs, tests, internal refactors, and maintenance without user-facing impact do not need a changeset.

## Reporting Issues

[File an issue](https://github.com/chenxin-yan/crust/issues) with a minimal reproduction, expected and actual behavior, and your Bun, Node.js, and OS versions.

Report security vulnerabilities privately through [GitHub Security Advisories](https://github.com/chenxin-yan/crust/security/advisories/new), not public issues.
