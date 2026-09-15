---
"@crustjs/core": patch
---

Calling a variadic builder method (`.provide()`, `.flags()`, `.args()`, `.use()`, `.add()`, `.extend()`) on a conditional builder union such as `(cond ? c.provide(db()) : c)` is now a compile error (TS2349) instead of silently erasing the call's type inference. Previously the combined union signature dropped both the duplicate-Context brand and the provided values' typing in `.action()`. Unconditional chains, identical-branch unions, and non-variadic methods on a union are unchanged; no runtime change.
