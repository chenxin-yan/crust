---
"@crustjs/core": patch
---

Internal refactor: `ValueType` and `ResolvePrimitive` now sourced from `@crustjs/utils`. `ValueType` is re-exported transparently — no consumer-visible change. `coerceValue` rewraps the new shared `tryCoerceNumber` helper and continues to throw `CrustError("PARSE")` on NaN.
