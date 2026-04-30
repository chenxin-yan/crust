---
"@crustjs/style": minor
---

**Breaking change:** Replaced the hand-rolled hex / RGB dynamic-color helpers
with a single canonical `fg` / `bg` pair powered by [`Bun.color()`](https://bun.com/docs/runtime/color).

### Removed

Direct calls and pair factories: `rgb`, `bgRgb`, `hex`, `bgHex`, `rgbCode`,
`bgRgbCode`, `hexCode`, `bgHexCode`, `parseHex`. Style-instance methods
`style.rgb`, `style.bgRgb`, `style.hex`, `style.bgHex`.

### Added

- `fg(text, input)` / `bg(text, input)` — apply a truecolor foreground or
  background from anything `Bun.color()` accepts.
- `fgCode(input)` / `bgCode(input)` — `AnsiPair` factories for composition.
- `style.fg(text, input)` / `style.bg(text, input)` on style instances and
  the runtime `style` facade.
- `ColorInput` type and `ColorInput` re-export.

### New input surface

`fg`, `bg`, `fgCode`, and `bgCode` accept any input `Bun.color()` understands:

- Hex (`"#f00"`, `"#ff0000"`, `"#ff000080"`)
- Named CSS colors (`"red"`, `"rebeccapurple"`)
- `rgb()` / `rgba()` strings (`"rgb(0, 128, 255)"`)
- `hsl()` / `hsla()` strings (`"hsl(120, 100%, 50%)"`)
- `lab()` strings
- Numeric literals (`0xff0000`)
- `{ r, g, b, a? }` objects
- `[r, g, b]` and `[r, g, b, a]` arrays

### Migration

```ts
// Before
rgb(text, 0, 128, 255);
bgRgb(text, 255, 128, 0);
hex(text, "#ff0000");
bgHex(text, "#ff8800");
style.rgb(text, 0, 128, 255);
style.hex(text, "#ff0000");

// After
fg(text, [0, 128, 255]);
bg(text, [255, 128, 0]);
fg(text, "#ff0000");
bg(text, "#ff8800");
style.fg(text, [0, 128, 255]);
style.fg(text, "#ff0000");
```

Pair factories migrate the same way (`rgbCode(r, g, b)` → `fgCode([r, g, b])`,
`hexCode("#ff0000")` → `fgCode("#ff0000")`, etc.).

### Error contract

Invalid inputs now raise `TypeError` (`Invalid color input: <input>`) whenever
`Bun.color()` cannot parse them. The previous `RangeError` for out-of-range RGB
channels and the previous `TypeError` for malformed hex strings have been
unified into this single contract.

Empty `text` continues to short-circuit to `""` without consulting the parser.

### Notes

- Foreground and background ANSI escapes are byte-identical to the previous
  API for the same color (e.g. `fg("x", [0, 128, 255])` produces the exact
  same sequence as `rgb("x", 0, 128, 255)` did).
- Capability gating is unchanged: `fg` / `bg` are still suppressed when
  `trueColorEnabled` is `false` on a style instance.
- Depth-aware fallback (`ansi-256` / `ansi-16` for non-truecolor terminals)
  is intentionally **not** included in this release; tracked separately.
