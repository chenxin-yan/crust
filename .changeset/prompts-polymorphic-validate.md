---
"@crustjs/prompts": minor
---

# Standard Schema support on `input()` / `password()` validate slot

The `validate` option on `input()` and `password()` is now polymorphic. In addition to the existing function shape — `(value: string) => true | string | Promise<true | string>` — you can pass any [Standard Schema v1](https://standardschema.dev/) object directly (Zod 4, Valibot, Effect Schema's `Schema.standardSchemaV1(...)`, ArkType, …).

When a schema is supplied, the prompt:

1. Parses the raw input on submit by `await`ing `schema['~standard'].validate(submitValue)` (so async schemas like Zod's `refine(async ...)` are supported).
2. Renders the **first** issue's `message` inline on rejection, falling back to `"Validation failed"` when the issue message is empty.
3. Resolves to the schema's **transformed output** type on success — no second-pass parse step.
4. Routes `initial` and (for `input()`) non-TTY `default` through the schema as well, so the `Promise<Output>` type contract holds across every short-circuit path. A short-circuit value the schema rejects throws an `Error`.

```ts
import { input } from "@crustjs/prompts";
import { z } from "zod";

const port = await input({
  message: "Port?",
  validate: z.coerce.number().int().min(1),
});
//    ^? number
```

This is a fully additive change for function-validator consumers: existing function-shape `validate` calls see no behavior change. `InputOptions` and `PasswordOptions` pick up an extra type parameter (`InputOptions<Output = string>`) which defaults to `string` and is inferred from the shape of `validate` via function overloads.

The package gains `@standard-schema/spec` as a regular dependency for the spec types only; the runtime discriminator that branches on the `~standard` property is local code. No schema library is bundled — `zod` is a devDependency for tests only.
