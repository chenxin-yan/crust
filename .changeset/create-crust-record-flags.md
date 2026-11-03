---
"create-crust": patch
---

The scaffolded `src/cli.ts` declares its `--greet` flag with the record form of `.flags()`: `.flags({ greet: { type: "string", … } })`.
