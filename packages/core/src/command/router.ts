import { CrustError } from "../errors.ts";
import type { FlagDef, FlagsDef } from "../types.ts";
import type { CommandNode } from "./node.ts";
import { snapshotCommand } from "./snapshot.ts";

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

/** Find a flag def by any spelling: canonical name, short, or long alias. */
function lookupFlag(flags: FlagsDef, spelling: string): FlagDef | undefined {
	for (const [name, def] of Object.entries(flags)) {
		if (name === spelling || def.short === spelling || def.aliases?.includes(spelling)) {
			return def;
		}
	}
	return undefined;
}

/**
 * Match a dash token against a command's effective flags.
 *
 * Returns `null` when the token is not a known flag of this command (routing
 * then stops, preserving the pre-existing fallback behavior), otherwise
 * whether the flag consumes the following argv token as its value.
 *
 * Mirrors the parser's accepted spellings: `--name`, `--name=value`,
 * `--no-name` (boolean negation unless `noNegate`), `-s`, and bundled
 * short booleans (`-ab`). Tokens with `=` after a short prefix are left
 * to the parser.
 */
function matchKnownFlagToken(flags: FlagsDef, token: string): { consumesValue: boolean } | null {
	if (token === "--") return null;

	if (token.startsWith("--")) {
		const eq = token.indexOf("=");
		const spelling = eq === -1 ? token.slice(2) : token.slice(2, eq);
		const def = lookupFlag(flags, spelling);
		if (def) return { consumesValue: def.type !== "boolean" && eq === -1 };
		if (spelling.startsWith("no-")) {
			const base = lookupFlag(flags, spelling.slice(3));
			if (base && base.type === "boolean" && !base.noNegate) {
				return { consumesValue: false };
			}
		}
		return null;
	}

	// Short form: `-q` or bundled `-qf`. Every char must be a known
	// single-char spelling; only the last may take a value.
	const chars = token.slice(1);
	if (chars.length === 0 || chars.includes("=")) return null;
	let last: FlagDef | undefined;
	for (const char of chars) {
		const def = lookupFlag(flags, char);
		if (!def) return null;
		if (last && last.type !== "boolean") return null; // value-taking short mid-bundle
		last = def;
	}
	return { consumesValue: last !== undefined && last.type !== "boolean" };
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
export function resolveCommand(command: CommandNode, argv: string[]): CommandRoute {
	const path = [command.meta.name];

	let current: CommandNode = command;
	let routedArgv = argv;
	// Known flags (and their values) encountered before a subcommand name are
	// set aside during routing and re-prepended for the resolved command's
	// parser, preserving token order.
	const skippedFlagTokens: string[] = [];

	while (routedArgv.length > 0) {
		const subCommands = current.subCommands;
		if (!subCommands || Object.keys(subCommands).length === 0) {
			// No subcommands defined — argv goes to the parser
			break;
		}

		const candidate = routedArgv[0];

		if (!candidate) break;

		// Flag-shaped token: skip it (and its value) when it is a known flag of
		// the current command so routing can continue to a subcommand name —
		// `app --quiet translate` must run `translate`, not silently resolve the
		// root. Unknown flags and `--` stop routing (parser reports them).
		if (candidate.startsWith("-")) {
			const match = matchKnownFlagToken(current.effectiveFlags, candidate);
			if (!match) break;
			skippedFlagTokens.push(candidate);
			routedArgv = routedArgv.slice(1);
			const value = routedArgv[0];
			if (match.consumesValue && value !== undefined) {
				skippedFlagTokens.push(value);
				routedArgv = routedArgv.slice(1);
			}
			continue;
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
		throw new CrustError("COMMAND_NOT_FOUND", `Unknown command "${candidate}".`, {
			input: candidate,
			available: Object.keys(subCommands),
			commandPath: [...path],
			parentCommand: snapshotCommand(current),
		});
	}

	return {
		command: current,
		argv: [...skippedFlagTokens, ...routedArgv],
		commandPath: path,
	};
}
