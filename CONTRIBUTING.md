# Contributing to Crust

Thanks for contributing to Crust. This repository is a Bun-native, TypeScript-first monorepo for the core CLI framework, official packages, and the documentation site.

## Before You Start

- Check existing [issues](https://github.com/chenxin-yan/crust/issues) and pull requests before starting work.
- Prefer small, focused pull requests over large mixed changes.
- If your change affects behavior, API shape, or developer workflow, include tests and documentation updates in the same PR.

## Prerequisites

- [Bun](https://bun.sh) `1.4.2`
- Node.js `^22.18.0 || ^24.11.0 || >=26.0.0` (package builds run tsdown under Node, which enforces this exact range — Node 23.x, 25.x and 24.0–24.10 are rejected)
- [Deno](https://deno.com) `>=2.8` (only needed to run the cross-runtime smoke suite locally; CI runs it for PRs matching the package workflow's path filters)
- Git

## Repository Layout

- `packages/`: framework packages and the private experimental compiler
- `apps/docs/`: documentation site
- `.changeset/`: release metadata used by Changesets
- `scripts/`: release and maintenance scripts

Most package source files live in `packages/*/src`. Unit tests are usually colocated as `packages/*/src/*.test.ts`, and broader integration or smoke tests live in package-local `packages/<pkg>/tests/` directories.

## Local Setup

```sh
bun install
```

Common root commands:

```sh
bun run build
bun run lint
bun run format
bun run check
bun run check:types
bun run test
```

`bun run test` runs package tests and the Node-based Oxlint RuleTester suite in
`tools`; it does not run scripts or docs tests. Do not substitute bare root
`bun test`: Oxlint RuleTester requires Node. For those additional checks, run:

```sh
bun test scripts/*.test.ts
bun x tsc --noEmit -p scripts
bun run --cwd apps/docs test
bun run check:types --filter=./apps/docs
```

Build changed packages and their dependencies before directly running tests that
consume `dist` (including declaration-emission and packed-consumer tests). The
Turbo-backed `bun run test` handles these build prerequisites; an existing `dist`
file alone does not prove it reflects current source.

The cross-runtime smoke suite (built distributions executed under Bun, Node,
and Deno) runs for PRs matching the package workflow's path filters. To run it
locally after `bun run build`:

```sh
bun scripts/smoke-runtimes/smoke.mjs
node scripts/smoke-runtimes/smoke.mjs
deno run --allow-env --allow-read --allow-write --allow-run --config scripts/smoke-runtimes/deno.json scripts/smoke-runtimes/smoke.mjs
```

The installed-tool E2E smoke runs on Linux with Node, Bun and Git on PATH and
verified npm **11.19.1**. After a current `bun run build`, run it directly (not
through cached Turbo tests), provisioning npm outside the workspace:

```sh
npm_prefix=$(mktemp -d)
npm install --global --prefix "$npm_prefix" --cache "$npm_prefix/cache" --ignore-scripts --no-audit --no-fund npm@11.19.1
PATH="$npm_prefix/bin:$PATH" CREATE_CRUST_INSTALLED_SMOKE=1 bun test packages/create-crust/tests/installed-tools.smoke.test.ts
rm -rf "$npm_prefix"
```

npm **10.9.8** returns a successful install but deletes the root `crust` shim when
pruning incompatible optional platform packages that share its bin name. npm
**11.19.1** is verified with Node **22.23.2**; this does not establish the minimum
fixed npm version or support for every npm11 release. CI pins that npm version
only for this new Linux step; existing scaffold/runtime coverage keeps its toolchain.

It packs staged `create-crust` and `crust` root/host-platform artifacts, installs
with npm outside the workspace, then scaffolds a Bun project and builds it through
the actual installed command shims. It runs the generated CLI and checks output
and exit status. Installed-copy-only removal probes verify template and platform
resolution. Existing source/bootstrap, cross-runtime and PTY tests remain separate.

The suite never rebuilds or modifies repository artifacts: current `.crust` staging
for both tools and `dist` for core/extensions/style/store are prerequisites. Crust's
root must retain the full manifest's optional dependencies, including incompatible
platforms; the test rejects host-only staging, which can mask the npm10 bug. Existing
build integration tests can replace staging with a host-only build, so rebuild all
targets before this smoke if needed. Those unpublished libraries and the host optional package are explicitly provisioned via
local tarballs (the host via npm overrides). Public registry access is still needed
for the pinned npm toolchain, non-host optional package metadata, and the template's
TypeScript/Bun typings and transitives; crust's update notifier
can also contact the registry. Real Bun remains available for compilation. This
is not offline/hermetic acquisition or published-registry optional-package selection
coverage, nor coverage of other platforms, installers or no-Bun compilation.

Unique `create-crust-installed-*` fixtures under `RUNNER_TEMP` or the system temp
directory isolate npm cache/prefix and home state. Success removes them; failure
prints the retained path (remove it manually after diagnosis). CI uploads only its
`diagnostics/` command logs and manifests, not the large binaries or npm cache.
Without `CREATE_CRUST_INSTALLED_SMOKE=1`, the test skips without creating a fixture.

The OpenTUI compile smoke installs pinned packages from npm, so it is opt-in: `CRUST_TUI_SMOKE=1 bun test packages/crust/tests/tui-build.smoke.test.ts` (Linux/macOS).

Before opening a pull request, always run:

```sh
bun run check
bun run check:types
```

Run `bun run test` when your change affects runtime behavior. This includes the compiler's Go-free diagnostics through its public `compile()` seam, but not the native differential corpus. Compiler runtime or emission changes also require `test:corpus`: use Node **24** as the reference runtime and the optional Go version pinned in `mise.toml` (`mise install go`). CI reads its Bun version from the root `package.json` `packageManager` field.

See the [compiler README](packages/compiler/README.md#testing) for compiler-only commands, loud Go-absent skips, and the runtime parity contract. The corpus runs in its own filtered CI lane; compiler build, types, lint, formatting, and Go-free tests remain framework checks. Add regressions through `compile()`, not internal lowering functions or IR/Go-source snapshots.

## Working on Packages

Most packages in `packages/` are built with `tsdown`; `@crustjs/crust` uses Bun directly. Packages are tested with `bun test` and type-checked with `tsc`.

You can work from the repository root or from an individual package directory.

Examples:

```sh
# Whole repo
bun run build
bun run test

# One package
cd packages/core
bun run build
bun run check:types
bun run test
```

If you change published package behavior, aim to:

- add or update tests close to the affected code
- keep public API changes intentional and documented
- avoid unrelated refactors in the same PR

## Working on Documentation

The docs site lives in `apps/docs`.

Useful commands:

```sh
bun run dev:docs
bun run build:docs
bun run lint apps/docs
bun run format apps/docs
bun run check:types --filter=./apps/docs
```

Update docs when you change public APIs, commands, flags, generated output, or release behavior.

## Code Style

- Use TypeScript and ESM consistently with the existing codebase.
- Let Oxlint and Oxfmt handle linting and formatting.
- Follow existing naming and file layout patterns instead of introducing new structure without a strong reason.
- Keep changes minimal and targeted.

This repository currently uses:

- tabs for indentation
- double quotes in JavaScript and TypeScript
- `bun:test` for tests

## Tests

Add tests for bug fixes and new behavior whenever practical.

Preferred patterns in this repo:

- colocated unit tests in `packages/*/src/*.test.ts`
- compile-only contracts in `packages/*/src/*.test-d.ts`, enforced by `check:types`, not `bun test`; keep them free of `bun:test` imports and Bun globals
- integration and smoke tests in package-local `packages/<pkg>/tests/` directories

Opt-in smoke suites should run directly with their documented environment flag,
not through a potentially cached Turbo test task that previously skipped them.

When fixing a bug, add a test that fails before the fix and passes after it.

## Changesets and Releases

This repository uses [Changesets](https://github.com/changesets/changesets) for package versioning and releases.

Add a changeset when your PR changes a published package in a way that should be released. Typical examples:

- new features
- bug fixes
- deprecations
- breaking changes

You usually do not need a changeset for:

- docs-only changes
- test-only changes
- internal refactors with no user-facing impact
- CI or repository maintenance changes with no published package impact

Create one with:

```sh
bun run changeset
```

Use the smallest accurate bump. Do not manually edit package versions or changelog files unless the release workflow specifically requires it.

## Pull Requests

Open PRs against `main`.

Before submitting:

- make sure the branch is rebased on the latest `main`
- run `bun run check`
- run `bun run check:types`
- run relevant tests
- add a changeset if a published package should be released
- update docs when public behavior changes

In the PR description, explain:

- what changed
- why it changed
- any package or docs areas affected
- any follow-up work or known limitations

## Reporting Bugs

Use [GitHub Issues](https://github.com/chenxin-yan/crust/issues) for bug reports, regressions, and feature requests.

Helpful reports include:

- clear reproduction steps
- expected behavior
- actual behavior
- Bun, Node.js, and OS versions
- a minimal example or failing command

If you believe you found a security issue, do not file a public issue with exploit details. Please report it via [GitHub Security Advisories](https://github.com/chenxin-yan/crust/security/advisories/new) or contact the maintainer directly before any public disclosure.
