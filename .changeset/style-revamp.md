---
"@crustjs/style": minor
---

Breaking: simplify color inputs, styling, and formatting APIs.

- Colors accept only 3-/6-digit hex, `rgb(r, g, b)`/`rgb(r g b)` strings, integer `[r, g, b]` tuples, and the 148 named CSS colors. Other CSS notation, alpha forms, packed numbers, and channel objects throw `TypeError`. `ColorString` provides named-color autocomplete and hex/RGB hints. Literal-checking types `StrictColorString`, `CssColorFunctionString`, `NonStringColorInput`, `ColorInputCandidate`, and `CheckedColorInput` are removed.
- Removed deprecated helpers: `rgb`, `bgRgb`, `hex`, `bgHex`, `rgbCode`, `bgRgbCode`, `hexCode`, `bgHexCode`, and `parseHex`. Use depth-aware `fg`/`bg`; their color-depth argument is also removed, so use `createStyle({ mode, overrides })` for deterministic depth.
- Static `*Code` exports, `applyStyle`, `composeStyles`, `fgCode`, `bgCode`, `linkCode`, `resolveColorDepth`, and `StyleInstance.apply` are removed. Call chainables directly (`bold(text)`), pass them as `StyleFn`, use `chain.open`/`chain.close` for manual composition, and use `link`/`style.colorDepth`. `ChainableStyleFn` and `StyleInput` are now exported.
- `setGlobalColorMode`/`getGlobalColorMode` are removed. The default facade, top-level helpers, and stored sub-chains re-resolve environment/TTY capabilities on each call; `createStyle()` instances stay frozen. `FORCE_COLOR=0`/`false` disables ANSI; `1`/`2`/`3` forces 16/256/truecolor depth and overrides `NO_COLOR` and non-TTY. Other values force color at detected depth. `ColorMode` (`"auto"`, `"always"`, `"never"`) is instance-only.
- `CapabilityOverrides` gains `forceColor`, `colorTerm`, and `term`; omitted properties read their corresponding runtime input, while explicit `undefined` simulates an unset variable. `TrueColorOverrides` is removed. Instance `fg`/`bg` chain pairs use resolved depth (empty at `"none"`); facade chain pairs remain static truecolor bytes.
- Markdown theme exports (`MarkdownTheme`, `PartialMarkdownTheme`, `ThemeSlotFn`, `CreateMarkdownThemeOptions`, `createMarkdownTheme`, `defaultTheme`), list helpers/types (`unorderedList`, `orderedList`, `taskList`, `UnorderedListOptions`, `OrderedListOptions`, `TaskListOptions`, `TaskListItem`), and `wrapText`/`WrapOptions` are removed. `table` remains, but `TableOptions` retains only `align`; `minColumnWidth`, `cellPadding`, `separatorChar`, and `borderChar` are removed.
- `visibleWidth` becomes `stringWidth(text)`, aware of ANSI, CJK, combining marks, and emoji. Padding helpers are unchanged.
