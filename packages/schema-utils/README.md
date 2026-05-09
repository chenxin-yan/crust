# @crustjs/schema-utils

Vendor-aware [Standard Schema v1](https://standardschema.dev/) introspection helpers shared across the Crust ecosystem.

> **⚠️ Pre-stability — version `0.0.1`.** The surface here is intended for
> framework authors and the other `@crustjs/*` packages. It is unstable until
> `0.1.0`. Pin an exact version if you depend on it directly. Most CLI authors
> should use [`@crustjs/validate`](https://www.npmjs.com/package/@crustjs/validate)
> or [`@crustjs/store`](https://www.npmjs.com/package/@crustjs/store), which
> consume this package internally.

`@crustjs/schema-utils` answers the question: *given any Standard Schema, what
does the rest of the framework need to know?* It dispatches on
`schema['~standard'].vendor` to recover metadata that the spec deliberately
leaves outside the portable surface — runtime defaults, descriptions, array
shape, optionality — and normalizes the issues a schema reports back into a
single shape that command middleware and store helpers can consume.

The vendor adapters today cover **Zod** and **Effect**. Schemas from other
libraries (Valibot, ArkType, Sury, …) still validate; introspection just
returns `{}` for them.

## Install

```sh
# bun
bun add @crustjs/schema-utils

# npm
npm install @crustjs/schema-utils
```

**Requirements:** Bun 1.x or Node 18+. TypeScript 5.x recommended.

## Helpers at a glance

The package exposes four small groups of helpers plus two reusable type aliases:

| Group        | Symbols                                                     | Use when…                                              |
| ------------ | ----------------------------------------------------------- | ------------------------------------------------------ |
| `introspect` | `inferOptions`, `extractDefault`                            | You need `type` / `array` / `description` / `default`. |
| `assertions` | `isStandardSchema`, `assertStandardSchema`                  | You need a boundary check on untrusted input.          |
| `issues`     | `normalizeStandardIssues`, `normalizeStandardPath`          | You're surfacing validation errors to a user.          |
| `types`      | `StandardSchema`, `InferOutput`                             | You need a portable type alias.                        |

## Examples

### Recover description and array shape

```ts
import { inferOptions } from "@crustjs/schema-utils";
import { z } from "zod";

const schema = z.array(z.string()).describe("input files");
const opts = inferOptions(schema, "arg", "files");
// → { type: "string", array: true, description: "input files" }
```

### Synchronously extract a default value

```ts
import { extractDefault } from "@crustjs/schema-utils";
import { z } from "zod";

const port = z.number().default(3000);
extractDefault(port);
// → { value: 3000 }

const free = z.string();
extractDefault(free);
// → undefined
```

`extractDefault` returns `undefined` when the schema has no statically
discoverable default. Effect schemas using `Schema.annotations({ default })`
are not extracted today; use `Schema.optionalWith({ default })` (or
`.default()` in Zod) to opt in.

### Normalize issues for display

```ts
import { normalizeStandardIssues } from "@crustjs/schema-utils";

const result = await schema["~standard"].validate(input);
if (result.issues) {
	const issues = normalizeStandardIssues(result.issues);
	// → [{ message, path }]
}
```

### Boundary assertion

```ts
import { assertStandardSchema } from "@crustjs/schema-utils";

assertStandardSchema(value, "options.schema");
// throws TypeError if value is not a StandardSchemaV1
```

## Primary consumers

- [`@crustjs/validate`](https://www.npmjs.com/package/@crustjs/validate) —
  consumes `inferOptions` / `extractDefault` to derive `arg` / `flag` / `field`
  metadata from any Standard Schema.
- [`@crustjs/store`](https://www.npmjs.com/package/@crustjs/store) — consumes
  the same helpers via `field()` to derive store-field defaults and types
  without forcing store users to import `@crustjs/validate`.

## License

MIT
