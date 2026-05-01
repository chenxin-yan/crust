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

import type { ArgDef, FlagDef } from "../index.ts";
import type { StandardSchema } from "../types.ts";

// ── Legacy type aliases (pre-0.1.0) ─────────────────────────────────────────
// Older consumer code imported `ZodArgDef` / `ZodFlagDef` as the return types
// of the Zod-flavoured `arg()` / `flag()`. The runtime brand changed (from
// `[ZOD_SCHEMA]` to `[VALIDATED_SCHEMA]`), but the Crust-facing shape did
// not, so we alias both names to the unified `ArgDef` / `FlagDef`. Anyone
// reflecting the old `ZOD_SCHEMA` symbol must migrate; everyone else keeps
// compiling.

/**
 * @deprecated Since 0.1.0 — alias for `ArgDef` from `@crustjs/validate`.
 * Will be removed in 1.0.0.
 */
export type ZodArgDef<
	Name extends string = string,
	Schema extends StandardSchema = StandardSchema,
	Variadic extends true | undefined = true | undefined,
> = ArgDef<Name, Schema, Variadic>;

/**
 * @deprecated Since 0.1.0 — alias for `FlagDef` from `@crustjs/validate`.
 * Will be removed in 1.0.0.
 */
export type ZodFlagDef<
	Schema extends StandardSchema = StandardSchema,
	Short extends string | undefined = string | undefined,
	Aliases extends readonly string[] | undefined = readonly string[] | undefined,
	Inherit extends true | undefined = true | undefined,
> = FlagDef<Schema, Short, Aliases, Inherit>;
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
