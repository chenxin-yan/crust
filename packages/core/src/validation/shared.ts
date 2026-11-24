import type { JsonValue } from "@crustjs/utils/json";
import type { InferInput, StandardSchema } from "@crustjs/utils/schema";

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

/** Brand a statically known name that is already taken, while allowing open names. */
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
 * A contribution to accumulated known spellings; adding an open one as `string` would absorb
 * every known spelling.
 */
export type KnownSpellings<S extends string> = string extends S ? never : S;

/**
 * Brand a definition whose custom parser can return a Promise — parse results
 * are consumed synchronously during argv parsing. `Extract` keeps the check
 * union-aware (a sometimes-async `cond ? Promise.resolve(x) : x` parser is
 * caught). An `any` return is branded too: it is no proof the parser is synchronous.
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

/** `true` only for `any`, which brands treat as widened input they leave unchecked. */
export type IsAny<T> = 0 extends 1 & T ? true : false;

/** Finite literal domains have required record keys; infinite templates and branded strings do not.
 * Distribute first so a finite union member cannot hide an open member's index signature.
 */
export type IsClosedName<N extends string> = false extends (
	N extends unknown ? ({} extends Record<N, true> ? false : true) : never
)
	? false
	: true;

// The value a present argument or flag hands its schema, from argv, `env`, or typed `run()`.
// Absence (`undefined`) is left out: a schema that rejects it owns requiredness. A present
// repeatable flag has at least one occurrence; a variadic may be empty.
type SchemaTokenName<T> = T extends { type: "boolean" } ? "boolean" : "string";
type SchemaToken<T> = { boolean: boolean; string: string }[SchemaTokenName<T>];
type SchemaTokens<T> = T extends { variadic: true }
	? string[]
	: T extends { multiple: true }
		? [SchemaToken<T>, ...SchemaToken<T>[]]
		: SchemaToken<T>;

// An input narrower than the token (an enum, a literal) is validation, so overlap is enough.
type AcceptsTokens<V, Input> = [V] extends [Input]
	? true
	: [V] extends [readonly (infer E)[]]
		? true extends AcceptsTokenElements<E, Extract<Input, readonly unknown[]>>
			? true
			: false
		: [Extract<Input, V>] extends [never]
			? false
			: true;

// Per position: a fixed tuple (`[unknown, unknown]` from coercing members) neither extends
// the token array nor contains it, yet overlaps it when every position accepts a token.
type AcceptsTokenElements<E, A> = A extends readonly unknown[]
	? false extends { [I in keyof A]: AcceptsTokens<E, A[I]> }[number]
		? false
		: true
	: never;

// A json flag hands its schema the parsed JSON value. Overlap again: some JSON value must fit
// the input. An object fits when every required property does (optional keys may be absent,
// and JSON has no symbol keys); a Date (its methods), bigint, or function never does.
type AcceptsJson<Input, Seen extends readonly unknown[] = []> = [JsonValue] extends [Input]
	? true
	: true extends (Input extends unknown ? AcceptsJsonMember<Input, Seen> : never)
		? true
		: false;

// A type recurring inside itself counts as no value, so a recursive input (`Link | null`)
// compiles (TS2615 otherwise) and is accepted only when a finite value of it is JSON.
type IsSeen<M, Seen> = true extends (
	Seen extends unknown ? ([M] extends [Seen] ? ([Seen] extends [M] ? true : false) : false) : never
)
	? true
	: false;

// A recursive input that never repeats (`Nest<T> { next: Nest<T[]> | null }`) would recurse until
// TS2589, so past this depth the check accepts and leaves the rest to runtime validation.
type AcceptsJsonDepth = 8;

type AcceptsJsonMember<M, Seen extends readonly unknown[]> = M extends
	| string
	| number
	| boolean
	| null
	? true
	: IsSeen<M, Seen[number]> extends true
		? false
		: M extends (...args: never[]) => unknown
			? false
			: Seen["length"] extends AcceptsJsonDepth
				? true
				: M extends readonly unknown[]
					? AcceptsJsonElements<M, [...Seen, M]>
					: M extends object
						? false extends {
								[K in keyof M]-?: {} extends Pick<M, K>
									? true
									: K extends symbol
										? false
										: AcceptsJson<M[K], [...Seen, M]>;
							}[keyof M]
							? false
							: true
						: false;

// Only required tuple elements, leading or trailing a rest, must accept JSON; an open array
// accepts `[]`.
type AcceptsJsonElements<
	M extends readonly unknown[],
	Seen extends readonly unknown[],
> = M extends readonly [infer H, ...infer R]
	? AcceptsJson<H, Seen> extends true
		? AcceptsJsonElements<R, Seen>
		: false
	: M extends readonly [...infer R, infer L]
		? AcceptsJson<L, Seen> extends true
			? AcceptsJsonElements<R, Seen>
			: false
		: true;

type SchemaInputMessage<T> = T extends { type: "json" }
	? "schema input must accept JSON data"
	: T extends { variadic: true } | { multiple: true }
		? `schema input must accept ${SchemaTokenName<T>}[]; use an array schema`
		: T extends { type: "boolean" }
			? "schema input must accept boolean"
			: "schema input must accept string; coerce it, e.g. z.coerce.number()";

/** Brand a schema whose input type cannot accept any value the parser hands it. */
type SchemaInputBrand<T> = T extends { schema: infer S extends StandardSchema }
	? (
			T extends { type: "json" }
				? AcceptsJson<InferInput<S>>
				: AcceptsTokens<SchemaTokens<T>, InferInput<S>>
		) extends true
		? {}
		: { readonly FIX_SCHEMA_INPUT: SchemaInputMessage<T> }
	: {};

// `keyof` a union lists only shared keys, so a key in one branch alone would escape its checks.
export type KeysOfAnyBranch<D> = D extends unknown ? keyof D : never;

// An optional key typed `?: never` holds no value: it is how a definition type forbids a property.
type HeldKeys<T> = T extends unknown
	? {
			[K in keyof T]-?: {} extends Pick<T, K>
				? [Exclude<T[K], undefined>] extends [never]
					? never
					: K
				: K;
		}[keyof T]
	: never;

// Only object members are definitions; a primitive in an open record is left to its other checks.
type UnknownKeys<T, Def> = Exclude<HeldKeys<Extract<T, object>>, KeysOfAnyBranch<Def>>;

/**
 * Reject a property no definition of kind `Def` has, such as a misspelled `requried`: a generic
 * parameter admits it, and nothing reads it. `unknown` when every key is known.
 */
export type UnknownKeysBrand<T, Def> =
	IsAny<T> extends true
		? unknown
		: [UnknownKeys<T, Def>] extends [never]
			? unknown
			: { readonly FIX_UNKNOWN_PROPERTY: `Unknown property "${UnknownKeys<T, Def> & string}"` };

/** Reject independently provable invalid local values, including members of uncertain definitions. */
export type LocalValueBrand<T> = UnionToIntersection<
	T extends unknown
		? AsyncParseBrand<T> & DefaultWithinChoicesBrand<T> & SchemaInputBrand<T>
		: never
>;
