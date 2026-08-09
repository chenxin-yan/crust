---
"@crustjs/core": patch
---

Command-tree building and parsing now share one definition-validation gate: invalid variadic-arg placement and flag/arg defaults outside their `choices` are always rejected with `DEFINITION` errors, both at build validation and on every parse.
