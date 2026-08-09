---
"@crustjs/core": minor
---

Reorder the trailing `Deps` and `Sibs` generic parameters on `Crust` and `CommandDefinitionBuilder`. This is a breaking change: positional annotations with six or more generic arguments must swap their `Sibs` and `Deps` arguments. The break is loud because the `string` and `ContextDeps` constraints are incompatible.
