---
"@crustjs/prompts": minor
"@crustjs/progress": minor
---

Remove `createTheme` from `@crustjs/prompts` and `@crustjs/progress`. It was a redundant wrapper: partial theme overrides already merge onto `defaultTheme` themselves. Replace `createTheme({...})` with a plain partial theme passed to `createPrompts({ theme: {...} })` / `createProgress({ theme: {...} })` or a per-call `theme` option. To read the fully resolved theme (e.g. for custom `runPrompt` renderers), use the `theme` property on a `createPrompts` instance.
