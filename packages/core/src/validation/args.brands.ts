import type { ArgsDef } from "../types.ts";
import type {
	AsyncParseBrand,
	DefaultWithinChoicesBrand,
	DefName,
	Overlap,
	IsUnion,
	IsClosedName,
	LocalValueBrand,
} from "./shared.ts";

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

/** Reject empty argument names, including empty members of a name union. */
export type EmptyArgNameBrand<Name extends string> =
	IsClosedName<Name> extends true ? ("" extends Name ? EmptyArgNameError : {}) : {};

// An empty name renders as "<>" in help/snapshot labels and validation messages.
type EmptyArgDefinitionNameBrand<A> = "" extends DefName<A> ? EmptyArgNameError : {};

type ArgChecks<A, Existing extends string, Local extends boolean> = A &
	DuplicateArgBrand<A, Existing> &
	(Local extends true
		? A extends { name: string }
			? LocalArgBrand<A>
			: {}
		: AsyncParseBrand<A> & DefaultWithinChoicesBrand<A>) &
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
	Local extends boolean = false,
> = A extends readonly [infer Head, ...infer Tail extends readonly object[]]
	? Tail extends readonly [unknown, ...unknown[]]
		? Head extends { variadic: true }
			? readonly [
					ArgChecks<Head, Existing, Local> & {
						readonly FIX_VARIADIC_POSITION: "Only the last positional argument can be variadic";
					},
					...ValidateVariadicArgs<Tail, Existing | DefName<Head>, Local>,
				]
			: readonly [
					ArgChecks<Head, Existing, Local>,
					...ValidateVariadicArgs<Tail, Existing | DefName<Head>, Local>,
				]
		: readonly [ArgChecks<Head, Existing, Local>]
	: Local extends true
		? { [I in keyof A]: ArgChecks<A[I], Existing, Local> }
		: A;

type BrandVariadicPosition<A extends readonly object[]> = {
	[I in keyof A]: A[I] & {
		readonly FIX_VARIADIC_POSITION: "Only the last positional argument can be variadic";
	};
};

export type AppendArgsChecks<
	A extends ArgsDef,
	NewA extends ArgsDef,
	Local extends boolean = false,
> = A extends readonly [...unknown[], infer Last]
	? Last extends { variadic: true }
		? BrandVariadicPosition<ValidateVariadicArgs<NewA, ArgNames<A>, Local>>
		: ValidateVariadicArgs<NewA, ArgNames<A>, Local>
	: ValidateVariadicArgs<NewA, never, Local>;

// ────────────────────────────────────────────────────────────────────────────

export type LocalArgBrand<A extends { name: string }> = EmptyArgDefinitionNameBrand<A> &
	LocalValueBrand<A>;

export type LocalAppendArgsChecks<A extends ArgsDef, NewA extends ArgsDef> = AppendArgsChecks<
	A,
	NewA,
	true
>;

/** Conditional collections and uncertain canonical identities cannot promise every alternative output key. */
export type AttachedArgs<A extends ArgsDef> = (
	number extends A["length"] ? false : IsUnion<A> extends true ? false : true
) extends true
	? true extends {
			[I in keyof A]:
				| IsUnion<A[I]["name"]>
				| (IsClosedName<A[I]["name"]> extends true ? false : true);
		}[number]
		? ArgsDef
		: A
	: ArgsDef;
