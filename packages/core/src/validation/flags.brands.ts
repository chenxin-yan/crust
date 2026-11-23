import type { DefiningOf } from "../api/context.ts";
import type { FlagDef, FlagsDef } from "../types.ts";
import type { IsUnion, KeysOfAnyBranch, LocalValueBrand, UnknownKeysBrand } from "./shared.ts";

// ────────────────────────────────────────────────────────────────────────────
// Compile-time validation
// ────────────────────────────────────────────────────────────────────────────

// Distributive over C: a union of Contexts must yield the union of their owned flags, not
// a single inference over the whole union (which collapses to {} when one member owns none).
export type ContextOwnedFlags<C> = C extends unknown
	? DefiningOf<C> extends { readonly _ownedFlags?: infer OF extends FlagsDef }
		? OF
		: {}
	: never;

/**
 * Declared flags carried by an Extension's `_flagDefs` phantom. Widened Extensions and
 * unions of Extensions (whose flags may be absent) opt out.
 */
export type ExtensionFlagDefsOf<E> = [E] extends [never]
	? {}
	: EachExtensionFlags<E> extends infer F extends FlagsDef
		? IsUnion<F> extends true
			? FlagsDef
			: F
		: never;

// Distributed, not inferred from the union: inference would reduce `{} | { out: … }` to `{}`.
type EachExtensionFlags<E> = E extends unknown
	? DefiningOf<E> extends { readonly _flagDefs?: infer F extends FlagsDef }
		? F
		: FlagsDef
	: never;

// `recursive: false` flags stay on the root; a possibly-recursive or dynamic record stays open.
export type RecursiveOwnFlags<F> = keyof F extends never
	? {}
	: string extends keyof F
		? FlagsDef
		: true extends {
					[K in keyof F]: F[K] extends { recursive: infer R }
						? boolean extends R
							? true
							: false
						: false;
			  }[keyof F]
			? FlagsDef
			: {
					[K in keyof F as F[K] extends { readonly recursive: false } ? never : K]: F[K];
				};

/**
 * Errors-only validation for a flag record (`.flags({ out: { type: "string" } })`):
 * `unknown` when valid; otherwise each offending key carries its brands, so the diagnostic
 * lands on that flag's object literal. Names, spellings and collisions are checked when the
 * CLI runs from source and by `crust build`, not here.
 */
export type FlagRecordErrors<F, Def = FlagDef> =
	// Each branch of a conditional record is checked on its own; a valid branch's `unknown`
	// would absorb an invalid sibling's errors in a union, so the branches intersect.
	BranchRecordErrors<F, Def> extends (errors: infer E) => void ? E : never;

type BranchRecordErrors<F, Def> = F extends unknown
	? (errors: RecordErrors<PresentRecord<F>, Def>) => void
	: never;

// Absent placeholders are dropped; real optional and required undefined definitions
// remain in the record so the undefined check still applies to them.
type PresentRecord<F> = false extends StrictNulls
	? F
	: undefined extends F[keyof F]
		? {
				[
					K in keyof F as [Exclude<F[K], undefined>] extends [never]
						? {} extends Pick<F, K>
							? never
							: K
						: K
				]: F[K];
			}
		: F;

type RecordErrors<F, Def> = DropEmpty<{
	[K in keyof F as KnownFlagKey<K>]: K extends string
		? UndefinedFlagBrand<F, K> & UnknownKeysBrand<F[K], Def> & FlagValueBrand<F[K]>
		: K extends number
			? // `keyof` keeps the number, so the flag would have no string key (`keyof F & string`).
				{ readonly FIX_NUMBER_KEY: "Flag names must be string keys; quote a numeric name" }
			: { readonly FIX_SYMBOL_KEY: "Flag names must be string keys; .flags() ignores symbol keys" };
}>;

// Only index signatures are dropped; number and symbol keys stay so they can be rejected.
type KnownFlagKey<K> = string extends K ? never : number extends K ? never : K;

// Only these fields can make one flag's values invalid; most flags skip the check.
type FlagValueBrand<D> = KeysOfAnyBranch<D> & ("choices" | "parse" | "schema") extends never
	? {}
	: LocalValueBrand<D>;

// An `undefined` definition is no flag; only an optional key may be absent.
// Without strictNullChecks every type admits `undefined`, so the check cannot tell.
type StrictNulls = undefined extends {} ? false : true;

type UndefinedFlagBrand<F, K extends keyof F> = false extends StrictNulls
	? {}
	: undefined extends F[K]
		? 0 extends 1 & F[K]
			? {}
			: {} extends Pick<F, K>
				? {}
				: {
						readonly FIX_UNDEFINED_FLAG: "Flag definitions must not be undefined; make a flag conditional with { ...(cond ? { name: def } : {}) }";
					}
		: {};

/**
 * `.flags()` input. TypeScript adds `missing?: undefined` to each branch of a conditional
 * record; accepting it keeps inference from falling back to an open record.
 */
export type FlagsInput<D = FlagDef> = { readonly [name: string]: D | undefined };

/** Drops the `missing?: undefined` keys of a conditional record's branches. */
export type DefinedFlags<F, D = FlagsDef> = Extract<DefinedRecord<F>, D>;

type DefinedRecord<F> = false extends StrictNulls
	? F
	: F extends unknown
		? undefined extends F[keyof F]
			? {
					[K in keyof F as [Exclude<F[K], undefined>] extends [never] ? never : K]: Exclude<
						F[K],
						undefined
					>;
				}
			: F
		: never;

// `unknown` when nothing is wrong: an empty `{}` left in `F & Errors` makes every call relate
// its record to the intersection, which measurably slows checking.
type DropEmpty<M> = NonEmpty<{ [K in keyof M as {} extends M[K] ? never : K]: M[K] }>;
type NonEmpty<M> = keyof M extends never ? unknown : M;
