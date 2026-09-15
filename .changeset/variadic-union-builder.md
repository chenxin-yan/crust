---
"@crustjs/core": patch
---

Prevent variadic calls on conditional builder unions from silently losing input validation and inferred value types. `.provide()`, `.use()`, and `.add()` reject failed input inference, while allowing explicit input tuples that pass validation. `.flags()`, `.args()`, and `.extend()` reject incompatible union signatures.

Use lightweight input defaults for Context and command registrations to avoid repeated whole-builder type instantiations on large command trees. Unconditional chains, identical-branch unions, and non-variadic methods are unchanged; no runtime change.
