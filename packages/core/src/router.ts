import { CrustError } from "./errors.ts";
import type { AnyCommand } from "./types.ts";

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
	command: AnyCommand;
	/** The argv after subcommand names have been consumed */
	argv: string[];
	/** The command path for help text (e.g. ["crust", "generate", "command"]) */
	commandPath: string[];
}

// ────────────────────────────────────────────────────────────────────────────
// resolveCommand — Subcommand routing
// ────────────────────────────────────────────────────────────────────────────

/**
 * Resolve a command from an argv array by walking the subcommand tree.
 *
 * Subcommand matching happens BEFORE flag parsing, so:
 * `crust build --entry src/cli.ts` first resolves "build" as a subcommand,
 * then passes `["--entry", "src/cli.ts"]` to the build command's parser.
 *
 * Resolution rules:
 * 1. If `argv[0]` matches a subcommand key, recurse into that subcommand
 * 2. If no match and the current command has `run()`, return it (args passed to parser)
 * 3. If no match and the current command has NO `run()`, it signals the caller
 *    should show help (the `showHelp` flag is set in the result)
 * 4. Unknown subcommands produce a structured COMMAND_NOT_FOUND error
 *
 * @param command - The root command to resolve from
 * @param argv - The argv array to resolve against
 * @returns The resolved command, argv, and the command path
 * @throws {CrustError} COMMAND_NOT_FOUND when an unknown subcommand is given and the parent has no run()
 */
export function resolveCommand(
	command: AnyCommand,
	argv: string[],
): CommandRoute {
	const path = [command.meta.name];

	let current: AnyCommand = command;
	let routedArgv = argv;

	while (routedArgv.length > 0) {
		const subCommands = current.subCommands;
		if (!subCommands || Object.keys(subCommands).length === 0) {
			// No subcommands defined — argv goes to the parser
			break;
		}

		const candidate = routedArgv[0];

		// Skip if the candidate looks like a flag (starts with -) or doesn't exists
		if (!candidate || candidate.startsWith("-")) {
			break;
		}

		// Check if it matches a known subcommand
		if (candidate in subCommands) {
			current = subCommands[candidate] as AnyCommand;
			path.push(candidate);
			routedArgv = routedArgv.slice(1);
			continue;
		}

		// Unknown subcommand candidate — but only if the parent has no run()
		// If the parent has run(), this could be a positional argument
		if (current.run) {
			break;
		}

		// Parent has no run() — this is an unknown subcommand error
		const available = Object.keys(subCommands);
		throw new CrustError(
			"COMMAND_NOT_FOUND",
			`Unknown command "${candidate}".`,
			{
				input: candidate,
				available,
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
