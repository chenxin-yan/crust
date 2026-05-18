# `@crustjs/validate`

Standard Schema-first validation helpers for the [Crust CLI framework](https://crustjs.com/).

`@crustjs/validate` exposes a single, library-agnostic API. You pass any
[Standard Schema v1](https://standardschema.dev/) object — Zod, Effect,
Valibot, ArkType, Sury, or anything else that implements the spec — and the
package parses CLI syntax into raw values, then validates and transforms
arguments, flags, and prompts with your schema. For store fields, use
[`field()` from `@crustjs/store`](https://www.npmjs.com/package/@crustjs/store).

```sh
bun add @crustjs/validate
# Optional, depending on your schema library:
bun add zod      # any Zod v4 schema is a Standard Schema natively
bun add effect   # wrap with `Schema.standardSchemaV1(...)`
```

## Locked public surface

The package exports exactly **seven** functions and one type group from a
single root entry. The mental model is uniform: schema in, typed value
out.

| Function | Purpose |
| --- | --- |
| `arg(name, schema, opts?)` | Define a positional argument |
| `flag(schema, opts)` | Define a flag; `opts.type` declares CLI grammar |
| `commandValidator(handler)` | Wrap a Crust handler with full schema validation |
| `parseValue(schema, value)` | Validate + return typed output (throws on failure) |
| `validateStandard(schema, value)` | Async low-level primitive (returns a result) |
| `validateStandardSync(schema, value)` | Sync low-level primitive (throws on async schemas) |
| `isStandardSchema(value)` | Runtime type guard for `Standard Schema v1` |

Every helper accepts any Standard Schema v1 object. Crust does not infer metadata from schemas. Use Crust options for
descriptions and flag parser grammar; schemas decide requiredness, defaults,
and transformations by validating runtime values. Store field construction lives in
[`@crustjs/store`](https://www.npmjs.com/package/@crustjs/store) (see
`field()` there).

## Quick start — Zod

```ts
import { Crust } from "@crustjs/core";
import { arg, commandValidator, flag } from "@crustjs/validate";
import { z } from "zod";

const serve = new Crust("serve")
  .meta({ description: "Start the dev server" })
  .args([
    arg("port", z.coerce.number().int().min(1), { description: "Port to listen on" }),
    arg("host", z.string().default("localhost")),
  ])
  .flags({
    verbose: flag(
      z.boolean().default(false),
      { type: "boolean", short: "v", description: "Enable verbose logging" },
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
passing them to `arg()` / `flag()`. Crust uses only the wrapper's Standard
Schema `validate` function at runtime.

```ts
import { Crust } from "@crustjs/core";
import { arg, commandValidator, flag } from "@crustjs/validate";
import * as Schema from "effect/Schema";

new Crust("serve")
  .args([
    arg("port", Schema.standardSchemaV1(Schema.NumberFromString), {
      description: "Port to listen on",
    }),
  ])
  .flags({
    verbose: flag(Schema.standardSchemaV1(Schema.UndefinedOr(Schema.Boolean)), {
      type: "boolean",
      short: "v",
      description: "Enable verbose logging",
    }),
  })
  .run(commandValidator(({ args, flags }) => { /* … */ }));
```

> **Parser grammar lives in Crust options.** Descriptions, aliases, and flag
> `type` are Crust metadata. For flags, `type` declares CLI grammar/token
> ownership; schemas decide requiredness, defaults, and transformations by
> validating actual values.

If you use Effect heavily and want shorter call sites, drop these
helpers into your own project:

```ts
import {
  arg,
  flag,
  type ArgDef,
  type ArgOptions,
  type FlagDef,
  type FlagOptions,
  type StandardSchema,
} from "@crustjs/validate";
import * as Schema from "effect/Schema";

type EffectAsStandardSchema<S> = S extends Schema.Schema<infer A, infer I>
  ? StandardSchema<I, A>
  : StandardSchema;

export const earg = <
  Name extends string,
  S extends Schema.Schema.AnyNoContext,
  const Variadic extends true | undefined = undefined,
>(
  name: Name,
  schema: S,
  options?: ArgOptions & { variadic?: Variadic },
) =>
  arg(
    name,
    Schema.standardSchemaV1(
      schema as Parameters<typeof Schema.standardSchemaV1>[0],
    ),
    options,
  ) as unknown as ArgDef<Name, EffectAsStandardSchema<S>, Variadic>;

export const eflag = <
  S extends Schema.Schema.AnyNoContext,
  const Short extends string | undefined = undefined,
  const Aliases extends readonly string[] | undefined = undefined,
  const Inherit extends true | undefined = undefined,
>(
  schema: S,
  options: FlagOptions & {
    short?: Short;
    aliases?: Aliases;
    inherit?: Inherit;
  },
) =>
  flag(
    Schema.standardSchemaV1(
      schema as Parameters<typeof Schema.standardSchemaV1>[0],
    ),
    options,
  ) as unknown as FlagDef<EffectAsStandardSchema<S>, Short, Aliases, Inherit>;
```

> The cast `schema as Parameters<typeof Schema.standardSchemaV1>[0]` is
> needed because `Schema.standardSchemaV1` is overloaded; everything else
> is structural. The forwarded `Variadic` / `Short` / `Aliases` /
> `Inherit` generics keep narrowed types reaching the handler signature.
> A type-level test for this recipe lives in
> `packages/validate/tests/effect-helper-recipe.test-d.ts`.

## Quick start — other Standard Schema vendors

Any other library implementing the spec works too. Supply descriptions as Crust
metadata when you want them in help output:

```ts
import { Crust } from "@crustjs/core";
import { arg, commandValidator } from "@crustjs/validate";
import * as v from "valibot";

new Crust("hi")
  .args([
    arg("name", v.pipe(v.string(), v.minLength(1)), {
      description: "Your name",
    }),
  ])
  .run(commandValidator(({ args }) => { /* args.name: string */ }));
```

For positional args, `type` is optional because the token is already owned by
the argument. For flags, `type` is required because it declares CLI grammar:
`type: "boolean"` does not consume a value, while `type: "string"` and
`type: "number"` consume `--flag value` / `--flag=value`. Schemas validate and
transform the parsed value after grammar is applied.

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

`field()` moved to [`@crustjs/store`](https://www.npmjs.com/package/@crustjs/store)
in 0.3.0. Import from there:

```ts
import { configDir, createStore, field } from "@crustjs/store";
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

See [`@crustjs/store`'s README](https://www.npmjs.com/package/@crustjs/store)
for the full reference, including the runtime-vs-type-level behaviour of
schema-derived defaults.

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
themselves at their preferred version.

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

## Migrating from 0.2.x

**`field()` moved to `@crustjs/store` (breaking):**

```ts
// 0.2.x
import { field } from "@crustjs/validate";

// 0.3.0
import { field } from "@crustjs/store";
```

No behaviour change. The factory now throws `CrustStoreError("DEFINITION")`
instead of `CrustError("DEFINITION")` on invalid input so the error class
matches the package that owns the store-field surface. `FieldOptions` is
no longer exported from `@crustjs/validate`; import it from
`@crustjs/store` if you previously relied on the type.

## See also

- [Standard Schema v1 spec](https://github.com/standard-schema/standard-schema)
- [`@crustjs/core`](../core/README.md) — the framework itself
- [`@crustjs/store`](../store/README.md) — config storage with its own
  schema-driven `field()` factory
- [`@crustjs/prompts`](../prompts/README.md) — prompts that accept
  Standard Schemas directly via `validate:`
