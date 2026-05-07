---
"@crustjs/style": minor
---

**Strict inline color literals — typo-safe `fg` / `bg`.**

Inline string literals passed to `fg` / `bg` / `fgCode` / `bgCode` (and
the corresponding `style.fg` / `style.bg` / chain `.fg` / `.bg` methods)
are now validated at compile time against a `StrictColorString` subset:

- 148 CSS named colors (e.g. `"rebeccapurple"`)
- `#rrggbb` / `#rgb` / `#rrggbbaa` hex
- CSS color-function notation: `rgb()`, `rgba()`, `hsl()`, `hsla()`,
  `hwb()`, `lab()`, `lch()`, `oklab()`, `oklch()`, `color()`,
  `color-mix()`

```ts
fg("ok",  "rebeccapurple");      // ✅ valid named color
fg("ok",  "#ff0000");            // ✅ valid hex
fg("ok",  "oklch(60% 0.2 240)"); // ✅ valid CSS function

fg("bad", "rebbecapurple");      // ❌ compile error (typo)
fg("bad", "not-a-color");        // ❌ compile error (arbitrary)
fg("bad", "ff0000");             // ❌ compile error (missing `#`)
```

Dynamic `string`, `ColorString`, and `ColorInput` values keep flowing
through unchanged, so theme tokens loaded from JSON / `process.env` /
arbitrary user input still type-check exactly as before. Template
literal types validate the *shape* only; structurally-valid-looking
literals like `"#"` or `"rgb(banana)"` still type-check and raise
`TypeError` at runtime via `Bun.color()`.

The change is delivered as a single generic conditional on each public
signature — no function overloads and no runtime change. New helper
types are exported for users who want to build their own strict
wrappers:

- `StrictColorString` — the literal subset
- `CssColorFunctionString` — color-function template branch
- `NonStringColorInput` — non-string `ColorInput` branches
- `ColorInputCandidate` — generic constraint
- `CheckedColorInput<T>` — conditional helper

**Public surface trimmed.** Three exports with no documented use case
were removed from the package root. Each remains importable inside the
package but is no longer part of the public API:

| Removed export             | Migration                                                |
| -------------------------- | -------------------------------------------------------- |
| `LiteralUnion`             | Use `NamedColor` directly, or your own `string & {}` shape |
| `buildDefaultMarkdownTheme(s)` | `createMarkdownTheme({ style: { mode: ... } })`        |
| `reset` (ANSI `\x1b[0m`)   | Use `"\x1b[0m"` directly                                  |

Deprecated v0.x compatibility helpers (`rgb`, `hex`, `parseHex`, etc.)
are unaffected and remain exported until v1.0.0 per the bun-color
redesign contract.
