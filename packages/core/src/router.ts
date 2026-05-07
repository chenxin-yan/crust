import { CrustError } from "./errors.ts";
import type { CommandNode } from "./node.ts";

// ────────────────────────────────────────────────────────────────────────────
// CommandRoute — Output of resolveCommand
// ────────────────────────────────────────────────────────────────────────────

/**
 * The result of resolving a command from an argv array.
 *
 * Contains the resolved (sub)command and argv after subcommand
 * resolution, and the full command path for help text rendering.
 */
export interface CommandRoute {
	/** The routed command (may be a subcommand of the original) */
	command: CommandNode;
	/** The argv after subcommand names have been consumed */
	argv: string[];
	/** The command path for help text (e.g. ["crust", "generate", "command"]) */
	commandPath: string[];
}

// ────────────────────────────────────────────────────────────────────────────
// resolveCommand — Subcommand routing
// ────────────────────────────────────────────────────────────────────────────

/**
 * Find a sibling whose `meta.aliases` contains the given candidate. Returns
 * the canonical sibling key and node when matched, otherwise `null`.
 *
 * Resolution intentionally records the **canonical** key on the
 * `CommandRoute.commandPath`, never the alias the user typed. This is
 * load-bearing: error messages, help titles, and downstream plugins read
 * `commandPath` and assume canonical names.
 */
function findAliasMatch(
	subCommands: Record<string, CommandNode>,
	candidate: string,
): { canonicalName: string; node: CommandNode } | null {
	for (const [name, node] of Object.entries(subCommands)) {
		const aliases = node.meta.aliases;
		if (!aliases) continue;
		if (aliases.includes(candidate)) {
			return { canonicalName: name, node };
		}
	}
	return null;
}

/**
 * Resolve a command from an argv array by walking the subcommand tree.
 *
 * Subcommand matching happens BEFORE flag parsing, so:
 * `crust build --entry src/cli.ts` first resolves "build" as a subcommand,
 * then passes `["--entry", "src/cli.ts"]` to the build command's parser.
 *
 * Resolution rules:
 * 1. If `argv[0]` matches a subcommand key, recurse into that subcommand
 * 2. If `argv[0]` matches a sibling's `meta.aliases` entry, recurse into
 *    that sibling and record the **canonical** name in `commandPath`
 * 3. If no match and the current command has `run()`, return it (args passed to parser)
 * 4. If no match and the current command has NO `run()`, it signals the caller
 *    should show help (the `showHelp` flag is set in the result)
 * 5. Unknown subcommands produce a structured COMMAND_NOT_FOUND error whose
 *    `details.available` lists the canonical sibling names (aliases are
 *    discoverable via `details.parentCommand.subCommands[name].meta.aliases`)
 *
 * Implementation: linear scan over siblings on miss. Command trees are small
 * and resolution runs once per invocation, so the cost is negligible compared
 * to building/freezing a parallel alias→canonical map. The scan does NOT
 * mutate `CommandNode`.
 *
 * @param command - The root command to resolve from
 * @param argv - The argv array to resolve against
 * @returns The resolved command, argv, and the command path
 * @throws {CrustError} COMMAND_NOT_FOUND when an unknown subcommand is given and the parent has no run()
 */
export function resolveCommand(
	command: CommandNode,
	argv: string[],
): CommandRoute {
	const path = [command.meta.name];

	let current: CommandNode = command;
	let routedArgv = argv;

	while (routedArgv.length > 0) {
		const subCommands = current.subCommands;
		if (!subCommands || Object.keys(subCommands).length === 0) {
			// No subcommands defined — argv goes to the parser
			break;
		}

		const candidate = routedArgv[0];

		// Skip if the candidate looks like a flag (starts with -) or doesn't exist
		if (!candidate || candidate.startsWith("-")) {
			break;
		}

		// Check if it matches a known subcommand by canonical name
		if (candidate in subCommands && subCommands[candidate]) {
			current = subCommands[candidate];
			path.push(candidate);
			routedArgv = routedArgv.slice(1);
			continue;
		}

		// Otherwise scan siblings for an alias match. We record the canonical
		// sibling key on the path, NOT the alias the user typed — downstream
		// help/plugins assume `commandPath` only ever contains canonical names.
		const aliasMatch = findAliasMatch(subCommands, candidate);
		if (aliasMatch) {
			current = aliasMatch.node;
			path.push(aliasMatch.canonicalName);
			routedArgv = routedArgv.slice(1);
			continue;
		}

		// Unknown subcommand candidate — but only if the parent has no run()
		// If the parent has run(), this could be a positional argument
		if (current.run) {
			break;
		}

		// Parent has no run() — this is an unknown subcommand error.
		// `details.available` lists canonical sibling names only; consumers
		// that want alias-aware matching (e.g. didYouMeanPlugin) read aliases
		// directly from `details.parentCommand.subCommands`.
		throw new CrustError(
			"COMMAND_NOT_FOUND",
			`Unknown command "${candidate}".`,
			{
				input: candidate,
				available: Object.keys(subCommands),
				commandPath: [...path],
				parentCommand: current,
			},
		);
	}

	return {
		command: current,
		argv: routedArgv,
		commandPath: path,
	};
}
