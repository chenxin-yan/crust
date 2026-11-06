---
"@crustjs/core": minor
---

`execute()` now writes its default output synchronously to file descriptors 1 and 2 instead of through `process.stdout` and `process.stderr`, so CLIs start faster. Large output piped to another program is no longer cut off when an action calls `process.exit()` right after writing it, and a `console.log` after a large write no longer lands in the middle of it on Bun. Windows keeps writing through `process.stdout` and `process.stderr`.

**Behavior change:** output written with `process.stdout.write`, or with `console.log` on Node, is buffered separately from Crust's output. Once a pipe is full, a later `stdout()` line can land inside it, so write through `stdout()` when output must stay in order. Replacing `process.stdout.write` or `process.stderr.write` no longer captures Crust's output on macOS and Linux. Pass `execute({ io })` or use `captureExecute()` from `@crustjs/testing` instead.
