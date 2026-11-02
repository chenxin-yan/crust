---
"@crustjs/extensions": minor
---

Importing an Extension now loads only its registration; renderers, completion scripts, update checks, and typo suggestions load the first time they run, so a CLI that never prints help or completion never pays for `@crustjs/style` or the shell templates at startup.

**Breaking:** `renderHelp`, `renderBashCompletion`, `renderZshCompletion`, and `renderFishCompletion` now return `Promise<string>`.

```diff
- const text = renderHelp(await app.snapshot());
+ const text = await renderHelp(await app.snapshot());
```
