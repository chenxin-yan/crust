---
"@crustjs/core": minor
---

Breaking: `.flags()` on commands, Contexts, and Extensions takes only the record form, and `defineFlag()` takes only a definition. The named form `.flags({ name: "out", type: "string" }, …)` and `defineFlag(name, def)` are removed, along with the `NamedFlagDef` and `NamedExtensionFlagDef` types. Each call takes exactly one record; call `.flags()` again to add more. A flag's key is its name:

```ts
const format = defineFlag({ type: "string", choices: ["json", "yaml"] });
app.flags({ out: { type: "string", short: "o" }, format });
```
