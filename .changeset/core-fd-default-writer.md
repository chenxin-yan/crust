---
"@crustjs/core": minor
---

`execute()` now writes its default output synchronously to file descriptors 1 and 2 instead of through `process.stdout` and `process.stderr`, so CLIs start faster. Large output piped to another program is no longer cut off when an action calls `process.exit()` right after writing it, and a `console.log` after a large write no longer lands in the middle of it on Bun. Windows keeps writing through `process.stdout` and `process.stderr`.

**Behavior change:** replacing `process.stdout.write` or `process.stderr.write` no longer captures Crust's output on macOS and Linux. Pass `execute({ io })` or use `captureExecute()` from `@crustjs/testing` instead. Print from actions with `stdout()` and `stderr()` rather than `console.log`: only output that goes through them is captured by `run()`, tests and MCP, and kept in order with Crust's own output.
