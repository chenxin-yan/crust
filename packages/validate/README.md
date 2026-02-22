# @crustjs/validate

> Experimental: API may change between minor versions.

Validation support for the [Crust](https://crustjs.com) CLI framework.

## Entry points

| Entry | Import | Purpose |
| --- | --- | --- |
| Shared contracts | `@crustjs/validate` | Provider-agnostic types (`ValidatedContext`, `ValidationIssue`) |
| Effect provider | `@crustjs/validate/effect` | Schema-first command API (`defineEffectCommand`, `arg`, `flag`) |
| Zod provider | `@crustjs/validate/zod` | Schema-first command API (`defineZodCommand`, `arg`, `flag`) |

## Install

```sh
bun add @crustjs/validate

# choose one or both providers
bun add zod
bun add effect
```

## Effect schema-first mode (`defineEffectCommand`)

Define schemas once and let Crust `args`/`flags` definitions be generated automatically.

```ts
import { runMain } from "@crustjs/core";
import {
	arg,
	defineEffectCommand,
	flag,
} from "@crustjs/validate/effect";
import * as Schema from "effect/Schema";

const serve = defineEffectCommand({
	meta: { name: "serve", description: "Start dev server" },
	args: [
		arg("port", Schema.Number, { description: "Port to listen on" }),
		arg("host", Schema.UndefinedOr(Schema.String), {
			description: "Host to bind",
		}),
	],
	flags: {
		verbose: flag(Schema.Boolean, {
			alias: "v",
			description: "Enable verbose logging",
		}),
		format: flag(Schema.Literal("json", "text"), {
			alias: "f",
			description: "Output format",
		}),
	},
	run({ args, flags, input }) {
		// args: { port: number; host: string | undefined }
		// flags: { verbose: boolean; format: "json" | "text" }
		console.log(args.port, args.host, flags.verbose, flags.format);
		console.log(input.args, input.flags); // original parser output
	},
});

runMain(serve);
```

### Effect schema support

- Primitive schemas: `Schema.String`, `Schema.Number`, `Schema.Boolean`
- Enums/literals: `Schema.Enums(...)`, `Schema.Literal(...)`
- Arrays: `Schema.Array(...)` and array-like tuple rest schemas
- Wrappers: refinement/transformation/suspend wrappers are unwrapped for parser-shape analysis

For optional args/flags, use schemas whose encoded input allows `undefined` (for example `Schema.UndefinedOr(Schema.String)`).

## Zod schema-first mode (`defineZodCommand`)

Define schemas once and let Crust `args`/`flags` definitions be generated automatically.

```ts
import { runMain } from "@crustjs/core";
import { arg, defineZodCommand, flag } from "@crustjs/validate/zod";
import { z } from "zod";

const serve = defineZodCommand({
	meta: { name: "serve", description: "Start dev server" },
	args: [
		arg("port", z.number().int().min(1).max(65535), {
			description: "Port to listen on",
		}),
		arg("host", z.string().default("localhost"), {
			description: "Host to bind",
		}),
	],
	flags: {
		verbose: flag(z.boolean().default(false), {
			alias: "v",
			description: "Enable verbose logging",
		}),
		format: flag(z.enum(["json", "text"]).default("text"), {
			alias: "f",
			description: "Output format",
		}),
	},
	run({ args, flags, input }) {
		// args: { port: number; host: string }
		// flags: { verbose: boolean; format: "json" | "text" }
		console.log(args.port, args.host, flags.verbose, flags.format);
		console.log(input.args, input.flags); // original parser output
	},
});

runMain(serve);
```

### Positional args

- Use ordered `arg(name, schema, options?)` entries.
- Optional/default schemas become optional CLI args (`[name]`).
- Variadic args use `{ variadic: true }` and must be last.

```ts
args: [
	arg("mode", z.string()),
	arg("files", z.string(), { variadic: true }),
];
```

### Flags

- Pass plain Zod schemas or `flag(schema, options?)` wrappers.
- Use `flag(..., { alias, description })` for CLI metadata.

```ts
flags: {
	debug: z.boolean().default(false),
	outDir: flag(z.string().default("dist"), { alias: "o" }),
};
```

### Help plugin compatibility

Generated definitions are compatible with `helpPlugin`.

```ts
import { runMain } from "@crustjs/core";
import { helpPlugin } from "@crustjs/plugins";

runMain(serve, { plugins: [helpPlugin()] });
```

### Lifecycle hooks

`defineZodCommand` supports `preRun` and `postRun` passthrough hooks.

- Both hooks receive the core `CommandContext` (raw parser output).
- Schema validation/transforms run inside `run`, so validated values are only
  available in the schema-first `run` handler.

## Validation errors

Failures throw `CrustError("VALIDATION")`.

- Message: bullet-list output with dot paths (for example `args.port`, `flags.verbose`).
- Structured issues: available on both `error.details.issues` and `error.cause`.

## v1 constraints

- Args and flags only (no env/config validation).
- Effect mode currently supports context-free schemas only (`R = never`).
- Zod mode requires Zod 4+.
- No automatic schema inheritance across subcommands.
