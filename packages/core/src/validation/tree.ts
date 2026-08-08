import { sortContexts } from "../api/context.ts";
import type { CommandNode } from "../command/node.ts";
import { CrustError } from "../errors.ts";
import { parseArgs, validateParsed } from "../parsing/parser.ts";
import type { ArgDef, FlagDef } from "../types.ts";
import { validateIncomingAliases } from "./commands.ts";

// ────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ────────────────────────────────────────────────────────────────────────────

/** Returns a synthetic token that satisfies `parseArgs` for the given type. */
function sampleToken(def: ArgDef | FlagDef): string {
	// When `choices` is declared, picking any value outside the list now
	// throws at parse time. Use the first declared choice so the
	// synthetic argv always passes the choices gate.
	const choices = (def as { choices?: readonly string[] }).choices;
	if (choices !== undefined && choices.length > 0) return choices[0] as string;
	switch (def.type) {
		case "number":
			return "1";
		case "boolean":
			return "true";
		case "url":
			return "https://example.com";
		case "json":
			return "null";
		default:
			return "sample";
	}
}

/**
 * Build a synthetic argv that satisfies `parseArgs` for the given command.
 *
 * Uses `effectiveFlags` so propagated required flags are included in the
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
		for (const def of args) {
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
 * - Alias collisions (including between Context-owned and local flags)
 * - `no-` prefix violations
 * - Required flag/arg validation
 * - Variadic arg position violations
 *
 * Uses `effectiveFlags` (Context-owned + local merged) so alias collisions
 * between a Context-owned flag and a local flag are caught.
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
			// Context dependency resolution (missing deps, cycles) fails at
			// build validation, not first dispatch.
			sortContexts(command.contexts, `the "${path.join(" ")}" command path`);
		} catch (error) {
			const message = error instanceof Error ? error.message : "Unknown validation error";
			throw new CrustError(
				"DEFINITION",
				`Command "${path.join(" ")}" failed runtime validation: ${message}`,
			).withCause(error);
		}

		// Detect alias collisions among children. Catches plugin-installed
		// subcommands that bypassed `.add()` (where collision detection
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
