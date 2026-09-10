// ────────────────────────────────────────────────────────────────────────────
// Shared type helpers
// ────────────────────────────────────────────────────────────────────────────

export type Awaitable<T> = T | Promise<T>;
export type Simplify<T> = { [K in keyof T]: T[K] };
// Flat intersections keep chained composition at constant instantiation depth.
export type MergeContext<A, B> = A & B;

/** Provider replacement is last-write-wins; an open name may leave any earlier value in place. */
export type MergeProviders<A, B> = keyof A extends never
	? B
	: keyof B extends never
		? A
		: string extends keyof B
			? Record<string, A[keyof A] | B[string]>
			: [keyof A & keyof B] extends [never]
				? A & B
				: Omit<A, keyof B> & B;

/**
 * Extract the narrowed canonical `name` literal from a definition.
 * Open name domains carry no spelling proof; attachment must retain
 * their uncertainty rather than treating this absence as an empty namespace.
 */
export type DefName<T> = T extends { name: infer N extends string }
	? IsClosedName<N> extends true
		? N
		: never
	: never;

export type UnionToIntersection<U> = (U extends unknown ? (x: U) => void : never) extends (
	x: infer I,
) => void
	? I
	: never;

export type IsUnion<T> = true extends UnionMemberDiffers<T> ? true : false;

// Overlapping members can produce boolean; any differing member still makes a union.
type UnionMemberDiffers<T, Whole = T> = T extends unknown
	? [Whole] extends [T]
		? false
		: true
	: never;

/**
 * `true` only for a single statically known fixed-length tuple whose members
 * are not unions. A conditionally assembled collection (`cond ? [a] : [b]` or
 * `[cond ? a : b]`) infers as a union at the tuple or member level, and a
 * variable-length array (`const xs: (typeof a)[]`) may be empty or partially
 * populated at runtime; such contributions must stay runtime-only.
 */
export type IsStaticTuple<Cs extends readonly unknown[]> = number extends Cs["length"]
	? false
	: IsUnion<Cs> extends true
		? false
		: true extends { [I in keyof Cs]: IsUnion<Cs[I]> }[number]
			? false
			: true;

/**
 * The members of union `S` that overlap with `Existing`, or `never` when
 * disjoint. Callers pattern-match the result with their own
 * `extends infer C extends string` to embed the colliding literal(s) in a
 * brand message.
 */
export type Overlap<S, Existing extends string> = S & Existing;

/** Brand a statically known empty literal while allowing widened and generic names. */
/* oxlint-disable anti-slop/no-unsafe-dictionary-type -- indexed type preserves deferred generic-name behavior while unknown means unbranded. */
export type EmptyLiteralNameBrand<Name extends string, Err> = ({
	readonly "": Err;
} & Record<string, unknown>)[Name];
/* oxlint-enable anti-slop/no-unsafe-dictionary-type */

/**
 * Brand a definition whose custom parser can return a Promise — parse results
 * are consumed synchronously during argv parsing. `Extract` keeps the check
 * union-aware (a sometimes-async `cond ? Promise.resolve(x) : x` parser is
 * caught) while `any`-returning parsers stay unbranded.
 */
export type AsyncParseBrand<T> = T extends { parse: (...args: never[]) => infer R }
	? Extract<R, Promise<unknown>> extends never
		? {}
		: {
				readonly FIX_ASYNC_PARSE: "parse must be synchronous; do async work in run()";
			}
	: {};

/** Brand literal defaults that fall outside a literal `choices` tuple. */
export type DefaultWithinChoicesBrand<T> = T extends {
	choices: readonly (infer Choice extends string)[];
	default: infer Default;
}
	? string extends Choice
		? {}
		: Default extends readonly string[]
			? string extends Default[number]
				? {}
				: Exclude<Default[number], Choice> extends never
					? {}
					: {
							readonly FIX_DEFAULT_CHOICE: "default must be one of choices";
						}
			: Default extends string
				? string extends Default
					? {}
					: Exclude<Default, Choice> extends never
						? {}
						: {
								readonly FIX_DEFAULT_CHOICE: "default must be one of choices";
							}
				: {}
	: {};

/** Finite literal domains have required record keys; infinite templates and branded strings do not.
 * Distribute first so a finite union member cannot hide an open member's index signature.
 */
export type IsClosedName<N extends string> = false extends (
	N extends unknown ? ({} extends Record<N, true> ? false : true) : never
)
	? false
	: true;

/** Reject independently provable invalid local values, including members of uncertain definitions. */
export type LocalValueBrand<T> = UnionToIntersection<
	T extends unknown ? AsyncParseBrand<T> & DefaultWithinChoicesBrand<T> : never
>;
