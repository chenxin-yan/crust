import type { DefName, Overlap } from "./shared.ts";

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
	: Alias extends `${string} ${string}` | `${string}\t${string}`
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

type CommandCollisionBrand<D, Existing extends string> =
	Overlap<CommandDefinitionSpellings<D>, Existing> extends infer Collision extends string
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
	? readonly [
			Head & CommandCollisionBrand<Head, Existing>,
			...ValidateCommandDefinitions<Tail, Existing | CommandDefinitionSpellings<Head>>,
		]
	: Ds;

// ────────────────────────────────────────────────────────────────────────────
