import { sortContexts } from "../api/context.ts";
import type { CommandNode } from "../command/node.ts";
import { CrustError } from "../errors.ts";
import { validateDefinition } from "../parsing/parser.ts";
import { validateIncomingAliases } from "./commands.ts";

// ────────────────────────────────────────────────────────────────────────────
// validateCommandTree — Tree validation
// ────────────────────────────────────────────────────────────────────────────

/**
 * Validate an entire command tree by walking each node and running the
 * definition-class checks the runtime parser itself uses
 * (`validateDefinition`), plus Context dependency resolution.
 *
 * This catches:
 * - Flag alias collisions (including between Context-owned and local flags,
 *   via `effectiveFlags`)
 * - `no-` prefix violations and invalid flag types
 * - Async `parse` functions
 * - Variadic arg position violations
 * - Defaults that violate their own `choices` list
 * - Missing/cyclic Context dependencies
 *
 * The rules themselves live in `validateDefinition` and `sortContexts` —
 * this walk only provides tree coverage and path-labelled errors.
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
			validateDefinition(command);
			// Context dependency resolution (missing deps, cycles) fails at
			// build validation, not first dispatch.
			sortContexts(command.contexts, `the "${path.join(" ")}" command path`);
		} catch (error) {
			const message = error instanceof Error ? error.message : "Unknown validation error";
			throw new CrustError(
				"DEFINITION",
				`Command "${path.join(" ")}" failed definition validation: ${message}`,
			).withCause(error);
		}

		// Detect alias collisions among children. Catches extension-installed
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
