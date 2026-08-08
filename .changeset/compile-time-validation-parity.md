---
"@crustjs/core": minor
---

Move more definition-time validation to the type level. Code that previously compiled and failed at runtime now fails typecheck:

- Flag spelling collisions across `.flags()` calls and with Context-owned flags (both `.flags()` after `.provide()` and `.provide()` after `.flags()`)
- Duplicate positional argument names within and across `.args()` calls
- Custom `parse` functions returning a Promise (parse is consumed synchronously; do async work in `run()`)

Runtime twins remain for plain-JS consumers. Collisions between instances in the same `.provide()` call and with ancestor-owned flags in child commands are still runtime-checked.
