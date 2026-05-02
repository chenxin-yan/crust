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
bun add effect   # wrap with `Schema.standardSchemaV1(...)` (see below)
```

## Why one entry point?

Earlier versions of this package shipped `/zod`, `/effect`, and `/standard`
subpath exports. In **0.1.0** the public API consolidates around the
Standard Schema spec: one root entry, one `arg()`, one `flag()`, one
`commandValidator()`. Internally a small vendor-dispatch registry reads
`schema["~standard"].vendor` and routes to per-library introspection
adapters so that:

- **Zod 4 schemas** are introspected natively (Zod 4 schemas implement
  Standard Schema v1 directly — no wrapping required).
- **Effect schemas** are introspected through their wrapper. You wrap once
  with `Schema.standardSchemaV1(...)`, and the registry walks the
  underlying AST. This requires `effect ≥ 3.14.2` (the version that
  exposed `.ast` on `Schema.standardSchemaV1(...)` wrappers; `3.14.0` and
  `3.14.1` returned a plain object without it).
- **Other vendors** (Valibot, ArkType, Sury, …) work too, but you supply
  CLI metadata explicitly via the second argument to `arg()` / `flag()`.

The deprecated `/zod`, `/effect`, and `/standard` subpaths still work for
the entire 0.x cycle. They are removed in 1.0.0.

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
      {
        short: "v",
      },
    ),
  })
  .run(
    commandValidator(({ args, flags }) => {
      // args.port: number, args.host: string, flags.verbose: boolean
      console.log(`Listening on ${args.host}:${args.port}`);
    }),
  );
```

Zod schemas pass through unchanged. Inferred CLI metadata: `type`,
`required`, `description`, plus array/variadic detection.

## Quick start — Effect

Wrap your raw Effect schemas with `Schema.standardSchemaV1(...)` before
passing them to `arg()` / `flag()`. The wrapper exposes `.ast`, which the
registry walks to recover the same metadata Zod gives natively.

```ts
import { Crust } from "@crustjs/core";
import { arg, commandValidator, flag } from "@crustjs/validate";
import * as Schema from "effect/Schema";

const serve = new Crust("serve")
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
  .run(
    commandValidator(({ args, flags }) => {
      // args.port: number, flags.verbose: boolean | undefined
    }),
  );
```

If you find the boilerplate noisy, drop these two helpers into your
project — they delegate to `arg`/`flag` and only differ in the wrap step:

```ts
import { arg, flag } from "@crustjs/validate";
import * as Schema from "effect/Schema";

export const earg: typeof arg = (name, schema, options) =>
  arg(name, Schema.standardSchemaV1(schema as never), options);
export const eflag: typeof flag = (schema, options) =>
  flag(Schema.standardSchemaV1(schema as never), options);
```

The package itself does **not** export these helpers — keeping the public
surface vendor-neutral lets every Standard Schema library land on the
same code path.

> **Effect ≥ 3.14 required.** Effect 3.14 [made `standardSchemaV1(...)`
> wrappers expose `.ast`](https://github.com/Effect-TS/effect/pull/4648),
> which is what the registry walks. On Effect 3.13.x the introspection
> registry returns an empty result and you must supply `type:` (and
> `required:` / `description:`) explicitly via the second argument.

## Quick start — other Standard Schema vendors

For any other library implementing the spec, supply CLI metadata
explicitly. The schema still drives validation; you just hand-craft the
parser hint:

```ts
import { Crust } from "@crustjs/core";
import { arg, commandValidator } from "@crustjs/validate";
import * as v from "valibot";

const cmd = new Crust("hi")
  .args([
    arg("name", v.pipe(v.string(), v.minLength(1)), {
      type: "string",
      description: "Your name",
    }),
  ])
  .run(
    commandValidator(({ args }) => {
      // args.name: string
    }),
  );
```

If you forget to supply `type:` for an unknown vendor, `arg()` / `flag()`
throws a `CrustError("DEFINITION")` that names the failing arg/flag and
the detected `vendor`.

Unknown-vendor schemas have no introspection available, so the second
argument is the full source of CLI metadata:

- **`type`** is required — pick `"string" | "number" | "boolean"`.
- **`required`** defaults to `true`. Optionality cannot be inferred from
  the schema; pass `required: false` for optional args/flags.
- **`description`** is taken verbatim from `options.description`.
- **`variadic: true`** on `arg()` declares a variadic positional that
  collects remaining inputs into an array.
- **`multiple: true`** on `flag()` declares a multi-value flag that
  collects repeated occurrences into an array.

```ts
import { arg, flag } from "@crustjs/validate";
import * as v from "valibot";

arg("files", v.array(v.string()), {
  type: "string",
  variadic: true,
});

flag(v.array(v.string()), {
  type: "string",
  multiple: true,
  short: "I",
  description: "Include path (repeatable)",
});
```

For Zod and Effect, explicit options still win silently over anything
the registry inferred — `type`, `required`, `description`, `multiple`,
and `variadic` are full overrides everywhere.

## Command validation

`commandValidator(handler)` returns a `run` function for the Crust
builder that:

1. Reads the Standard Schema attached to each `arg()`/`flag()` definition
   via the internal `[VALIDATED_SCHEMA]` brand.
2. Validates parsed CLI input against every schema (handles sync and
   `Promise`-returning `~standard.validate` transparently).
3. Calls `handler` with `ValidatedContext` containing the transformed
   values, or throws `CrustError("VALIDATION")` with normalized issues
   attached as `error.details.issues`.

**Strict mode**: every `arg`/`flag` must come from this package's `arg()`
/ `flag()` helpers. Mixing in a plain core def causes the handler
parameter to resolve to `never` at compile time.

## Prompt validation

```ts
import { promptValidator, parsePromptValue } from "@crustjs/validate";
import { z } from "zod";

const validate = promptValidator(z.email("Enter a valid email"));
//   ^? (input: unknown) => Promise<true | string>

const value = await parsePromptValue(z.email(), userInput);
//    ^? string  (throws CrustError("VALIDATION") on failure)
```

`promptValidator(schema, { errorStrategy })` accepts:

- `errorStrategy: "first"` (default) — single first-issue message
- `errorStrategy: "all"` — multi-line bullet list with every issue

## Store field validation

```ts
import { configDir, createStore } from "@crustjs/store";
import { field, fieldSync } from "@crustjs/validate";
import { z } from "zod";

const store = createStore({
  dirPath: configDir("my-cli"),
  fields: {
    theme: {
      type: "string",
      default: "light",
      validate: field(z.enum(["light", "dark"])),
    },
    port: {
      type: "number",
      default: 3000,
      validate: fieldSync(z.number().int().min(1)),
    },
  },
});
```

`field(schema)` is async-safe; `fieldSync(schema)` throws if the schema
returns a `Promise` (Zod's async refinements, for example).

## Validation errors

All failures normalize to `CrustError("VALIDATION")` with:

- A bullet-list message rendered from each issue's `path` and `message`.
- `error.details.issues: { path: string; message: string }[]` — the raw
  issues with dot-paths (e.g. `args[0].port`, `flags.verbose`).
- `error.cause` — the same array of issues, suitable for programmatic
  consumption.

## Migration: 0.0.x → 0.1.0

The change is a deprecation, not a breaking change. Existing imports
keep working through 1.0.0.

**Zod (recommended migration):**

```ts
// Before (still works, but logs @deprecated TSDoc warnings in IDEs)
import { arg, flag, commandValidator } from "@crustjs/validate/zod";

// After
import { arg, flag, commandValidator } from "@crustjs/validate";
```

Zod 4 schemas are Standard Schemas natively, so no other code changes are
needed.

**Effect (recommended migration):**

```ts
// Before — raw Effect schemas accepted directly
import { arg, flag, commandValidator } from "@crustjs/validate/effect";
import * as Schema from "effect/Schema";

arg("port", Schema.Number);

// After — wrap once, import from the root
import { arg, flag, commandValidator } from "@crustjs/validate";
import * as Schema from "effect/Schema";

arg("port", Schema.standardSchemaV1(Schema.Number));
```

Or define the 5-line `earg` / `eflag` helpers from the Quick Start above
and substitute them for the deprecated subpath calls 1:1.

**Other Standard Schema libraries** (Valibot, ArkType, Sury, …) didn't
have a subpath; they used `@crustjs/validate/standard` for prompt/store
helpers only. Same import-path swap as Zod:

```ts
// Before
import { promptValidator, field } from "@crustjs/validate/standard";

// After
import { promptValidator, field } from "@crustjs/validate";
```

### Behaviour intentionally removed in 0.1.0

The previous `arg()` / `flag()` introspection-conflict checks no longer
fire. Specifically, none of the following throw any more — explicit
options always win silently:

- `explicit type "X" conflicts with schema-inferred type "Y"`
- `explicit required: true conflicts with schema that accepts undefined`
- `explicit required: false conflicts with schema that does not accept undefined`

This simplifies the model: introspection fills in fields you didn't
specify; everything you did specify wins.

## Constraints

- **Effect peer-dep floor: `^3.14.2`.** Effect 3.14.0 and 3.14.1 shipped
  `standardSchemaV1` wrappers as plain objects with no `.ast`, so
  introspection of pre-wrapped Effect schemas falls through to `{}`.
  Effect 3.14.2 made the wrapper extend `Schema.make(schema.ast)`, which
  is what the introspection registry walks. The deprecated
  `@crustjs/validate/effect` subpath calls `standardSchemaV1` internally
  and is therefore subject to the same floor.

## See also

- [Standard Schema v1 spec](https://github.com/standard-schema/standard-schema)
- [`@crustjs/core`](../core/README.md) — the framework itself
- [`@crustjs/store`](../store/README.md) — config storage that consumes
  this package's `field()` validators
- [`@crustjs/prompts`](../prompts/README.md) — prompts that consume this
  package's `promptValidator()`
