---
"@crustjs/style": minor
"@crustjs/prompts": patch
"@crustjs/progress": patch
---

Add `createPlainStyle()`: plain style functions (`bold`, `red`, …) with fixed settings. It takes the same options as `createStyle()` and gives the same output, without chaining, `open`/`close`, or `fg`/`bg`, so importing it does not bundle the chain engine. Pass `overrides: { isTTY }` to decide color for a stream other than stdout. Its return type, `PlainStyle`, is exported.

The default themes of `@crustjs/prompts` and `@crustjs/progress` use it to decide color from their own output stream, so apps that use prompts or spinners no longer bundle the chain engine. Output is unchanged.
