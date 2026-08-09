import type { CommandNode } from "../command/node.ts";
import { CrustError } from "../errors.ts";
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
export type CommandDefinitionSpellings<D> =
	DefName<D> extends infer Name extends string
		? [Name] extends [never]
			? never
			: Name | NarrowAliases<DefinitionAliases<D>>
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
// Runtime validation
// ────────────────────────────────────────────────────────────────────────────

// Alias collision policy: aliases share a namespace with canonical names,
// so a value collides with any sibling's canonical name or alias.
//
// Both registration time (`crust.ts`) and tree-walk validation
// (`validateCommandTree`) reuse these helpers so the policy lives in one
// place and surfaces as the same `DEFINITION` error shape regardless of
// how a subcommand was installed (`.add()` vs. plugin-installed via
// the `addCommand` action / direct `node.subCommands` mutation).

/**
 * Validate the shape of an alias string.
 *
 * Aliases must be non-empty, contain no whitespace, and not start with `-`
 * (otherwise the parser would treat them as flags). They must also differ
 * from the command's own canonical name. Throws `CrustError("DEFINITION")`
 * on violation. The `subjectLabel` is shown in the error so the user can
 * locate the offending subcommand in their tree.
 */
function validateAliasString(alias: unknown, canonicalName: string, subjectLabel: string): void {
	if (typeof alias !== "string" || alias.length === 0) {
		throw new CrustError(
			"DEFINITION",
			`Subcommand "${subjectLabel}" has an invalid alias: must be a non-empty string`,
		);
	}
	if (/\s/.test(alias)) {
		throw new CrustError(
			"DEFINITION",
			`Subcommand "${subjectLabel}" alias "${alias}" must not contain whitespace`,
		);
	}
	if (alias.startsWith("-")) {
		throw new CrustError(
			"DEFINITION",
			`Subcommand "${subjectLabel}" alias "${alias}" must not start with "-" (reserved for flags)`,
		);
	}
	if (alias === canonicalName) {
		throw new CrustError(
			"DEFINITION",
			`Subcommand "${subjectLabel}" alias "${alias}" must not equal its own canonical name`,
		);
	}
}

/**
 * Validate that adding `incoming` (its canonical name and aliases) to a
 * sibling map containing `existing` introduces no name/alias collisions.
 *
 * Checks performed (mirroring `spellings.ts` flag-alias collision detection):
 *  1. Each alias in `incoming.aliases` is shape-valid.
 *  2. No duplicate aliases within `incoming.aliases` itself.
 *  3. `incoming.canonicalName` is not already a sibling's alias
 *     (catches the reverse-order case where a sibling registered earlier
 *     reserved an alias that equals this command's canonical name).
 *  4. Each `incoming.aliases` entry is not already a sibling's canonical
 *     name or any sibling's alias.
 *
 * Note: a *canonical* vs. *canonical* duplicate is structurally impossible
 * because `existing` is keyed by canonical name; the existing duplicate-name
 * check at the call site catches direct re-registration.
 *
 * `subjectLabel` should identify `incoming` (e.g. its dotted path) for
 * error messages.
 *
 * Throws `CrustError("DEFINITION")` on the first violation.
 */
export function validateIncomingAliases(
	incoming: { canonicalName: string; aliases?: readonly string[] },
	existing: Record<string, CommandNode>,
	subjectLabel: string,
): void {
	const { canonicalName, aliases } = incoming;

	// Shape-validate first so error messages don't leak through.
	if (aliases) {
		const seen = new Set<string>();
		for (const alias of aliases) {
			validateAliasString(alias, canonicalName, subjectLabel);
			if (seen.has(alias)) {
				throw new CrustError(
					"DEFINITION",
					`Subcommand "${subjectLabel}" lists alias "${alias}" more than once`,
				);
			}
			seen.add(alias);
		}
	}

	for (const [siblingName, sibling] of Object.entries(existing)) {
		const siblingAliases = sibling.meta.aliases;

		// 3) Incoming canonical name vs. an existing sibling's alias.
		if (siblingAliases?.includes(canonicalName)) {
			throw new CrustError(
				"DEFINITION",
				`Subcommand "${subjectLabel}" canonical name "${canonicalName}" collides with alias of sibling "${siblingName}"`,
			);
		}

		if (!aliases) continue;

		for (const alias of aliases) {
			// 4a) Incoming alias vs. existing sibling's canonical name.
			if (alias === siblingName) {
				throw new CrustError(
					"DEFINITION",
					`Subcommand "${subjectLabel}" alias "${alias}" collides with sibling canonical name "${siblingName}"`,
				);
			}
			// 4b) Incoming alias vs. existing sibling's alias.
			if (siblingAliases?.includes(alias)) {
				throw new CrustError(
					"DEFINITION",
					`Subcommand "${subjectLabel}" alias "${alias}" collides with alias of sibling "${siblingName}"`,
				);
			}
		}
	}
}
