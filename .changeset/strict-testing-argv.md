---
"@crustjs/core": patch
"@crustjs/testing": minor
---

Preserve command aliases in argv hints when aliased and alias-free definitions are added in one batch. Testing helpers now reject statically unknown command and flag literals while keeping positionals, values, widened argv arrays, and structural applications flexible.
