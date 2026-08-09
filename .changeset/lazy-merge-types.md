---
"@crustjs/core": patch
---

Faster type inference for fluent builder chains. `MergeFlags`/`MergeContext` are now single-pass mapped types instead of `Simplify<Omit<...> & ...>` intersections, which raises the instantiation-depth ceiling from ~31 to ~47 chained `.flags()` calls before `TS2589`, fixes silent `ctx` inference degradation on long `.provide()` chains, and cuts type-check instantiations in consuming packages by ~9–23%. `ValidateNamedFlagDefs` also hoists its call-invariant validators out of the per-definition map.
