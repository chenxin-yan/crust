# `@crustjs/validate`

Standard Schema-first validation for **CLI arguments and flags** in the
[Crust CLI framework](https://crustjs.com/).

`@crustjs/validate` exposes a single, library-agnostic API. You pass any
[Standard Schema v1](https://standardschema.dev/) object — Zod, Effect,
Valibot, ArkType, Sury, or anything else — and Crust parses CLI syntax into
raw values, then validates and transforms them with your schema before they
reach your command handler.

> **Validation lives where it's used.**
>
> - **Prompts** — [`@crustjs/prompts`](https://www.npmjs.com/package/@crustjs/prompts)
>   accepts any Standard Schema directly on its `validate:` slot. You do not
>   need `@crustjs/validate` for prompts.
> - **Store fields** — [`@crustjs/store`](https://www.npmjs.com/package/@crustjs/store)
>   ships its own `field()` factory. You do not need `@crustjs/validate` for
>   stores.
>
> Reach for `@crustjs/validate` only for command-level `arg()` / `flag()` /
> `commandValidator()`.

```sh
bun add @crustjs/validate
# Optional, depending on your schema library:
bun add zod      # any Zod v4 schema is a Standard Schema natively
bun add effect   # wrap with `Schema.standardSchemaV1(...)`
```

## Public surface

The package exports seven functions and one type group from a single root
entry. The mental model is uniform: schema in, typed value out.

| Function | Purpose |
| --- | --- |
| `arg(name, schema, opts?)` | Define a positional argument |
| `flag(schema, opts)` | Define a flag; `opts.type` declares CLI grammar |
| `commandValidator(handler)` | Wrap a Crust handler with full schema validation |
| `parseValue(schema, value)` | Validate + return typed output (throws on failure) |
| `validateStandard(schema, value)` | Async low-level primitive (returns a result) |
| `validateStandardSync(schema, value)` | Sync low-level primitive (throws on async schemas) |
| `isStandardSchema(value)` | Runtime type guard for `Standard Schema v1` |

Crust does not infer metadata from schemas. Use Crust options for
descriptions and flag parser grammar; schemas decide requiredness,
defaults, and transformations by validating runtime values.

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

## Helpers

### `parseValue(schema, value)`

Validate any value through any Standard Schema and get the transformed
output back, typed:

```ts
import { parseValue } from "@crustjs/validate";
import { z } from "zod";

const port = await parseValue(z.coerce.number().int().positive(), "8080");
// port is typed as `number`
```

Throws `CrustError("VALIDATION")` with all issues in
`error.details.issues` on failure. Useful for schema-driven parsing
outside the `arg()` / `flag()` flow — for example, validating an
environment variable or a value read from a file.

### `validateStandard` / `validateStandardSync` / `isStandardSchema`

Low-level primitives for code that wants to handle the result without
throwing, or to runtime-check whether an object implements Standard
Schema v1:

```ts
import {
  isStandardSchema,
  validateStandard,
  validateStandardSync,
} from "@crustjs/validate";

const result = await validateStandard(schema, value);
if (result.ok) {
  console.log(result.value);
} else {
  console.log(result.issues); // [{ message, path }]
}

// Sync — throws TypeError if the schema returns a Promise.
const sync = validateStandardSync(schema, value);
```

## Validation errors

All failures normalize to `CrustError("VALIDATION")` with:

- A bullet-list message rendered from each issue's `path` and `message`.
- `error.details.issues: { path: string; message: string }[]` — the raw
  issues with dot-paths (e.g. `args[0].port`, `flags.verbose`).
- `error.cause` — the same array of issues, suitable for programmatic
  consumption.

## See also

- [Standard Schema v1 spec](https://github.com/standard-schema/standard-schema)
- [`@crustjs/core`](../core/README.md) — the framework itself
- [`@crustjs/prompts`](../prompts/README.md) — schema-driven prompt
  validation (independent of this package)
- [`@crustjs/store`](../store/README.md) — schema-driven store-field
  validation via its own `field()` factory (independent of this package)
