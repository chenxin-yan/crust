---
"@crustjs/prompts": minor
"@crustjs/progress": minor
---

Replace global theme state with explicit themed instances (breaking):

- Removed `setTheme` and `getTheme` from both packages. There is no module-global theme anymore.
- New `createPrompts({ theme })` in `@crustjs/prompts` returns all prompt functions bound to a theme, plus the resolved `theme` for custom `runPrompt` renderers.
- `@crustjs/progress` accepts theme overrides directly on each `progress`/`spinner` call.
- `runPrompt`'s `theme` config is now an optional partial merged onto `defaultTheme`.
- Prompt resolution order: `defaultTheme` ← instance theme ← per-call `theme`; progress resolution order: `defaultTheme` ← per-call `theme`.

Migration: `setTheme({...})` → `const p = createPrompts({ theme: {...} })` and call `p.input(...)` etc.; `getTheme()` → `p.theme`.
