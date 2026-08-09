---
"@crustjs/core": minor
---

Move more definition-time validation to the type level. Code that previously compiled and failed at runtime now fails typecheck:

- Flag spelling collisions within and across `.flags()` calls (including duplicate canonical names and a short alias equal to its own flag name) and with Context-owned flags (both `.flags()` after `.provide()` and `.provide()` after `.flags()`)
- Duplicate positional argument names within and across `.args()` calls
- Custom `parse` functions returning a Promise (parse is consumed synchronously; do async work in `run()`)
- Invalid command aliases (empty, whitespace, leading dash, or equal to the canonical name)
- Sibling command name and alias collisions within and across `.add()` calls
- Context dependency cycles within and across `.provide()` calls

Migration note: generic wrapper functions that keep a builder's flag parameter bounded (e.g. `<E extends FlagsDef>(app: Crust<Local, Owned, A, E, Ctx>)`) no longer typecheck further `.flags()` calls because the collision check stays deferred — type wrapper parameters as `Crust<any, any, any, any, any>` instead; runtime validation still applies. Spellings typed as unions of literals (e.g. `short: cond ? "a" : "b"`) are conservatively rejected when any member collides; widen to `string` to defer the check to runtime.

Runtime twins remain for plain-JS consumers. Collisions between instances in the same `.provide()` call and with ancestor-owned flags in child commands, plus cycles through inherited parent Contexts, are still runtime-checked.
