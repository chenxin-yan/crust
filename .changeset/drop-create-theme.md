---
"@crustjs/prompts": minor
"@crustjs/progress": minor
---

Remove `createTheme` from `@crustjs/prompts` and `@crustjs/progress`. It was a redundant wrapper: `setTheme` and per-call `theme` options already accept partial overrides and merge onto `defaultTheme` themselves. Replace `setTheme(createTheme({...}))` with `setTheme({...})`. To read the fully resolved theme (e.g. for custom `runPrompt` renderers), use `getTheme()` in `@crustjs/prompts`.
