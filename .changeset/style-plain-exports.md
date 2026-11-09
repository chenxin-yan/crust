---
"@crustjs/style": minor
---

**Breaking:** bare color and modifier exports (`bold`, `red`, `bgYellow`, …) are now plain functions. `bold.red` on a bare export no longer chains; use `style.bold.red`, or nest calls (`bold(red(text))`). Bare exports also no longer carry `open`/`close`; read them from `style.bold`. Calling a bare export, directly or as a tagged template, works as before and follows the same `NO_COLOR`, `FORCE_COLOR`, and TTY rules. Their new `PlainStyleFn` type is exported.

Importing a bare export no longer bundles the chain engine, color parsing, or CSS color names, so apps that use `help()` ship smaller bundles. Chaining on `style` and `createStyle()` instances is unchanged.
