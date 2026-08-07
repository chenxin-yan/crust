---
"@crustjs/core": minor
---

Name every definition helper with a `define*` prefix: `defineContext(name, ...)`, `defineExtension(name, config)`, `defineCommand(name, ...)`, and the new `defineFlag(name, def)` and `defineArg(name, def)`.

`defineFlag` and `defineArg` are const-generic helpers that return the definition with its `name` attached, preserving literal types without `as const`. Named definitions attach through the now-variadic builder methods — `.flags(...defs)` replaces `.flags(record)` and `.args(...defs)` replaces `.args(tuple)` — and are referenced in `requires.flags` arrays. Inline object literals carrying a `name` work everywhere a named definition does:

```ts
const verbose = defineFlag("verbose", { type: "boolean", short: "v" });
const target = defineArg("target", { type: "string", required: true });

const app = new Crust("my-cli")
	.flags(verbose, { name: "dry-run", type: "boolean" })
	.args(target)
	.handle(({ flags, args }) => {});
```
