// ────────────────────────────────────────────────────────────────────────────
// @crustjs/validate/standard — Standard Schema-first validation core
// ────────────────────────────────────────────────────────────────────────────

// Types
export type {
	InferInput,
	InferOutput,
	StandardSchema,
	ValidationFailure,
	ValidationResult,
	ValidationSuccess,
} from "./types.ts";
// Type guard
// Schema execution
// Issue / path normalization
// Result constructors
export {
	failure,
	isStandardSchema,
	normalizeStandardIssues,
	normalizeStandardPath,
	success,
	validateStandard,
	validateStandardSync,
} from "./validate.ts";
