// ────────────────────────────────────────────────────────────────────────────
// @crustjs/validate/zod — Deprecated alias barrel (kept until 1.0.0)
// ────────────────────────────────────────────────────────────────────────────
//
// Pure re-export of the unified API from `@crustjs/validate`. Zod v4 schemas
// are Standard Schemas natively, so no shim is required — every export here
// is the same function/type as the corresponding root-entry export.
//
// **Migration (Zod):**
//
// ```ts
// // Before
// import { arg, flag, commandValidator } from "@crustjs/validate/zod";
//
// // After
// import { arg, flag, commandValidator } from "@crustjs/validate";
// ```
//
// No other code changes needed — Zod 4 schemas implement Standard Schema v1
// natively and continue to be introspected for `type`, `required`, `default`,
// and `description`.
//
// This subpath will be removed in `@crustjs/validate@1.0.0`.

/**
 * @deprecated Since 0.1.0 — import from `@crustjs/validate` directly.
 * Will be removed in 1.0.0. See file-level header for migration.
 */
export type {
	ArgDef,
	ArgOptions,
	CommandValidatorHandler,
	FlagDef,
	FlagOptions,
	InferValidatedArgs,
	InferValidatedFlags,
	PromptErrorStrategy,
	PromptValidatorOptions,
} from "../index.ts";
/**
 * @deprecated Since 0.1.0 — import from `@crustjs/validate` directly.
 * Will be removed in 1.0.0.
 *
 * Migration:
 *
 * ```ts
 * // Before
 * import { arg, flag, commandValidator } from "@crustjs/validate/zod";
 *
 * // After
 * import { arg, flag, commandValidator } from "@crustjs/validate";
 * ```
 */
export {
	arg,
	commandValidator,
	field,
	fieldSync,
	flag,
	parsePromptValue,
	parsePromptValueSync,
	promptValidator,
} from "../index.ts";
