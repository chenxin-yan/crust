---
"@crustjs/extensions": patch
---

`schema [path...] --json` prints its JSON line once, on stdout. It also wrote the same line to stderr, because `json()` moves the text a command without `.output()` prints to stderr; the command now declares an `.output()`, as `help` and `completion` do.
