// ────────────────────────────────────────────────────────────────────────────
// @crustjs/validate — Single Standard Schema-first entry point
// ────────────────────────────────────────────────────────────────────────────
//
// Library-agnostic at the public boundary. Crust uses only Standard Schema's
// validate function at runtime and schema output types for inference.
//
// Effect users wrap raw schemas with `Schema.standardSchemaV1(...)` once
// before passing them here. The previously deprecated `/zod`, `/effect`,
// and `/standard` subpaths were removed in 0.2.0 — there is now only the
// single root entry. Store-field construction (`field()`) lives in
// `@crustjs/store` as of 0.3.0.

// ── Command DSL ─────────────────────────────────────────────────────────────
export { commandValidator } from "./command.ts";
// ── Typed parsing helper ────────────────────────────────────────────────────
export { parseValue } from "./parse.ts";
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
export type {
	InferInput,
	InferOutput,
	StandardSchema,
	ValidatedContext,
	ValidationIssue,
	ValidationResult,
} from "./types.ts";
// ── Standard Schema execution helpers ───────────────────────────────────────
export { isStandardSchema, validateStandard, validateStandardSync } from "./validate.ts";
