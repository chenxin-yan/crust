// ────────────────────────────────────────────────────────────────────────────
// Branded types for arg() / flag() / commandValidator() — single-vendor edition
// ────────────────────────────────────────────────────────────────────────────
//
// Replaces the per-library `ZodArgDef` / `EffectArgDef` types with one
// generic def shape parameterized over a Standard Schema. The hidden brand
// `[VALIDATED_SCHEMA]` enables the strict-mode `HasAllSchemas` check.

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

type StripUndefined<T> = Exclude<T, undefined>;

type PrimitiveToValueType<T> = [T] extends [string]
	? "string"
	: [T] extends [number]
		? "number"
		: [T] extends [boolean]
			? "boolean"
			: ValueType;

/**
 * Resolve CLI ValueType from a Standard Schema's input type.
 *
 * Falls back to `ValueType` (the union) for non-primitive schemas — runtime
 * introspection always produces the correct narrow value, so this only
 * affects type inference at `arg()`/`flag()` call sites.
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
 * The schema-derived `Type` literal is computed from `S`'s input type, so
 * core's discriminated `ArgDef` union resolves to a single variant.
 */
export interface ArgDef$<
	Name extends string = string,
	S extends StandardSchema = StandardSchema,
	Variadic extends true | undefined = true | undefined,
	Type extends ValueType = ResolveValueType<S>,
> {
	readonly name: Name;
	readonly type: Type;
	readonly description?: string;
	readonly required?: true;
	/**
	 * Non-optional for type-level variadic-args validation in core.
	 *
	 * When `true`, the inferred TypeScript type for this arg is always `T[]`,
	 * regardless of `required`.
	 */
	readonly variadic: Variadic;
	readonly [VALIDATED_SCHEMA]: S;
}

/**
 * Detect array-shaped Standard Schema inputs. Used by `FlagDef$` to
 * select the multi-value variant (`multiple: true`) so that
 * `flag(z.array(z.string()))` satisfies core's discriminated `FlagDef`.
 */
type IsArrayInput<S> =
	S extends StandardSchema<infer In, infer _Out>
		? StripUndefined<In> extends readonly unknown[]
			? true
			: false
		: false;

/** Element type of an array Standard Schema input, or `never`. */
type ArrayElementInput<S> =
	S extends StandardSchema<infer In, infer _Out>
		? StripUndefined<In> extends readonly (infer E)[]
			? E
			: never
		: never;

/** ValueType resolution for an array Standard Schema (uses element type). */
type ResolveArrayElementType<S> = PrimitiveToValueType<
	StripUndefined<ArrayElementInput<S>>
>;

/**
 * Common shape for both single- and multi-value flag defs.
 */
interface FlagDefBase$<
	S extends StandardSchema,
	Short extends string | undefined,
	Aliases extends readonly string[] | undefined,
	Inherit extends true | undefined,
	Type extends ValueType,
> {
	readonly type: Type;
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
 * Array-typed schemas (e.g. `z.array(z.string())`,
 * `Schema.Array(Schema.String)`) pin `multiple: true` so they discriminate
 * against core's `StringMultiFlagDef` etc.; scalar schemas omit it.
 *
 * The optional 5th `Type` generic exists so the deprecated `/effect`
 * subpath shim can pin the CLI value-type literal when its schema generic
 * collapses to the broad `StandardSchema`. End-user call sites should
 * leave it on its default.
 */
export type FlagDef$<
	S extends StandardSchema = StandardSchema,
	Short extends string | undefined = string | undefined,
	Aliases extends readonly string[] | undefined = readonly string[] | undefined,
	Inherit extends true | undefined = true | undefined,
	Type extends ValueType = IsArrayInput<S> extends true
		? ResolveArrayElementType<S>
		: ResolveValueType<S>,
> = FlagDefBase$<S, Short, Aliases, Inherit, Type> &
	(IsArrayInput<S> extends true ? { readonly multiple: true } : unknown);

// ────────────────────────────────────────────────────────────────────────────
// Public option types for arg() / flag()
// ────────────────────────────────────────────────────────────────────────────

/**
 * Optional CLI metadata passed to `arg()`.
 *
 * Every field is optional. When automatic introspection covers a field
 * (`type`, `description`, `required`), explicit values override it
 * silently. For schemas with unknown vendors (e.g. Valibot, ArkType),
 * `type` MUST be supplied explicitly because no inference is available.
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
 * Every field is optional. When automatic introspection covers a field
 * (`type`, `description`, `required`, `multiple`), explicit values
 * override it silently. For schemas with unknown vendors (e.g. Valibot,
 * ArkType), `type` MUST be supplied explicitly because no inference is
 * available; use `multiple: true` to declare a multi-value flag.
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

/**
 * Optional store-field metadata passed to `field()`.
 *
 * Every key is optional. When automatic introspection covers a field
 * (`type`, `description`, `default`, `array`), explicit values override
 * the introspection silently. For schemas with unknown vendors (e.g.
 * Valibot, ArkType), `type` MUST be supplied explicitly because no
 * inference is available.
 *
 * No `validate` key — validation flows exclusively through the schema.
 * If extra checks are needed, refine the schema with `.refine(...)`
 * (Zod), `Schema.filter(...)` (Effect), etc.
 *
 * @typeParam T - The schema's output value type. Used to type-tighten the
 *               `default` key when the user wants a non-`undefined` field.
 */
export interface FieldOptions<T = unknown> {
	type?: "string" | "number" | "boolean";
	description?: string;
	/**
	 * Default value for this field when the persisted state does not contain
	 * a value for it. Passing `default` explicitly here narrows the inferred
	 * config type from `T | undefined` to `T`. Schema-derived defaults
	 * (e.g. `z.string().default("x")`) populate the runtime default but do
	 * NOT narrow the TypeScript type — pass it explicitly here for tight
	 * typing.
	 */
	default?: T;
	/** Mark this field as an array (collects values into an array). */
	array?: true;
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
