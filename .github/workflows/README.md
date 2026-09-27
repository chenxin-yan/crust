# CI ownership

[CI Packages](ci-packages.yml) answers three different questions. Release calls the same workflow, so CLI distribution checks are not a PR-only gate.

| Job family                                           | Question                                                 | Ownership                                                                                                                                                                   |
| ---------------------------------------------------- | -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Code checks (Linux)                                  | Does the implementation behave correctly?                | Type checks, package lint/format, library/tooling behavior, and Crust's `src/` tests. Excludes the build/distribution integrations and compiled marker/path fixtures below. |
| Library runtime checks (Node/Bun/Deno, all on Linux) | Do the built libraries work on supported runtime floors? | `scripts/smoke-runtimes/smoke.mjs` under the exact Node/Bun/Deno versions selected in the workflow. Not application packaging.                                              |
| CLI distribution checks (Linux/macOS/Windows)        | Can users install and run what we build?                 | All six runtime × artifact modes, including direct binary execution, npm launchers, bundled dependencies, assets and source-independent execution.                          |

This is **seven runner instances**, not a separate job per runtime/artifact/installer combination. All jobs may build dependencies as preparation; that does not give them ownership of CLI distribution checks.

## CLI distribution checks

- **Every OS:** Node/Bun/Deno runtime packages and Node/Bun/Deno binaries. Node's extra compiler requirement is setup within this job, not a separate testing responsibility. The normal test host stays on the shared toolchain; `CRUST_TEST_SEA_NODE` selects the executable compiler.
- **Linux:** runs all of `packages/crust/tests/`, including the host acceptance cases, build hooks, staging/cross-target/error cases and library packaging. Also runs core's compiled build-marker fixtures and utils' runtime artifact-path fixture, excluded from Code checks.
- **macOS/Windows:** repeat the portable shipping cases, not the Linux-owned hardcoded cross-target suite. Windows retains its native shell for executable builds.
- **Installer coverage on Linux:** npm, pnpm and Bun each exercise application installation and optional Node compiler-backend delivery. These opt-in suites run in the installer step, not twice in the default integration pass.
- **Opt-in limits:** the existing OpenTUI smoke remains opt-in and is not enabled by this workflow.

Keep deterministic build planning/metadata tests in `packages/crust/src/`; keep compiler/pack/install/execute integration tests in `packages/crust/tests/`. New compiled fixtures in other packages need an explicit owner: select them in CLI distribution checks and exclude them from Code checks. Ordinary local `pnpm run test` still runs all default suites; the CI split does not change local defaults.

## Other workflows

- [CI Create Crust](ci-create-crust.yml): the scaffold-to-working-project journey on three OSes, plus actual installed-tool delivery on Linux. This is distinct from testing generated application artifacts.
- [CI Docs](ci-docs.yml): docs types, lint, formatting, tests and site build.
- [CI Tooling](ci-tooling.yml): repository/tooling lint and formatting outside packages/apps.
- [Package Size](package-size.yml) and [Type Performance](type-perf.yml): compare the PR with its base and report changes.
- [Changeset Status](changeset-status.yml): release metadata reporting, not executable correctness.

Workflow path filters decide when these run. No Homebrew formula, Scoop manifest or public registry publication is exercised by the artifact tests; direct executable and adjacent-asset behavior is covered, while channel-specific packaging remains author-owned.
