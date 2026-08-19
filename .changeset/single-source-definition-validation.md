---
"@crustjs/core": patch
---

Every definition-shape validation now has exactly one home. Compile-time brands (`FIX_*`) own statically checkable mistakes — variadic placement, defaults outside literal `choices`, spelling/name collisions, reserved `__proto__` spellings, section audience exclusivity, dependency closure. Runtime validates only what types cannot see: argv values, dynamic strings, recipe behavior, and transitive dependencies above an `.of()` cut (lazy `missing-context`). Runtime twins of brand-covered checks are removed; the library assumes TypeScript with type checking as a build gate.
