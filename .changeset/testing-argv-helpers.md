---
"@crustjs/testing": minor
"@crustjs/core": minor
"@crustjs/prompts": minor
---

`captureExecute()` and `runInteractive()` both take argv, run it through `execute()`, and resolve to `{ stdout, stderr, exitCode }`. Their `env` option replaces the whole process environment for the run. See [Testing](https://crustjs.com/docs/guide/testing). **Breaking:** `runInteractive(app, argv, options)` replaces `runInteractive(app, path, input, options)`, captured text keeps its final newline, `env` replaces `process.env` instead of feeding flags' `env` fallbacks, and core's `run()` and `execute()` no longer take an `env` option.

- `runInteractive(app, argv, options)` runs argv on a fake terminal, as a user types it. `done` resolves to `{ stdout, stderr, exitCode }` and never rejects: a failure is its rendered error and exit code. For a typed result, call `app.run(path, input)`.
- The handle gains `resize(columns, rows)`, which resizes the terminal and emits `resize`, and `cancel()`, which cancels the run as Ctrl-C does (exit code 130). `keys()` takes named keys and `ctrl+<letter>` only, so `keys("entr")` is a compile error instead of a run-time throw.
- Captured `stdout` and `stderr` are exactly what was written: `stdout("a")` captures `"a\n"`.
- `env` replaces `process.env` for the run and restores it afterwards, so settings, config and state directories, app code reading `process.env`, and child processes are isolated too. `{}` is an empty environment, `{ ...process.env, NAME: "value" }` changes one variable, and an `undefined` value is left out. The new `cwd` option sets the working directory the same way. A second run that replaces either while one is active throws.
- `withEnv(env, fn)` runs `fn` with the environment replaced and keeps its result's type, for typed `app.run()` tests: `await withEnv({}, () => app.run(["deploy"], input))`.
- Core: the `env` option of `run()` and `execute()` is removed. Flags' `env` fallbacks read `process.env`; isolate a test with `withEnv()` or the helpers' `env` option.
- `@crustjs/prompts/testing`: `createPromptIO()` gains `resize(columns, rows)`, and its output reports `rows` (24 at first).
