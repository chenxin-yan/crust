---
"@crustjs/crust": patch
---

`crust build` now rejects `bin` keys (and the package-name command) that start with `_` or contain `~`, matching the names `completion()` already required. Command names use letters, digits, `.`, `_`, and `-`, starting with a letter or digit. To migrate, rename such commands, for example `"_tool"` to `"tool"` or `"my~cli"` to `"my-cli"`, along with their root `new Crust(name)`.
