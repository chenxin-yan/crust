// ────────────────────────────────────────────────────────────────────────────
// @crustjs/validate/zod — Zod schema-validated run middleware for Crust CLI
// ────────────────────────────────────────────────────────────────────────────

// Prompt adapters — re-exported from standard (Zod v4 implements Standard Schema natively)
export type {
	PromptErrorStrategy,
	PromptValidatorOptions,
} from "../standard/prompt.ts";
export {
	parsePromptValue,
	parsePromptValueSync,
	promptValidator,
} from "../standard/prompt.ts";
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
