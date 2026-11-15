---
"@crustjs/testing": patch
"@crustjs/core": patch
"@crustjs/extensions": patch
---

`captureExecute()` and `runInteractive()` return plain text on a developer's terminal and on CI alike, and `runInteractive()` can answer `confirm()` under `CI`.

- `captureExecute()` and `runInteractive()` return plain `stdout` and `stderr` even when the test runner's stdout is a terminal or `FORCE_COLOR` is set, as runners such as Jest and `bun test --parallel` do for their workers on a color terminal: they strip ANSI escape sequences, like `@oclif/test` and `@inquirer/testing`. Pass `{ raw: true }` to keep them: `captureExecute(app, argv, { raw: true })`, `runInteractive(app, path, input, { raw: true })`.
- `captureExecute()` and `runInteractive()` take an `env` option that replaces `process.env` for flags' `env` fallbacks, so a result need not depend on the developer's shell: `captureExecute(app, argv, { env: { API_TOKEN: "t" } })`, or `{ env: {} }` for none.
- `confirm()` prompts on a terminal injected with `withTerminalIO()`, such as `runInteractive()`'s fake terminal, even when `CI` is set, so interactive confirm tests pass on GitHub Actions. A real terminal under `CI` still fails with `ConfirmationRequiredError`.
- `runInteractive().done` resolves with the command's typed `run()` outcome: `result`, `stdout`, and `stderr` (without prompt frames). It still rejects with a failed outcome's error. `ShapeRunOutcome` is now exported from `@crustjs/core`.

**Behavior change:** `captureExecute()` and `runInteractive()` strip escape codes unless `raw` is set.
