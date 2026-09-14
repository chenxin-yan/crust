---
"@crustjs/core": patch
"@crustjs/crust": patch
"@crustjs/create": patch
"create-crust": patch
"@crustjs/extensions": patch
"@crustjs/man": patch
"@crustjs/progress": patch
"@crustjs/prompts": patch
"@crustjs/skills": patch
"@crustjs/store": patch
"@crustjs/style": patch
"@crustjs/testing": patch
"@crustjs/tui": patch
---

Raise the supported Bun floor to 1.4.0.

Every package now declares `engines.bun` as `>=1.4.0`, and Bun 1.3 is no longer tested. Bun 1.4 ships a single x64 binary, which is what lets `crust build` use the canonical `bun-linux-x64` and `bun-windows-x64` target names.
