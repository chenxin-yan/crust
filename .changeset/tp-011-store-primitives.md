---
"@crustjs/store": patch
---

Internal refactor: `ValueType` and `ResolvePrimitive` now sourced from `@crustjs/utils`. `ValueType` is re-exported transparently — no consumer-visible change. `coerceByType` rewraps the new shared `tryCoerceNumber` helper and continues to silently return the original string on NaN.
