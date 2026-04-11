import type { ArgDef, ArgsDef, FlagDef, FlagsDef } from "@crustjs/core";
import type * as schema from "effect/Schema";
import type { ValidatedContext } from "../types.ts";

// ────────────────────────────────────────────────────────────────────────────
// Schema metadata symbol — attaches Effect schema to core ArgDef / FlagDef
// ────────────────────────────────────────────────────────────────────────────

/**
 * Unique symbol used to attach an Effect schema to a core `ArgDef` or `FlagDef`.
 *
 * Survives `{ ...def }` spread in the Crust builder and `Object.freeze`,
 * making the schema available at runtime via `def[EFFECT_SCHEMA]`.
 */
export const EFFECT_SCHEMA: unique symbol = Symbol.for(
	"crustjs.validate.effect",
);
export type EFFECT_SCHEMA = typeof EFFECT_SCHEMA;

// ────────────────────────────────────────────────────────────────────────────
// Core schema alias
// ────────────────────────────────────────────────────────────────────────────

/**
 * An Effect schema used by the validate/effect entrypoint.
 *
 * v1 intentionally supports context-free schemas only (`R = never`).
 */
export type EffectSchemaLike = schema.Schema.AnyNoContext;

// ────────────────────────────────────────────────────────────────────────────
// Type-level: Effect schema → CLI ValueType resolution
// ────────────────────────────────────────────────────────────────────────────

/** CLI value type literals. */
type ValueType = "string" | "number" | "boolean";

/**
 * Resolve CLI ValueType from an Effect schema's encoded (input) type.
 *
 * Uses `Schema.Encoded<S>` to determine the CLI input type. If the encoded
 * type is a primitive (possibly `| undefined`), resolves to the matching
 * ValueType literal. Falls back to `ValueType` (the union) for complex types.
 */
type StripUndefined<T> = Exclude<T, undefined>;

type PrimitiveToValueType<T> = [T] extends [string]
	? "string"
	: [T] extends [number]
		? "number"
		: [T] extends [boolean]
			? "boolean"
			: ValueType;

export type ResolveEffectValueType<S> =
	S extends schema.Schema<infer _A, infer I, infer _R>
		? PrimitiveToValueType<StripUndefined<I>>
		: ValueType;

// ────────────────────────────────────────────────────────────────────────────
// Branded def types — ArgDef / FlagDef carrying hidden schema metadata
// ────────────────────────────────────────────────────────────────────────────

/**
 * An `ArgDef` enriched with a hidden Effect schema.
 *
 * The `Type` parameter is resolved from the schema's encoded type.
 *
 * The `EFFECT_SCHEMA` symbol key carries the schema for runtime validation.
 */
export interface EffectArgDef<
	Name extends string = string,
	SchemaType extends EffectSchemaLike = EffectSchemaLike,
	Variadic extends true | undefined = true | undefined,
	Type extends ValueType = ResolveEffectValueType<SchemaType>,
> {
	readonly name: Name;
	readonly type: Type;
	readonly description?: string;
	readonly required?: true;
	/** Non-optional so `ValidateVariadicArgs` can match `{ variadic: true }`. */
	readonly variadic: Variadic;
	readonly [EFFECT_SCHEMA]: SchemaType;
}

/**
 * A `FlagDef` enriched with a hidden Effect schema.
 *
 * The `EFFECT_SCHEMA` symbol key carries the schema for runtime validation.
 */
export interface EffectFlagDef<
	SchemaType extends EffectSchemaLike = EffectSchemaLike,
	Short extends string | undefined = string | undefined,
	Aliases extends readonly string[] | undefined = readonly string[] | undefined,
	Inherit extends true | undefined = true | undefined,
	Type extends ValueType = ResolveEffectValueType<SchemaType>,
> {
	readonly type: Type;
	readonly description?: string;
	readonly required?: true;
	/**
	 * Non-optional so `InheritableFlags` can match `{ inherit: true }`.
	 * When `Inherit` is `undefined`, the runtime value is `undefined`.
	 */
	readonly inherit: Inherit;
	/**
	 * Non-optional so `ValidateFlagAliases` can extract narrow alias literals.
	 * When `Short` is `undefined`, the runtime value is `undefined` (no short alias).
	 */
	readonly short: Short extends string ? Short : undefined;
	/**
	 * Non-optional so `ValidateFlagAliases` can extract narrow alias literals.
	 * When `Aliases` is `undefined`, the runtime value is `undefined` (no long aliases).
	 */
	readonly aliases: Aliases extends readonly string[] ? Aliases : undefined;
	readonly [EFFECT_SCHEMA]: SchemaType;
}

// ────────────────────────────────────────────────────────────────────────────
// arg() / flag() option types
// ────────────────────────────────────────────────────────────────────────────

/**
 * Explicit parser metadata that overrides schema introspection.
 *
 * Use when the schema type is too complex for automatic introspection
 * (e.g., discriminated unions, custom transforms, or opaque pipes) and
 * the framework cannot determine CLI metadata automatically.
 *
 * **Precedence rules**:
 * - Explicit metadata takes priority over schema introspection.
 * - If explicit metadata is provided AND schema introspection succeeds
 *   with a conflicting value, a `DEFINITION` error is thrown.
 * - `description` from explicit metadata always wins without conflict
 *   checks (descriptions are additive, not structural).
 */
export interface ParserMeta {
	/**
	 * Explicit CLI value type override.
	 *
	 * Use when the schema's input type cannot be automatically resolved
	 * to a CLI primitive (e.g., complex union, opaque pipe).
	 */
	readonly type?: "string" | "number" | "boolean";

	/**
	 * Explicit description override.
	 *
	 * Takes priority over any description found via schema introspection.
	 */
	readonly description?: string;

	/**
	 * Explicit required/optional override.
	 *
	 * Set to `true` to mark as required, `false` to mark as optional.
	 * When omitted, derived from schema optionality introspection.
	 */
	readonly required?: boolean;
}

/** Options for `arg()`. */
export interface ArgOptions extends ParserMeta {
	/** Collect remaining positionals into this arg as an array. */
	readonly variadic?: true;
}

/** Options for `flag()`. */
export interface FlagOptions extends ParserMeta {
	/** Single-character short alias (e.g. `"v"` → `-v`). */
	readonly short?: string;
	/** Additional long aliases (e.g. `["out"]` → `--out`). */
	readonly aliases?: readonly string[];
	/** When `true`, the flag is inherited by subcommands. */
	readonly inherit?: true;
}

// ────────────────────────────────────────────────────────────────────────────
// Type-level: Infer validated output types from branded defs
// ────────────────────────────────────────────────────────────────────────────

/** Infer Effect output type from a schema. */
export type InferSchemaOutput<S> =
	S extends schema.Schema<infer A, infer _I, infer _R> ? A : never;

/** Output type for a single arg: variadic → `output[]`, scalar → `output`. */
type InferValidatedArgValue<D> = D extends {
	readonly [EFFECT_SCHEMA]: infer S;
	readonly variadic: true;
}
	? InferSchemaOutput<S>[]
	: D extends { readonly [EFFECT_SCHEMA]: infer S }
		? InferSchemaOutput<S>
		: never;

/** Flattens an intersection of objects for readable inferred types. */
type Simplify<T> = { [K in keyof T]: T[K] };

/** Recursively maps args tuple to a named output object. */
type InferValidatedArgsTuple<A extends readonly ArgDef[]> = A extends readonly [
	infer Head extends ArgDef,
	...infer Tail extends readonly ArgDef[],
]
	? Head extends { readonly name: infer N extends string }
		? { [K in N]: InferValidatedArgValue<Head> } & InferValidatedArgsTuple<Tail>
		: InferValidatedArgsTuple<Tail>
	: // biome-ignore lint/complexity/noBannedTypes: empty base case for recursive intersection
		{};

/**
 * Infer the validated args output type from an `ArgsDef` tuple
 * where each element carries an `[EFFECT_SCHEMA]` brand.
 */
export type InferValidatedArgs<A> = A extends readonly ArgDef[]
	? Simplify<InferValidatedArgsTuple<A>>
	: Record<string, never>;

/**
 * Infer the validated flags output type from a `FlagsDef` record
 * where each value carries an `[EFFECT_SCHEMA]` brand.
 */
export type InferValidatedFlags<F> =
	F extends Record<string, FlagDef>
		? Simplify<{
				[K in keyof F]: F[K] extends { readonly [EFFECT_SCHEMA]: infer S }
					? InferSchemaOutput<S>
					: never;
			}>
		: Record<string, never>;

// ────────────────────────────────────────────────────────────────────────────
// Strict check — reject plain defs without schema metadata
// ────────────────────────────────────────────────────────────────────────────

/** Check that every arg in a tuple carries the `[EFFECT_SCHEMA]` brand. */
type AllArgsHaveSchema<A extends ArgsDef> = A extends readonly [
	infer Head,
	...infer Tail extends readonly ArgDef[],
]
	? Head extends { readonly [EFFECT_SCHEMA]: unknown }
		? AllArgsHaveSchema<Tail>
		: false
	: true;

/** Check that every flag in a record carries the `[EFFECT_SCHEMA]` brand. */
type AllFlagsHaveSchema<F extends FlagsDef> = string extends keyof F
	? true
	: {
				[K in keyof F]: F[K] extends { readonly [EFFECT_SCHEMA]: unknown }
					? true
					: false;
			}[keyof F] extends true
		? true
		: false;

/**
 * Resolves to `true` only when all args and flags carry schema metadata.
 * Used by `commandValidator` to enforce strict mode at compile time.
 */
export type HasAllSchemas<A extends ArgsDef, F extends FlagsDef> =
	AllArgsHaveSchema<A> extends true
		? AllFlagsHaveSchema<F> extends true
			? true
			: false
		: false;

// ────────────────────────────────────────────────────────────────────────────
// commandValidator handler type
// ────────────────────────────────────────────────────────────────────────────

/**
 * The validated handler type for `commandValidator()`.
 */
export type CommandValidatorHandler<A extends ArgsDef, F extends FlagsDef> =
	HasAllSchemas<A, F> extends true
		? (
				context: ValidatedContext<
					InferValidatedArgs<A>,
					InferValidatedFlags<F>
				>,
			) => void | Promise<void>
		: never;
