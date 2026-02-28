import type { ArgDef, ArgsDef, FlagDef, FlagsDef } from "@crustjs/core";
import type * as z from "zod/v4/core";
import type { ValidatedContext } from "../types.ts";

// ────────────────────────────────────────────────────────────────────────────
// Schema metadata symbol — attaches Zod schema to core ArgDef / FlagDef
// ────────────────────────────────────────────────────────────────────────────

/**
 * Unique symbol used to attach a Zod schema to a core `ArgDef` or `FlagDef`.
 *
 * Survives `{ ...def }` spread in `defineCommand` and `Object.freeze`,
 * making the schema available at runtime via `def[ZOD_SCHEMA]`.
 */
export const ZOD_SCHEMA: unique symbol = Symbol.for("crustjs.validate.zod");
export type ZOD_SCHEMA = typeof ZOD_SCHEMA;

// ────────────────────────────────────────────────────────────────────────────
// Core schema alias
// ────────────────────────────────────────────────────────────────────────────

/** A Zod schema used by the validate/zod entrypoint. */
export type ZodSchemaLike<Input = unknown, Output = Input> = z.$ZodType<
	Output,
	Input
>;

// ────────────────────────────────────────────────────────────────────────────
// Type-level: Zod schema → CLI ValueType resolution
// ────────────────────────────────────────────────────────────────────────────

/** CLI value type literals. */
type ValueType = "string" | "number" | "boolean";

/**
 * Resolve the CLI `ValueType` from a Zod schema at the type level.
 *
 * Unwraps common wrappers (optional, default, nullable, pipe, catch,
 * prefault, nonoptional, readonly) and maps leaf schemas to their
 * primitive type string.
 *
 * Falls back to `ValueType` (the union) for unrecognized schemas — the
 * runtime introspection always produces the correct narrow value.
 */
export type ResolveZodValueType<S> =
	// Leaf types
	S extends z.$ZodString
		? "string"
		: S extends z.$ZodNumber
			? "number"
			: S extends z.$ZodBoolean
				? "boolean"
				: // Enum / literal → string
					S extends z.$ZodEnum
					? "string"
					: S extends z.$ZodLiteral<infer L>
						? L extends string
							? "string"
							: L extends number
								? "number"
								: L extends boolean
									? "boolean"
									: ValueType
						: // Wrappers — unwrap and recurse
							S extends z.$ZodOptional<infer Inner>
							? ResolveZodValueType<Inner>
							: S extends z.$ZodDefault<infer Inner>
								? ResolveZodValueType<Inner>
								: S extends z.$ZodNullable<infer Inner>
									? ResolveZodValueType<Inner>
									: S extends z.$ZodCatch<infer Inner>
										? ResolveZodValueType<Inner>
										: S extends z.$ZodPrefault<infer Inner>
											? ResolveZodValueType<Inner>
											: S extends z.$ZodNonOptional<infer Inner>
												? ResolveZodValueType<Inner>
												: S extends z.$ZodReadonly<infer Inner>
													? ResolveZodValueType<Inner>
													: S extends z.$ZodPipe<infer In, infer _Out>
														? ResolveZodValueType<In>
														: // Fallback
															ValueType;

// ────────────────────────────────────────────────────────────────────────────
// Branded def types — ArgDef / FlagDef carrying hidden schema metadata
// ────────────────────────────────────────────────────────────────────────────

/**
 * An `ArgDef` enriched with a hidden Zod schema.
 *
 * The `Type` parameter is resolved from the schema at the type level via
 * `ResolveZodValueType`, producing a narrow literal (e.g. `"number"`) that
 * matches exactly one variant of core's discriminated `ArgDef` union.
 *
 * The `ZOD_SCHEMA` symbol key carries the schema for runtime validation.
 */
export interface ZodArgDef<
	Name extends string = string,
	Schema extends ZodSchemaLike = ZodSchemaLike,
	Variadic extends true | undefined = true | undefined,
	Type extends ValueType = ResolveZodValueType<Schema>,
> {
	readonly name: Name;
	readonly type: Type;
	readonly description?: string;
	readonly required?: true;
	/**
	 * Non-optional so `ValidateVariadicArgs` can match `{ variadic: true }`.
	 * When `Variadic` is `undefined`, the runtime value is `undefined`.
	 */
	readonly variadic: Variadic;
	readonly [ZOD_SCHEMA]: Schema;
}

/**
 * A `FlagDef` enriched with a hidden Zod schema.
 *
 * The `Type` parameter is resolved from the schema at the type level.
 *
 * The `ZOD_SCHEMA` symbol key carries the schema for runtime validation.
 */
export interface ZodFlagDef<
	Schema extends ZodSchemaLike = ZodSchemaLike,
	Alias extends string | readonly string[] | undefined =
		| string
		| readonly string[]
		| undefined,
	Type extends ValueType = ResolveZodValueType<Schema>,
> {
	readonly type: Type;
	readonly description?: string;
	readonly required?: true;
	/**
	 * Non-optional so `ValidateFlagAliases` can extract narrow alias literals.
	 * When `Alias` is `undefined`, the runtime value is `undefined` (no alias).
	 */
	readonly alias: Alias extends string | readonly string[] ? Alias : undefined;
	readonly [ZOD_SCHEMA]: Schema;
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
	/** Short alias or array of aliases (e.g. `"v"` or `["v", "V"]`). */
	readonly alias?: string | readonly string[];
}

// ────────────────────────────────────────────────────────────────────────────
// Type-level: Infer validated output types from branded defs
// ────────────────────────────────────────────────────────────────────────────

/** Infer Zod output type from a schema. */
export type InferSchemaOutput<S> = S extends z.$ZodType ? z.output<S> : never;

/** Output type for a single arg: variadic → `output[]`, scalar → `output`. */
type InferValidatedArgValue<D> = D extends {
	readonly [ZOD_SCHEMA]: infer S;
	readonly variadic: true;
}
	? InferSchemaOutput<S>[]
	: D extends { readonly [ZOD_SCHEMA]: infer S }
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
 * where each element carries a `[ZOD_SCHEMA]` brand.
 */
export type InferValidatedArgs<A> = A extends readonly ArgDef[]
	? Simplify<InferValidatedArgsTuple<A>>
	: Record<string, never>;

/**
 * Infer the validated flags output type from a `FlagsDef` record
 * where each value carries a `[ZOD_SCHEMA]` brand.
 */
export type InferValidatedFlags<F> =
	F extends Record<string, FlagDef>
		? Simplify<{
				[K in keyof F]: F[K] extends { readonly [ZOD_SCHEMA]: infer S }
					? InferSchemaOutput<S>
					: never;
			}>
		: Record<string, never>;

// ────────────────────────────────────────────────────────────────────────────
// Strict check — reject plain defs without schema metadata
// ────────────────────────────────────────────────────────────────────────────

/** Check that every arg in a tuple carries the `[ZOD_SCHEMA]` brand. */
type AllArgsHaveSchema<A extends ArgsDef> = A extends readonly [
	infer Head,
	...infer Tail extends readonly ArgDef[],
]
	? Head extends { readonly [ZOD_SCHEMA]: unknown }
		? AllArgsHaveSchema<Tail>
		: false
	: true;

/** Check that every flag in a record carries the `[ZOD_SCHEMA]` brand. */
type AllFlagsHaveSchema<F extends FlagsDef> =
	// When F resolves to the base `FlagsDef` (no flags provided), pass
	string extends keyof F
		? true
		: {
					[K in keyof F]: F[K] extends { readonly [ZOD_SCHEMA]: unknown }
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
 *
 * When all args/flags carry schema metadata, resolves to a typed handler
 * receiving `ValidatedContext`. Otherwise resolves to `never`, causing
 * a compile error at the call site.
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
