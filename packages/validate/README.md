# `@crustjs/validate`

Standard Schema-first validation helpers for the [Crust CLI framework](https://crustjs.com/).

`@crustjs/validate` exposes a single, library-agnostic API. You pass any
[Standard Schema v1](https://standardschema.dev/) object — Zod, Effect,
Valibot, ArkType, Sury, or anything else that implements the spec — and the
package introspects what it can (Zod and Effect natively), then validates
arguments, flags, prompts, and store fields against your schema.

```sh
bun add @crustjs/validate
# Optional, depending on your schema library:
bun add zod      # any Zod v4 schema is a Standard Schema natively
bun add effect   # wrap with `Schema.standardSchemaV1(...)`
```

## Locked public surface

The package exports exactly **eight** functions and one type group from a
single root entry. The mental model is uniform: schema in, typed value
out.

| Function | Purpose |
| --- | --- |
| `arg(name, schema, opts?)` | Define a positional argument |
| `flag(schema, opts?)` | Define a flag |
| `commandValidator(handler)` | Wrap a Crust handler with full schema validation |
| `field(schema, opts?)` | Build a `@crustjs/store` field definition |
| `parseValue(schema, value)` | Validate + return typed output (throws on failure) |
| `validateStandard(schema, value)` | Async low-level primitive (returns a result) |
| `validateStandardSync(schema, value)` | Sync low-level primitive (throws on async schemas) |
| `isStandardSchema(value)` | Runtime type guard for `Standard Schema v1` |

Every helper accepts any Standard Schema v1 object. Vendor-specific
introspection (Zod, Effect) auto-derives metadata where possible; explicit
options always win silently.

## Quick start — Zod

```ts
import { Crust } from "@crustjs/core";
import { arg, commandValidator, flag } from "@crustjs/validate";
import { z } from "zod";

const serve = new Crust("serve")
  .meta({ description: "Start the dev server" })
  .args([
    arg("port", z.number().int().min(1).describe("Port to listen on")),
    arg("host", z.string().default("localhost")),
  ])
  .flags({
    verbose: flag(
      z.boolean().default(false).describe("Enable verbose logging"),
      { short: "v" },
    ),
  })
  .run(
    commandValidator(({ args, flags }) => {
      // args.port: number, args.host: string, flags.verbose: boolean
      console.log(`Listening on ${args.host}:${args.port}`);
    }),
  );
```

## Quick start — Effect

Wrap your raw Effect schemas with `Schema.standardSchemaV1(...)` before
passing them to `arg()` / `flag()` / `field()`. The wrapper exposes
`.ast`, which the registry walks to recover the same metadata Zod gives
natively.

```ts
import { Crust } from "@crustjs/core";
import { arg, commandValidator, flag } from "@crustjs/validate";
import * as Schema from "effect/Schema";

new Crust("serve")
  .args([
    arg(
      "port",
      Schema.standardSchemaV1(
        Schema.Number.annotations({ description: "Port to listen on" }),
      ),
    ),
  ])
  .flags({
    verbose: flag(
      Schema.standardSchemaV1(
        Schema.UndefinedOr(
          Schema.Boolean.annotations({ description: "Enable verbose logging" }),
        ),
      ),
      { short: "v" },
    ),
  })
  .run(commandValidator(({ args, flags }) => { /* … */ }));
```

> **Effect ≥ 3.14.2 required.** Effect 3.14.2
> [made `standardSchemaV1(...)`](https://github.com/Effect-TS/effect/pull/4648)
> wrappers expose `.ast`, which is what the registry walks. On older
> versions the introspection registry returns an empty result and you
> must supply `type:` / `description:` explicitly via the second
> argument.

If you use Effect heavily and want shorter call sites, drop these
helpers into your own project:

```ts
import { arg, flag, type ArgDef, type FlagDef, type StandardSchema } from "@crustjs/validate";
import * as Schema from "effect/Schema";

type EffectAsStandardSchema<S> = S extends Schema.Schema<infer A, infer I>
  ? StandardSchema<I, A>
  : StandardSchema;

export const earg = <Name extends string, S extends Schema.Schema.AnyNoContext>(
  name: Name,
  schema: S,
  options?: Parameters<typeof arg>[2],
) => arg(name, Schema.standardSchemaV1(schema as never), options) as unknown as ArgDef<Name, EffectAsStandardSchema<S>>;

export const eflag = <S extends Schema.Schema.AnyNoContext>(
  schema: S,
  options?: Parameters<typeof flag>[1],
) => flag(Schema.standardSchemaV1(schema as never), options) as unknown as FlagDef<EffectAsStandardSchema<S>>;
```

## Quick start — other Standard Schema vendors

Any other library implementing the spec works too. Supply CLI metadata
explicitly via the second argument:

```ts
import { arg, commandValidator } from "@crustjs/validate";
import * as v from "valibot";

new Crust("hi")
  .args([
    arg("name", v.pipe(v.string(), v.minLength(1)), {
      type: "string",
      description: "Your name",
    }),
  ])
  .run(commandValidator(({ args }) => { /* args.name: string */ }));
```

If `type:` is missing for an unknown vendor, `arg()` / `flag()` /
`field()` throws a `CrustError("DEFINITION")` naming the failing
definition and the detected `vendor`.

## Command validation

`commandValidator(handler)` returns a `run` function for the Crust
builder that:

1. Reads the Standard Schema attached to each `arg()`/`flag()` via the
   hidden `[VALIDATED_SCHEMA]` brand.
2. Validates parsed CLI input against every schema (handles sync and
   `Promise`-returning `~standard.validate` transparently).
3. Calls `handler` with a `ValidatedContext` containing the transformed
   values — or throws `CrustError("VALIDATION")` with normalized issues
   attached as `error.details.issues`.

**Strict mode**: every `arg`/`flag` must come from this package's `arg()`
/ `flag()` helpers. Mixing in a plain core def causes the handler
parameter to resolve to `never` at compile time.

## Prompt integration

`@crustjs/prompts` accepts any Standard Schema directly via its
polymorphic `validate:` slot — no validator helper is required:

```ts
import { input } from "@crustjs/prompts";
import { z } from "zod";

const email = await input({
  message: "Enter your email",
  validate: z.email("Enter a valid email"),
});
```

For non-prompt code that wants a typed value back from any input
(coerced, transformed, or refined), use `parseValue`:

```ts
import { parseValue } from "@crustjs/validate";
import { z } from "zod";

const port = await parseValue(z.coerce.number().int().positive(), "8080");
// port is typed as `number`
```

`parseValue` throws `CrustError("VALIDATION")` with all issues in
`error.details.issues` on failure.

## Store field validation

`field(schema, opts?)` returns a `FieldDef` value that structurally fits
`@crustjs/store`'s discriminated union — no validate runtime dep needed
on store's side. Introspection auto-derives `type`, `default`, `array`,
and `description`; pass `opts` to override any of them silently.

```ts
import { configDir, createStore } from "@crustjs/store";
import { field } from "@crustjs/validate";
import { z } from "zod";

const store = createStore({
  dirPath: configDir("my-cli"),
  fields: {
    theme: field(z.enum(["light", "dark"]).default("light")),
    port: field(z.number().int().min(1).default(3000)),
    tags: field(z.array(z.string()).default([])),
  },
});
```

### Schema-derived defaults and TypeScript

Standard Schema v1 has no spec-portable type-level access to schema
defaults. As a result:

- `field(z.string().default("x"))` populates `default: "x"` at runtime,
  but the inferred config type is `string | undefined` (NOT narrowed).
- `field(z.string(), { default: "x" })` populates `default: "x"` AND
  narrows the inferred config type to `string`.

For tight typing of default-bearing fields, prefer the explicit form
when the field is required to always have a value at use sites.

## Low-level primitives

```ts
import { validateStandard, validateStandardSync, isStandardSchema } from "@crustjs/validate";

const r = await validateStandard(schema, value);
if (r.ok) {
  console.log(r.value);
} else {
  console.log(r.issues); // [{ message, path }]
}

// Sync — throws TypeError if the schema returns a Promise.
const sr = validateStandardSync(schema, value);
```

## Validation errors

All failures normalize to `CrustError("VALIDATION")` with:

- A bullet-list message rendered from each issue's `path` and `message`.
- `error.details.issues: { path: string; message: string }[]` — the raw
  issues with dot-paths (e.g. `args[0].port`, `flags.verbose`).
- `error.cause` — the same array of issues, suitable for programmatic
  consumption.

## Migrating from 0.1.x

`@crustjs/validate` 0.2.0 removes the deprecated subpath barrels and
trims the public surface to the locked 8-function root.

**Subpath removal (breaking):**

```ts
// 0.1.x
import { arg, flag, commandValidator } from "@crustjs/validate/zod";
import { promptValidator, field } from "@crustjs/validate/standard";
import { arg, flag } from "@crustjs/validate/effect"; // auto-wrapped raw Effect

// 0.2.0
import { arg, flag, commandValidator, field } from "@crustjs/validate";
// Effect users wrap once with Schema.standardSchemaV1(...) — see Quick start above.
```

The `effect` peer dependency was removed; users install `effect`
themselves at their preferred version (≥ 3.14.2 to keep introspection
working).

**Helper renames and removals:**

| 0.1.x | 0.2.0 |
| --- | --- |
| `parsePromptValue(schema, v)` | `parseValue(schema, v)` |
| `parsePromptValueSync(schema, v)` | use `validateStandardSync(schema, v)` and check `result.ok` |
| `promptValidator(schema)` | pass `schema` directly to `input({ validate: schema })` (see [`@crustjs/prompts`](../prompts/README.md)) |
| `field(schema)` (validator-only) | `field(schema)` now returns a full `FieldDef` |
| `fieldSync(schema)` | use `field(schema)` (the resulting `validate` is async) |

The `errorStrategy` option on `promptValidator` is gone everywhere. Prompts
render the first issue inline; `parseValue` throws with all issues in
`error.details.issues`. There is no toggle.

**`field()` shape change (breaking):**

```ts
// 0.1.x — schema repeated, validator-only field()
fields: {
  theme: {
    type: "string",
    default: "light",
    validate: field(z.enum(["light", "dark"])),
  },
}

// 0.2.0 — single source of truth
fields: {
  theme: field(z.enum(["light", "dark"]).default("light")),
}
```

Schema-derived defaults populate at runtime but do NOT narrow the TS
type — see [Schema-derived defaults and TypeScript](#schema-derived-defaults-and-typescript).

## See also

- [Standard Schema v1 spec](https://github.com/standard-schema/standard-schema)
- [`@crustjs/core`](../core/README.md) — the framework itself
- [`@crustjs/store`](../store/README.md) — config storage that consumes
  this package's `field()` factory
- [`@crustjs/prompts`](../prompts/README.md) — prompts that accept
  Standard Schemas directly via `validate:`
