import type { FlagsDef, NamedFlagDef, NamedFlagsRecord } from "../types.ts";
import type { AsyncParseBrand, DefaultWithinChoicesBrand, DefName, Overlap } from "./shared.ts";

// ────────────────────────────────────────────────────────────────────────────
// Compile-time validation
// ────────────────────────────────────────────────────────────────────────────

/** Extract only the branded error properties from a validated record value. */
type FlagDefBrand<Name, V> = Name extends keyof V
	? Pick<V[Name], Extract<keyof V[Name], `FIX_${string}`>>
	: {};

/** Brand an incoming definition when one of its spellings is already claimed. */
type ExistingFlagCollisionBrand<F, Existing extends string> =
	Overlap<DefName<F> | ExtractAllAliases<F>, Existing> extends infer Collision extends string
		? [Collision] extends [never]
			? {}
			: {
					readonly FIX_ALIAS_COLLISION: `Flag spelling "${Collision}" collides with an existing flag`;
				}
		: never;

/** Reject `__proto__`, which mutates the prototype of plain-object flag registries. */
type ReservedSpellingBrand<F> = "__proto__" extends DefName<F> | ExtractAllAliases<F>
	? {
			readonly FIX_RESERVED_SPELLING: 'Flag spelling "__proto__" is reserved';
		}
	: {};

/** Reject empty spellings: their CLI tokens (`--`, `-`) are unparseable, so the flag can never be supplied. */
type EmptySpellingBrand<F> = "" extends DefName<F> | ExtractAllAliases<F>
	? {
			readonly FIX_EMPTY_SPELLING: "Flag names and aliases must be non-empty strings";
		}
	: {};

/** Canonical names claimed by more than one definition in the same call. */
type DuplicateNames<
	Defs extends readonly NamedFlagDef[],
	Seen extends string = never,
> = Defs extends readonly [infer Head, ...infer Tail extends readonly NamedFlagDef[]]
	? (DefName<Head> & Seen) | DuplicateNames<Tail, Seen | DefName<Head>>
	: never;

/** Brand every occurrence of a name repeated within one `.flags()` call. */
type DuplicateNameBrand<F, Dups extends string> =
	Overlap<DefName<F>, Dups> extends infer Duplicate extends string
		? [Duplicate] extends [never]
			? {}
			: {
					readonly FIX_ALIAS_COLLISION: `Flag "${Duplicate}" is already defined`;
				}
		: never;

/**
 * Per-definition validation for the variadic `.flags(...defs)` call.
 *
 * Runs the record-based validators ({@link ValidateFlagAliases},
 * {@link ValidateNoPrefixedFlags}) against the derived record, then maps
 * each branded record value back onto the tuple element that declared it —
 * so collisions, `no-` prefixes, and async parsers error on the offending argument.
 *
 * Bounded-generic wrappers (e.g. `<F extends FlagsDef>(app: Crust<F, A, C>)`)
 * keep the default `Sp = SpellingsOf<F>` deferred and will not typecheck against
 * `Existing`; type wrapper parameters as `Crust<any, ...>` instead, whose default
 * `SpellingsOf<any>` is `never` (see tests/helpers.ts).
 */
export type ValidateNamedFlagDefs<
	Defs extends readonly NamedFlagDef[],
	Existing extends string = never,
	Validated = Defs extends Defs
		? ValidateNoPrefixedFlags<ValidateFlagAliases<NamedFlagsRecord<Defs>>>
		: never,
	Dups extends string = DuplicateNames<Defs>,
> = {
	[I in keyof Defs]: Defs[I] &
		FlagDefBrand<Defs[I]["name"], Validated> &
		ExistingFlagCollisionBrand<Defs[I], Existing> &
		DuplicateNameBrand<Defs[I], Dups> &
		AsyncParseBrand<Defs[I]> &
		DefaultWithinChoicesBrand<Defs[I]> &
		ReservedSpellingBrand<Defs[I]> &
		EmptySpellingBrand<Defs[I]>;
};

// ────────────────────────────────────────────────────────────────────────────
// Flag alias collision detection (compile-time, per-flag granularity)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Extract the `short` alias literal from a flag definition.
 * Resolves to `never` when no `short` field exists or when the type
 * is the broad `string` (not a narrowed literal).
 */
type ExtractShort<F> = F extends { short: infer S }
	? S extends string
		? string extends S
			? never
			: S
		: never
	: never;

/**
 * Extract alias string literals from the `aliases` array of a flag definition.
 * Resolves to `never` when no `aliases` field exists or when the element type
 * is the broad `string` (not narrowed literals).
 */
type ExtractLongAliases<F> = F extends { aliases: infer A }
	? A extends readonly string[]
		? string extends A[number]
			? never
			: A[number]
		: never
	: never;

/**
 * Extract all alias identifiers (short + long) from a flag definition.
 *
 * Generalized to work with any shape; values without `short`/`aliases`
 * fields resolve to `never`.
 *
 * Includes `string extends ...` guards so non-narrowed types (e.g. the
 * broad `string` type from a default generic) resolve to `never` instead
 * of causing false-positive collisions.
 */
type ExtractAllAliases<F> = ExtractShort<F> | ExtractLongAliases<F>;

/** All narrowed canonical, short, and long-alias spellings in a flags record. */
export type SpellingsOf<F extends FlagsDef> = string extends keyof F
	? never
	:
			| (keyof F & string)
			| {
					[K in keyof F & string]: ExtractAllAliases<F[K]>;
			  }[keyof F & string];

/**
 * Collects aliases from every flag *except* flag K.
 * Used to detect alias→alias duplicates across different flags.
 */
type AliasesExcluding<F extends FlagsDef, K extends keyof F & string> = {
	[J in Exclude<keyof F & string, K>]: ExtractAllAliases<F[J]>;
}[Exclude<keyof F & string, K>];

/**
 * Per-flag collision detection: resolves to the alias literal(s) of flag K
 * that collide with a flag name (including K's own) or another flag's alias,
 * or `never` when K's aliases are all unique.
 */
type CollidingAliases<F extends FlagsDef, K extends keyof F & string> =
	| (ExtractAllAliases<F[K]> & (keyof F & string)) // alias→name (self included)
	| (ExtractAllAliases<F[K]> & AliasesExcluding<F, K>); // alias→alias

/**
 * Per-flag validation mapped type. Resolves to `F` when no collisions exist.
 * For flags with colliding aliases, adds a branded error property to the
 * specific flag definition, causing a type error on that flag's value.
 *
 * ```
 * Property 'FIX_ALIAS_COLLISION' is missing in type '{ type: "string"; short: "m" }'
 *   but required in type
 *     '{ readonly FIX_ALIAS_COLLISION: "Alias \"m\" collides with another flag name or alias" }'.
 * ```
 */
type ValidateFlagAliases<F extends FlagsDef> = {
	[K in keyof F & string]: CollidingAliases<F, K> extends never
		? F[K]
		: F[K] & {
				readonly FIX_ALIAS_COLLISION: `Alias "${CollidingAliases<F, K>}" collides with another flag name or alias`;
			};
};

// ────────────────────────────────────────────────────────────────────────────
// "no-" prefix validation (compile-time, per-flag granularity)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Detects whether a single alias literal starts with `"no-"`.
 * Resolves to the offending alias, or `never` when it is clean.
 */
type NoPrefixedAlias<A> = A extends `no-${string}` ? A : never;

/**
 * Collects all `"no-"`-prefixed alias literals from a flag definition.
 * Checks both `short` and `aliases` fields.
 * Non-narrowed `string` types resolve to `never` to avoid false positives.
 */
type NoPrefixedAliases<F> =
	| NoPrefixedAlias<ExtractShort<F>>
	| NoPrefixedAlias<ExtractLongAliases<F>>;

/**
 * Per-flag validation mapped type. Resolves to `F` when no `"no-"` prefixes
 * exist on flag names, short aliases, or long aliases. For flags with offending values,
 * adds a branded error property causing a compile-time type error.
 *
 * The `"no-"` prefix is reserved for boolean flag negation (`--no-flag`).
 * Define only the positive form (e.g. `cache`) and use `--no-cache` at runtime.
 *
 * ```
 * Property 'FIX_NO_PREFIX' is missing in type '{ type: "boolean" }'
 *   but required in type
 *     '{ readonly FIX_NO_PREFIX: "Flag name \"no-cache\" must not start with \"no-\"; define \"cache\" instead and use \"--no-cache\" at runtime" }'.
 * ```
 */
type ValidateNoPrefixedFlags<F extends FlagsDef> = {
	[K in keyof F & string]: K extends `no-${infer Base}`
		? F[K] & {
				readonly FIX_NO_PREFIX: `Flag name "${K}" must not start with "no-"; define "${Base}" instead and use "--no-${Base}" at runtime`;
			}
		: NoPrefixedAliases<F[K]> extends never
			? F[K]
			: F[K] & {
					readonly FIX_NO_PREFIX: `Alias "${NoPrefixedAliases<F[K]>}" must not start with "no-"; the "no-" prefix is reserved for boolean negation`;
				};
};

// ────────────────────────────────────────────────────────────────────────────
// Context-owned flag validation (compile-time, per-instance granularity)
// ────────────────────────────────────────────────────────────────────────────

type ContextOwnedFlags<C> = C extends {
	readonly _ownedFlags?: infer OF extends FlagsDef;
}
	? OF
	: {};

type ContextFlagCollisionBrand<C, Existing extends string> =
	Overlap<SpellingsOf<ContextOwnedFlags<C>>, Existing> extends infer Collision extends string
		? [Collision] extends [never]
			? {}
			: {
					readonly FIX_ALIAS_COLLISION: `Flag spelling "${Collision}" collides with an existing flag`;
				}
		: never;

// ────────────────────────────────────────────────────────────────────────────
// Extension flag validation (compile-time, per-extension granularity)
// ────────────────────────────────────────────────────────────────────────────

/** Declared flag literals carried by an Extension's `_flagDefs` phantom; widened Extensions opt out. */
type ExtensionFlagDefsOf<E> = E extends {
	readonly _flagDefs?: infer D extends readonly NamedFlagDef[];
}
	? D
	: readonly NamedFlagDef[];

type ProvidedSpellings<P extends readonly unknown[]> = P extends readonly [
	infer H,
	...infer T extends readonly unknown[],
]
	? SpellingsOf<ContextOwnedFlags<H>> | ProvidedSpellings<T>
	: never;

/** All statically known flag spellings an Extension contributes: declared flags plus provided Context-owned flags. */
export type ExtensionSpellings<E> =
	| SpellingsOf<NamedFlagsRecord<ExtensionFlagDefsOf<E>>>
	| (E extends { readonly provides?: infer P extends readonly unknown[] }
			? ProvidedSpellings<P>
			: never);

type ExtensionFlagCollisionBrand<E, Existing extends string> =
	Overlap<ExtensionSpellings<E>, Existing> extends infer Collision extends string
		? [Collision] extends [never]
			? {}
			: {
					readonly FIX_ALIAS_COLLISION: `Extension flag spelling "${Collision}" collides with an existing flag`;
				}
		: never;

/**
 * Validate each Extension's contributed flag spellings against accumulated
 * existing spellings and against Extensions earlier in the same `.extend()`
 * call. Extensions must not override application flags: a silent overwrite
 * would retype an already-bound action's flag at parse time.
 */
export type ValidateExtensionFlags<
	Es extends readonly unknown[],
	Existing extends string,
> = Es extends readonly [infer H, ...infer T extends readonly unknown[]]
	? readonly [
			H & ExtensionFlagCollisionBrand<H, Existing>,
			...ValidateExtensionFlags<T, Existing | ExtensionSpellings<H>>,
		]
	: Es;

/** Union of every statically known flag spelling contributed by a tuple of Extensions. */
export type ExtensionsSpellings<Es extends readonly unknown[]> = Es extends readonly [
	infer H,
	...infer T extends readonly unknown[],
]
	? ExtensionSpellings<H> | ExtensionsSpellings<T>
	: never;

/**
 * Validate Context-owned flags against accumulated existing spellings.
 *
 * Only compares each instance against `Sp`. Pairwise checks between instances
 * in the same `.provide(a(), b())` call are omitted because they cost roughly
 * 9k extra type instantiations for a rare misuse.
 */
export type ProvideChecks<Sp extends string, Cs extends readonly unknown[]> = {
	[I in keyof Cs]: Cs[I] & ContextFlagCollisionBrand<Cs[I], Sp>;
};

// ────────────────────────────────────────────────────────────────────────────
