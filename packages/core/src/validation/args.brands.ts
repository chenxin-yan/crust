import type { InferInput, StandardSchema } from "@crustjs/utils/schema";

import type { ArgDef, ArgsDef, RequiredArgNames, VariadicMode } from "../types.ts";
import type {
	CollisionBrand,
	DefName,
	HasClosedNames,
	LocalValueBrand,
	UnknownKeysBrand,
} from "./shared.ts";

// ────────────────────────────────────────────────────────────────────────────
// Compile-time validation
// ────────────────────────────────────────────────────────────────────────────

type ArgNames<A extends readonly object[]> = DefName<A[number]>;

type DuplicateArgBrand<A, Existing extends string> = CollisionBrand<
	DefName<A>,
	Existing,
	"FIX_DUPLICATE_ARG",
	"Argument name ",
	" is already defined"
>;

type ArgChecks<A, Existing extends string> = A &
	DuplicateArgBrand<A, Existing> &
	LocalValueBrand<A> &
	UnknownKeysBrand<A, ArgDef>;

type VariadicPositionError = {
	readonly FIX_VARIADIC_POSITION: 'Only the last argument, or the one before a final "afterDoubleDash" argument, can be variadic';
};

type LastPositionError = {
	readonly FIX_LAST_ARGUMENT_POSITION: 'Only the last argument can be variadic "afterDoubleDash" or "passthrough"';
};

type RequiredAfterOptionalError = {
	readonly FIX_REQUIRED_AFTER_OPTIONAL: "A required argument cannot follow an optional one";
};

/**
 * `true` when argv must supply the argument: `required` without a default, or a scalar
 * schema that rejects absence (a variadic schema receives `[]`, never absence). An `unknown`
 * input (`z.coerce.number()`) says nothing about absence, so it opts out like a union does.
 */
type IsRequiredArg<D> = D extends { schema: infer S extends StandardSchema }
	? D extends { variadic: VariadicMode }
		? false
		: unknown extends InferInput<S>
			? boolean
			: undefined extends InferInput<S>
				? false
				: true
	: RequiredArgNames<[D & object]> extends never
		? false
		: true;

/** Only a definitely optional argument opens the gap; a conditional one opts out. */
type IsOptionalArg<D> = [IsRequiredArg<D>] extends [false] ? true : false;

type HasOptionalArg<A extends readonly unknown[]> = true extends {
	[I in keyof A]: IsOptionalArg<A[I]>;
}[number]
	? true
	: false;

/**
 * An argument after an optional one could never be given without it, so it cannot be
 * required. An `"afterDoubleDash"` argument follows `--`, apart from the others.
 */
type OrderBrand<Head, AfterOptional extends boolean> = AfterOptional extends true
	? [IsRequiredArg<Head>] extends [true]
		? Head extends { variadic: "afterDoubleDash" }
			? unknown
			: RequiredAfterOptionalError
		: unknown
	: unknown;

/** A variadic may precede only a final `"afterDoubleDash"` argument, whose words follow `--`. */
type HeadPositionBrand<Head, Tail extends readonly unknown[]> = Head extends {
	variadic: "afterDoubleDash" | "passthrough";
}
	? LastPositionError
	: Head extends { variadic: true }
		? Tail extends readonly [{ variadic: "afterDoubleDash" }]
			? unknown
			: VariadicPositionError
		: unknown;

/**
 * Per-arg validation tuple type. Resolves to `A` when the constraints are
 * satisfied: only the last arg is variadic (or a plain variadic directly before a
 * final `"afterDoubleDash"` arg), an `"afterDoubleDash"` or `"passthrough"` arg is
 * last, no required arg follows an optional one, names are unique, custom parsers
 * are synchronous, and literal defaults are within `choices`. Invalid definitions
 * receive a branded property. These rules have no runtime check.
 *
 * Generalized to work with any ordered tuple of object-typed definitions.
 * Uses `readonly object[]` to avoid TypeScript's weak type detection
 * (all-optional constraint rejection).
 *
 * ```
 * Property 'FIX_VARIADIC_POSITION' is missing in type '{ name: "files"; ... variadic: true }'
 *   but required in type '{ readonly FIX_VARIADIC_POSITION: "Only the last argument, …" }'.
 * ```
 */
export type ValidateArgs<
	A extends readonly object[],
	Existing extends string = never,
	AfterOptional extends boolean = false,
> = A extends readonly [infer Head, ...infer Tail extends readonly object[]]
	? Tail extends readonly [unknown, ...unknown[]]
		? readonly [
				ArgChecks<Head, Existing> & OrderBrand<Head, AfterOptional> & HeadPositionBrand<Head, Tail>,
				...ValidateArgs<
					Tail,
					Existing | DefName<Head>,
					AfterOptional extends true ? true : IsOptionalArg<Head>
				>,
			]
		: readonly [ArgChecks<Head, Existing> & OrderBrand<Head, AfterOptional>]
	: { [I in keyof A]: ArgChecks<A[I], Existing> };

type BrandPosition<A extends readonly object[], Error> = {
	[I in keyof A]: A[I] & Error;
};

export type AppendArgsChecks<A extends ArgsDef, NewA extends ArgsDef> = A extends readonly [
	...unknown[],
	infer Last,
]
	? Last extends { variadic: "afterDoubleDash" | "passthrough" }
		? BrandPosition<ValidateArgs<NewA, ArgNames<A>, HasOptionalArg<A>>, LastPositionError>
		: Last extends { variadic: true }
			? NewA extends readonly [{ variadic: "afterDoubleDash" }]
				? ValidateArgs<NewA, ArgNames<A>, HasOptionalArg<A>>
				: BrandPosition<ValidateArgs<NewA, ArgNames<A>, HasOptionalArg<A>>, VariadicPositionError>
			: ValidateArgs<NewA, ArgNames<A>, HasOptionalArg<A>>
	: ValidateArgs<NewA>;

/** Errors-only view of {@link AppendArgsChecks}: `unknown` when no element carries a `FIX_*` brand. */
export type AppendArgsErrors<A extends ArgsDef, NewA extends ArgsDef> =
	// A valid branch's `unknown` would absorb an invalid sibling's errors in a union, so the branches intersect.
	BranchArgsErrors<A, NewA> extends (errors: infer E) => void ? E : never;

type BranchArgsErrors<A extends ArgsDef, NewA extends ArgsDef> = NewA extends unknown
	? (errors: OneArgsErrors<A, NewA>) => void
	: never;

type OneArgsErrors<A extends ArgsDef, NewA extends ArgsDef> =
	AppendArgsChecks<A, NewA> extends infer C extends readonly unknown[]
		? [{ [I in keyof C]: keyof C[I] & `FIX_${string}` }[number]] extends [never]
			? unknown
			: C
		: never;

/** Conditional collections and uncertain canonical identities cannot promise every alternative output key. */
export type AttachedArgs<A extends ArgsDef> = HasClosedNames<A> extends true ? A : ArgsDef;
