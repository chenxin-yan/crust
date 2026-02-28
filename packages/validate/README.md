# @crustjs/validate

> Experimental: API may change between minor versions.

Universal schema validation for the [Crust](https://crustjs.com) CLI framework — one schema, three targets.

Define validation schemas once using [Standard Schema](https://standardschema.dev)-compatible libraries (Zod, Effect, or any compliant provider), then use target-specific adapters for **command** args/flags, **prompt** answers, and **store** config — with consistent error behavior everywhere.

## Architecture

The validation platform is organized around a **Standard Schema-first** core:

```
┌──────────────────────────────────────────────────────┐
│  @crustjs/validate/standard                          │
│  Core: validateStandard(), issue normalization,       │
│        result contracts, target adapters              │
├────────────────────┬─────────────────────────────────┤
│  /zod              │  /effect                        │
│  arg(), flag(),    │  arg(), flag(),                 │
│  commandValidator()│  commandValidator()             │
│  + prompt/store    │  + prompt/store                 │
│    re-exports      │    re-exports                   │
└────────────────────┴─────────────────────────────────┘
```

- **`@crustjs/validate/standard`** — Provider-agnostic runtime: schema execution, issue normalization, prompt adapters, store adapters.
- **`@crustjs/validate/zod`** and **`@crustjs/validate/effect`** — Provider-specific command DSL (`arg`, `flag`, middleware) plus re-exported prompt and store adapters.
- **`@crustjs/validate`** — Shared type-only contracts (`ValidatedContext`, `ValidationIssue`).

## Target Matrix

| Target  | What it does                                  | Standard | Zod | Effect |
| ------- | --------------------------------------------- | :------: | :-: | :----: |
| Command | Validates args/flags via `commandValidator` middleware | —       | `arg`, `flag`, `commandValidator` | `arg`, `flag`, `commandValidator` |
| Prompt  | Validates interactive prompt input            | `promptValidator` | `promptValidator`¹ | `promptValidator`¹ |
| Prompt (parse) | Validates + returns typed output       | `parsePromptValue` | `parsePromptValue`¹ | `parsePromptValue`¹ |
| Store   | Validates config on read/write/update         | `storeValidator` | `storeValidator`¹ | `storeValidator`¹ |

¹ Re-exported from `standard` — accepts any Standard Schema. Effect schemas require `Schema.standardSchemaV1()` wrapping.

## Entry Points

| Entry            | Import                       | Purpose                                                        |
| ---------------- | ---------------------------- | -------------------------------------------------------------- |
| Shared contracts | `@crustjs/validate`          | Provider-agnostic types (`ValidatedContext`, `ValidationIssue`) |
| Standard core    | `@crustjs/validate/standard` | Universal validation runtime + prompt/store adapters           |
| Zod provider     | `@crustjs/validate/zod`      | `arg`, `flag`, `commandValidator` + prompt/store adapters      |
| Effect provider  | `@crustjs/validate/effect`   | `arg`, `flag`, `commandValidator` + prompt/store adapters      |

## Install

```sh
bun add @crustjs/validate

# choose one or both providers
bun add zod
bun add effect
```

## Command Validation

### Zod provider

```ts
import { defineCommand, runMain } from "@crustjs/core";
import { arg, flag, commandValidator } from "@crustjs/validate/zod";
import { z } from "zod";

const serve = defineCommand({
	meta: { name: "serve", description: "Start dev server" },
	args: [
		arg("port", z.number().int().min(1).max(65535).describe("Port to listen on")),
		arg("host", z.string().default("localhost").describe("Host to bind")),
	],
	flags: {
		verbose: flag(
			z.boolean().default(false).describe("Enable verbose logging"),
			{ alias: "v" },
		),
		format: flag(
			z.enum(["json", "text"]).default("text").describe("Output format"),
			{ alias: "f" },
		),
	},
	run: commandValidator(({ args, flags, input }) => {
		// args: { port: number; host: string }
		// flags: { verbose: boolean; format: "json" | "text" }
		console.log(args.port, args.host, flags.verbose, flags.format);
		console.log(input.args, input.flags); // original parser output
	}),
});

runMain(serve);
```

### Effect provider

```ts
import { defineCommand, runMain } from "@crustjs/core";
import { arg, flag, commandValidator } from "@crustjs/validate/effect";
import * as Schema from "effect/Schema";

const serve = defineCommand({
	meta: { name: "serve", description: "Start dev server" },
	args: [
		arg("port", Schema.Number.annotations({ description: "Port to listen on" })),
		arg("host", Schema.UndefinedOr(
			Schema.String.annotations({ description: "Host to bind" }),
		)),
	],
	flags: {
		verbose: flag(
			Schema.Boolean.annotations({ description: "Enable verbose logging" }),
			{ alias: "v" },
		),
		format: flag(
			Schema.Literal("json", "text").annotations({ description: "Output format" }),
			{ alias: "f" },
		),
	},
	run: commandValidator(({ args, flags, input }) => {
		// args: { port: number; host: string | undefined }
		// flags: { verbose: boolean; format: "json" | "text" }
		console.log(args.port, args.host, flags.verbose, flags.format);
		console.log(input.args, input.flags); // original parser output
	}),
});

runMain(serve);
```

### Schema support

**Zod:**
- Primitive schemas: `z.string()`, `z.number()`, `z.boolean()`
- Enums/literals: `z.enum(...)`, `z.literal(...)`
- Arrays: `z.array(...)` for variadic args or flags with `multiple: true`
- Wrappers: `.optional()`, `.default()`, `.nullable()`, `.transform()`, `.pipe()`
- Descriptions: `.describe("...")` — auto-extracted through wrappers

**Effect:**
- Primitive schemas: `Schema.String`, `Schema.Number`, `Schema.Boolean`
- Enums/literals: `Schema.Enums(...)`, `Schema.Literal(...)`
- Arrays: `Schema.Array(...)` and array-like tuple rest schemas
- Wrappers: refinement/transformation/suspend wrappers are unwrapped for parser-shape analysis
- Descriptions: `schema.annotations({ description: "..." })` — auto-extracted through wrappers
- For optional args/flags, use schemas whose encoded input allows `undefined` (e.g., `Schema.UndefinedOr(Schema.String)`)

### Positional args

Use ordered `arg(name, schema, options?)` entries.

- Optional/default schemas become optional CLI args (`[name]`).
- Variadic args use `{ variadic: true }` and must be last.

```ts
args: [
	arg("mode", z.string()),
	arg("files", z.string(), { variadic: true }),
];
```

### Flags

Use `flag(schema, options?)` to define flags.

- Use `flag(..., { alias })` for short aliases.
- Use `.describe("...")` (Zod) or `.annotations({ description: "..." })` (Effect) for help text.

```ts
flags: {
	debug: flag(z.boolean().default(false).describe("Enable debug mode")),
	outDir: flag(z.string().default("dist").describe("Output directory"), { alias: "o" }),
};
```

### Explicit parser metadata (`ParserMeta`)

When schema introspection cannot resolve the CLI type, description, or required status automatically (e.g., complex unions, opaque pipes), provide explicit overrides:

```ts
import { arg, flag } from "@crustjs/validate/zod";
import { z } from "zod";

// Explicit type override for ambiguous schema
arg("input", complexSchema, { type: "string", description: "Input file path" });

// Explicit required override
flag(z.string().optional(), { required: false, description: "API key" });
```

**Precedence rules:**
- `type` and `required`: Explicit value takes priority. If both explicit and inferred values exist and **conflict**, a `DEFINITION` error is thrown to prevent stale metadata.
- `description`: Explicit always wins without conflict checks (descriptions are additive).

Both Zod and Effect providers export `ParserMeta`, `ArgOptions`, and `FlagOptions` types.

### Strict mode

When using `commandValidator()`, **all** args and flags must be created
with the matching provider's `arg()` / `flag()` helpers. Mixing plain core
definitions causes a compile-time error (handler parameter becomes `never`).

Plugin-injected flags (e.g., `--help` from `helpPlugin`) are silently skipped at
runtime — they don't need schema metadata.

### Help plugin compatibility

Generated definitions are compatible with `helpPlugin`.

```ts
import { runMain } from "@crustjs/core";
import { helpPlugin } from "@crustjs/plugins";

runMain(serve, { plugins: [helpPlugin()] });
```

## Prompt Validation

### Prompt validator

Use `promptValidator()` to create a validation function compatible with `@crustjs/prompts`:

```ts
import { z } from "zod";
import { promptValidator } from "@crustjs/validate/zod";
import { input } from "@crustjs/prompts";

const name = await input({
	message: "Enter your name",
	validate: promptValidator(z.string().min(1, "Name is required")),
});
```

Returns `true` on valid input, a `string` error message on invalid input. Always async.

#### Error strategies

```ts
// Default: "first" — shows only the first issue
promptValidator(schema);
promptValidator(schema, { errorStrategy: "first" });

// Show all issues as a bullet list
promptValidator(schema, { errorStrategy: "all" });
```

### Typed prompt parsing

After a prompt resolves, use `parsePromptValue()` to validate and get a typed output:

```ts
import { z } from "zod";
import { parsePromptValue, promptValidator } from "@crustjs/validate/zod";
import { input } from "@crustjs/prompts";

const raw = await input({
	message: "Enter port",
	validate: promptValidator(z.coerce.number().int().positive()),
});

// Parse and get typed output — coerced from string to number
const port = await parsePromptValue(z.coerce.number().int().positive(), raw);
// port: number
```

`parsePromptValueSync()` is available for synchronous schemas (throws `TypeError` on async schemas).

On failure, both throw `CrustError("VALIDATION")` with structured issues.

### Effect schemas with prompt adapters

Effect schemas must be wrapped with `Schema.standardSchemaV1()`:

```ts
import * as Schema from "effect/Schema";
import { promptValidator, parsePromptValue } from "@crustjs/validate/effect";

const schema = Schema.standardSchemaV1(Schema.String.pipe(Schema.minLength(1)));

const validate = promptValidator(schema);
const parsed = await parsePromptValue(schema, rawValue);
```

## Store Validation

Use `storeValidator()` to add schema validation to `@crustjs/store`:

```ts
import { z } from "zod";
import { storeValidator } from "@crustjs/validate/zod";
import { createStore, configDir } from "@crustjs/store";

const configSchema = z.object({
	theme: z.enum(["light", "dark"]),
	verbose: z.boolean(),
});

const store = createStore({
	dirPath: configDir("my-cli"),
	fields: {
		theme: { type: "string", default: "light" },
		verbose: { type: "boolean", default: false },
	},
	validator: storeValidator(configSchema),
});
```

When a validator is configured, validation is **strict by default** — invalid config causes a `CrustStoreError("VALIDATION")` on read, write, and update operations.

`storeValidatorSync()` is available for synchronous schemas.

### Effect schemas with store adapters

```ts
import * as Schema from "effect/Schema";
import { storeValidator } from "@crustjs/validate/effect";

const schema = Schema.standardSchemaV1(
	Schema.Struct({
		theme: Schema.Literal("light", "dark"),
		verbose: Schema.Boolean,
	}),
);

const store = createStore({
	dirPath: configDir("my-cli"),
	fields: { /* ... */ },
	validator: storeValidator(schema),
});
```

### Standard Schema directly

Any Standard Schema-compatible library works with the standard entrypoint:

```ts
import { storeValidator, promptValidator } from "@crustjs/validate/standard";

// Works with any library implementing Standard Schema v1
const validate = promptValidator(anyStandardSchema);
const storeVal = storeValidator(anyStandardSchema);
```

## Validation Errors

All validation failures use consistent error behavior across targets:

| Target  | Error type                      | Code           | Trigger                          |
| ------- | ------------------------------- | -------------- | -------------------------------- |
| Command | `CrustError("VALIDATION")`     | `"VALIDATION"` | Invalid args or flags            |
| Prompt  | `CrustError("VALIDATION")`     | `"VALIDATION"` | `parsePromptValue` failure       |
| Store   | `CrustStoreError("VALIDATION")`| `"VALIDATION"` | Invalid config on read/write/update |

- **Message**: Bullet-list output with dot paths (e.g., `args.port`, `flags.verbose`, `theme`).
- **Structured issues**: Available on `error.details.issues` and `error.cause`.
- **Prompt validator**: Returns `string` error message (not thrown) for prompt integration.

## Types

### Shared types (`@crustjs/validate`)

```ts
import type { ValidatedContext, ValidationIssue } from "@crustjs/validate";
```

### Standard types (`@crustjs/validate/standard`)

```ts
import type {
	StandardSchema,
	InferInput,
	InferOutput,
	ValidationResult,
	ValidationSuccess,
	ValidationFailure,
	PromptErrorStrategy,
	PromptValidatorOptions,
} from "@crustjs/validate/standard";
```

### Zod types (`@crustjs/validate/zod`)

```ts
import type {
	ZodSchemaLike,
	ZodArgDef,
	ZodFlagDef,
	ArgOptions,
	FlagOptions,
	ParserMeta,
	InferSchemaOutput,
	InferValidatedArgs,
	InferValidatedFlags,
	CommandValidatorHandler,
	PromptErrorStrategy,
	PromptValidatorOptions,
} from "@crustjs/validate/zod";
```

### Effect types (`@crustjs/validate/effect`)

```ts
import type {
	EffectSchemaLike,
	EffectArgDef,
	EffectFlagDef,
	ArgOptions,
	FlagOptions,
	ParserMeta,
	InferSchemaOutput,
	InferValidatedArgs,
	InferValidatedFlags,
	CommandValidatorHandler,
	PromptErrorStrategy,
	PromptValidatorOptions,
} from "@crustjs/validate/effect";
```

## Constraints

- Zod mode requires Zod 4+.
- Effect schemas need `Schema.standardSchemaV1()` wrapping for prompt and store adapters.
- No automatic schema inheritance across subcommands.
- Command validation uses provider-specific DSL; prompt and store targets use the universal Standard Schema contract.
