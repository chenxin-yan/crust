// ────────────────────────────────────────────────────────────────────────────
// @crustjs/validate — Single Standard Schema-first entry point
// ────────────────────────────────────────────────────────────────────────────
//
// Library-agnostic at the public boundary. Auto-introspection for Zod and
// Effect (via `Schema.standardSchemaV1(...)` wrappers, requires Effect ≥
// 3.14.2) is handled internally via vendor dispatch.
//
// Effect users wrap raw schemas with `Schema.standardSchemaV1(...)` once
// before passing them here. The previously deprecated `/zod`, `/effect`,
// and `/standard` subpaths were removed in 0.2.0 — there is now only the
// single root entry.

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
	FieldOptions,
	FlagDef$ as FlagDef,
	FlagOptions,
	InferValidatedArgs,
	InferValidatedFlags,
} from "./schema-types.ts";
// ── Store field factory ─────────────────────────────────────────────────────
export { field } from "./store.ts";
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
