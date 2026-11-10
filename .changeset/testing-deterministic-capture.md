---
"@crustjs/testing": patch
"@crustjs/core": patch
"@crustjs/style": patch
"@crustjs/extensions": patch
---

Tests that capture output or drive prompts now behave the same on a developer's terminal and on CI.

- `captureExecute()` and `runInteractive()` return plain `stdout` and `stderr` even when `FORCE_COLOR` is set, as runners such as Jest and `bun test --parallel` do for their workers on a color terminal: they strip ANSI escape sequences, like `@oclif/test` and `@inquirer/testing`. Pass `{ raw: true }` to keep them: `captureExecute(app, argv, { raw: true })`, `runInteractive(app, path, input, { raw: true })`.
- `captureExecute()` and `runInteractive()` resolve flags' `env` fallbacks only from a new `env` option, `{}` by default, so results never depend on the developer's shell: `captureExecute(app, argv, { env: { API_TOKEN: "t" } })`.
- `confirm()` prompts on a terminal injected with `withTerminalIO()`, such as `runInteractive()`'s fake terminal, even when `CI` is set, so interactive confirm tests pass on GitHub Actions. A real terminal under `CI` still fails with `ConfirmationRequiredError`.
- `@crustjs/style` treats `TERM=dumb` as no ANSI support, like Node's `tty` color detection: it now disables modifiers (`bold`, links) too and overrides `COLORTERM=truecolor`. `FORCE_COLOR` still forces escape codes.
- `runInteractive().done` resolves with the command's typed `run()` outcome: `result`, `stdout`, and `stderr` (without prompt frames). It still rejects with a failed outcome's error. `ShapeRunOutcome` is now exported from `@crustjs/core`.

**Behavior change:** `captureExecute()` and `runInteractive()` no longer read flag `env` fallbacks from `process.env` and strip escape codes unless `raw` is set.
