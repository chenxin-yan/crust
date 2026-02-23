# @crustjs/style

## 0.0.3

### Patch Changes

- 6d666b3: Add truecolor (24-bit) RGB and hex color support.

  New direct styling functions: `rgb`, `bgRgb`, `hex`, `bgHex`. New ANSI pair factories for composition: `rgbCode`, `bgRgbCode`, `hexCode`, `bgHexCode`, and `parseHex` for hex-to-RGB conversion.

  Truecolor capability detection via `resolveTrueColor()` gates dynamic colors in `"auto"` mode using `COLORTERM` and `TERM` environment variable heuristics. In `"always"` mode, truecolor sequences are always emitted. In `"never"` mode, plain text is returned. Dynamic color methods are also available on `StyleInstance` (`style.rgb(...)`, `style.hex(...)`, etc.) with the same mode-aware gating.

  No automatic fallback to 256 or 16 colors — unsupported terminals may approximate or ignore truecolor sequences without runtime errors.

## 0.0.2

### Patch Changes

- 0092dcc: Add chainable style composition via property access, enabling usage like `style.bold.red("text")` while preserving existing call syntax.

  Derive style method names and mappings from a single registry so runtime behavior and TypeScript types stay in sync when ANSI methods are added or changed.

## 0.0.1

### Patch Changes

- 051fd44: Introduce @crustjs/style — a terminal styling foundation for Crust with ANSI-safe styling primitives, color mode awareness (auto/always/never), ANSI-aware text layout utilities, list and table block helpers, and a semantic markdown theme covering all GFM constructs. Zero runtime dependencies.
