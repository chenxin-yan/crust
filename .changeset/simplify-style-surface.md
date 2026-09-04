---
"@crustjs/style": minor
---

Simplify dynamic colors and tables ahead of 1.0 (breaking).

- `fg` and `bg` no longer accept a color-depth override argument. Use `createStyle({ overrides })` for deterministic output.
- `TableOptions` no longer includes `minColumnWidth`, `cellPadding`, `separatorChar`, or `borderChar`; tables use their standard width, padding, separator, and border formatting.
