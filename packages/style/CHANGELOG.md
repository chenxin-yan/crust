# @crustjs/style

## 0.0.2

### Patch Changes

- 0092dcc: Add chainable style composition via property access, enabling usage like `style.bold.red("text")` while preserving existing call syntax.

  Derive style method names and mappings from a single registry so runtime behavior and TypeScript types stay in sync when ANSI methods are added or changed.

## 0.0.1

### Patch Changes

- 051fd44: Introduce @crustjs/style — a terminal styling foundation for Crust with ANSI-safe styling primitives, color mode awareness (auto/always/never), ANSI-aware text layout utilities, list and table block helpers, and a semantic markdown theme covering all GFM constructs. Zero runtime dependencies.
