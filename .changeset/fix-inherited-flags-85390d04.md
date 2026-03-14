---
"@crustjs/core": patch
"@crustjs/plugins": patch
---

Fix inherited flags not being applied to subcommand trees injected by plugins. The help flag (`-h`) now correctly inherits into plugin-added subcommands.
