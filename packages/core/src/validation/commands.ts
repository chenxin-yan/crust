import type { CommandNode } from "../command/node.ts";
import { CrustError } from "../errors.ts";

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
