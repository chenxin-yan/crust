import type { DefiningOf } from "../api/context.ts";
import type { CommandDefinitionData } from "../command/crust.ts";
import type { FlagDef, FlagsDef } from "../types.ts";
import type {
	ClosedMembers,
	CollisionBrand,
	DefName,
	EmptyLiteralNameBrand,
	IsAny,
	IsStaticTuple,
	IsClosedName,
	IsUnion,
	LocalValueBrand,
	DefNameMembers,
	SpacedToken,
	UnionToIntersection,
} from "./shared.ts";

// ────────────────────────────────────────────────────────────────────────────
// Compile-time validation
// ────────────────────────────────────────────────────────────────────────────

/** Brand incoming spellings that are already claimed. */
type ExistingSpellingCollisionBrand<S extends string, Existing extends string> = CollisionBrand<
	S,
	Existing,
	"FIX_ALIAS_COLLISION",
	"Flag spelling ",
	" collides with an existing flag"
>;

/**
 * Every statically known canonical, short, and long-alias member, including literals
 * beside an open member. Spelling grammar only: collision evidence stays with
 * {@link ExtractAllAliases}, which must not leak literals out of an open domain.
 * Each field is filtered on its own so a `string`-typed field cannot absorb a
 * sibling field's invalid literal before the filter runs.
 */
type SpellingMembers<F> = LongSpellingMembers<F> | ShortMembers<F>;

// Optional and `undefined`-unioned fields count: a supplied value is still one of the literals.
type LongSpellingMembers<F> =
	| DefNameMembers<F>
	| ClosedMembers<
			F extends { aliases?: infer A extends readonly string[] | undefined }
				? Exclude<A, undefined>[number]
				: never
	  >;

type ShortMembers<F> = ClosedMembers<
	F extends { short?: infer S extends string | undefined } ? Exclude<S, undefined> : never
>;

// Mirrors runtime `isBareToken`, since the parser adds a spelling's dashes. Names and aliases
// (`Long`) also reject `=`: `--a=b` splits there, while `-=` still reaches a short.
// Valid spellings take only the first `extends`.
type SpellingShapeError<S extends string, Long extends boolean> = S extends
	| SpacedToken
	| `-${string}`
	| (Long extends true ? `${string}=${string}` : never)
	? S extends SpacedToken
		? `Flag spelling "${S}" must not contain whitespace`
		: S extends `-${string}`
			? `Flag spelling "${S}" must not start with "-"; the parser adds the dashes`
			: `Flag spelling "${S}" must not contain "="`
	: never;

type SpellingShapeBrand<Long extends string, Short extends string = never> = [
	SpellingShapeError<Long, true> | SpellingShapeError<Short, false>,
] extends [never]
	? {}
	: {
			readonly FIX_SPELLING_SHAPE:
				| SpellingShapeError<Long, true>
				| SpellingShapeError<Short, false>;
		};

/** Reject `__proto__`, which mutates the prototype of plain-object flag registries. */
type ReservedSpellingBrand<F> =
	"__proto__" extends SpellingMembers<F>
		? {
				readonly FIX_RESERVED_SPELLING: 'Flag spelling "__proto__" is reserved';
			}
		: {};

type EmptySpellingError = {
	readonly FIX_EMPTY_SPELLING: "Flag names and aliases must be non-empty strings";
};

/** Reject empty flag names, including an empty member of a name union beside an open member. */
type EmptyFlagSpellingBrand<Name extends string> = EmptyLiteralNameBrand<Name, EmptySpellingError>;

/** Reject empty spellings: their CLI tokens (`--`, `-`) are unparseable, so the flag can never be supplied. */
type EmptySpellingBrand<F> = "" extends SpellingMembers<F> ? EmptySpellingError : {};

// Each binding of an env union is read on its own, so one binding's missing or open field
// cannot hide another's empty literal. Optional and `undefined`-unioned fields still count:
// a value that can only be `""` when supplied is a known mistake.
type EnvBinding<F> = F extends { env?: infer E } ? Exclude<E, undefined> : never;
type EnvNames<E> = E extends { name: infer N extends string } ? ClosedMembers<N> : never;
type Delimiters<T> = T extends { delimiter?: infer D } ? ClosedMembers<Extract<D, string>> : never;

/** Reject an empty env variable name: the variable can never be read. */
type EmptyEnvBrand<F> =
	"" extends EnvNames<EnvBinding<F>>
		? { readonly FIX_EMPTY_ENV: "env.name must be a non-empty string" }
		: {};

/**
 * Reject an empty delimiter, which would split values into single characters. Each field is
 * filtered on its own so a `string`-typed field cannot absorb the other's empty literal.
 */
type EmptyDelimiterBrand<F> = "" extends Delimiters<F> | Delimiters<EnvBinding<F>>
	? { readonly FIX_EMPTY_DELIMITER: "delimiter and env.delimiter must be non-empty strings" }
	: {};

// Most flags have neither field; testing for them first keeps the common case cheap.
type EmptyTextBrand<F> = F extends unknown
	? [Extract<keyof F, "env" | "delimiter">] extends [never]
		? {}
		: EmptyEnvBrand<F> & EmptyDelimiterBrand<F>
	: never;

type RepeatedAliases<
	Aliases extends readonly string[],
	Seen extends string,
> = Aliases extends readonly [infer Head extends string, ...infer Tail extends readonly string[]]
	? (Head & Seen) | RepeatedAliases<Tail, Seen | Head>
	: never;

type OwnAliasesBrand<F> = F extends { aliases?: infer A extends readonly string[] | undefined }
	? RepeatedAliases<Exclude<A, undefined>, ExtractShort<F>> extends infer Duplicate extends string
		? [Duplicate] extends [never]
			? {}
			: { readonly FIX_ALIAS_COLLISION: "Flag repeats one of its own spellings" }
		: never
	: {};

type InvalidShort<S extends string> = S extends `${infer _First}${infer Rest}`
	? Rest extends ""
		? never
		: S
	: S;

type ShortLengthBrand<F> = F extends { short?: infer S extends string | undefined }
	? Exclude<S, undefined> extends infer Short extends string
		? string extends Short
			? {}
			: [InvalidShort<Short>] extends [never]
				? {}
				: { readonly FIX_SHORT_LENGTH: "Short flags must be one character" }
		: never
	: {};

// ────────────────────────────────────────────────────────────────────────────
// Flag alias collision detection (compile-time, per-flag granularity)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Extract the `short` alias literal from a flag definition.
 * Resolves to `never` when the field is absent or its spelling domain is open.
 */
type ExtractShort<F> = F extends { short?: infer Field }
	? Exclude<Field, undefined> extends infer S extends string
		? IsClosedName<S> extends true
			? S
			: never
		: never
	: never;

/**
 * Extract alias string literals from the `aliases` array of a flag definition.
 * Resolves to `never` when the field is absent or its element domain is open.
 */
type ExtractLongAliases<F> = F extends { aliases?: infer Field }
	? Exclude<Field, undefined> extends infer A extends readonly string[]
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

type NoPrefixBrand<S extends string> = [Extract<S, `no-${string}`>] extends [never]
	? {}
	: { readonly FIX_NO_PREFIX: "Names must not start with no-" };

// ────────────────────────────────────────────────────────────────────────────
// Context-owned flag validation (compile-time, per-instance granularity)
// ────────────────────────────────────────────────────────────────────────────

// Distributive over C: a union of Contexts must yield the union of their owned flags, not
// a single inference over the whole union (which collapses to {} when one member owns none).
export type ContextOwnedFlags<C> = C extends unknown
	? DefiningOf<C> extends { readonly _ownedFlags?: infer OF extends FlagsDef }
		? OF
		: {}
	: never;

type ContextFlagCollisionBrand<C, Existing extends string> = ExistingSpellingCollisionBrand<
	LocalSpellingsOf<ContextOwnedFlags<C>>,
	Existing
>;

// ────────────────────────────────────────────────────────────────────────────
// Extension flag validation (compile-time, per-extension granularity)
// ────────────────────────────────────────────────────────────────────────────

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

/** All statically known owned-flag spellings across a tuple of Context instances. */
export type ProvidedContextSpellings<
	P extends readonly unknown[],
	Acc extends string = never,
> = P extends readonly [infer H, ...infer T extends readonly unknown[]]
	? ProvidedContextSpellings<T, Acc | LocalSpellingsOf<ContextOwnedFlags<H>>>
	: [P[number]] extends [never]
		? Acc
		: Acc | LocalSpellingsOf<ContextOwnedFlags<P[number]>>;

/** All statically known flag spellings an Extension contributes: declared flags plus provided Context-owned flags. */
type ExtensionSpellings<E> =
	| LocalSpellingsOf<ExtensionFlagDefsOf<E>>
	| ([E] extends [never]
			? never
			: DefiningOf<E> extends { readonly provide?: infer P extends readonly unknown[] }
				? ProvidedContextSpellings<P>
				: never);

type ExtensionFlagCollisionBrand<E, Existing extends string> = CollisionBrand<
	ExtensionSpellings<E>,
	Existing,
	"FIX_ALIAS_COLLISION",
	"Extension flag spelling ",
	" collides with an existing flag"
>;

/**
 * Validate each Extension's contributed flag spellings against accumulated
 * existing spellings and against Extensions earlier in the same `.extend()`
 * call. Extensions must not override application flags: a silent overwrite
 * would retype an already-bound action's flag at parse time.
 */
export type ValidateExtensionFlags<
	Es extends readonly unknown[],
	Existing extends string,
	// Accumulating in tail position lets one `.extend()` take 45+ Extensions without TS2589.
	Acc extends readonly unknown[] = readonly [],
> = Es extends readonly [infer H, ...infer T extends readonly unknown[]]
	? ValidateExtensionFlags<
			T,
			Existing | ExtensionSpellings<H>,
			readonly [...Acc, H & ExtensionFlagCollisionBrand<H, Existing>]
		>
	: Acc extends readonly []
		? Es
		: readonly [...Acc, ...Es];

// ────────────────────────────────────────────────────────────────────────────
// Command-tree flag spellings (for Extension-vs-subcommand collision checks)
// ────────────────────────────────────────────────────────────────────────────

// Widened (`any`) definitions opt out instead of recursing.
type ShapeSpellings<S> =
	IsAny<S> extends true
		? string
		: S extends { readonly flags: infer F extends FlagsDef; readonly children: infer C }
			? LocalSpellingsOf<F> | TreeSpellings<C>
			: never;

/** Every flag spelling reachable in a compile-time command tree (`Record<spelling, CommandShape>`), recursively. */
export type TreeSpellings<Tree> =
	IsAny<Tree> extends true
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
export type ShapeFlagCollisionBrand<S, Ext extends string> = CollisionBrand<
	ShapeSpellings<S>,
	Ext,
	"FIX_ALIAS_COLLISION",
	"Flag spelling ",
	" collides with a registered Extension flag"
>;

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
export type ExtensionsSpellings<
	Es extends readonly unknown[],
	Acc extends string = never,
> = Es extends readonly [infer H, ...infer T extends readonly unknown[]]
	? ExtensionsSpellings<T, Acc | ExtensionSpellings<H>>
	: ExtensionSpellings<Es[number]> extends never
		? Acc
		: string;

/**
 * Validate Context-owned flags against accumulated existing spellings and
 * against instances earlier in the same `.provide(a(), b())` call. Without
 * the batch check a same-call collision silently resolves last-write-wins,
 * and a required flag shadowed by a peer's alias becomes impossible to supply.
 */
export type ProvideChecks<
	Sp extends string,
	Cs extends readonly unknown[],
	// Accumulating in tail position lets one `.provide()` take 46+ Contexts without TS2589.
	Acc extends readonly unknown[] = readonly [],
> = Cs extends readonly [infer H, ...infer T extends readonly unknown[]]
	? ProvideChecks<
			Sp | LocalSpellingsOf<ContextOwnedFlags<H>>,
			T,
			readonly [...Acc, H & ContextFlagCollisionBrand<H, Sp>]
		>
	: Acc extends readonly []
		? Cs
		: readonly [...Acc, ...Cs];

// ────────────────────────────────────────────────────────────────────────────

/** Whether canonical and alias spellings form a closed, fixed local namespace. */
type HasClosedFlagSpellings<F> = F extends { name: infer N extends string }
	? false extends
			| IsClosedName<N>
			| ("short" extends keyof F
					? F extends { short: infer S extends string }
						? IsClosedName<S>
						: false
					: true)
			| ("aliases" extends keyof F
					? F extends { aliases: infer A extends readonly string[] }
						? false extends IsStaticTuple<A> | IsClosedName<A[number]>
							? false
							: true
						: false
					: true)
		? false
		: true
	: false;

export type LocalFlagBrand<F> = UnionToIntersection<
	F extends unknown ? LocalFlagBranchBrand<F> : never
>;

type LocalFlagBranchBrand<F> = LocalValueBrand<F> &
	OwnAliasesBrand<F> &
	ShortLengthBrand<F> &
	ReservedSpellingBrand<F> &
	EmptySpellingBrand<F> &
	SpellingShapeBrand<LongSpellingMembers<F>, ShortMembers<F>> &
	EmptyTextBrand<F> &
	NoPrefixBrand<SpellingMembers<F>> &
	([DefName<F> & ExtractAllAliases<F>] extends [never]
		? {}
		: { readonly FIX_ALIAS_COLLISION: "Flag repeats one of its own spellings" });

/**
 * Errors-only validation for a flag record (`.flags({ out: { type: "string" } })`):
 * `unknown` when valid; otherwise each offending key carries its brands, so the diagnostic
 * lands on that flag's object literal. Each flag is checked against `Existing` and against
 * every other flag in the record. An index signature (a dynamic record) is left to runtime
 * checks, but literal keys beside it are still validated, including against each other.
 */
export type FlagRecordErrors<F, Existing extends string> =
	// Each branch of a conditional record is checked on its own; a valid branch's `unknown`
	// would absorb an invalid sibling's errors in a union, so the branches intersect.
	BranchRecordErrors<F, Existing> extends (errors: infer E) => void ? E : never;

type BranchRecordErrors<F, Existing extends string> = F extends unknown
	? (errors: OneRecordErrors<F, Existing>) => void
	: never;

type OneRecordErrors<F, Existing extends string> = RecordErrors<
	F,
	[KnownFlagKey<keyof F>] extends [never]
		? // An index signature absorbs literal keys in `keyof`; mapping per key recovers them.
			keyof { [K in keyof F as KnownFlagKey<K>]: 0 } & string
		: KnownFlagKey<keyof F> & string,
	Existing
>;

// Every short and alias in the record, computed once: a flag without its own short or aliases
// only needs this union, which keeps a large record of plain flags linear instead of quadratic.
type RecordErrors<
	F,
	Names extends string,
	Existing extends string,
	AllAliases extends string = ExtractAllAliases<F[Names & keyof F]>,
> = DropEmpty<{
	[K in keyof F as KnownFlagKey<K>]: K extends string
		? IntegerLikeBrand<K> &
				UndefinedFlagBrand<F, K> &
				RecordFlagBrand<F, K, Names, Existing, AllAliases>
		: K extends number
			? // Builders keep `keyof F` as is, so a number key would hide its runtime spelling from collision checks.
				{ readonly FIX_NUMBER_KEY: "Flag names must be string keys; quote a numeric name" }
			: { readonly FIX_SYMBOL_KEY: "Flag names must be string keys; .flags() ignores symbol keys" };
}>;

// Only index signatures are dropped; number and symbol keys stay so they can be rejected.
type KnownFlagKey<K> = string extends K ? never : number extends K ? never : K;

type IntegerLikeMessage = "Flag names must not be integer-like; JavaScript lists such keys first";

// Mirrors the runtime `^(0|[1-9]\d*)$` check, which covers every canonical decimal integer, not
// only array indexes.
// Written inline (not an alias) so diagnostics print the message.
type IntegerLikeBrand<K extends string> = K extends `${bigint}`
	? K extends `-${string}` | `0${string}`
		? K extends "0"
			? { readonly FIX_INTEGER_LIKE_NAME: IntegerLikeMessage }
			: {}
		: { readonly FIX_INTEGER_LIKE_NAME: IntegerLikeMessage }
	: {};

// The runtime rejects an `undefined` definition; only an optional key may be absent.
// Without strictNullChecks every type admits `undefined`, so neither check can tell.
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
	: undefined extends F[keyof F]
		? F extends unknown
			? {
					[K in keyof F as [Exclude<F[K], undefined>] extends [never] ? never : K]: Exclude<
						F[K],
						undefined
					>;
				}
			: never
		: F;

// Only these fields can make one flag invalid on its own; other flags need name checks only.
type RiskyFlagField = "short" | "aliases" | "choices" | "parse" | "env" | "delimiter";

type RecordFlagBrand<
	F,
	K extends keyof F & string,
	Names extends string,
	Existing extends string,
	AllAliases extends string,
> = (KeysOfAnyBranch<F[K]> & RiskyFlagField extends never
	? RecordNameBrand<K>
	: LocalFlagBrand<F[K] & { name: K }>) &
	ExistingSpellingCollisionBrand<
		K | ExtractAllAliases<F[K]>,
		// An open `Existing` (after a dynamic record) is checked at runtime; dropping it keeps
		// this record's own flags checked against each other instead of skipping every check.
		| (string extends Existing ? never : Existing)
		// A flag without a known short or alias can only collide with another flag's alias.
		| ([ExtractAllAliases<F[K]>] extends [never]
				? AllAliases
				:
						| Exclude<Names, K>
						| { [O in Exclude<Names, K>]: ExtractAllAliases<F[O & keyof F]> }[Exclude<Names, K>])
	>;

// `keyof` a union lists only shared keys, so a risky field in one branch would skip its checks.
type KeysOfAnyBranch<D> = D extends unknown ? keyof D : never;

type RecordNameBrand<K extends string> = NoPrefixBrand<K> &
	EmptyFlagSpellingBrand<K> &
	SpellingShapeBrand<ClosedMembers<K>> &
	ReservedSpellingBrand<{ name: K }>;

// `unknown` when nothing is wrong: an empty `{}` left in `F & Errors` makes every call relate
// its record to the intersection, which measurably slows checking.
type DropEmpty<M> = NonEmpty<{ [K in keyof M as {} extends M[K] ? never : K]: M[K] }>;
type NonEmpty<M> = keyof M extends never ? unknown : M;

/** Broad structural builder holders must not default their spelling state to empty. */
export type LocalSpellingsOf<F extends FlagsDef> = string extends keyof F
	? string
	: true extends {
				[K in keyof F]: HasClosedFlagSpellings<F[K] & { name: K }> extends false ? true : false;
		  }[keyof F]
		? string
		: SpellingsOf<F>;
