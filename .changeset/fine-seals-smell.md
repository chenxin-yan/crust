---
"@crustjs/create": patch
---

Keep scaffold writes inside the destination: an existing destination file or ancestor directory symlink that resolves outside the (canonicalized) destination, or to a missing target, now throws before any file is written, so `conflict: "overwrite"` can no longer modify files elsewhere. `interpolate()` only substitutes own context properties, leaving `{{toString}}`-style placeholders unchanged. `runSteps()` accepts readonly step arrays.
