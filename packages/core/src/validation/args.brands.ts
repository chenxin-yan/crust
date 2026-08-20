import type { ArgsDef } from "../types.ts";
import type { AsyncParseBrand, DefaultWithinChoicesBrand, DefName, Overlap } from "./shared.ts";

// ────────────────────────────────────────────────────────────────────────────
// Compile-time validation
// ────────────────────────────────────────────────────────────────────────────

type ArgNames<A extends readonly object[]> = DefName<A[number]>;

type DuplicateArgBrand<A, Existing extends string> =
	Overlap<DefName<A>, Existing> extends infer Duplicate extends string
		? [Duplicate] extends [never]
			? {}
			: {
					readonly FIX_DUPLICATE_ARG: `Argument name "${Duplicate}" is already defined`;
				}
		: never;

type EmptyArgNameError = { readonly FIX_EMPTY_NAME: "Argument names must be non-empty" };

/** Brand a statically known empty argument name while allowing widened and generic names. */
export type EmptyArgNameBrand<Name extends string> = ({
	readonly "": EmptyArgNameError;
} & Record<string, unknown>)[Name];

// An empty name renders as "<>" in help/snapshot labels and validation messages.
type EmptyArgDefinitionNameBrand<A> = "" extends DefName<A> ? EmptyArgNameError : {};

type ArgChecks<A, Existing extends string> = A &
	DuplicateArgBrand<A, Existing> &
	AsyncParseBrand<A> &
	DefaultWithinChoicesBrand<A> &
	EmptyArgDefinitionNameBrand<A>;

/**
 * Per-arg validation tuple type. Resolves to `A` when the constraints are
 * satisfied: only the last arg is variadic, names are unique, and custom
 * parsers are synchronous. Invalid definitions receive a branded property.
 *
 * Generalized to work with any ordered tuple of object-typed definitions.
 * Uses `readonly object[]` to avoid TypeScript's weak type detection
 * (all-optional constraint rejection).
 *
 * ```
 * Property 'FIX_VARIADIC_POSITION' is missing in type '{ name: "files"; ... variadic: true }'
 *   but required in type
 *     '{ readonly FIX_VARIADIC_POSITION: "Only the last positional argument can be variadic" }'.
 * ```
 */
export type ValidateVariadicArgs<
	A extends readonly object[],
	Existing extends string = never,
> = A extends readonly [infer Head, ...infer Tail extends readonly object[]]
	? Tail extends readonly [unknown, ...unknown[]]
		? Head extends { variadic: true }
			? readonly [
					ArgChecks<Head, Existing> & {
						readonly FIX_VARIADIC_POSITION: "Only the last positional argument can be variadic";
					},
					...ValidateVariadicArgs<Tail, Existing | DefName<Head>>,
				]
			: readonly [
					ArgChecks<Head, Existing>,
					...ValidateVariadicArgs<Tail, Existing | DefName<Head>>,
				]
		: readonly [ArgChecks<Head, Existing>]
	: A;

type BrandVariadicPosition<A extends readonly object[]> = {
	[I in keyof A]: A[I] & {
		readonly FIX_VARIADIC_POSITION: "Only the last positional argument can be variadic";
	};
};

export type AppendArgsChecks<A extends ArgsDef, NewA extends ArgsDef> = A extends readonly [
	...unknown[],
	infer Last,
]
	? Last extends { variadic: true }
		? BrandVariadicPosition<ValidateVariadicArgs<NewA, ArgNames<A>>>
		: ValidateVariadicArgs<NewA, ArgNames<A>>
	: ValidateVariadicArgs<NewA>;

// ────────────────────────────────────────────────────────────────────────────
