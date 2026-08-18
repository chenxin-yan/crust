---
"@crustjs/core": minor
---

Normalize command definitions exactly once at definition or materialization time. Definition errors now surface earlier, snapshots trust successful materialization instead of re-walking the command tree, error messages use the shared normalization rules, and the type-level Context-cycle brand has been removed in favor of runtime enforcement. A flag default outside its `choices` now reports error code `DEFINITION` (was `PARSE`) and throws at definition time.
