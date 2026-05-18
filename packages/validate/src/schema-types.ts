// ────────────────────────────────────────────────────────────────────────────
// Branded types for arg() / flag() / commandValidator()
// ────────────────────────────────────────────────────────────────────────────
//
// One generic def shape parameterized over a Standard Schema. The hidden
// brand `[VALIDATED_SCHEMA]` lets `commandValidator` find the schema at
// runtime and enables the strict-mode `HasAllSchemas` compile-time check.

import type { ArgDef, ArgsDef, FlagDef, FlagsDef } from "@crustjs/core";
import type { StandardSchema, ValidatedContext } from "./types.ts";

// ────────────────────────────────────────────────────────────────────────────
// Schema metadata symbol — attaches the Standard Schema to the def
// ────────────────────────────────────────────────────────────────────────────

/**
 * Unique symbol used to attach a Standard Schema to a core `ArgDef` or
 * `FlagDef`. Survives `{ ...def }` spread and `Object.freeze`, so the
 * schema is available at runtime via `def[VALIDATED_SCHEMA]`.
 */
export const VALIDATED_SCHEMA: unique symbol = Symbol.for(
	"crustjs.validate.schema",
);
export type VALIDATED_SCHEMA = typeof VALIDATED_SCHEMA;

// ────────────────────────────────────────────────────────────────────────────
// Standard Schema → CLI ValueType resolution at the type level
// ────────────────────────────────────────────────────────────────────────────

type ValueType = "string" | "number" | "boolean";
type ParserType = ValueType | undefined;

type StripUndefined<T> = Exclude<T, undefined>;

type PrimitiveToValueType<T> = [T] extends [string]
	? "string"
	: [T] extends [number]
		? "number"
		: [T] extends [boolean]
			? "boolean"
			: "string";

/**
 * Resolve CLI ValueType from a Standard Schema's input type.
 *
 * Falls back to `ValueType` (the union) for non-primitive schemas. This only
 * affects structural compatibility with core definitions; validated handler
 * output is inferred from the schema output type.
 */
export type ResolveValueType<S> =
	S extends StandardSchema<infer In, infer _Out>
		? PrimitiveToValueType<StripUndefined<In>>
		: ValueType;

// ────────────────────────────────────────────────────────────────────────────
// Branded def types
// ────────────────────────────────────────────────────────────────────────────

/**
 * Crust `ArgDef` carrying a hidden Standard Schema.
 *
 * The `type` parser hint is present only when explicitly supplied to `arg()`.
 * Raw schema-backed args intentionally omit it at runtime.
 */
export type ArgDef$<
	Name extends string = string,
	S extends StandardSchema = StandardSchema,
	Variadic extends true | undefined = true | undefined,
	Type extends ParserType = undefined,
> = {
	readonly name: Name;
	readonly description?: string;
	readonly required?: true;
	readonly variadic: Variadic;
	readonly [VALIDATED_SCHEMA]: S;
} & (Type extends ValueType
	? { readonly type: Type }
	: { readonly type?: never });

/**
 * Common shape for both single- and multi-value flag defs.
 */
interface FlagDefBase$<
	S extends StandardSchema,
	Short extends string | undefined,
	Aliases extends readonly string[] | undefined,
	Inherit extends true | undefined,
> {
	readonly description?: string;
	readonly required?: true;
	readonly inherit: Inherit;
	readonly short: Short extends string ? Short : undefined;
	readonly aliases: Aliases extends readonly string[] ? Aliases : undefined;
	readonly [VALIDATED_SCHEMA]: S;
}

/**
 * Crust `FlagDef` carrying a hidden Standard Schema.
 *
 * The `type` parser hint and `multiple` marker are present only when explicitly
 * supplied to `flag()`. Raw schema-backed flags intentionally omit them at
 * runtime, even when the schema input is array-shaped.
 */
export type FlagDef$<
	S extends StandardSchema = StandardSchema,
	Short extends string | undefined = string | undefined,
	Aliases extends readonly string[] | undefined = readonly string[] | undefined,
	Inherit extends true | undefined = true | undefined,
	Type extends ParserType = undefined,
	Multiple extends true | undefined = undefined,
> = FlagDefBase$<S, Short, Aliases, Inherit> &
	(Type extends ValueType
		? { readonly type: Type }
		: { readonly type?: never }) &
	(Multiple extends true
		? { readonly multiple: true }
		: { readonly multiple?: never });

// ────────────────────────────────────────────────────────────────────────────
// Public option types for arg() / flag()
// ────────────────────────────────────────────────────────────────────────────

/**
 * Optional CLI metadata passed to `arg()`.
 *
 * Every field is optional. Omit `type` for raw schema-backed parsing; pass it
 * as a legacy parser hint when you need parser coercion or `--flag value`.
 */
export interface ArgOptions {
	type?: "string" | "number" | "boolean";
	description?: string;
	required?: boolean;
	/**
	 * Mark this arg as variadic (collects remaining positionals into an array).
	 *
	 * The inferred TypeScript type is always `T[]` — never `T[] | undefined` —
	 * regardless of `required`. `required` only controls whether an empty array
	 * fails validation; it does not change the type.
	 */
	variadic?: true;
}

/**
 * Optional CLI metadata passed to `flag()`.
 *
 * Every field is optional. Omit `type` for raw schema-backed parsing; pass it
 * as a legacy parser hint when you need parser coercion or `--flag value`. Use
 * `multiple: true` to declare a multi-value flag.
 */
export interface FlagOptions {
	type?: "string" | "number" | "boolean";
	description?: string;
	required?: boolean;
	short?: string;
	aliases?: readonly string[];
	inherit?: true;
	/** Mark this flag as multi-value (collects repeated occurrences into an array). */
	multiple?: true;
}

// ────────────────────────────────────────────────────────────────────────────
// Output-type inference from branded defs
// ────────────────────────────────────────────────────────────────────────────

/** Infer the Standard Schema output type from `S`. */
export type InferSchemaOutput<S> =
	S extends StandardSchema<infer _I, infer O> ? O : never;

type InferValidatedArgValue<D> = D extends {
	readonly [VALIDATED_SCHEMA]: infer S;
	readonly variadic: true;
}
	? InferSchemaOutput<S>[]
	: D extends { readonly [VALIDATED_SCHEMA]: infer S }
		? InferSchemaOutput<S>
		: never;

type Simplify<T> = { [K in keyof T]: T[K] };

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
 * Infer the validated args output type from an `ArgsDef` tuple where every
 * element carries a `[VALIDATED_SCHEMA]` brand.
 */
export type InferValidatedArgs<A> = A extends readonly ArgDef[]
	? Simplify<InferValidatedArgsTuple<A>>
	: Record<string, never>;

/**
 * Infer the validated flags output type from a `FlagsDef` record where every
 * value carries a `[VALIDATED_SCHEMA]` brand.
 */
export type InferValidatedFlags<F> =
	F extends Record<string, FlagDef>
		? Simplify<{
				[K in keyof F]: F[K] extends { readonly [VALIDATED_SCHEMA]: infer S }
					? InferSchemaOutput<S>
					: never;
			}>
		: Record<string, never>;

// ────────────────────────────────────────────────────────────────────────────
// Strict check — every def must carry [VALIDATED_SCHEMA]
// ────────────────────────────────────────────────────────────────────────────

type AllArgsHaveSchema<A extends ArgsDef> = A extends readonly [
	infer Head,
	...infer Tail extends readonly ArgDef[],
]
	? Head extends { readonly [VALIDATED_SCHEMA]: unknown }
		? AllArgsHaveSchema<Tail>
		: false
	: true;

type AllFlagsHaveSchema<F extends FlagsDef> = string extends keyof F
	? true
	: keyof F extends never
		? true // vacuously true for empty flags (`flags: {}`)
		: {
					[K in keyof F]: F[K] extends {
						readonly [VALIDATED_SCHEMA]: unknown;
					}
						? true
						: false;
				}[keyof F] extends true
			? true
			: false;

/**
 * Resolves to `true` only when every arg and flag carries `[VALIDATED_SCHEMA]`.
 * `commandValidator()` uses this to enforce strict mode at compile time.
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
 * The validated handler accepted by `commandValidator()`.
 *
 * Resolves to a typed handler when every def carries a schema; otherwise
 * resolves to `never`, producing a compile error at the call site.
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
