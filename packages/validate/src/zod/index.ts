// ────────────────────────────────────────────────────────────────────────────
// @crustjs/validate/zod — Zod 4 schema-first mode for Crust CLI
// ────────────────────────────────────────────────────────────────────────────

// Schema-first command factory
export { defineZodCommand } from "./command.ts";

// Schema-first DSL helpers
export { arg, flag } from "./schema.ts";

// Public types
export type {
	ArgOptions,
	ArgSpec,
	ArgSpecs,
	FlagOptions,
	FlagShape,
	FlagSpec,
	InferArgsFromConfig,
	InferArgsFromSpecs,
	InferFlagsFromConfig,
	InferFlagsFromShape,
	InferSchemaOutput,
	ZodCommandDef,
	ZodCommandRunHandler,
	ZodSchemaLike,
} from "./types.ts";
