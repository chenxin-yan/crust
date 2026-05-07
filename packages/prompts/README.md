# @crustjs/prompts

Interactive terminal prompts for the [Crust](https://crustjs.com) CLI framework.

`@crustjs/prompts` ships seven prompts (`input`, `password`, `confirm`, `select`, `multiselect`, `filter`, `multifilter`), a customizable theme, fuzzy matching, and a small renderer for building custom prompts. All prompt UI renders to **stderr** so it never pollutes piped stdout.

## Install

```sh
bun add @crustjs/prompts
```

## Quick start

```ts
import { input, password, confirm, select } from "@crustjs/prompts";

const name = await input({ message: "Project name?" });
const useTS = await confirm({ message: "Use TypeScript?" });
const fw = await select({
  message: "Framework",
  choices: ["react", "vue", "svelte"],
});
const secret = await password({
  message: "Enter password:",
  validate: (v) => v.length >= 8 || "Must be at least 8 characters",
});
```

Pass `initial` to skip interactivity (useful for prefilling from CLI flags or in CI). When stdin is not a TTY, `default` is returned automatically when set; otherwise a `NonInteractiveError` is thrown.

## Schema validation

The `validate` slot on `input()` and `password()` is **polymorphic**:

- a `(value: string) => true | string | Promise<true | string>` validator, or
- any [Standard Schema v1](https://standardschema.dev/) object (Zod 4, Valibot, Effect Schema's `Schema.standardSchemaV1(...)`, ArkType, …).

When a schema is supplied, the prompt parses the raw input on submit, renders the **first** issue's `message` inline on rejection, and resolves to the schema's transformed `Output` type on success — no second-pass parse step.

```ts
import { input } from "@crustjs/prompts";
import { z } from "zod";

const port = await input({
  message: "Port?",
  validate: z.coerce.number().int().min(1).max(65535),
});
//    ^? Promise<number>
```

```ts
import { input } from "@crustjs/prompts";
import { Schema } from "effect";

const Email = Schema.standardSchemaV1(
  Schema.String.pipe(Schema.pattern(/.+@.+/)),
);

const email = await input({ message: "Email?", validate: Email });
//    ^? Promise<string>
```

For command-level argument and flag validation against the same schemas, see [`@crustjs/validate`](https://crustjs.com/docs/modules/validate).

## More

- Full docs: [crustjs.com/docs/modules/prompts](https://crustjs.com/docs/modules/prompts)
- Source: [`packages/prompts/`](https://github.com/chenxin-yan/crust/tree/main/packages/prompts)
