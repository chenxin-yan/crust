---
"@crustjs/style": minor
---

Trim the public API surface ahead of 1.0 — one mode-aware door per capability, no speculative contracts:

- Markdown theme system removed: `MarkdownTheme`, `PartialMarkdownTheme`, `ThemeSlotFn`, `createMarkdownTheme`, `defaultTheme`, `CreateMarkdownThemeOptions`. It was a contract for a renderer that doesn't exist yet; it will ship with that renderer.
- List block helpers removed: `unorderedList`, `orderedList`, `taskList` and their option types. `table` stays.
- Mode-unaware pair-level escape hatches removed: `applyStyle`, `composeStyles`, `fgCode`, `bgCode`, `linkCode`, `resolveColorDepth`. Use the mode-aware equivalents: call the chainable directly (`bold(text)`) or use its `open`/`close` for manual hot-path composition, plus `fg`/`bg`, `link`, and `style.colorDepth`.
- Strict inline color-literal type machinery removed: `CheckedColorInput`, `StrictColorString`, `CssColorFunctionString`, `ColorInputCandidate`, `NonStringColorInput`. `fg`/`bg` accept plain `ColorInput`; `ColorString` autocomplete is unchanged and invalid colors still throw `TypeError` at call time.
- `StyleInstance.apply` removed. To pass a style as a value, pass the chainable itself (it is already a `StyleFn`) — this also keeps per-step `NO_COLOR` degradation, which `apply` could not provide for compound pairs. Chainables keep `open`/`close` for manual hot-path composition.
- `visibleWidth` removed — use Bun's built-in `Bun.stringWidth(text)`, which is ANSI-aware and CJK-aware by default. `padStart`/`padEnd`/`center` are unchanged.
- `wrapText` and `WrapOptions` removed — no consumer materialized; will return with the first real one (e.g. a help formatter).
