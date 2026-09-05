---
"@crustjs/progress": minor
---

Breaking: imperative progress indicators and injectable output.

- `spinner()` without `task` returns a `SpinnerHandle` with `start()`, `updateMessage()`, and `stop(outcome?, message?)`. `stop("error")` renders the failure line without throwing; stopping before starting still renders a final line. New `progress({ total, message })` returns a `ProgressHandle` with `advance(amount?, message?)`, rendering `(current/total)`. Task-mode spinners still pass `updateMessage` to the callback.
- Interactive indicators restore the cursor on SIGINT and re-raise the signal instead of calling `process.exit(130)`. If the host retains a SIGINT listener, termination is left to it. Pass `sigint: false` to install no handler and perform your own cleanup.
- `spinner`/`progress` accept a per-call `sink`: `ProgressSink` is writable-compatible (`{ write, isTTY?, columns? }`). `withTerminalIO(io, fn)` shares ambient output with prompts; `withProgressSink(sink, fn)` is an output-only alias. Resolution is per-call sink → ambient output → `process.stderr`; non-TTY output receives final lines only.
- Global theme APIs `setTheme`, `getTheme`, and `createTheme` are removed; pass `theme` per call over `defaultTheme`. `SpinnerController` is removed; the task callback takes `Pick<SpinnerHandle, "updateMessage">`.
- New public types: `SpinnerHandle`, `SpinnerHandleOptions`, `SpinnerOutcome`, `SpinnerSigintPolicy`, `ProgressHandle`, `ProgressOptions`, `ProgressSink`, and `TerminalIO`.
