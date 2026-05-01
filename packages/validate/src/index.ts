// ────────────────────────────────────────────────────────────────────────────
// @crustjs/validate — Single Standard Schema-first entry point
// ────────────────────────────────────────────────────────────────────────────
//
// Library-agnostic at the public boundary. Auto-introspection for Zod and
// Effect (via `Schema.standardSchemaV1(...)` wrappers, requires Effect ≥
// 3.14.2) is handled internally via vendor dispatch.
//
// Effect users must wrap raw schemas before passing them here. The
// `@crustjs/validate/effect` deprecated alias preserves the auto-wrap shim
// until 1.0.0.

// ── Command DSL ─────────────────────────────────────────────────────────────
export { commandValidator } from "./command.ts";
// ── Prompt adapters ─────────────────────────────────────────────────────────
export type {
	PromptErrorStrategy,
	PromptValidatorOptions,
} from "./prompt.ts";
export {
	parsePromptValue,
	parsePromptValueSync,
	promptValidator,
} from "./prompt.ts";
export { arg, flag } from "./schema.ts";
// ── Public types ────────────────────────────────────────────────────────────
export type {
	ArgDef$ as ArgDef,
	ArgOptions,
	CommandValidatorHandler,
	FlagDef$ as FlagDef,
	FlagOptions,
	InferValidatedArgs,
	InferValidatedFlags,
} from "./schema-types.ts";
// ── Store field adapters ────────────────────────────────────────────────────
export { field, fieldSync } from "./store.ts";
export type {
	InferInput,
	InferOutput,
	StandardSchema,
	ValidatedContext,
	ValidationIssue,
	ValidationResult,
} from "./types.ts";
// ── Standard Schema execution helpers ───────────────────────────────────────
export {
	isStandardSchema,
	validateStandard,
	validateStandardSync,
} from "./validate.ts";
