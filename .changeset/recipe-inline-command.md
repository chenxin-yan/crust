---
"@crustjs/core": patch
---

Allow `.command()` inside `defineCommand` recipes, so subcommands can nest inline. The inline recipe sees the Contexts its parent declared with `.use()` or `.provide()` before the call.
