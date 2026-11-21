---
"@crustjs/effect": patch
---

`service(factory)` accepts a structural copy of a Context factory, which core allows, such as the factory `defineConfig(...).flags(...)` from `@crustjs/config` returns: it compares the factories' `of`, which a copy carries from the original, so `service(config)` finds `.provide(config())` and `.provide(config.of(...))`. An unrelated factory with the same name, and another factory's `.of()` double, are still rejected.
