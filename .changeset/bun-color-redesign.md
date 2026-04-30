---
"@crustjs/style": minor
---

**Color redesign:** added a single canonical `fg` / `bg` pair powered by
[`Bun.color()`](https://bun.com/docs/runtime/color), plus depth-aware
fallback so dynamic colors automatically downgrade to `ansi-256` or
`ansi-16` on terminals that don't support truecolor. The earlier
`rgb` / `bgRgb` / `hex` / `bgHex` helpers (and their `*Code` /
`style.*` variants) are kept as `@deprecated` aliases and will be
removed in v1.0.0.

### Added

- `fg(text, input)` / `bg(text, input)` — apply a foreground or
  background color from anything `Bun.color()` accepts. Output adapts to
  the resolved `ColorDepth` (see *Fallback* below).
- `fgCode(input)` / `bgCode(input)` — deterministic `AnsiPair` factories
  for composition. Always emit `ansi-16m`; runtime capability gating
  happens at apply time.
- `style.fg(text, input)` / `style.bg(text, input)` on style instances
  and the runtime `style` facade.
- `ColorInput` type — accepted by every dynamic-color helper.
- `ColorDepth` type — `"truecolor" | "256" | "16" | "none"`.
- `resolveColorDepth(mode, overrides?)` — resolves the active color
  depth for any emission decision.
- `colorDepth` property on `StyleInstance` (and the default `style`
  facade).

### Deprecated

The following exports continue to work with their original signatures
and error contracts (`RangeError` for out-of-range RGB, `TypeError` for
malformed hex). They emit `@deprecated` JSDoc warnings in IDEs and
`tsc`, and will be removed in v1.0.0. Migrate at your leisure.

| Deprecated | Replacement |
| --- | --- |
| `rgb(text, r, g, b)` | `fg(text, [r, g, b])` |
| `bgRgb(text, r, g, b)` | `bg(text, [r, g, b])` |
| `hex(text, "#rrggbb")` | `fg(text, "#rrggbb")` |
| `bgHex(text, "#rrggbb")` | `bg(text, "#rrggbb")` |
| `rgbCode(r, g, b)` | `fgCode([r, g, b])` |
| `bgRgbCode(r, g, b)` | `bgCode([r, g, b])` |
| `hexCode("#rrggbb")` | `fgCode("#rrggbb")` |
| `bgHexCode("#rrggbb")` | `bgCode("#rrggbb")` |
| `parseHex("#rrggbb")` | Pass the hex string directly to `fg` / `bg` / `fgCode` / `bgCode` |
| `style.rgb(text, r, g, b)` | `style.fg(text, [r, g, b])` |
| `style.bgRgb(text, r, g, b)` | `style.bg(text, [r, g, b])` |
| `style.hex(text, "#rrggbb")` | `style.fg(text, "#rrggbb")` |
| `style.bgHex(text, "#rrggbb")` | `style.bg(text, "#rrggbb")` |

### Input surface

`fg`, `bg`, `fgCode`, and `bgCode` accept any input `Bun.color()`
understands:

- Hex (`"#f00"`, `"#ff0000"`, `"#ff000080"`)
- Named CSS colors (`"red"`, `"rebeccapurple"`)
- `rgb()` / `rgba()` strings (`"rgb(0, 128, 255)"`)
- `hsl()` / `hsla()` strings (`"hsl(120, 100%, 50%)"`)
- `lab()` strings
- Numeric literals (`0xff0000`)
- `{ r, g, b, a? }` objects
- `[r, g, b]` and `[r, g, b, a]` arrays

### Fallback

Dynamic colors now resolve at runtime against the terminal's color depth:

| Resolved depth | Detection (in `"auto"` mode) |
| --- | --- |
| `"truecolor"` | `COLORTERM=truecolor\|24bit`, or `TERM` contains `truecolor`/`24bit`/ends with `-direct` |
| `"256"` | `TERM` contains `256color` |
| `"16"` | Any other TTY value |
| `"none"` | Not a TTY, `NO_COLOR=1`, `TERM=dumb`, or `mode === "never"` |

- Standalone `fg` / `bg` resolve depth on every call through the runtime
  `style` facade, so `setGlobalColorMode("never")`, `NO_COLOR=1`, and
  changes to `TERM` / `COLORTERM` continue to gate emission as expected.
- `style.fg` / `style.bg` on instances created by `createStyle()` capture
  the depth at construction time (consistent with how `mode` is locked).
- Invalid color inputs raise `TypeError` at every depth — including
  `"none"` — so user bugs are not silently masked when colors are off.
- The deprecated helpers above are still gated on `trueColorEnabled`
  exactly as before; they don't participate in depth fallback.

### Compatibility

- All deprecated exports keep their original behavior, signatures, and
  error contracts.
- Truecolor escape bytes from `fg` / `fgCode` for the same input are
  byte-identical to the deprecated helpers (e.g. `fg("x", [0, 128, 255])`
  produces the exact same sequence as `rgb("x", 0, 128, 255)`).
- `resolveColorCapability` and `resolveTrueColorCapability` keep their
  signatures; they are now thin wrappers over `resolveColorDepth`.
- `trueColorEnabled` is retained on `StyleInstance` and equals
  `colorDepth === "truecolor"`.
