---
"@crustjs/man": patch
---

`mdoc` includes command aliases in the SUBCOMMANDS section.

When a subcommand declares `aliases` on its `meta`, the rendered man page lists them inline next to the canonical name on the `.It Nm` line — e.g. `.It Nm issue (issues, i)` — matching the inline format used by `helpPlugin`. Subcommands without aliases render unchanged. The `.Bl -tag -width` directive's column width is recalculated to fit the longest combined label so alignment stays consistent.

Requires `aliases` on `CommandMeta`, added in the same release of `@crustjs/core`.
