---
"@crustjs/style": patch
---

Remove `stripAnsi` export from `@crustjs/style`. Users should use Bun's built-in `Bun.stripANSI()` function instead for stripping ANSI escape sequences from strings.
