---
"@crustjs/style": patch
---

Add truecolor (24-bit) RGB and hex color support.

New direct styling functions: `rgb`, `bgRgb`, `hex`, `bgHex`. New ANSI pair factories for composition: `rgbCode`, `bgRgbCode`, `hexCode`, `bgHexCode`, and `parseHex` for hex-to-RGB conversion.

Truecolor capability detection via `resolveTrueColor()` gates dynamic colors in `"auto"` mode using `COLORTERM` and `TERM` environment variable heuristics. In `"always"` mode, truecolor sequences are always emitted. In `"never"` mode, plain text is returned. Dynamic color methods are also available on `StyleInstance` (`style.rgb(...)`, `style.hex(...)`, etc.) with the same mode-aware gating.

No automatic fallback to 256 or 16 colors — unsupported terminals may approximate or ignore truecolor sequences without runtime errors.
