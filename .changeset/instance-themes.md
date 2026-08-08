---
"@crustjs/prompts": minor
"@crustjs/progress": minor
---

Replace global theme state with explicit themed instances (breaking):

- Removed `setTheme` from both packages and `getTheme` from `@crustjs/prompts`. There is no module-global theme anymore.
- New `createPrompts({ theme })` in `@crustjs/prompts` returns all prompt functions bound to a theme, plus the resolved `theme` for custom `runPrompt` renderers.
- New `createProgress({ theme })` in `@crustjs/progress` returns themed `progress`/`spinner`.
- `runPrompt`'s `theme` config is now an optional partial merged onto `defaultTheme`.
- Resolution order everywhere: `defaultTheme` ← instance theme ← per-call `theme` option.

Migration: `setTheme({...})` → `const p = createPrompts({ theme: {...} })` and call `p.input(...)` etc.; `getTheme()` → `p.theme`.
