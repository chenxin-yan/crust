---
"@crustjs/utils": patch
"@crustjs/core": patch
"@crustjs/prompts": patch
"@crustjs/progress": patch
"@crustjs/create": patch
---

Prompts, spinners, progress indicators, and `runSteps()` now honor cancellation, and spinner frames no longer stick to log lines.

- Inside a Crust command they follow the invocation's `signal` without passing it. `TerminalIO` (and `withTerminalIO()`) gains a `signal`, so `input({ message }, { signal })` also works. Spinners and progress indicators take a `signal` option, and so does `runSteps()`.
- **Behavior change:** a `SIGTERM`, a Ctrl-C delivered as a signal, or an aborted `execute({ signal })` cancels a waiting prompt. The prompt shows the cursor again, turns raw mode off, and rejects with `signal.reason`. It no longer hangs, and the terminal is no longer left raw with the cursor hidden.
- **Behavior change:** `runSteps()` sends `SIGTERM` to the running step's child on abort. Once the child exits, it rejects with `signal.reason` and skips the remaining steps. Ctrl-C and `SIGTERM` no longer finish the step and exit `0`, and no longer print `exited with code null`.
- **Behavior change:** inside a Crust command, a spinner or progress indicator's default `sigint: "exit"` handler leaves Ctrl-C to Crust. When the signal aborts, the indicator stops with `✗` and its current message, unless your own `stop()` in the same turn renders its final line, such as `bar.stop("error", "Cancelled")` in a `finally`. The frame no longer freezes, and your final line is no longer dropped. A `SIGINT` the process inherited as ignored stays ignored.
- An action's default `stdout()`/`stderr()` line now erases a live spinner or progress frame first and redraws it below the line. Lines like `⠙ Running build (0/5)pkg-a: built` no longer appear.
