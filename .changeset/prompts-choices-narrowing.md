---
"@crustjs/prompts": minor
---

`select`, `multiselect`, `filter`, and `multifilter` now narrow their result type to the union of the literal choice values (`choices: ["dev", "prod"]` → `"dev" | "prod"`), for both plain string and `{ label, value }` object choices. Added via new overloads: literal non-empty tuples narrow, widened `string[]` choices now infer `string` (previously `unknown`), and explicit-type-arg calls (`select<number>(…)`) and generic wrappers over the options types keep their previous contract. The new `ChoiceValue` helper type is exported.
