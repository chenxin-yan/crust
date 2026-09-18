---
"@crustjs/core": patch
---

Preserve action-local Context value obligations after binding. Incompatible inherited shadowing is still allowed before an action; compatible replacements and independent descendant shadowing remain valid. Previously accepted replacements that invalidate a stored action now fail typechecking.
