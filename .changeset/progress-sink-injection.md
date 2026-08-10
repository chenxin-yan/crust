---
"@crustjs/progress": minor
"@crustjs/testing": minor
---

`@crustjs/progress` output is now injectable: the `SpinnerSink` contract (`{ isTTY, write, exit }`) is a public export, `spinner()` and `progress()` accept a per-call `sink` option, and `withProgressSink(sink, fn)` makes a sink ambiently available to every indicator in `fn`'s async scope (mirroring `withPromptIO` in `@crustjs/prompts`). Resolution order: per-call `sink` → ambient sink → `process.stderr`. `runInteractive()` in `@crustjs/testing` uses the ambient sink so spinners and progress indicators render onto its fake terminal — `waitFor()` and `screen()` now observe them.
