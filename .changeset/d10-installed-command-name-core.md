---
"@crustjs/core": patch
---

Add `isInstalledCommandName()` and `INSTALLED_COMMAND_NAME_RULE` to `@crustjs/core/tooling`: the one rule for installed command names (letters, digits, `.`, `_`, and `-`, starting with a letter or digit) shared by `crust build`, `create-crust`, and `completion()`.
