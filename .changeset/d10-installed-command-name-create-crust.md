---
"create-crust": patch
---

Reject project names that start with `_` or contain `~`, since the name becomes the installed command and `crust build` and `completion()` reject them. Project names use letters, digits, `.`, `_`, and `-`, starting with a letter or digit. To migrate, choose a directory name such as `tool` instead of `_tool`, or `my-cli` instead of `my~cli`.
