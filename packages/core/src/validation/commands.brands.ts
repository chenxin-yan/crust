import type { DefiningOf } from "../api/context.ts";
import type { CommandDefinitionData } from "../command/crust.ts";
import type {
	CollisionBrand,
	DefName,
	HasClosedNames,
	IsClosedName,
	IsStaticTuple,
	IsUnion,
	Overlap,
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

type NarrowAliases<A extends readonly string[]> =
	IsClosedName<A[number]> extends true ? A[number] : never;

type AliasShapeError<Name extends string, Alias extends string> = Alias extends ""
	? `Subcommand "${Name}" has an invalid alias: must be a non-empty string`
	: Alias extends
				| `${string} ${string}`
				| `${string}\t${string}`
				| `${string}\n${string}`
				| `${string}\r${string}`
				| `${string}\v${string}`
				| `${string}\f${string}`
		? `Subcommand "${Name}" alias "${Alias}" must not contain whitespace`
		: Alias extends `-${string}`
			? `Subcommand "${Name}" alias "${Alias}" must not start with "-" (reserved for flags)`
			: string extends Name
				? never
				: Alias extends Name
					? `Subcommand "${Name}" alias "${Alias}" must not equal its own canonical name`
					: never;

type AliasShapeErrors<Name extends string, C> =
	NarrowAliases<AliasesOf<C>> extends infer Alias
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

/** Runtime checks own open names; provably invalid literal members remain errors. */
export type CommandNameBrand<Name extends string> =
	IsClosedName<Name> extends false
		? {}
		: true extends BlankName<Name>
			? EmptyNameError
			: "__proto__" extends Name
				? { readonly FIX_RESERVED_NAME: 'Command name "__proto__" is reserved' }
				: {};

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
type SelfAliasBrand<D> =
	Overlap<DefName<D>, NarrowAliases<DefinitionAliases<D>>> extends infer Dup extends string
		? [Dup] extends [never]
			? {}
			: {
					readonly FIX_ALIAS_SHAPE: `Command "${Dup}" must not list its own canonical name as an alias`;
				}
		: never;

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
 */
export type ValidateCommandDefinitions<
	Ds extends readonly unknown[],
	Existing extends string = never,
> = Ds extends readonly [infer Head, ...infer Tail]
	? CommandDefinitionSpellings<Head> extends infer Spellings extends string
		? readonly [
				Head &
					CommandCollisionBrand<Spellings, Existing> &
					CommandNameBrand<DefName<Head>> &
					SelfAliasBrand<Head>,
				...ValidateCommandDefinitions<Tail, Existing | Spellings>,
			]
		: never
	: Ds;

export type ExtensionCommandDefs<E> = [E] extends [never]
	? readonly []
	: DefiningOf<E> extends {
				readonly commands?: infer Cs extends readonly unknown[];
		  }
		? Cs
		: readonly [];

/** An uncertain command collection opens only the child namespace. */
export type ExtensionCommandSpellings<E> = AttachedCommandSpellings<ExtensionCommandDefs<E>>;
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
 * Runtime preparation resolves collisions last-write-wins, so a statically
 * known collision would silently retype `run()` against a command that
 * dispatch replaces.
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

export type LocalSectionsBrand<C> = "sections" extends keyof C
	? C extends { sections: infer S extends readonly unknown[] }
		? {
				readonly sections: {
					[I in keyof S]: S[I] &
						UnionToIntersection<SectionTextBrand<S[I]>> &
						(S[I] extends { only: readonly [] } | { except: readonly [] }
							? { readonly FIX_SECTION_AUDIENCE: "Section audience must be nonempty" }
							: {});
				};
			}
		: {}
	: {};

export type LocalCommandConfigBrand<N extends string, C> = ValidateCommandConfig<N, C> &
	LocalSectionsBrand<C>;

export type AttachedCommandSpellings<Ds extends readonly unknown[]> = [Ds] extends [readonly []]
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
