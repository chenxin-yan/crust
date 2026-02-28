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
// Store field adapters — re-exported from standard (Zod v4 implements Standard Schema natively)
export { field, fieldSync } from "../standard/store.ts";
// Command validation middleware
export { commandValidator } from "./command.ts";
// Schema-first DSL helpers
export { arg, flag } from "./schema.ts";
// Public types
export type {
	CommandValidatorHandler,
	InferValidatedArgs,
	InferValidatedFlags,
	ZodArgDef,
	ZodFlagDef,
} from "./types.ts";
