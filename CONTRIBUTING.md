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

### Release automation

The release workflow versions packages with Changesets and refreshes `bun.lock`
without installing dependencies or running lifecycle hooks. Publishing has three
separate jobs:

1. Build without restored caches, then pack workspace and generated platform
   packages. Bun packing resolves workspace/catalog ranges and runs the LICENSE
   hooks. Generated packages are validated and packed before their root package.
2. Download those tarballs and upload missing versions with npm trusted publishing.
   This is the only OIDC-enabled job; it installs no project dependencies and runs
   no build, pack, or lifecycle hooks.
3. After every upload succeeds, Changesets tags the entire cohort and creates
   GitHub releases. This job has no npm publishing permission.

The small repository publisher is deliberately for stable, public npm releases.
It explicitly targets npmjs.com for both lookups and uploads, ignoring ambient
registry overrides. Other registries and prerelease release policies are not
handled by this repository workflow. The public `crust publish` command remains
separate.

Bun packing plus npm uploading remains necessary until upstream supports the
required combination: [Bun OIDC](https://github.com/oven-sh/bun/issues/15601) and
[Changesets workspace packing with Bun](https://github.com/changesets/changesets/issues/1468).
Generated binary packages also require the staged manifest, not just workspace
discovery. Do not replace this with bare `changeset publish` or rename the package
`release` scripts to npm's recursive `publish` lifecycle hook.

To inspect release artifacts without publishing (use a new empty directory):

```sh
bun run build:pkgs
bun run packages:pack /tmp/crust-release-pack
bun run packages:publish /tmp/crust-release-pack --dry-run
```

The dry run queries npm but uploads nothing. After a partial upload failure,
rerun the failed jobs to reuse the same run's tarballs (retained for seven days).
Existing versions are skipped; finalization still runs when no uploads remain.
Each root and platform package needs its own npm trusted-publisher configuration
for `release.yml`; first publication and registry permissions require a maintainer.
If tags were pushed but GitHub release creation failed, inspect/reconcile the
missing GitHub releases manually: `changeset git-tag` skips existing tags.

## Reporting Issues

[File an issue](https://github.com/chenxin-yan/crust/issues) with a minimal reproduction, expected and actual behavior, and your Bun, Node.js, and OS versions.

Report security vulnerabilities privately through [GitHub Security Advisories](https://github.com/chenxin-yan/crust/security/advisories/new), not public issues.
