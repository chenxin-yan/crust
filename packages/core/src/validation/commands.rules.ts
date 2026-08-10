import type { CommandNode } from "../command/node.ts";
import { CrustError } from "../errors.ts";

/** Command aliases must be non-empty, flag-safe, and differ from their canonical name. */
export function aliasShape(alias: unknown, canonicalName: string, subjectLabel: string): void {
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

/** Canonical command names and aliases share one sibling namespace. */
export function commandCollision(
	incoming: { canonicalName: string; aliases?: readonly string[] },
	existing: Record<string, CommandNode>,
	subjectLabel: string,
): void {
	const { canonicalName, aliases } = incoming;
	if (Object.hasOwn(existing, canonicalName)) {
		// subjectLabel keeps owner attribution (e.g. `Extension "docs" command "x"`).
		throw new CrustError("DEFINITION", `${subjectLabel} is already registered`, {
			subject: "command",
			name: canonicalName,
			reason: "duplicate-command",
		});
	}
	if (aliases) {
		const seen = new Set<string>();
		for (const alias of aliases) {
			aliasShape(alias, canonicalName, subjectLabel);
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
		if (siblingAliases?.includes(canonicalName)) {
			throw new CrustError(
				"DEFINITION",
				`Subcommand "${subjectLabel}" canonical name "${canonicalName}" collides with alias of sibling "${siblingName}"`,
			);
		}
		if (!aliases) continue;
		for (const alias of aliases) {
			if (alias === siblingName) {
				throw new CrustError(
					"DEFINITION",
					`Subcommand "${subjectLabel}" alias "${alias}" collides with sibling canonical name "${siblingName}"`,
				);
			}
			if (siblingAliases?.includes(alias)) {
				throw new CrustError(
					"DEFINITION",
					`Subcommand "${subjectLabel}" alias "${alias}" collides with alias of sibling "${siblingName}"`,
				);
			}
		}
	}
}
