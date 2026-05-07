---
"@crustjs/prompts": minor
---

# Standard Schema support on `input()` / `password()` validate slot

The `validate` option on `input()` and `password()` is now polymorphic. In addition to the existing `(value: string) => true | string` function shape, you can pass any [Standard Schema v1](https://standardschema.dev/) object directly (Zod 4, Valibot, Effect Schema's `Schema.standardSchemaV1(...)`, ArkType, …).

When a schema is supplied, the prompt:

1. Parses the raw input on submit by calling `schema['~standard'].validate(submitValue)`.
2. Renders the **first** issue's `message` inline on rejection (single line; falls back to `"Validation failed"` when the issue message is empty).
3. Resolves to the schema's **transformed output** type on success — no second-pass parse step.

```ts
import { input } from "@crustjs/prompts";
import { z } from "zod";

const port = await input({
  message: "Port?",
  validate: z.coerce.number().int().min(1),
});
//    ^? Promise<number>
```

This is a fully additive change: existing function-shape `validate` consumers see no behavior change. Only the `InputOptions` and `PasswordOptions` types pick up an extra type parameter (`InputOptions<Output = string>`), which defaults to `string` and is inferred from the shape of `validate` via function overloads.

The package gains `@standard-schema/spec` (~5 KB) as a regular dependency for the spec types and runtime guard. No schema library is bundled — `zod` is a devDependency for tests only.
