---
"@crustjs/prompts": minor
---

Breaking: themed prompt instances, injectable terminal IO, and typed choice results.

- `setTheme`, `getTheme`, and `createTheme` are removed. Migrate global themes to `const p = createPrompts({ theme })`; `p` exposes every prompt plus its resolved `theme` for custom renderers. Theme resolution is `defaultTheme` ← instance ← per-call; `runPrompt` accepts an optional partial theme. `CreatePromptsOptions` and `PromptsInstance` are exported.
- Ctrl+C rejects with a `DOMException` named `"AbortError"` instead of `CancelledError`; check `err.name === "AbortError"`.
- Prompts and `runPrompt` accept optional `PromptIO` (`{ input?, output? }`). `withTerminalIO(io, fn)` shares streams with prompts and `@crustjs/progress` in an async scope; `withPromptIO` is an alias. Resolution is explicit IO → ambient scope → `process.stdin`/`process.stderr`. `resolvePromptIO(io?)` exposes the resolved streams; `isTTY(input?)`/`assertTTY(input?)` default to the resolved input. `PromptIO`, `PromptInput`, and `PromptOutput` are exported.
- New `@crustjs/prompts/testing` provides `renderPrompt`, `createPromptIO`, and `encodeKey` for fake-terminal tests with `type()`, `keys()`, `screen()`, and `answer`. Exported types include `Key`, `NamedKey`, `PromptTestIO`, and `RenderedPrompt`; named keys autocomplete, while control keys and single characters remain accepted.
- `select`, `multiselect`, `filter`, and `multifilter` infer literal choice-value unions for strings and `{ label, value }` choices; widened arrays retain their wider type. `ChoiceValue` is exported.
- `input`/`password` accept Standard Schema through `schema`; migrate `validate: schema` to `schema`. `validate` is function-only and cannot combine with `schema` (checked statically and at runtime). Non-`undefined` validator returns are now ignored rather than raising `TypeError`; throw an error to reject input.
- Deprecated spinner re-exports and the `@crustjs/progress` dependency are removed; import spinner APIs directly from `@crustjs/progress`.
- Custom renderers gain `renderTextWithCursor`, `highlightMatches`, `renderChoiceList`, and glyph exports `PREFIX_SYMBOL`, `PREFIX_SUBMITTED`, `CURSOR_INDICATOR`, `SCROLL_INDICATOR`, `CHECKBOX_CHECKED`, and `CHECKBOX_UNCHECKED`. `formatPromptLine`/`formatSubmitted` remain available. `normalizeChoices`, `NormalizedChoice`, `calculateScrollOffset`, and `CURSOR_CHAR` are removed from the root exports.
- `multiselect` starts on the first default choice, matching `multifilter`. `multifilter` toggles the highlighted item when duplicates share label and value, and preserves its initial cursor when the first default value is `undefined`.
