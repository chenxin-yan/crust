# Pin `@crustjs/*` versions at scaffold time

## What changed

`create-crust` no longer ships literal `"latest"` dep entries in the generated `package.json`. Instead, at scaffold time the detected package manager's `add` command is invoked, which resolves `@latest` to a concrete semver and writes a caret range (e.g. `^1.2.3`) into the user's `package.json` in a single install-and-pin step.

## Why

A fresh project committing `"latest"` is surprising and fragile — `bun install` does not rewrite that tag, so the user's `package.json` keeps drifting with every install and is untracked by lockfile-free consumers. Running `bun add` (or the equivalent for other PMs) at scaffold time gives the expected "latest-at-creation-time" semantics while producing a deterministic pinned file the user can commit.

## Files touched

### `@crustjs/create` (core framework)
- `packages/create/src/types.ts`
  - Added a new `"add"` variant to the `PostScaffoldStep` union, with optional `dependencies` and `devDependencies` string arrays.
- `packages/create/src/steps.ts`
  - Implemented `runAdd` + `spawnAdd` + `buildAddArgv`.
  - Wired the `"add"` case into the `runSteps` switch.
  - Per-PM argv mapping (`bun`, `pnpm`, `yarn`, `npm`), dev vs. regular deps branched by flag (`-d` / `-D` / `install -D`).
  - Each package gets `@latest` appended before the spawn. `--exact`/`-E` is intentionally NOT passed so the package manager writes caret ranges.
  - Empty / omitted lists → skipped spawn. Both empty → no-op (no throw).
  - Max two spawns per step (one for deps, one for dev deps).
- `packages/create/tests/steps.test.ts`
  - Added an `add step` describe block: regular-dep caret-range test, dev-dep caret-range test, no-op test. Uses `is-number` as a small stable fixture.

### `create-crust`
- `packages/create-crust/src/create-project.ts`
  - Introduced a `CRUST_DEPS_BY_MODE` map describing which `@crustjs/*` deps belong to `dependencies` vs `devDependencies` for each distribution mode.
  - Replaced the unconditional `{ type: "install" }` step with a single `{ type: "add", ... }` step (only when `installDeps` is true). The `add` step installs as a side effect, so no separate `install` step is emitted.
  - `installDeps: false` → emits neither `add` nor `install`, matching the previous behavior (just scaffold files).
- `packages/create-crust/templates/distribution/runtime/package.json`
  - Removed `@crustjs/core`, `@crustjs/plugins`, `@crustjs/crust`, `@types/bun` (all `"latest"` entries) and the now-empty `dependencies` object. Only `typescript: "^6"` remains.
- `packages/create-crust/templates/distribution/binary/package.json`
  - Removed all `@crustjs/*` and `@types/bun` `"latest"` entries. Only `typescript: "^6"` remains.
- `packages/create-crust/tests/create-project.test.ts`
  - Extended the `installDeps: true` test to assert no dep equals `"latest"` and every `@crustjs/*` entry matches `/^\^\d+\.\d+\.\d+(-.+)?$/`.
  - Bumped that test's timeout to 60s since the registry install can exceed the default 5s.
  - `installDeps: false` test left functionally unchanged.
- `packages/create-crust/tests/scaffold.test.ts`
  - Updated the three assertions that previously checked for `"latest"`-tagged entries to reflect the new template contents (only `typescript: "^6"` remains after raw scaffolding).
- `packages/create-crust/README.md`
  - Added a "Dependency Versions" section explaining the caret-range behavior and the manual `bun add` command to run after `--no-install`.

### Changeset
- `.changeset/pin-versions-on-scaffold.md`
  - `create-crust`: patch (behavior change, no public API delta).
  - `@crustjs/create`: minor (new public `"add"` step variant).

## Test results

- `bun run check` — ✓ (Biome clean, 272 files)
- `bun run check:types` — ✓ (21/21 tasks successful)
- `bun run test` — ✓ (all 21 packages, all tests pass; last run: `@crustjs/crust` 129/130 with 1 expected skip; `@crustjs/create` 73 pass; `create-crust` 21 pass + 1 skipped smoke test)
- `bunx changeset status` — ✓ (`create-crust` patch + `@crustjs/create` minor queued)

## Smoke-test note

`packages/create-crust/tests/cli.smoke.test.ts` only asserts successful scaffold + install + build (no exact version pinning). It didn't need any changes — the new `add` step keeps producing `package.json`, `package-lock.json`, and `node_modules`, which is all the smoke test checks.

## Follow-ups

- None blocking. If the npm registry is ever unreachable in CI, the `add` step (and the associated tests) will surface that as a failed spawn — same behavior as the old `install` step, just with an extra network hop per dep-kind.
- Consider exposing an optional `exact: boolean` flag on the `"add"` step later if a downstream consumer wants hard-pinned ranges instead of carets. Intentionally omitted for now.
