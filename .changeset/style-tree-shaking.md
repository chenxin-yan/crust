---
"@crustjs/style": patch
---

`@crustjs/style` now tree-shakes: the default instance, its named color helpers, and the code tables are side-effect-free to bundlers, so importing only `stringWidth`, `padEnd`, or `table` no longer bundles the color engine (`stringWidth` alone: ~12 KB → ~2 KB minified).
