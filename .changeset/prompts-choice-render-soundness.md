---
"@crustjs/prompts": patch
---

Constrain plain-string `Choice<T>` values to `T & string`, so `select<number>`, `filter<number>`, `multiselect<number>` and `multifilter<number>` (and literal-union `T`) reject strings that could not be a `T` value instead of submitting a string where the caller was promised another type. Object choices, literal-tuple narrowing, widened `string[]` choices, and generic wrappers are unchanged. Callers relying on the previously accepted unsound strings must use `{ label, value }` objects or widen `T`.

`runPrompt()` now catches errors thrown by a deferred re-render and rejects the prompt promise after restoring raw mode, the cursor, and stream reservations, instead of surfacing an uncaught timer exception with the prompt left pending.
