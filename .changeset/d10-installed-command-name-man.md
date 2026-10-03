---
"@crustjs/man": patch
---

`man()` now validates the root command name with the same installed command name rule as `crust build` (letters, digits, `.`, `_`, and `-`, starting with a letter or digit), instead of only rejecting path separators.
