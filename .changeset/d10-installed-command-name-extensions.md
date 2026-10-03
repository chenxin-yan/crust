---
"@crustjs/extensions": patch
---

`completion()` now validates the root command name with the installed command name rule shared with `crust build`, and its error states that rule (letters, digits, `.`, `_`, and `-`, starting with a letter or digit). Accepted names are unchanged.
