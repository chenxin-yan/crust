// ────────────────────────────────────────────────────────────────────────────
// @crustjs/validate/standard — Deprecated alias barrel (kept until 1.0.0)
// ────────────────────────────────────────────────────────────────────────────
//
// Pure re-export of the prompt and store helpers from the unified root
// entry point.
//
// **Migration:**
//
// ```ts
// // Before
// import { promptValidator, field } from "@crustjs/validate/standard";
//
// // After
// import { promptValidator, field } from "@crustjs/validate";
// ```
//
// This subpath will be removed in `@crustjs/validate@1.0.0`.

/**
 * @deprecated Since 0.1.0 — import from `@crustjs/validate` directly.
 * Will be removed in 1.0.0. See file-level header for migration.
 */
export type {
	InferInput,
	InferOutput,
	PromptErrorStrategy,
	PromptValidatorOptions,
	StandardSchema,
	ValidationResult,
} from "../index.ts";
/**
 * @deprecated Since 0.1.0 — import from `@crustjs/validate` directly.
 * Will be removed in 1.0.0.
 *
 * Migration:
 *
 * ```ts
 * // Before
 * import { promptValidator, field } from "@crustjs/validate/standard";
 *
 * // After
 * import { promptValidator, field } from "@crustjs/validate";
 * ```
 */
export {
	field,
	fieldSync,
	parsePromptValue,
	parsePromptValueSync,
	promptValidator,
} from "../index.ts";
