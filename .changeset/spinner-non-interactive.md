---
"@crustjs/prompts": patch
---

Support non-interactive environments in `spinner`. When stderr is not a TTY (CI, piped output), the spinner skips all animation and ANSI escape codes — only the final success (`✓`) or error (`✗`) line is printed. `updateMessage()` calls silently update the message used in the final line.
