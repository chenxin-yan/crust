import type { DefiningOf } from "../api/context.ts";
import type { CommandDefinitionData } from "../command/crust.ts";
import type { commandDefinitionInternal } from "../command/node.ts";
import type {
	ClosedMembers,
	CollisionBrand,
	DefName,
	HasClosedNames,
	IsClosedName,
	IsStaticTuple,
	IsUnion,
	DefNameMembers,
	UnionToIntersection,
} from "./shared.ts";

// ────────────────────────────────────────────────────────────────────────────
// Compile-time validation
// ────────────────────────────────────────────────────────────────────────────

/** Preserve configured aliases; only a genuinely absent field proves an empty set. */
export type AliasesOf<C> = C extends { readonly aliases: infer A extends readonly string[] }
	? A
	: "aliases" extends keyof C
		? readonly string[]
		: readonly [];

// Key/collision evidence: all-or-nothing, so an open member never leaks literal siblings.
type NarrowAliases<A extends readonly string[]> =
	IsClosedName<A[number]> extends true ? A[number] : never;

// Spelling grammar: each literal member is independently provable.
type AliasMembers<A extends readonly string[]> = ClosedMembers<A[number]>;

// Whitespace that runtime `isCommandToken` rejects in child names and aliases.
type SpacedToken =
	| `${string} ${string}`
	| `${string}\t${string}`
	| `${string}\n${string}`
	| `${string}\r${string}`
	| `${string}\v${string}`
	| `${string}\f${string}`;

type AliasShapeError<Name extends string, Alias extends string> = Alias extends ""
	? `Subcommand "${Name}" has an invalid alias: must be a non-empty string`
	: Alias extends SpacedToken
		? `Subcommand "${Name}" alias "${Alias}" must not contain whitespace`
		: Alias extends `-${string}`
			? `Subcommand "${Name}" alias "${Alias}" must not start with "-" (reserved for flags)`
			: string extends Name
				? never
				: Alias extends Name
					? `Subcommand "${Name}" alias "${Alias}" must not equal its own canonical name`
					: never;

type AliasShapeErrors<Name extends string, C> =
	AliasMembers<AliasesOf<C>> extends infer Alias
		? Alias extends string
			? AliasShapeError<Name, Alias>
			: never
		: never;

type AliasShapeBrand<Name extends string, C> = [AliasShapeErrors<Name, C>] extends [never]
	? {}
	: { readonly FIX_ALIAS_SHAPE: AliasShapeErrors<Name, C> };

type RootVersionBrand<C> = "version" extends keyof C
	? { readonly FIX_ROOT_VERSION: 'Command config "version" belongs on the root Crust constructor' }
	: {};

/** Brand command config containing statically known invalid metadata. */
export type ValidateCommandConfig<Name extends string, C> = AliasShapeBrand<Name, C> &
	RootVersionBrand<C>;

type EmptyNameError = { readonly FIX_EMPTY_NAME: "Command name must be a non-empty string" };

// ECMAScript String.trim whitespace, matching canonical command-name validation.
type TrimWhitespace =
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

type BlankName<Name extends string> = Name extends `${TrimWhitespace}${infer Tail}`
	? BlankName<Tail>
	: Name extends ""
		? true
		: false;

/** Runtime checks own open members; every statically known member is validated, even beside an open one. */
export type CommandNameBrand<Name extends string> =
	true extends BlankName<ClosedMembers<Name>>
		? EmptyNameError
		: "__proto__" extends ClosedMembers<Name>
			? { readonly FIX_RESERVED_NAME: 'Command name "__proto__" is reserved' }
			: {};

type NameShapeError<Name extends string> = Name extends SpacedToken
	? `Command name "${Name}" must not contain whitespace`
	: Name extends `-${string}`
		? `Command name "${Name}" must not start with "-" (reserved for flags)`
		: never;

/**
 * Child names are also matched against one argv token, like aliases. The root
 * name never is, so `new Crust()` keeps {@link CommandNameBrand} alone.
 */
export type ChildCommandNameBrand<Name extends string> =
	CommandNameBrand<Name> extends infer Brand
		? {} extends Brand
			? [NameShapeError<ClosedMembers<Name>>] extends [never]
				? {}
				: { readonly FIX_NAME_SHAPE: NameShapeError<ClosedMembers<Name>> }
			: Brand
		: never;

type DefinitionAliases<D> =
	CommandDefinitionData<D> extends {
		readonly _aliases?: infer A extends readonly string[];
	}
		? A
		: readonly string[];

/** All statically known canonical and alias spellings carried by a command definition. */
export type CommandDefinitionSpellings<D> = D extends unknown
	? D extends { name: infer N extends string }
		? IsUnion<N> extends true
			? never
			: DefName<D> extends infer Name extends string
				? [Name] extends [never]
					? never
					: Name | NarrowAliases<DefinitionAliases<D>>
				: never
		: never
	: never;

// Catches `.as()` renames that land on one of the definition's own aliases
// (config-time AliasShapeError compares aliases against the original name only).
// Distributes over definition unions so `cond ? x : y` compares each variant's
// name with its own aliases; the intersection keeps a `{}` variant from
// absorbing a sibling's error brand.
type SelfAliasBrand<D> = UnionToIntersection<
	D extends unknown
		? DefNameMembers<D> & AliasMembers<DefinitionAliases<D>> extends infer Dup extends string
			? [Dup] extends [never]
				? {}
				: {
						readonly FIX_ALIAS_SHAPE: `Command "${Dup}" must not list its own canonical name as an alias`;
					}
			: never
		: never
>;

export type CommandCollisionBrand<
	Spellings extends string,
	Existing extends string,
> = CollisionBrand<
	Spellings,
	Existing,
	"FIX_COMMAND_COLLISION",
	"Command name or alias ",
	" collides with a sibling command"
>;

/**
 * Validate definitions against existing siblings and definitions earlier in
 * the same `.add()` call. Widened names opt out because their spellings are
 * not statically knowable; their literal aliases opt out with them
 * (see {@link CommandDefinitionSpellings}).
 *
 * Yields only the first offending definition's error brand (`{}` when valid):
 * tail recursion lets one `.add()` take 44+ definitions without TS2589, and
 * stopping early keeps two same-key `FIX_*` literals from intersecting to `never`.
 * Tuple-union variants are intersected so a valid variant cannot erase another's error.
 */
export type ValidateCommandDefinitions<
	Ds extends readonly unknown[],
	Existing extends string = never,
> = UnionToIntersection<
	Ds extends unknown
		? number extends Ds["length"]
			? CommandDefinitionsErrors<Ds, Existing>
			: CommandInfoErrors<
					{
						[I in keyof Ds]: readonly [
							CommandDefinitionSpellings<Ds[I]>,
							ChildCommandNameBrand<DefNameMembers<Ds[I]>> & SelfAliasBrand<Ds[I]>,
						];
					},
					Existing
				>
		: never
>;

// Walks precomputed per-definition spellings and local errors: recursing over the
// definitions themselves re-instantiates the remaining tuple on every step (O(n^2)).
type CommandInfoErrors<Is, Existing extends string> = Is extends readonly [
	readonly [infer S extends string, infer Own],
	...infer T,
]
	? CommandCollisionBrand<S, Existing> & Own extends infer E
		? {} extends E
			? CommandInfoErrors<T, Existing | S>
			: E
		: never
	: {};

type CommandDefinitionsErrors<
	Ds extends readonly unknown[],
	Existing extends string,
> = Ds extends readonly [infer Head, ...infer Tail]
	? CommandDefinitionSpellings<Head> extends infer Spellings extends string
		? CommandCollisionBrand<Spellings, Existing> &
				ChildCommandNameBrand<DefNameMembers<Head>> &
				SelfAliasBrand<Head> extends infer Errors
			? {} extends Errors
				? CommandDefinitionsErrors<Tail, Existing | Spellings>
				: Errors
			: never
		: never
	: {};

export type ExtensionCommandDefs<E> = [E] extends [never]
	? readonly []
	: DefiningOf<E> extends {
				readonly commands?: infer Cs extends readonly unknown[];
		  }
		? Cs
		: readonly [];

/** An uncertain command collection opens only the child namespace. */
type ExtensionCommandSpellings<E> = AttachedCommandSpellings<ExtensionCommandDefs<E>>;
export type ExtensionsCommandSpellings<Es extends readonly unknown[]> =
	IsStaticTuple<Es> extends true
		? { [I in keyof Es]: ExtensionCommandSpellings<Es[I]> }[number]
		: ExtensionCommandDefs<Es[number]>[number] extends never
			? never
			: string;

type ExtensionCommandCollisionBrand<E, Existing extends string> = CollisionBrand<
	ExtensionCommandSpellings<E>,
	Existing,
	"FIX_COMMAND_COLLISION",
	"Extension command ",
	" collides with an existing command"
>;

/**
 * Validate each Extension's contributed command spellings against existing
 * root commands and against Extensions earlier in the same `.extend()` call.
 * Runtime preparation rejects the same collisions as a `DEFINITION` error;
 * this brand reports statically known ones at compile time.
 */
export type ValidateExtensionCommands<
	Es extends readonly unknown[],
	Existing extends string,
> = Es extends readonly [infer H, ...infer T extends readonly unknown[]]
	? readonly [
			H & ExtensionCommandCollisionBrand<H, Existing>,
			...ValidateExtensionCommands<T, Existing | ExtensionCommandSpellings<H>>,
		]
	: Es;

// ────────────────────────────────────────────────────────────────────────────

/** Local metadata checks; unrelated description/version/usage text has no grammar. */
type SectionTextBrand<S> = S extends { title: infer T extends string; body: infer B extends string }
	? true extends BlankName<T> | BlankName<B>
		? { readonly FIX_SECTION_TEXT: "Section title/body must be nonblank" }
		: Extract<T, `${string}\r${string}` | `${string}\n${string}`> extends never
			? {}
			: { readonly FIX_SECTION_TEXT: "Section title must be a single line" }
	: {};

type SectionAudienceBrand<S> = S extends { only: readonly [] } | { except: readonly [] }
	? { readonly FIX_SECTION_AUDIENCE: "Section audience must be nonempty" }
	: {};

export type LocalSectionsBrand<C> = "sections" extends keyof C
	? C extends { sections: infer S extends readonly unknown[] }
		? {
				readonly sections: {
					[I in keyof S]: S[I] &
						UnionToIntersection<SectionTextBrand<S[I]>> &
						UnionToIntersection<SectionAudienceBrand<S[I]>>;
				};
			}
		: {}
	: {};

export type LocalCommandConfigBrand<N extends string, C> = ValidateCommandConfig<N, C> &
	LocalSectionsBrand<C>;

// Fast path for the common `.add(def)`: one definition with a closed, non-union name.
export type AttachedCommandSpellings<Ds extends readonly unknown[]> = [Ds] extends [
	readonly [
		{
			readonly name: infer N extends string;
			readonly [commandDefinitionInternal]: {
				readonly _aliases?: infer Al extends readonly string[];
			};
		},
	],
]
	? IsUnion<N> extends true
		? AttachedCommandSpellingsSlow<Ds>
		: IsClosedName<N> extends true
			? IsClosedName<Al[number]> extends true
				? N | Al[number]
				: string
			: AttachedCommandSpellingsSlow<Ds>
	: AttachedCommandSpellingsSlow<Ds>;

type AttachedCommandSpellingsSlow<Ds extends readonly unknown[]> = [Ds] extends [readonly []]
	? never
	: IsStaticTuple<Ds> extends true
		? HasClosedNames<Ds> extends true
			? false extends {
					[I in keyof Ds]: IsClosedName<DefinitionAliases<Ds[I]>[number]>;
				}[number]
				? string
				: CommandDefinitionSpellings<Ds[number]>
			: string
		: string;
