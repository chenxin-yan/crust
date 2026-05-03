import { CrustError } from "./errors.ts";
import type { CommandNode } from "./node.ts";
import { parseArgs, validateParsed } from "./parser.ts";
import type { ArgDef, FlagDef } from "./types.ts";

// ──────────────────────────────────────────────────────────────────────────────
// Alias collision policy (TP-016)
//
// Both registration time (`crust.ts`) and tree-walk validation
// (`validateCommandTree`) reuse these helpers so the policy lives in one
// place and surfaces as the same `DEFINITION` error shape regardless of
// how a subcommand was installed (`.command()` vs. plugin-installed via
// the `addCommand` action / direct `node.subCommands` mutation).
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Validate the shape of an alias string.
 *
 * Aliases must be non-empty, contain no whitespace, and not start with `-`
 * (otherwise the parser would treat them as flags). They must also differ
 * from the command's own canonical name. Throws `CrustError("DEFINITION")`
 * on violation. The `subjectLabel` is shown in the error so the user can
 * locate the offending subcommand in their tree.
 */
export function validateAliasString(
	alias: unknown,
	canonicalName: string,
	subjectLabel: string,
): void {
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
 * Checks performed (mirroring `parser.ts` flag-alias collision detection):
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

// ────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ────────────────────────────────────────────────────────────────────────────

/** Returns a synthetic token that satisfies `parseArgs` for the given type. */
function sampleToken(def: ArgDef | FlagDef): string {
	switch (def.type) {
		case "number":
			return "1";
		case "boolean":
			return "true";
		default:
			return "sample";
	}
}

/**
 * Build a synthetic argv that satisfies `parseArgs` for the given command.
 *
 * Uses `effectiveFlags` so inherited required flags are included in the
 * synthetic argv.
 */
function createValidationArgv(command: CommandNode): string[] {
	const argv: string[] = [];

	const flags = command.effectiveFlags;

	for (const [name, def] of Object.entries(flags as Record<string, FlagDef>)) {
		// Skip flags that are optional or have defaults — parseArgs won't
		// complain about them being absent.
		if (def.required !== true || def.default !== undefined) continue;

		argv.push(`--${name}`);
		if (def.type !== "boolean") {
			argv.push(sampleToken(def));
		}
	}

	const args = command.args;

	if (args) {
		for (const def of args as readonly ArgDef[]) {
			// Skip args that are optional or have defaults.
			if (def.required !== true || def.default !== undefined) continue;

			argv.push(sampleToken(def));
		}
	}

	return argv;
}

// ────────────────────────────────────────────────────────────────────────────
// validateCommandTree — Tree validation
// ────────────────────────────────────────────────────────────────────────────

/**
 * Validate an entire command tree by walking each node and calling `parseArgs`
 * with a synthetic argv derived from the node's flag/arg definitions.
 *
 * This catches:
 * - Alias collisions (including between inherited and local flags)
 * - `no-` prefix violations
 * - Required flag/arg validation
 * - Variadic arg position violations
 *
 * Uses `effectiveFlags` (inherited + local merged) so alias collisions
 * between an inherited flag and a local flag are caught.
 *
 * @param root - The root command node to validate
 * @throws {CrustError} `DEFINITION` with the full command path on failure
 */
export function validateCommandTree(root: CommandNode): void {
	const stack: Array<{ command: CommandNode; path: string[] }> = [
		{ command: root, path: [root.meta.name] },
	];
	const visited = new Set<CommandNode>();

	while (stack.length > 0) {
		const item = stack.pop();
		if (!item) break;

		const { command, path } = item;
		if (visited.has(command)) continue;
		visited.add(command);

		try {
			const parsed = parseArgs(command, createValidationArgv(command));
			validateParsed(command, parsed);
		} catch (error) {
			const message =
				error instanceof Error ? error.message : "Unknown validation error";
			throw new CrustError(
				"DEFINITION",
				`Command "${path.join(" ")}" failed runtime validation: ${message}`,
			).withCause(error);
		}

		// Detect alias collisions among children. Catches plugin-installed
		// subcommands that bypassed `.command()` (where collision detection
		// already runs eagerly). We re-run the full check by walking the
		// children and validating each one against the children registered
		// before it in iteration order.
		const seen: Record<string, CommandNode> = {};
		for (const [name, subCommand] of Object.entries(command.subCommands)) {
			validateIncomingAliases(
				{ canonicalName: name, aliases: subCommand.meta.aliases },
				seen,
				[...path, name].join(" "),
			);
			seen[name] = subCommand;
		}

		for (const [name, subCommand] of Object.entries(command.subCommands)) {
			stack.push({
				command: subCommand,
				path: [...path, name],
			});
		}
	}
}
