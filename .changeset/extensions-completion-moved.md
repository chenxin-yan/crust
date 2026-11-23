---
"@crustjs/extensions": minor
---

**Breaking:** `completion()`, `renderBashCompletion()`, `renderZshCompletion()`, and `renderFishCompletion()` move to the new package `@crustjs/completion`, which owns completion's `complete` definition key. Install it and replace `import { completion } from "@crustjs/extensions"` with `import { completion } from "@crustjs/completion"`. See [Completion](https://crustjs.com/docs/modules/completion).
