---
"@crustjs/prompts": patch
---

`select`, `multiselect`, `filter`, and `multifilter` now narrow their result type to the union of the literal choice values (`choices: ["dev", "prod"]` → `"dev" | "prod"`), for both plain string and `{ label, value }` object choices. Added via a new overload, so explicit-type-arg calls (`select<number>(…)`) and widened `string[]` choices keep their previous types. The new `ChoiceValue` helper type is exported.
