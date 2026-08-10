---
"@crustjs/core": patch
---

Flag definition rules now live in one runtime rulebook shared by every entry point. `no-`-prefix, parser-type, reserved-`__proto__`, and self-duplicate-spelling checks apply consistently at `.flags()`, `.provide()`, `defineContext`, `defineExtension`, and Extension flag injection instead of surfacing only at first parse — dynamically built definitions that bypass compile-time checks now fail at definition time with a `DEFINITION` error. Schema exclusivity is also enforced inside `validateIncomingFlag`, so plain-JS misuse fails at the same gate.
