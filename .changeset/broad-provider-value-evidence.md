---
"@crustjs/core": patch
---

`.provide()` now rejects a broad-named provider whose value type does not satisfy a dependency declared by a later provider, including when a known literal provider sits beside an unknown broad provider (`FIX_DEPENDENCY_TYPE`). Previously these mismatches compiled and surfaced only as runtime `TypeError`s.
