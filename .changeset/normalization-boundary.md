---
"@crustjs/core": minor
---

Check developer-authored command definitions once at compile time and let snapshots materialize them without re-walking a runtime validation rulebook. Dynamic Context cycles remain runtime-enforced. A literal flag default outside its literal `choices` now fails typechecking with `FIX_DEFAULT_CHOICE`; runtime parsing continues to report invalid argv choices as `PARSE`.
