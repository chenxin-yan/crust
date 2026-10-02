---
"@crustjs/testing": patch
---

Require a caret-compatible `@crustjs/prompts` peer (`^0.2.5` instead of `0.x`), so installs no longer accept prompts releases older than 0.2.0 that lack the `withTerminalIO` and `@crustjs/prompts/testing` APIs `@crustjs/testing/interactive` imports.
