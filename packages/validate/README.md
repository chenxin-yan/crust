# @crustjs/validate

> Experimental: API may change between minor versions.

Validation support for the [Crust](https://crustjs.com) CLI framework.

## Entry points

| Entry | Import | Purpose |
| --- | --- | --- |
| Shared contracts | `@crustjs/validate` | Provider-agnostic types (`ValidatedContext`, `ValidationIssue`) |
| Zod provider | `@crustjs/validate/zod` | Schema-first command API (`defineZodCommand`, `arg`, `flag`) |

## Install

```sh
bun add @crustjs/validate zod
```

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
- Zod mode requires Zod 4+.
- No automatic schema inheritance across subcommands.
