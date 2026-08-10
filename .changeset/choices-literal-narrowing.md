---
"@crustjs/core": patch
---

Narrow string flag/arg types to the literal union of their `choices`. A definition like `{ type: "string", choices: ["staging", "production"] as const }` now infers `"staging" | "production"` in the action instead of `string`. Raw args (no `type`/`schema`) with literal choices narrow the same way instead of `unknown`. Choices widened to `readonly string[]` still infer `string`.
