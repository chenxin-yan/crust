import type { DefName, EmptyLiteralNameBrand, IsStaticTuple, Overlap } from "./shared.ts";

// ────────────────────────────────────────────────────────────────────────────
// Compile-time validation
// ────────────────────────────────────────────────────────────────────────────

/** Preserve a narrowed aliases tuple from command config; widened or absent aliases opt out. */
export type AliasesOf<C> = C extends { readonly aliases: infer A extends readonly string[] }
	? A
	: readonly string[];

type NarrowAliases<A extends readonly string[]> = string extends A[number] ? never : A[number];

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
			: Alias extends Name
				? `Subcommand "${Name}" alias "${Alias}" must not equal its own canonical name`
				: never;

type AliasShapeErrors<Name extends string, C> =
	NarrowAliases<AliasesOf<C>> extends infer Alias
		? Alias extends string
			? AliasShapeError<Name, Alias>
			: never
		: never;

/** Brand command config containing a statically known invalid alias. */
export type ValidateCommandConfig<Name extends string, C> = string extends Name
	? {}
	: [AliasShapeErrors<Name, C>] extends [never]
		? {}
		: { readonly FIX_ALIAS_SHAPE: AliasShapeErrors<Name, C> };

type EmptyNameError = { readonly FIX_EMPTY_NAME: "Command name must be a non-empty string" };

/** Brand a statically known empty command name while allowing widened and generic names. */
export type EmptyNameBrand<Name extends string> = EmptyLiteralNameBrand<Name, EmptyNameError>;

/**
 * Brand a statically known empty command name at the composition site:
 * routing stops at empty argv tokens, so such a command can never dispatch.
 * Widened names opt out (`DefName` yields `never`, which `""` does not extend).
 */
type EmptyDefinitionNameBrand<D> = "" extends DefName<D> ? EmptyNameError : {};

type DefinitionAliases<D> = D extends {
	readonly _aliases?: infer A extends readonly string[];
}
	? A
	: readonly string[];

/** All statically known canonical and alias spellings carried by a command definition. */
export type CommandDefinitionSpellings<D> = D extends unknown
	? DefName<D> extends infer Name extends string
		? [Name] extends [never]
			? never
			: Name | NarrowAliases<DefinitionAliases<D>>
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

type CommandCollisionBrand<Spellings extends string, Existing extends string> =
	Overlap<Spellings, Existing> extends infer Collision extends string
		? [Collision] extends [never]
			? {}
			: {
					readonly FIX_COMMAND_COLLISION: `Command name or alias "${Collision}" collides with a sibling command`;
				}
		: never;

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
					EmptyDefinitionNameBrand<Head> &
					SelfAliasBrand<Head>,
				...ValidateCommandDefinitions<Tail, Existing | Spellings>,
			]
		: never
	: Ds;

type ExtensionCommandDefs<E> = E extends {
	readonly commands?: infer Cs extends readonly unknown[];
}
	? IsStaticTuple<Cs> extends true
		? Cs
		: readonly []
	: readonly [];

/**
 * Statically known command spellings contributed by one Extension. Widened
 * and conditionally assembled contributions opt out; they stay runtime-only
 * and resolve last-write-wins at prepare time.
 */
export type ExtensionCommandSpellings<E> = CommandDefinitionSpellings<
	ExtensionCommandDefs<E>[number]
>;

/** Command spellings contributed by a tuple of Extensions. */
export type ExtensionsCommandSpellings<Es extends readonly unknown[]> = ExtensionCommandSpellings<
	Es[number]
>;

type ExtensionCommandCollisionBrand<E, Existing extends string> =
	Overlap<ExtensionCommandSpellings<E>, Existing> extends infer Collision extends string
		? [Collision] extends [never]
			? {}
			: {
					readonly FIX_COMMAND_COLLISION: `Extension command "${Collision}" collides with an existing command`;
				}
		: never;

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
