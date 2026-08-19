---
"@crustjs/core": patch
---

Flag definition rules are enforced once through TypeScript `FIX_*` brands and discriminated definition types across `.flags()`, `.provide()`, `defineContext`, and `defineExtension`. The checks cover `no-` prefixes, reserved `__proto__` spellings, alias collisions, parser synchronicity, and schema exclusivity. Runtime argv validation remains separate; dynamic Extension injection retains only the `__proto__` guard needed to prevent prototype mutation.
