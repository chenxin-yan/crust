# Reproducible CLI comparison

A small, bounded benchmark, **not a feature ranking**. Eighteen candidates were considered: **11 libraries plus the runtime builtin pass**, five installed libraries have reproducible contract limitations, and full oclif is outside the single-file bundle scope. Nothing is published or added to the root dependency graph.

Read the [measured comparison](./results/full.md) and [raw samples](./results/full.json). The broader survey and sources are in [research.md](./research.md).

## Reproduce

Prerequisites: this PR's checkout (which contains the harness), Bun **1.4.2**, Node **v26.8.2**, npm, and network access for dependency installation. The frozen baseline is `b79c147ad81549d5cf8755993bf707b539fda996`, which predates the harness; build it in a separate worktree rather than checking this harness out at that revision.

From the repository root, install the harness tooling and create an installed baseline worktree:

```sh
bun ci
git worktree add --detach ../crust-cli-baseline b79c147ad81549d5cf8755993bf707b539fda996
bun install --frozen-lockfile --cwd ../crust-cli-baseline
```

Then, still starting from the repository root, run the harness against that baseline:

```sh
cd scripts/cli-comparison
npm ci --ignore-scripts --no-audit --no-fund
CRUST_ROOT="$(realpath ../../../crust-cli-baseline)" bun run prepare:local
bun run check
bun test contract.test.ts
bun run build
bun run verify
bun run smoke
bun report.ts results/smoke.json > results/smoke.md
```

**Full measurement, after review, with other CPU-intensive work stopped:**

```sh
cd scripts/cli-comparison
bun run build && bun run verify && bun run measure
bun report.ts results/full.json > results/full.md
```

The full run has 15 warm measurement batches (3 fresh workers × 5 batches, each after 3 warmup batches; 300 calls/batch) and 30 startup samples per runtime/library plus an empty-process baseline (2 untimed startup rounds). Expect roughly a few minutes on a development machine. Smoke uses 2 × 10 warm calls, 1 warmup batch, and 3 startup samples; **smoke numbers are not performance evidence**. Measurements are serial; a lock rejects a second measurement runner. Individual children have timeouts (30 seconds, or 120 seconds for a warm worker) and bounded loops. A crashed runner can leave `.generated/measurement.lock`; remove it only after confirming no measurement is active.

To measure the current checkout instead of the frozen baseline, run the following from `scripts/cli-comparison` after installing repository and benchmark dependencies:

```sh
EXPECTED_REVISION="$(git rev-parse HEAD)" bun run prepare:local
bun run check && bun test contract.test.ts
bun run build && bun run verify
bun measure.ts --out current
bun report.ts results/current.json > results/current.md
```

To measure another commit in a separate checkout, use `CRUST_ROOT=<absolute-checkout-path> EXPECTED_REVISION=<full-sha> bun run prepare:local` instead. `CRUST_ROOT` defaults to this repository. Always rebuild and verify after preparation; `--out <name>` retains the frozen `full.json` rather than overwriting it. `BUN_BIN` and `NODE_BIN` can select executable paths. Build/prepare still require the Bun used to launch them; the measurement gate checks the recorded bundler version. Node uses its native TypeScript stripping for harness/source conformance, not a third-party TS loader. Measurements execute **bundled JavaScript**, never compare source TS against a bundle.

Generated `.generated/` and smoke results are ignored; `results/full.json` and `results/full.md` are retained as the reproducible measurement snapshot. The benchmark-local `package-lock.json` locks all installed transitive dependencies. Never run `bun install` in this nested workspace: use the explicit npm command above. After `npm ci`, rerun `prepare:local` to recreate local package links.

## Local Crust provenance

`prepare.ts` refuses a different HEAD or modified core/utils/build configuration. It clears and rebuilds the ignored `packages/{utils,core}/dist` with the repository's normal `tsdown` build, then copies these artifacts into `.generated/local/` and links the **public package roots** into benchmark-local node_modules. No stale dist or registry Crust is used. Provenance includes git revision, root lockfile hash, build tool versions, build timestamp and SHA-256 of every copied dist artifact. The bundle builder checks these hashes. Crust is **local 0.3.3**, utils **local 0.1.0**, not an npm-release comparison. No internal compiler marker/define, snapshot optimization or internal API is used; the fixture uses public `.command()`, `.action()` and `.execute({argv})`.

## Tested CLI contract

```text
cli deploy <target> [--region/-r text] [--replicas/-n number]
                   [--force/-f] [--tag/-t text ...repeated flag]
cli config <key> [--value/-v text]
```

- Deploy result: `{command:"deploy", target, region:"us-east-1", replicas:1, force:false, tag:[]}` with supplied values replacing defaults. Tags retain occurrence order.
- Config result: `{command:"config", key, value:null}` when absent; supplied value stays a string.
- **All text values are nonempty strings**, including numeric-looking strings such as `001`. Numbers are nonempty finite values converted with `Number` (not integer-only). Shared application validation in `contract.ts` applies to every adapter and is counted in every metric; it does not inspect tokens or recover lost values.
- Tests cover defaults, all explicit flags, aliases, repeated tags, long-option `=value`, numeric-looking strings, both commands, alternating invocations back to defaults, unknown commands/options, wrong-command options, missing positionals/option values, empty text/numbers, `NaN`, infinities and nonnumeric numbers. Errors need nonzero status, not identical messages.
- Explicit empty values are **rejected**, not merely untested. Minimist/MRI cannot distinguish an omitted option value from an explicitly empty string; the common nonempty-text domain rejects both. Yargs-parser's application glue sets defaults only after native parsing because native defaults also replace missing values.
- Duplicate scalar options, surplus positionals, option-like text values, short-option clusters, short `=value`, boolean `=false`/negation, `--` forwarding, root/no-command behavior and help text are outside this bounded common contract. This is not full semantic equivalence for arbitrary argv.

Frameworks use native subcommands. Bare parsers (Arg, minimist, MRI, yargs-parser, parseArgs) use the visible small route/required/default/known-option glue; it is included in size and time. Argparse natively selects a subparser; the adapter dispatches the selected namespace. No independent parser, raw-token guard, upstream patch, console interception or process-exit monkey patch is used. Native public error/exit APIs are retained; invalid-input checks run in separate processes so terminal adapters cannot poison later checks.

## Uniform measurement method

**Bundles:** one Bun.build configuration for every row: `target:"node"`, `format:"esm"`, minification, no source maps, no splitting, packages bundled, no framework-specific defines. This portable Node-target bundle is used unchanged for **both** runtimes. Bun-target bundles were explored but generate Bun-specific CommonJS builtin bridges (e.g. Clipanion/argparse), so they are not mixed into this portable comparison. The byte count includes the real CLI entry, adapter, domain validation and transitive runtime code. Gzip level 9 compresses exactly those bytes. Only runtime builtins may remain external; the build input metafile records them. A builtin's small fixture size is **not** the size of its implementation, which resides in the runtime.

A bundle must pass all positive/rejection cases on both Bun and Node after copying it into an isolated temporary directory outside node_modules, with that empty directory as cwd. Additional artifacts or nonbuiltin externals fail loudly rather than producing a misleading partial size. This is practical exercised-path evidence, not a proof about unexercised help/plugin/asset paths. Unsupported build/runtime cases must be investigated and explicitly reported, not silently dropped. Generated entry uses a portable URL/path direct-execution guard; `import.meta.main` is intentionally avoided because Bun's Node-target bundler folds it at build time.

**Warm command invocation:** each call constructs a new command schema, parses/routes, validates, dispatches and returns a normalized object. Imports are outside the timer. No library reuses a schema, command instance or prepared parse state across calls. The harness copies argv, unconditionally awaits both sync and async adapters, JSON-serializes and compares each result **inside** the timer; those common costs can dominate tiny parsers. No stdout writes occur in the measured warm loop. Sync/async adapter paths are labeled, not specially optimized.

**Fresh process:** parent-side lifetime of one fresh runtime executing the same bundle/argv, including runtime startup, import, schema construction, invocation, JSON stdout and exit. Output is asserted after timing. This is **OS-cache-warm process startup, not filesystem cold start**; no OS caches are flushed. Empty `.mjs` process lifetime is reported separately, never subtracted. Parent spawn overhead is included.

Bun and Node run in separate batches. Warm library order is shuffled reproducibly across independent worker rounds; startup order is shuffled each sample round, including the baseline. Seeded Fisher–Yates ordering and its seed are recorded; randomization reduces systematic order effects but does not guarantee balance in a finite run. No concurrent measurements, timing thresholds or speed-based pass/fail. Summary is median and p05–p95 with linear interpolation; min/max and every raw sample are retained. Warm spread is **batch-average** spread, not individual invocation latency. No GC forcing, CPU affinity, governor control or statistical-significance claim. Current workload is the all-flags deploy case, not an average over command shapes.

Raw `results/full.json` includes source fingerprint, bundle hashes, exact installed direct versions, local build provenance, lock-backed dependency graph, runtime/bundler versions, OS/CPU/memory, git status/revision, settings, argv/expected result, ordering seed and actual orders, all raw samples and conformance records. `report.ts` produces descriptive Markdown, not rankings. Source/bundle changes invalidate the verification gate.

## Explicit N/A candidates

These limitations apply to **this pinned fixture/API**, not blanket incompatibility or maintenance judgments. See [research.md](./research.md) for citations and exact installed source locations. Every installed limitation has a runnable `probes/*.ts` program, asserted by `verify.ts` on both runtimes.

| Candidate             | Pinned version                | Why no timings/bundle ranking                                                                                                                                                                                                                 |
| --------------------- | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CAC                   | 7.0.0                         | Native numeric coercion loses leading zeros before public array transforms; `--region 001` becomes `1`, `--tag 002` becomes `["2"]`. `type:[String]` is an array transform, not scalar typing.                                                |
| Citty                 | 0.2.2                         | Repeated tags collapse to the last value and unknown options are accepted; this fixture cannot supply the strict/repeated-option contract through declarations.                                                                               |
| Sade                  | 1.8.1                         | Built-in pre-parse treats `-v` as version before the `config -v` action. A different alias could work; this is not a universal Sade restriction.                                                                                              |
| Gunshi (normal entry) | 0.37.3                        | Built-in global `-v` wins over command-local value. Public `addGlobalOption` throws on duplicate registration and the options getter returns a copy; no supported override was used. Not silently replaced with `gunshi/bone`.                |
| cmd-ts                | 0.15.0                        | In the declarative option fixture, missing/empty option values fall through to defaults or `optional` absent values. Probe compares absent, `--region=`, `--region`, `--value=`, `--value`. No claim about every possible public composition. |
| Full oclif            | 5.0.0 surveyed; not installed | Official bundling limitation/discovery and package metadata requirements conflict with this single-file scope. No parser-only replacement or claims of slow/unsupported parsing.                                                              |

## Checks and known limits

The standalone Oxlint config inherits the repository rules but excludes only dependencies and generated artifacts; the root lint pass still excludes this independently installed benchmark.

`bun run check` is strict TypeScript consumer checking plus the repository's Oxlint/Oxfmt gates (not a competing local formatter). The shared parser-result validation boundary explicitly justifies raw `unknown`/`typeof` checks; adapter consumer types remain checked. External types are pinned for yargs/minimist/yargs-parser; `skipLibCheck` skips dependency declaration internals, **not adapter consumer checking**. `bun test contract.test.ts` checks shared domain and summary math. `bun verify.ts --source-only` is useful while editing adapters. The early conformance runs genuinely failed for CAC's initial array-typing mistake, then native zero loss, and cmd-ts/yargs-parser silent default cases; retained probes and tests guard against hiding those differences.

The full measurement runs after independent review and passing clean-install, typecheck, repository lint/format, unit-test and cross-runtime conformance gates. Warm ordering and standalone report percentile labels were corrected following review. These tiny fixtures exclude help styling, plugins/completion/prompts, real application I/O, install footprint, memory, large trees, and security/maintenance assessments. Choosing a framework from these numbers alone would ignore most of its purpose.
