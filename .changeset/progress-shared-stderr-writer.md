---
"@crustjs/progress": minor
"@crustjs/utils": patch
"@crustjs/style": patch
---

Spinners and progress indicators without a `sink` or ambient terminal output now write standard error through the same writer as `@crustjs/core`'s default `stderr`, so inside a Command Action they stay in order with the action's `stderr()` lines and restore the cursor even when the process exits right away. Their default colors now follow only their own output, so creating a spinner no longer touches `process.stdout`, and `@crustjs/style` no longer reads `process.stdout` when `overrides.isTTY` is given.

**Behavior change:** on macOS and Linux the default output is written synchronously to file descriptor 2, so replacing `process.stderr.write` no longer captures it. Pass a `sink` or use `withTerminalIO()` to capture spinner output.
