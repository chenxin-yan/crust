import type { DefiningOf } from "../api/context.ts";
import type { CommandConfig, CommandDefinitionData } from "../command/crust.ts";
import type { commandDefinitionInternal } from "../command/node.ts";
import type {
	DefName,
	HasClosedNames,
	IsClosedName,
	IsStaticTuple,
	IsUnion,
	UnknownKeysBrand,
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

// All-or-nothing, so an open member never leaks literal siblings into the command tree.
type NarrowAliases<A extends readonly string[]> =
	IsClosedName<A[number]> extends true ? A[number] : never;

type RootVersionBrand<C> = "version" extends keyof C
	? { readonly FIX_ROOT_VERSION: 'Command config "version" belongs on the root Crust constructor' }
	: {};

/**
 * Command config checks. Names, aliases and sections are checked when the CLI runs from
 * source and by `crust build`, not here.
 */
export type LocalCommandConfigBrand<C> = RootVersionBrand<C> & UnknownKeysBrand<C, CommandConfig>;

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

// Fast path for the common `.add(def)`: one definition with a closed, non-union name. A
// conditional definition keeps the slow path even when its variants share a name.
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
		: IsUnion<Ds[number]> extends true
			? AttachedCommandSpellingsSlow<Ds>
			: IsClosedName<N> extends true
				? N | NarrowAliases<Al>
				: AttachedCommandSpellingsSlow<Ds>
	: AttachedCommandSpellingsSlow<Ds>;

// Aliases known only at runtime add no spelling: typed paths use the canonical name, and the
// other commands' paths stay checked.
type AttachedCommandSpellingsSlow<Ds extends readonly unknown[]> = [Ds] extends [readonly []]
	? never
	: IsStaticTuple<Ds> extends true
		? HasClosedNames<Ds> extends true
			? CommandDefinitionSpellings<Ds[number]>
			: string
		: string;
