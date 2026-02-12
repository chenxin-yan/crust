import type { Command } from "./types.ts";

// ────────────────────────────────────────────────────────────────────────────
// ResolveResult — Output of resolveCommand
// ────────────────────────────────────────────────────────────────────────────

/**
 * The result of resolving a command from an argv array.
 *
 * Contains the resolved (sub)command, the remaining argv after subcommand
 * resolution, and the full command path for help text rendering.
 */
export interface ResolveResult {
	/** The resolved command (may be a subcommand of the original) */
	// biome-ignore lint/suspicious/noExplicitAny: works with any command generics
	resolved: Command<any, any>;
	/** The remaining argv after subcommand names have been consumed */
	argv: string[];
	/** The command path for help text (e.g. ["crust", "generate", "command"]) */
	path: string[];
}

// ────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ────────────────────────────────────────────────────────────────────────────

/**
 * Compute the Levenshtein distance between two strings.
 * Used for "Did you mean?" suggestions on unknown subcommands.
 */
function levenshtein(a: string, b: string): number {
	const aLen = a.length;
	const bLen = b.length;

	// Quick exits
	if (aLen === 0) return bLen;
	if (bLen === 0) return aLen;

	// Use a single-row DP approach for space efficiency
	const row: number[] = Array.from({ length: bLen + 1 }, (_, i) => i);

	for (let i = 1; i <= aLen; i++) {
		let prev = i;
		for (let j = 1; j <= bLen; j++) {
			const cost = a[i - 1] === b[j - 1] ? 0 : 1;
			const val = Math.min(
				(row[j] as number) + 1, // deletion
				prev + 1, // insertion
				(row[j - 1] as number) + cost, // substitution
			);
			row[j - 1] = prev;
			prev = val;
		}
		row[bLen] = prev;
	}

	return row[bLen] as number;
}

/**
 * Find the closest matching subcommand names for a given input.
 * Returns suggestions sorted by relevance (Levenshtein distance ≤ 3 or startsWith match).
 */
function findSuggestions(input: string, candidates: string[]): string[] {
	const suggestions: { name: string; distance: number }[] = [];

	for (const candidate of candidates) {
		// startsWith match (prefix)
		if (candidate.startsWith(input) || input.startsWith(candidate)) {
			suggestions.push({ name: candidate, distance: 0 });
			continue;
		}

		// Levenshtein distance
		const distance = levenshtein(input, candidate);
		if (distance <= 3) {
			suggestions.push({ name: candidate, distance });
		}
	}

	// Sort by distance (closest first), then alphabetically for ties
	suggestions.sort((a, b) => {
		if (a.distance !== b.distance) return a.distance - b.distance;
		return a.name.localeCompare(b.name);
	});

	return suggestions.map((s) => s.name);
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
 * 4. Unknown subcommands produce an error with "Did you mean?" suggestions
 *
 * @param command - The root command to resolve from
 * @param argv - The argv array to resolve against
 * @returns The resolved command, remaining argv, and the command path
 * @throws {Error} When an unknown subcommand is given and the parent has no run()
 */
export function resolveCommand(
	// biome-ignore lint/suspicious/noExplicitAny: works with any command generics
	command: Command<any, any>,
	argv: string[],
): ResolveResult {
	const path: string[] = [command.meta.name];

	// biome-ignore lint/suspicious/noExplicitAny: works with any command generics
	let current: Command<any, any> = command;
	let remainingArgv = argv;

	while (remainingArgv.length > 0) {
		const subCommands = current.subCommands;
		if (!subCommands || Object.keys(subCommands).length === 0) {
			// No subcommands defined — remaining argv goes to the parser
			break;
		}

		const candidate = remainingArgv[0] as string;

		// Skip if the candidate looks like a flag (starts with -)
		if (candidate.startsWith("-")) {
			break;
		}

		// Check if it matches a known subcommand
		if (candidate in subCommands) {
			// biome-ignore lint/suspicious/noExplicitAny: works with any command generics
			current = subCommands[candidate] as Command<any, any>;
			path.push(candidate);
			remainingArgv = remainingArgv.slice(1);
			continue;
		}

		// Unknown subcommand candidate — but only if the parent has no run()
		// If the parent has run(), this could be a positional argument
		if (current.run) {
			break;
		}

		// Parent has no run() — this is an unknown subcommand error
		const available = Object.keys(subCommands);
		const suggestions = findSuggestions(candidate, available);

		let message = `Unknown command "${candidate}".`;
		if (suggestions.length > 0) {
			message += ` Did you mean "${suggestions[0]}"?`;
		}
		message += `\n\nAvailable commands: ${available.join(", ")}`;

		throw new Error(message);
	}

	return {
		resolved: current,
		argv: remainingArgv,
		path,
	};
}
