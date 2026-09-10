---
"@crustjs/core": patch
---

`.provide()` now rejects a broad-named provider whose value type does not satisfy a dependency declared by a later provider (`FIX_DEPENDENCY_TYPE`). Previously a `Record<string, number>` provider satisfied a `string` dependency by name alone and the mismatch surfaced only as a runtime `TypeError`.
