---
"@crustjs/core": minor
---

`.flags()` no longer checks at runtime that each flag definition is an object when TypeScript already rejects it, such as a string or an array in place of a definition. A `null` or `undefined` definition, a `null` or `undefined` record, and a record whose prototype is not `Object.prototype` or `null` (such as a `Record`-typed literal written with a `__proto__` key) still throw a `DEFINITION` error with `reason: "invalid-flags"`.
