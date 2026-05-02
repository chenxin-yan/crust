// ────────────────────────────────────────────────────────────────────────────
// @crustjs/validate/effect — Deprecated alias + auto-wrap shim (kept until 1.0.0)
// ────────────────────────────────────────────────────────────────────────────
//
// Re-exports the unified API from the root entry point. The local
// `arg`/`flag`/`commandValidator` shims accept raw Effect schemas (detected
// via `Schema.isSchema()`) and wrap them with `Schema.standardSchemaV1()`
// before delegating to the root API. This preserves the pre-0.1.0 contract
// so existing Effect-based code keeps working through the entire 0.x cycle.
//
// **Migration (Effect):**
//
// ```ts
// // Before — raw Effect schemas accepted directly
// import { arg, flag, commandValidator } from "@crustjs/validate/effect";
// import * as Schema from "effect/Schema";
//
// arg("port", Schema.Number);
//
// // After — wrap once with Schema.standardSchemaV1(...) and import from the root
// import { arg, flag, commandValidator } from "@crustjs/validate";
// import * as Schema from "effect/Schema";
//
// arg("port", Schema.standardSchemaV1(Schema.Number));
// ```
//
// Or copy the type-precise `earg`/`eflag` recipe from the README. The
// short `as never` form loses Effect output types in handlers; the
// generic shape preserves them. See `packages/validate/README.md` for
// the full snippet.
//
// This subpath will be removed in `@crustjs/validate@1.0.0`.

import type { ArgsDef, CrustCommandContext, FlagsDef } from "@crustjs/core";
import type * as schema from "effect/Schema";
import { isSchema, standardSchemaV1 } from "effect/Schema";
import {
	type ArgDef,
	type ArgOptions,
	type CommandValidatorHandler,
	type FlagDef,
	type FlagOptions,
	arg as rootArg,
	commandValidator as rootCommandValidator,
	flag as rootFlag,
} from "../index.ts";
import type { StandardSchema } from "../types.ts";

// ── Pure re-exports ─────────────────────────────────────────────────────────
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
 * Will be removed in 1.0.0. These helpers already require manual wrapping
 * via `Schema.standardSchemaV1(...)`, so migrating only changes the import
 * path.
 */
export {
	field,
	fieldSync,
	parsePromptValue,
	parsePromptValueSync,
	promptValidator,
} from "../index.ts";

// ────────────────────────────────────────────────────────────────────────────
// Type-level value-type resolution from raw Effect schemas
// ────────────────────────────────────────────────────────────────────────────

type ValueType = "string" | "number" | "boolean";

type StripUndefined<T> = Exclude<T, undefined>;

type PrimitiveToValueType<T> = [T] extends [string]
	? "string"
	: [T] extends [number]
		? "number"
		: [T] extends [boolean]
			? "boolean"
			: ValueType;

type ResolveEffectValueType<S> =
	S extends schema.Schema<infer _A, infer I, infer _R>
		? PrimitiveToValueType<StripUndefined<I>>
		: ValueType;

// Effect's `Schema.standardSchemaV1(s)` returns `StandardSchemaV1<I, A>`
// (input = encoded type `I`, output = parsed type `A`). Map raw Effect
// schemas to that Standard Schema view so `InferValidatedArgs` /
// `InferValidatedFlags` see the schema's output type instead of `unknown`.
type EffectAsStandardSchema<S> =
	S extends schema.Schema<infer A, infer I, infer _R>
		? StandardSchema<I, A>
		: StandardSchema;

/**
 * @deprecated Since 0.1.0 — the return type of the legacy Effect-flavoured
 * `arg()`. Will be removed in 1.0.0; switch to `ArgDef` from
 * `@crustjs/validate` and wrap raw Effect schemas with
 * `Schema.standardSchemaV1(...)`.
 */
export type EffectArgDef<
	Name extends string = string,
	S extends schema.Schema.AnyNoContext = schema.Schema.AnyNoContext,
	Variadic extends true | undefined = true | undefined,
	Type extends ValueType = ResolveEffectValueType<S>,
> = ArgDef<Name, EffectAsStandardSchema<S>, Variadic, Type>;

/**
 * @deprecated Since 0.1.0 — the return type of the legacy Effect-flavoured
 * `flag()`. Will be removed in 1.0.0; switch to `FlagDef` from
 * `@crustjs/validate` and wrap raw Effect schemas with
 * `Schema.standardSchemaV1(...)`.
 */
export type EffectFlagDef<
	S extends schema.Schema.AnyNoContext = schema.Schema.AnyNoContext,
	Short extends string | undefined = string | undefined,
	Aliases extends readonly string[] | undefined = readonly string[] | undefined,
	Inherit extends true | undefined = true | undefined,
	Type extends ValueType = ResolveEffectValueType<S>,
> = FlagDef<EffectAsStandardSchema<S>, Short, Aliases, Inherit, Type>;

// ────────────────────────────────────────────────────────────────────────────
// Auto-wrap shim — accept raw Effect schemas
// ────────────────────────────────────────────────────────────────────────────

/**
 * Wrap a raw Effect schema with `Schema.standardSchemaV1(...)` so the root
 * introspection registry can read its `.ast`. Pass-through for values that
 * are already Standard Schemas.
 */
function ensureStandardSchema(value: unknown): StandardSchema {
	if (isSchema(value)) {
		return standardSchemaV1(
			value as Parameters<typeof standardSchemaV1>[0],
		) as StandardSchema;
	}
	return value as StandardSchema;
}

/**
 * Define a positional argument from an Effect schema (raw or wrapped).
 *
 * Raw Effect schemas are auto-wrapped via `Schema.standardSchemaV1(...)` for
 * backwards compatibility with pre-0.1.0 imports.
 *
 * @deprecated Since 0.1.0 — import `arg` from `@crustjs/validate` and wrap
 * Effect schemas with `Schema.standardSchemaV1(...)` yourself. Will be removed
 * in 1.0.0. See file-level header for migration recipes.
 */
export function arg<
	Name extends string,
	S extends schema.Schema.AnyNoContext,
	const Variadic extends true | undefined = undefined,
>(
	name: Name,
	schemaArg: S,
	options?: ArgOptions & { variadic?: Variadic },
): EffectArgDef<Name, S, Variadic> {
	return rootArg(
		name,
		ensureStandardSchema(schemaArg),
		options,
	) as unknown as EffectArgDef<Name, S, Variadic>;
}

/**
 * Define a flag from an Effect schema (raw or wrapped).
 *
 * Raw Effect schemas are auto-wrapped via `Schema.standardSchemaV1(...)` for
 * backwards compatibility with pre-0.1.0 imports.
 *
 * @deprecated Since 0.1.0 — import `flag` from `@crustjs/validate` and wrap
 * Effect schemas with `Schema.standardSchemaV1(...)` yourself. Will be removed
 * in 1.0.0. See file-level header for migration recipes.
 */
export function flag<
	S extends schema.Schema.AnyNoContext,
	const Short extends string | undefined = undefined,
	const Aliases extends readonly string[] | undefined = undefined,
	const Inherit extends true | undefined = undefined,
>(
	schemaArg: S,
	options?: FlagOptions & {
		short?: Short;
		aliases?: Aliases;
		inherit?: Inherit;
	},
): EffectFlagDef<S, Short, Aliases, Inherit> {
	return rootFlag(
		ensureStandardSchema(schemaArg),
		options,
	) as unknown as EffectFlagDef<S, Short, Aliases, Inherit>;
}

/**
 * Validated `run` middleware delegating to the root `commandValidator`.
 *
 * Behaviour is identical to the root export; this re-export exists so
 * existing Effect users can keep their imports unchanged through the
 * entire 0.x cycle.
 *
 * @deprecated Since 0.1.0 — import `commandValidator` from
 * `@crustjs/validate` directly. Will be removed in 1.0.0.
 */
export function commandValidator<
	A extends ArgsDef = ArgsDef,
	F extends FlagsDef = FlagsDef,
>(
	handler: CommandValidatorHandler<A, F>,
): (context: CrustCommandContext<A, F>) => Promise<void> {
	return rootCommandValidator<A, F>(handler);
}
