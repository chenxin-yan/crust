---
"@crustjs/core": patch
---

Flag definition rules now live in one runtime rulebook shared by every entry point. `no-`-prefix, parser-type, reserved-`__proto__`, and self-duplicate-spelling checks apply consistently at `.flags()`, `.provide()`, `defineContext`, `defineExtension`, and Extension flag injection — dynamically built definitions that bypass compile-time checks now fail at definition time with a `DEFINITION` error, including flags on subcommands that are never invoked (previously those were only validated when their command was routed, or never). Schema exclusivity is also enforced inside `validateIncomingFlag`, so plain-JS misuse fails at the same gate. A definition that duplicates its own spelling (e.g. `short: "o"` plus `aliases: ["o"]`) now reports `repeats spelling "o"` instead of a degenerate self-collision message.
