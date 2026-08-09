---
"@crustjs/core": patch
---

Build-tree validation and the runtime parser now share one definition-validation gate (`validateDefinition`) instead of the tree walk fabricating a synthetic argv. Variadic-arg position violations on dynamically installed commands are now always caught — previously the build walk only caught them when a required arg happened to follow the variadic one, and `parseArgs` now fails fast with a `DEFINITION` error instead of silently mis-parsing.
