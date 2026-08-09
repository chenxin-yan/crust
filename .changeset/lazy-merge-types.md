---
"@crustjs/core": patch
---

Faster type inference for fluent builder chains. `MergeFlags`/`EffectiveFlags`/`MergeContext` now accumulate as flat intersections instead of nesting a merge layer (`Simplify<Omit<...> & ...>`) per call — safe because overlapping keys are compile-branded and throw at runtime, so valid programs never merge overlapping records. This raises the instantiation-depth ceiling from ~31 to ~93 chained `.flags()` calls before `TS2589`, removes the `.provide()` chain ceiling entirely, fixes silent `ctx` inference degradation on long `.provide()` chains, and cuts type-check instantiations by ~17% in core and ~30% in consuming packages. `ValidateNamedFlagDefs` also hoists its call-invariant validators out of the per-definition map.
