---
"@crustjs/prompts": minor
---

Rework `@crustjs/prompts` around themed instances, injectable IO, and typed results (breaking).

- Global theme state is removed: `setTheme`, `getTheme`, and `createTheme` are gone. `createPrompts({ theme })` returns all prompt functions bound to a theme plus the resolved `theme` for custom `runPrompt` renderers; `runPrompt`'s `theme` config is an optional partial merged onto `defaultTheme`. Resolution order: `defaultTheme` ← instance theme ← per-call `theme`. Migrate `setTheme({...})` → `const p = createPrompts({ theme: {...} })`.
- Prompt cancellation (Ctrl+C) rejects with a standard `DOMException` named `"AbortError"` instead of the removed `CancelledError` class; check `err.name === "AbortError"`.
- Prompt IO is injectable through optional `io` parameters and `withPromptIO()`. The new `@crustjs/prompts/testing` subpath ships fake-TTY helpers, whose `keys()` autocompletes named key names (`Key` and `NamedKey` types are exported).
- `select`, `multiselect`, `filter`, and `multifilter` narrow their result type to the union of literal choice values (`choices: ["dev", "prod"]` → `"dev" | "prod"`), for both plain string and `{ label, value }` object choices; widened `string[]` choices infer `string`. The `ChoiceValue` helper type is exported.
- `input()` and `password()` take Standard Schemas through the dedicated `schema` option; `validate` is function-only, follows the `void` return contract, and cannot be combined with `schema` (encoded in the option types).
- The deprecated spinner exports are removed; import spinner APIs from `@crustjs/progress`.
