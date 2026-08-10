---
"@crustjs/core": minor
---

Normalize command definitions exactly once at definition or materialization time. Definition errors now surface earlier, snapshots trust successful materialization instead of re-walking the command tree, error messages use the shared normalization rules, and the type-level Context-cycle brand has been removed in favor of runtime enforcement. A flag default outside its `choices` now reports error code `DEFINITION` (was `PARSE`) and throws at definition time. Context dependencies must now be provided in the same `.provide()` call or an earlier one on the path; providing a dependent before its dependency in a later call throws `DEFINITION` immediately (previously the full list was sorted at dispatch, so cross-call order was free).
