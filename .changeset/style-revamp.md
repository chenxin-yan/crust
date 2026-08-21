---
"@crustjs/style": minor
---

Trim `@crustjs/style` to one mode-aware door per capability ahead of 1.0 (breaking).

- Color input is narrowed to three- and six-digit hex, integer RGB triples (`rgb(r, g, b)` strings or `[r, g, b]` arrays), and the 148 named CSS colors. Other CSS notation (hsl, lab, color-mix, …), alpha forms, packed numbers, and channel objects are no longer accepted; invalid colors throw `TypeError` at call time. `ColorString` autocompletes the named colors plus `#` and `rgb()` syntax hints.
- The deprecated `rgb`, `bgRgb`, `hex`, and `bgHex` style methods and dynamic helpers are removed — use the depth-aware `fg` and `bg` APIs. The static `*Code` aliases and the mode-unaware escape hatches (`applyStyle`, `composeStyles`, `fgCode`, `bgCode`, `linkCode`, `resolveColorDepth`) are removed: call the chainable directly (`bold(text)`), use its `open`/`close` for manual hot-path composition, plus `fg`/`bg`, `link`, and `style.colorDepth`. `StyleInstance.apply` is removed — pass the chainable itself (it is already a `StyleFn`).
- Global color control moves to the standard environment variables: `setGlobalColorMode`/`getGlobalColorMode` are removed, and the default `style` facade re-resolves `NO_COLOR`/`FORCE_COLOR`/TTY on every call. Capability detection honors `FORCE_COLOR` (chalk convention): `0`/`false` force all ANSI off; `1`/`2`/`3` force color at 16/256/truecolor depth; `FORCE_COLOR` takes precedence over `NO_COLOR` and TTY. `ColorMode` is now purely an instance concept (`"never"` = all ANSI off). `CapabilityOverrides` gains `forceColor`, `colorTerm`, and `term`; `TrueColorOverrides` is removed.
- The markdown theme system (`MarkdownTheme`, `createMarkdownTheme`, …), list block helpers (`unorderedList`, `orderedList`, `taskList`), `wrapText`, and the strict inline color-literal type machinery are removed — contracts for renderers that don't exist yet will ship with their first real consumer. `table` stays.
- `visibleWidth` is replaced by the exported `stringWidth(text)`, ANSI-aware and CJK-aware by default; `padStart`/`padEnd`/`center` are unchanged.
