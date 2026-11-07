---
"@crustjs/extensions": minor
---

`schema()` describes Standard Schema–backed args and flags in `input` by their schema's input JSON Schema when `run()` accepts that shape (for example `z.enum()` keeps its `enum`), and by their token type otherwise, through the updated `commandInputSchema()`.
