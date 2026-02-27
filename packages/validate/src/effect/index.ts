// ────────────────────────────────────────────────────────────────────────────
// @crustjs/validate/effect — Effect schema-validated run middleware for Crust CLI
// ────────────────────────────────────────────────────────────────────────────

// Prompt adapters — re-exported from standard
// Note: Effect schemas require wrapping with Schema.standardSchemaV1() before
// passing to these functions. Zod schemas work directly.
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
	EffectArgDef,
	EffectFlagDef,
	EffectSchemaLike,
	FlagOptions,
	InferSchemaOutput,
	InferValidatedArgs,
	InferValidatedFlags,
	WithEffectHandler,
} from "./types.ts";
// Validated run middleware
export { withEffect } from "./withEffect.ts";
