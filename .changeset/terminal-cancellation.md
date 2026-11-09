---
"@crustjs/utils": patch
"@crustjs/core": patch
"@crustjs/prompts": patch
"@crustjs/progress": patch
"@crustjs/create": patch
"@crustjs/extensions": patch
---

Prompts, spinners, progress indicators, and `runSteps()` now honor cancellation, and spinner frames no longer stick to log lines.

- Inside a Crust command they follow the invocation's `signal` without passing it. `TerminalIO` (and `withTerminalIO()`) gains a `signal`, so `input({ message }, { signal })` also works. Spinners and progress indicators take a `signal` option, and so does `runSteps()`.
- **Behavior change:** a `SIGTERM`, a Ctrl-C delivered as a signal, or an aborted `execute({ signal })` cancels a waiting prompt. The prompt shows the cursor again, turns raw mode off, and rejects with `signal.reason`. It no longer hangs, and the terminal is no longer left raw with the cursor hidden.
- **Behavior change:** Ctrl+C in a prompt inside a Crust command now also sends `SIGINT` to the process, so the run cancels and the process ends by `SIGINT` like a Ctrl-C anywhere else; shell loops stop. The prompt rejects with the invocation's abort reason. A prompt outside a Crust command (no `SIGINT` listener) still only rejects with its own `AbortError`.
- **Behavior change:** `runSteps()` sends `SIGTERM` to the running step's child on abort, and on macOS and Linux to its descendants, such as a `command` step's shell workers. Once they exit, it rejects with `signal.reason` and skips the remaining steps. Any still running 5 seconds later get `SIGKILL`, so a step that ignores `SIGTERM` cannot hang the command. On Windows the child's whole process tree ends at once. Ctrl-C and `SIGTERM` no longer finish the step and exit `0`, and no longer print `exited with code null`.
- **Behavior change:** inside a Crust command, a spinner or progress indicator's default `sigint: "exit"` handler leaves Ctrl-C to Crust. When the signal aborts, the indicator stops with `✗` and its current message, unless your own `stop()` in the same turn renders its final line, such as `bar.stop("error", "Cancelled")` in a `finally`. The frame no longer freezes, and your final line is no longer dropped. Under any other `SIGINT` listener the indicator stops the same way a turn after the signal and leaves ending the process to that listener. A `SIGINT` the process inherited as ignored stays ignored.
- An action's default `stdout()`/`stderr()` line now erases a live spinner or progress frame first and redraws it below the line. Lines like `⠙ Running build (0/5)pkg-a: built` no longer appear.
- `updateNotifier()` stops its registry check as soon as Ctrl-C or `SIGTERM` cancels the run, instead of waiting up to `timeoutMs`.
