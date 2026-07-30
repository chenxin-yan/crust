---
"@crustjs/core": minor
"create-crust": minor
"@crustjs/create": minor
"@crustjs/crust": minor
"@crustjs/extensions": minor
"@crustjs/man": minor
"@crustjs/progress": minor
"@crustjs/prompts": minor
"@crustjs/skills": minor
"@crustjs/store": minor
"@crustjs/style": minor
"@crustjs/utils": minor
---

Require Bun 1.3.14 or newer across all published packages and remove the obsolete sync-disposal workaround now that `AsyncDisposableStack.use()` supports `Symbol.dispose`.
