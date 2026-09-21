---
"@crustjs/core": patch
---

Invocations no longer project the resolved command's snapshot a second time; `ctx.command` is now the very subtree object found inside `ctx.rootCommand` (previously a structurally equal but distinct copy), and equals `ctx.rootCommand` for the root command.
