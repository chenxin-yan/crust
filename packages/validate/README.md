# @crustjs/validate

> Experimental: API may change between minor versions.

Validation helpers for the [Crust](https://crustjs.com) CLI framework.

## Modes

| Mode | Import | Best for |
| --- | --- | --- |
| Generic Standard Schema | `@crustjs/validate` | Add validation to existing `defineCommand` commands |
| Zod schema-first | `@crustjs/validate/zod` | New commands where schemas are the source of truth |

## Install

```sh
bun add @crustjs/validate
```

For Zod schema-first mode:

```sh
bun add zod
```

## Generic mode (`withValidation`)

Use this when you already have command `args`/`flags` definitions and only want to add validation.

```ts
import { defineCommand } from "@crustjs/core";
import { withValidation } from "@crustjs/validate";
import { z } from "zod";

const base = defineCommand({
	meta: { name: "serve" },
	args: [{ name: "port", type: "number" }],
	flags: { host: { type: "string", default: "localhost" } },
});

export const serve = withValidation({
	command: base,
	schemas: {
		args: z.object({ port: z.number().min(1).max(65535) }),
		flags: z.object({ host: z.string().min(1) }),
	},
	run({ args, flags, input }) {
		console.log(args.port, flags.host);
		console.log(input.args, input.flags); // original parser output
	},
});
```

## Zod schema-first mode (`defineZodCommand`)

This is the DX-first API. You define schemas once and Crust `args`/`flags` are generated automatically.

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

- Pass plain schemas or `flag(schema, options?)` wrappers.
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

## Validation errors

Failures throw `CrustError("VALIDATION")`.

- Message: bullet-list output with dot paths (for example `args.port`, `flags.verbose`).
- Structured issues: available on both `error.details.issues` and `error.cause`.

## v1 constraints

- Args and flags only (no env/config validation).
- Sync validation only (async validators are rejected).
- Zod mode requires Zod 4+.
- No automatic schema inheritance across subcommands.
