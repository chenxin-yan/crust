---
"@crustjs/validate": major
"@crustjs/store": minor
---

`field()` moved from `@crustjs/validate` to `@crustjs/store`.

The Standard-Schema-first store-field factory previously lived in
`@crustjs/validate` for historical reasons — the introspection layer used
to live inside validate before `@crustjs/schema-utils` was extracted (see
TP-017). Now that schema-utils exists as a shared internal package, the
factory that produces a store `FieldDef` belongs in the package that owns
`FieldDef`.

### Migration

```ts
// Before
import { field } from "@crustjs/validate";

// After
import { field } from "@crustjs/store";
```

No behaviour change. Same Standard Schema input, same `FieldDef` output,
same per-field async `validate` adapter.

### `@crustjs/validate` (major) — public surface reduced

The locked TP-014 root surface shrinks from **8 functions to 7**:

| Removed | Replacement |
| --- | --- |
| `field` | `import { field } from "@crustjs/store"` |
| `FieldOptions` (type) | `import type { FieldOptions } from "@crustjs/store"` |

The remaining 7 functions (`arg`, `flag`, `commandValidator`, `parseValue`,
`validateStandard`, `validateStandardSync`, `isStandardSchema`) are
unchanged.

### `@crustjs/store` (minor) — new schema-driven API

`@crustjs/store` now exports `field()` and `FieldOptions` from its root.
Schema-derived field defaults, descriptions, and the per-field validator
are derived in one call:

```ts
import { configDir, createStore, field } from "@crustjs/store";
import { z } from "zod";

const store = createStore({
  dirPath: configDir("my-cli"),
  fields: {
    theme: field(z.enum(["light", "dark"]).default("light")),
    port: field(z.number().int().min(1).default(3000)),
  },
});
```

`field()` throws `CrustStoreError("DEFINITION")` (with `details.vendor`)
on non-Standard-Schema input or when the CLI type cannot be inferred from
an unknown vendor — previously this was `CrustError("DEFINITION")`. Catch
the new error class when porting:

```ts
// Before
import { CrustError } from "@crustjs/core";
try { field(opaque); } catch (err) { if (err instanceof CrustError) … }

// After
import { CrustStoreError } from "@crustjs/store";
try { field(opaque); } catch (err) { if (err instanceof CrustStoreError) … }
```

`@crustjs/store` gains a runtime dependency on `@crustjs/schema-utils`
(internal workspace package, ~6.7 KB gzipped). Store consumers who never
call `field()` still ship this dependency.
