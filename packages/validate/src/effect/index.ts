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
// Store adapters — re-exported from standard
// Note: Effect schemas require wrapping with Schema.standardSchemaV1() before
// passing to storeValidator/storeValidatorSync.
export { storeValidator, storeValidatorSync } from "../standard/store.ts";
// Command validation middleware
export { commandValidator } from "./command.ts";
// Schema-first DSL helpers
export { arg, flag } from "./schema.ts";
// Public types
export type {
	ArgOptions,
	CommandValidatorHandler,
	EffectArgDef,
	EffectFlagDef,
	EffectSchemaLike,
	FlagOptions,
	InferSchemaOutput,
	InferValidatedArgs,
	InferValidatedFlags,
	ParserMeta,
} from "./types.ts";
