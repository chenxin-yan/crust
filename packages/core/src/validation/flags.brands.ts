import type { AnyContextInstance, ContextInstanceData } from "../api/context.ts";
import type { ExtensionData } from "../api/extension.ts";
import type { CommandDefinitionData } from "../command/crust.ts";
import type { FlagsDef, NamedFlagDef, NamedFlagsRecord } from "../types.ts";
import type {
	DefName,
	Overlap,
	KnownNameBrand,
	RuntimeRequiredBrand,
	IsStaticTuple,
	IsUnion,
	IsClosedName,
	LocalValueBrand,
} from "./shared.ts";

// ────────────────────────────────────────────────────────────────────────────
// Compile-time validation
// ────────────────────────────────────────────────────────────────────────────

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

type EmptySpellingError = {
	readonly FIX_EMPTY_SPELLING: "Flag names and aliases must be non-empty strings";
};

/** Reject empty flag names, including empty members of a name union. */
export type EmptyFlagSpellingBrand<Name extends string> = "" extends Name ? EmptySpellingError : {};

/** Reject empty spellings: their CLI tokens (`--`, `-`) are unparseable, so the flag can never be supplied. */
type EmptySpellingBrand<F> = "" extends DefName<F> | ExtractAllAliases<F> ? EmptySpellingError : {};

type RepeatedAliases<
	Aliases extends readonly string[],
	Seen extends string,
> = Aliases extends readonly [infer Head extends string, ...infer Tail extends readonly string[]]
	? (Head & Seen) | RepeatedAliases<Tail, Seen | Head>
	: never;

type OwnAliasesBrand<F> = F extends { aliases: infer Aliases extends readonly string[] }
	? RepeatedAliases<Aliases, ExtractShort<F>> extends infer Duplicate extends string
		? [Duplicate] extends [never]
			? {}
			: { readonly FIX_ALIAS_COLLISION: `Flag repeats its own spelling "${Duplicate}"` }
		: never
	: {};

type InvalidShort<S extends string> = S extends `${infer _First}${infer Rest}`
	? Rest extends ""
		? never
		: S
	: S;

type ShortLengthBrand<F> = F extends { short: infer Short extends string }
	? string extends Short
		? {}
		: [InvalidShort<Short>] extends [never]
			? {}
			: { readonly FIX_SHORT_LENGTH: "Short flags must be one character" }
	: {};

// ────────────────────────────────────────────────────────────────────────────
// Flag alias collision detection (compile-time, per-flag granularity)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Extract the `short` alias literal from a flag definition.
 * Resolves to `never` when the field is absent or its spelling domain is open.
 */
type ExtractShort<F> = F extends { short: infer S }
	? S extends string
		? IsClosedName<S> extends true
			? S
			: never
		: never
	: never;

/**
 * Extract alias string literals from the `aliases` array of a flag definition.
 * Resolves to `never` when the field is absent or its element domain is open.
 */
type ExtractLongAliases<F> = F extends { aliases: infer A }
	? A extends readonly string[]
		? IsClosedName<A[number]> extends true
			? A[number]
			: never
		: never
	: never;

/**
 * Extract all alias identifiers (short + long) from a flag definition.
 *
 * Generalized to work with any shape; values without `short`/`aliases`
 * fields resolve to `never`.
 *
 * Closed-name proof excludes open domains from literal collision evidence.
 * Attachment separately keeps their spelling namespace open.
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

// ────────────────────────────────────────────────────────────────────────────
// Context-owned flag validation (compile-time, per-instance granularity)
// ────────────────────────────────────────────────────────────────────────────

export type ContextOwnedFlags<C> = C extends AnyContextInstance
	? ContextInstanceData<C> extends { readonly _ownedFlags?: infer OF extends FlagsDef }
		? OF
		: {}
	: C extends { readonly _ownedFlags?: infer OF extends FlagsDef }
		? OF
		: {};

type ContextFlagCollisionBrand<C, Existing extends string> =
	Overlap<LocalSpellingsOf<ContextOwnedFlags<C>>, Existing> extends infer Collision extends string
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
export type ExtensionFlagDefsOf<E> = [E] extends [never]
	? readonly []
	: ExtensionData<E> extends {
				readonly _flagDefs?: infer D extends readonly NamedFlagDef[];
		  }
		? D
		: readonly NamedFlagDef[];

/** All statically known owned-flag spellings across a tuple of Context instances. */
export type ProvidedContextSpellings<P extends readonly unknown[]> = P extends readonly [
	infer H,
	...infer T extends readonly unknown[],
]
	? LocalSpellingsOf<ContextOwnedFlags<H>> | ProvidedContextSpellings<T>
	: [P[number]] extends [never]
		? never
		: LocalSpellingsOf<ContextOwnedFlags<P[number]>>;

/** All statically known flag spellings an Extension contributes: declared flags plus provided Context-owned flags. */
export type ExtensionSpellings<E> =
	| AttachedSpellings<ExtensionFlagDefsOf<E>>
	| ([E] extends [never]
			? never
			: ExtensionData<E> extends { readonly provides?: infer P extends readonly unknown[] }
				? ProvidedContextSpellings<P>
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

// ────────────────────────────────────────────────────────────────────────────
// Command-tree flag spellings (for Extension-vs-subcommand collision checks)
// ────────────────────────────────────────────────────────────────────────────

// `0 extends 1 & T` detects `any`: widened definitions opt out instead of recursing.
type ShapeSpellings<S> = 0 extends 1 & S
	? string
	: S extends { readonly flags: infer F extends FlagsDef; readonly children: infer C }
		? LocalSpellingsOf<F> | TreeSpellings<C>
		: never;

/** Every flag spelling reachable in a compile-time command tree (`Record<spelling, CommandShape>`), recursively. */
export type TreeSpellings<Tree> = 0 extends 1 & Tree
	? string
	: string extends keyof Tree
		? string
		: Tree extends object
			? { [K in keyof Tree]: ShapeSpellings<Tree[K]> }[keyof Tree]
			: never;

type DefinitionSpellings<D> =
	CommandDefinitionData<D> extends { readonly _shape?: infer S } ? ShapeSpellings<S> : never;

/** Flag spellings contributed by a tuple of command definitions. */
export type DefinitionTreeSpellings<Ds extends readonly unknown[]> = DefinitionSpellings<
	Ds[number]
>;

/**
 * Extension-collision brand over a built command shape. Shared by `.add()`
 * (via {@link ValidateDefinitionFlags}) and inline `.command()`, whose recipe
 * builder exposes a shape instead of a definition tuple.
 */
export type ShapeFlagCollisionBrand<S, Ext extends string> = [Ext] extends [never]
	? {}
	: string extends ShapeSpellings<S> | Ext
		? RuntimeRequiredBrand
		: Overlap<ShapeSpellings<S>, Ext> extends infer Collision extends string
			? [Collision] extends [never]
				? {}
				: {
						readonly FIX_ALIAS_COLLISION: `Flag spelling "${Collision}" collides with a registered Extension flag`;
					}
			: never;

type DefinitionFlagCollisionBrand<D, Ext extends string> =
	CommandDefinitionData<D> extends {
		readonly _shape?: infer S;
	}
		? ShapeFlagCollisionBrand<S, Ext>
		: {};

/**
 * Validate an added definition tree's flag spellings against already-registered
 * Extension flags. Recursive Extension flags inject into every node at prepare
 * time, so a colliding local flag would be silently retyped for its action.
 */
export type ValidateDefinitionFlags<Ds extends readonly unknown[], Ext extends string> = {
	[I in keyof Ds]: Ds[I] & DefinitionFlagCollisionBrand<Ds[I], Ext>;
};

/** Union of every statically known flag spelling contributed by a tuple of Extensions. */
export type ExtensionsSpellings<Es extends readonly unknown[]> = Es extends readonly [
	infer H,
	...infer T extends readonly unknown[],
]
	? ExtensionSpellings<H> | ExtensionsSpellings<T>
	: ExtensionSpellings<Es[number]> extends never
		? never
		: string;

/**
 * Validate Context-owned flags against accumulated existing spellings and
 * against instances earlier in the same `.provide(a(), b())` call. Without
 * the batch check a same-call collision silently resolves last-write-wins,
 * and a required flag shadowed by a peer's alias becomes impossible to supply.
 */
export type ProvideChecks<Sp extends string, Cs extends readonly unknown[]> = Cs extends readonly [
	infer H,
	...infer T extends readonly unknown[],
]
	? readonly [
			H & ContextFlagCollisionBrand<H, Sp>,
			...ProvideChecks<Sp | LocalSpellingsOf<ContextOwnedFlags<H>>, T>,
		]
	: Cs;

// ────────────────────────────────────────────────────────────────────────────

/** Local spelling proof, separate from collisions at an eventual destination. */
export type KnownFlagSpellings<F> = F extends { name: infer N extends string }
	? KnownNameBrand<N> &
			("short" extends keyof F
				? F extends { short: infer S extends string }
					? KnownNameBrand<S>
					: RuntimeRequiredBrand
				: {}) &
			("aliases" extends keyof F
				? F extends { aliases: infer A extends readonly string[] }
					? IsStaticTuple<A> extends true
						? KnownNameBrand<A[number]>
						: RuntimeRequiredBrand
					: RuntimeRequiredBrand
				: {})
	: RuntimeRequiredBrand;

export type LocalFlagBrand<F> = KnownFlagSpellings<F> &
	LocalFlagValuesBrand<F> &
	(Extract<DefName<F>, `no-${string}`> extends never
		? {}
		: { readonly FIX_NO_PREFIX: "Names must not start with no-" }) &
	([DefName<F> & ExtractAllAliases<F>] extends [never]
		? {}
		: { readonly FIX_ALIAS_COLLISION: "Aliases must not equal the canonical name" });

export type LocalFlagFieldsBrand<F> = KnownFlagSpellings<F & { name: never }> &
	LocalFlagValuesBrand<F>;

type LocalFlagValuesBrand<F> = LocalValueBrand<F> &
	OwnAliasesBrand<F> &
	ShortLengthBrand<F> &
	ReservedSpellingBrand<F> &
	EmptySpellingBrand<F> &
	(NoPrefixedAliases<F> extends never
		? {}
		: { readonly FIX_NO_PREFIX: "Aliases must not start with no-" });

/** Trusted authoring and composition require closed local spelling proof. */
export type ValidateLocalFlagDefs<
	Defs extends readonly NamedFlagDef[],
	Existing extends string,
> = Defs &
	LocalFlagTupleChecks<Defs, Existing> &
	(IsUnion<Defs> extends true ? RuntimeRequiredBrand : {}) &
	(string extends Existing ? RuntimeRequiredBrand : {});

// Accumulate only errors: rebuilding a validated tuple forces structural comparison
// of every FlagDef variant during inference. The tail also rejects optional/rest slots.
type LocalFlagTupleChecks<
	Defs extends readonly NamedFlagDef[],
	Existing extends string,
	Errors = {},
> = Defs extends readonly [
	infer Head extends NamedFlagDef,
	...infer Tail extends readonly NamedFlagDef[],
]
	? LocalFlagTupleChecks<
			Tail,
			Existing | DefName<Head> | ExtractAllAliases<Head>,
			Errors &
				LocalFlagBrand<Head> &
				(IsUnion<Head["name"]> extends true ? RuntimeRequiredBrand : {}) &
				ExistingFlagCollisionBrand<Head, Existing>
		>
	: Defs extends readonly []
		? Errors
		: RuntimeRequiredBrand;

/** A checked open collection is not an empty or guaranteed-present flag record. */
export type AttachedFlags<Defs extends readonly NamedFlagDef[]> =
	IsStaticTuple<Defs> extends true
		? true extends {
				[I in keyof Defs]:
					| IsUnion<Defs[I]["name"]>
					| (IsClosedName<Defs[I]["name"]> extends true ? false : true);
			}[number]
			? FlagsDef
			: NamedFlagsRecord<Defs>
		: FlagsDef;
export type AttachedSpellings<Defs extends readonly NamedFlagDef[]> =
	IsStaticTuple<Defs> extends true
		? true extends {
				[I in keyof Defs]: IsUnion<Defs[I]["name"]> extends true
					? true
					: "FIX_RUNTIME_INPUT" extends keyof KnownFlagSpellings<Defs[I]>
						? true
						: false;
			}[number]
			? string
			: SpellingsOf<NamedFlagsRecord<Defs>>
		: string;

export type LocalFlagNameBrand<N extends string> = KnownNameBrand<N> &
	EmptyFlagSpellingBrand<N> &
	ReservedSpellingBrand<{ name: N }> &
	(Extract<N, `no-${string}`> extends never
		? {}
		: { readonly FIX_NO_PREFIX: "Names must not start with no-" });

/** Broad structural builder holders must not default their spelling state to empty. */
export type LocalSpellingsOf<F extends FlagsDef> = string extends keyof F
	? string
	: true extends {
				[K in keyof F]: "FIX_RUNTIME_INPUT" extends keyof KnownFlagSpellings<F[K] & { name: K }>
					? true
					: false;
		  }[keyof F]
		? string
		: SpellingsOf<F>;
