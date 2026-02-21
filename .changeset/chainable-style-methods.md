---
"@crustjs/style": patch
---

Add chainable style composition via property access, enabling usage like `style.bold.red("text")` while preserving existing call syntax.

Derive style method names and mappings from a single registry so runtime behavior and TypeScript types stay in sync when ANSI methods are added or changed.
