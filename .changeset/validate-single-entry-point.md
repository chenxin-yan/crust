---
"@crustjs/validate": minor
---

# Single Standard Schema entry point + vendor-dispatch introspection

`@crustjs/validate` now exposes one root API. Pass any
[Standard Schema v1](https://standardschema.dev/) object — Zod, Effect,
Valibot, ArkType, Sury, anything else — and the package introspects
what it can (Zod and Effect natively, via vendor dispatch) and validates
arguments, flags, prompts, and store fields against your schema.

## What's new

- **Single entry point**: `arg`, `flag`, `commandValidator`,
  `promptValidator`, `field`, and friends are all importable from
  `@crustjs/validate` directly. No more guessing which subpath to use.
- **Vendor-dispatch introspection registry**: the new internal
  `inferOptions(schema)` reads `schema["~standard"].vendor` and routes
  to per-library adapters, preserving the auto-`type` /
  auto-`required` / auto-`description` behaviour for Zod and Effect
  through one code path.
- **Library-agnostic defaults**: any Standard Schema vendor works for
  `commandValidator()`/`arg()`/`flag()` — supply explicit `type:` (and
  `required:` / `description:`) for vendors the registry can't
  introspect.

## What changed (deprecation, not breaking)

The `/zod`, `/effect`, and `/standard` subpath exports are now
`@deprecated` aliases that re-export from the root. Existing imports
keep working through the entire 0.x cycle. They are removed in 1.0.0.

Migrate your imports at your leisure:

```ts
// Before
import { arg, flag, commandValidator } from "@crustjs/validate/zod";
// After
import { arg, flag, commandValidator } from "@crustjs/validate";
```

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

The `/effect` subpath retains an internal auto-wrap shim until 1.0.0,
so existing Effect-based code keeps working unchanged on the deprecated
path. The new root API requires you to wrap with
`Schema.standardSchemaV1(...)` yourself (or use the 5-line
`earg`/`eflag` recipe from the README).

Legacy type aliases `ZodArgDef`, `ZodFlagDef`, `EffectArgDef`, and
`EffectFlagDef` continue to be exported from `/zod` and `/effect` as
`@deprecated` re-aliases of the unified `ArgDef` / `FlagDef`. Code that
imports those names as types keeps compiling on the deprecated
subpaths until 1.0.0. Anyone reflecting on the legacy `ZOD_SCHEMA` /
`EFFECT_SCHEMA` runtime symbols must migrate to the new
`VALIDATED_SCHEMA` brand.

## Effect peer-dep floor: `^3.14.2`

The introspection registry walks `.ast` off
`Schema.standardSchemaV1(...)` wrappers. PR #4648 (released in Effect
3.14.0) added `standardSchemaV1` itself, but the wrapper kept returning
a plain object; only Effect 3.14.2 made it extend
`Schema.make(schema.ast)`, which exposes `.ast`. Effect 3.14.0 and
3.14.1 silently fall through to `{}` introspection, so the peer-dep
floor is `^3.14.2`. The deprecated `@crustjs/validate/effect` subpath
calls `standardSchemaV1` internally and is subject to the same floor.

## Behaviour intentionally removed

The `arg()` / `flag()` introspection-conflict checks no longer fire.
Specifically, none of the following throw any more — explicit options
always win silently:

- `explicit type "X" conflicts with schema-inferred type "Y"`
- `explicit required: true conflicts with schema that accepts undefined`
- `explicit required: false conflicts with schema that does not accept undefined`

This simplifies the model: introspection fills in fields you didn't
specify; everything you did specify wins.

## Why

A single, library-agnostic public surface lowers friction for non-Zod
and non-Effect Standard Schema users (Valibot, ArkType, Sury, …) and
removes a layer of indirection from the import graph. Vendor-specific
introspection now lives in one internal registry instead of being
duplicated across separate barrels.
