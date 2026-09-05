# Contributing to Crust

Thanks for contributing to Crust. This repository is a Bun-native, TypeScript-first monorepo for the core CLI framework, official packages, and the documentation site.

## Before You Start

- Check existing [issues](https://github.com/chenxin-yan/crust/issues) and pull requests before starting work.
- Prefer small, focused pull requests over large mixed changes.
- If your change affects behavior, API shape, or developer workflow, include tests and documentation updates in the same PR.

## Prerequisites

- [Bun](https://bun.sh) `1.4.0`
- Node.js `^22.18 || >=24.11` (package builds run tsdown under Node, which enforces this exact range — Node 23.x and 24.0–24.10 are rejected)
- [Deno](https://deno.com) `>=2.8` (only needed to run the cross-runtime smoke suite locally; CI runs it on every PR)
- Git

## Repository Layout

- `packages/`: published framework packages
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

The cross-runtime smoke suite (built distributions executed under Bun, Node,
and Deno) runs in CI on every PR. To run it locally after `bun run build`:

```sh
bun scripts/smoke-runtimes/smoke.mjs
node scripts/smoke-runtimes/smoke.mjs
deno run --allow-env --allow-read --allow-write --allow-run --config scripts/smoke-runtimes/deno.json scripts/smoke-runtimes/smoke.mjs
```

Before opening a pull request, always run:

```sh
bun run check
bun run check:types
```

Run `bun run test` when your change affects runtime behavior. Compiler runtime or emission changes also require the Node/Go differential corpus (with both `node` and `go` on `PATH`):

```sh
cd packages/compiler
bun run test:corpus
```

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
- integration and smoke tests in package-local `packages/<pkg>/tests/` directories

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

Official packages declare `@crustjs/core` peer dependencies as `workspace:^`. Bun packs this as a caret range from the versioned workspace core, excluding older, incompatible pre-1.0 APIs that `workspace:0.x` would accept. Adopting this policy uses an explicit minor changeset for every affected package, including `@crustjs/testing`, which is outside the fixed release cohort. Subsequent out-of-range core updates can cause Changesets to automatically re-release testing as a patch; review those computed bumps when planning compatibility changes.

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
