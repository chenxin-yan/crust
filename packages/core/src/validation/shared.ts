// ────────────────────────────────────────────────────────────────────────────
// Shared type helpers
// ────────────────────────────────────────────────────────────────────────────

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

/**
 * Statically known `name` members of a definition (or definition union), for spelling grammar.
 * Filtered per variant: combining names first would let an open variant's `string` absorb
 * a literal sibling before {@link ClosedMembers} can see it.
 */
export type DefNameMembers<T> = T extends { name: infer N extends string }
	? ClosedMembers<N>
	: never;

export type UnionToIntersection<U> = (U extends unknown ? (x: U) => void : never) extends (
	x: infer I,
) => void
	? I
	: never;

// A union is a type some member of which does not cover the whole. Cheaper than
// comparing against `UnionToIntersection<T>`, which builds a function type per member.
export type IsUnion<T> = [T] extends [never]
	? false
	: true extends IsUnionWorker<T, T>
		? true
		: false;
type IsUnionWorker<T, U> = T extends unknown ? ([U] extends [T] ? false : true) : never;

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

/** Whether a fixed tuple has one closed canonical name per slot. */
export type HasClosedNames<Ds extends readonly unknown[]> = number extends Ds["length"]
	? false
	: IsUnion<Ds> extends true
		? false
		: false extends { [I in keyof Ds]: HasClosedName<Ds[I]> }[number]
			? false
			: true;

// A separate alias, not an inline `Ds[I] extends { name: infer N }`: an enclosing `extends`
// mentions `Ds`, so TypeScript keeps `Ds` as an outer parameter of the `{ name }` pattern and
// re-instantiates the whole tuple once per element (O(n^2) for a batched `.add(...)`).
// `[D]` keeps the check non-distributive: a union member has a union name, which is not closed.
type HasClosedName<D> = [D] extends [{ name: infer N extends string }]
	? IsUnion<N> extends true
		? false
		: IsClosedName<N>
	: false;

/** Brand statically known spelling collisions while allowing open names. */
export type CollisionBrand<
	S extends string,
	Existing extends string,
	Key extends string,
	Before extends string,
	After extends string,
> = string extends S | Existing
	? {}
	: [S & Existing] extends [never]
		? {}
		: { readonly [K in Key]: `${Before}"${S & Existing}"${After}` };

/**
 * The statically known members of a name union; open members stay runtime-owned.
 * Only for local spelling grammar: a literal beside an open template is still
 * independently invalid, but must never become key or collision evidence.
 */
export type ClosedMembers<N extends string> = N extends unknown
	? IsClosedName<N> extends true
		? N
		: never
	: never;

/** Brand a statically known empty literal member while allowing widened and generic names. */
export type EmptyLiteralNameBrand<Name extends string, Err> =
	"" extends ClosedMembers<Name> ? Err : {};

/**
 * Brand a definition whose custom parser can return a Promise — parse results
 * are consumed synchronously during argv parsing. `Extract` keeps the check
 * union-aware (a sometimes-async `cond ? Promise.resolve(x) : x` parser is
 * caught) while `any`-returning parsers stay unbranded.
 */
type AsyncParseBrand<T> = T extends { parse?: (...args: never[]) => infer R }
	? Extract<R, Promise<unknown>> extends never
		? {}
		: {
				readonly FIX_ASYNC_PARSE: "parse must be synchronous; do async work in run()";
			}
	: {};

/** Brand literal defaults that fall outside a literal `choices` tuple. */
type DefaultWithinChoicesBrand<T> = T extends {
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
					: { readonly FIX_DEFAULT_CHOICE: "default must be one of choices" }
			: Default extends string
				? string extends Default
					? {}
					: Exclude<Default, Choice> extends never
						? {}
						: { readonly FIX_DEFAULT_CHOICE: "default must be one of choices" }
				: {}
	: {};

// Whitespace that runtime `isBareToken` rejects in child command names, aliases, and flag spellings.
export type SpacedToken =
	| `${string} ${string}`
	| `${string}\t${string}`
	| `${string}\n${string}`
	| `${string}\r${string}`
	| `${string}\v${string}`
	| `${string}\f${string}`;

// ECMAScript String.trim whitespace, matching runtime `trim()`-based validation.
export type TrimWhitespace =
	| " "
	| "\t"
	| "\n"
	| "\r"
	| "\v"
	| "\f"
	| "\u00a0"
	| "\u1680"
	| "\u2000"
	| "\u2001"
	| "\u2002"
	| "\u2003"
	| "\u2004"
	| "\u2005"
	| "\u2006"
	| "\u2007"
	| "\u2008"
	| "\u2009"
	| "\u200a"
	| "\u2028"
	| "\u2029"
	| "\u202f"
	| "\u205f"
	| "\u3000"
	| "\ufeff";

/** `true` only for `any`, which brands treat as widened input owned by runtime checks. */
export type IsAny<T> = 0 extends 1 & T ? true : false;

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
