---
"@crustjs/validate": minor
---

# `@crustjs/validate` 0.2.0 — locked 8-function root surface

Aligns the public API around a single mental model — schema in, typed value out — and removes the deprecated subpath barrels introduced in TP-007. **Breaking changes for 0.1.x consumers.**

The package now exports exactly eight functions from a single root entry: `arg`, `flag`, `commandValidator`, `field`, `parseValue`, `validateStandard`, `validateStandardSync`, `isStandardSchema`.

## Breaking

- **Subpath removal.** `@crustjs/validate/zod`, `@crustjs/validate/effect`, and `@crustjs/validate/standard` are gone. Replace all three with `@crustjs/validate`. Effect users wrap raw schemas once with `Schema.standardSchemaV1(...)` before passing them — the auto-wrap shim in the old `/effect` barrel was removed.
- **`effect` peer dependency removed.** `@crustjs/validate` now imports nothing from `effect` at runtime. Users install `effect` themselves at their preferred version (≥ 3.14.2 to keep AST introspection working).
- **Helper renames and removals.** `parsePromptValue` → `parseValue`. `parsePromptValueSync`, `promptValidator`, and `fieldSync` are removed (use `validateStandardSync` directly, pass schemas to `input({ validate: schema })` per TP-013, or rely on the new async `field()` validate respectively).
- **`field()` shape change.** The validator-only `field(schema): (v) => Promise<void>` is replaced by a full factory `field(schema, opts?)` that returns a `FieldDef` value satisfying `@crustjs/store`'s discriminated union. Auto-derives `type`, `default`, `array`, `description` from the schema; the optional `opts` overrides any key silently and narrows the inferred config type when `default` is passed explicitly.
- **`errorStrategy` is gone everywhere.** Prompts render the first issue inline (TP-013); `parseValue` always throws with all issues in `error.details.issues`.

## Migration

```ts
// 0.1.x
import { arg, flag, commandValidator } from "@crustjs/validate/zod";
import { promptValidator, parsePromptValue, field } from "@crustjs/validate/standard";

// 0.2.0
import { arg, flag, commandValidator, field, parseValue } from "@crustjs/validate";
// promptValidator → pass the schema directly to input({ validate: schema }).
```

```ts
// 0.1.x
fields: {
  theme: { type: "string", default: "light", validate: field(z.enum(["light", "dark"])) },
}

// 0.2.0
fields: {
  theme: field(z.enum(["light", "dark"]).default("light")),
}
```

Schema-derived defaults populate at runtime but do NOT narrow the TypeScript type — pass `field(schema, { default: x })` explicitly when you need tight typing.
