---
"@crustjs/core": patch
---

Build-tree validation and the runtime parser now share one definition-validation gate (`validateDefinition`) instead of the tree walk fabricating a synthetic argv. Variadic-arg position violations on dynamically installed commands are now always caught — previously the build walk only caught them when a required arg happened to follow the variadic one, and `parseArgs` now fails fast with a `DEFINITION` error instead of silently mis-parsing. The shared gate also validates flag/arg defaults against their `choices` up front, so a default outside its choices is rejected at build validation and on every parse, not just when the default happens to be applied.
