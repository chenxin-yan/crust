---
"@crustjs/core": patch
"@crustjs/create": patch
"@crustjs/extensions": patch
"@crustjs/man": patch
"@crustjs/progress": patch
"@crustjs/prompts": patch
"@crustjs/skills": patch
"@crustjs/store": patch
"@crustjs/style": patch
"@crustjs/testing": patch
---

Declare `"sideEffects": false` in all published library packages so bundlers can tree-shake unused modules out of consumer bundles. All modules were verified free of import-time side effects.
