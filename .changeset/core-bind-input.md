---
"@crustjs/core": minor
---

Extensions can bind structured input from `setup` or `preRun` with `ctx.bindInput({ args, flags, raw })`, for example a JSON object read from a flag. Arguments, flags, and passthrough tokens given explicitly on argv win, even when equal to the default; every other supplied key replaces the environment value or default, converted exactly as typed `run()` input. Under `run()`, supplied keys replace the typed input. The last call wins, and `ctx.args`, `ctx.flags`, `ctx.rawArgs`, validation, and the Command Action use the bound values. Binding in `setup` lets every `preRun` check see them whatever the `.extend()` order; a bound flag never selects a flag handler.
