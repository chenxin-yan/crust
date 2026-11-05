---
"@crustjs/progress": minor
---

Breaking: `ProgressSink` is renamed to `TerminalOutput`, the same type `@crustjs/prompts` exports, and the `withProgressSink(sink, fn)` alias is removed; use `withTerminalIO({ output: sink }, fn)`.
