// ────────────────────────────────────────────────────────────────────────────
// @crustjs/validate/zod — Zod schema-validated run middleware for Crust CLI
// ────────────────────────────────────────────────────────────────────────────

// Schema-first DSL helpers
export { arg, flag } from "./schema.ts";
// Public types
export type {
	ArgOptions,
	FlagOptions,
	InferSchemaOutput,
	InferValidatedArgs,
	InferValidatedFlags,
	WithZodHandler,
	ZodArgDef,
	ZodFlagDef,
	ZodSchemaLike,
} from "./types.ts";
// Validated run middleware
export { withZod } from "./withZod.ts";
