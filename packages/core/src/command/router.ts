import { CrustError } from "../errors.ts";
import { matchFlagToken } from "../parsing/parser.ts";
import { isListed } from "../sections.ts";
import { childMetaOf, type CommandNode } from "./node.ts";
import { createSnapshotProjector, type CommandSnapshot } from "./snapshot.ts";

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

/** Build the COMMAND_NOT_FOUND error for an unknown child of `parent`. */
export function commandNotFound(
	parent: CommandNode,
	candidate: string,
	commandPath: readonly string[],
): CrustError<"COMMAND_NOT_FOUND"> {
	// Lazy: listing siblings reads only their static metadata, so an unrelated
	// broken recipe cannot replace this error.
	return commandNotFoundIn(createSnapshotProjector(parent)(parent), candidate, commandPath);
}

/** A command with subcommands and no action, run without one and without a `noAction` hook to take it. */
export function missingCommand(group: CommandNode): CrustError<"VALIDATION"> {
	const available = [...childMetaOf(group.subCommands)].flatMap(([name, meta]) =>
		meta.hidden ? [] : [name],
	);
	return new CrustError(
		"VALIDATION",
		`Missing command.${available.length > 0 ? ` Available: ${available.join(", ")}` : ""}`,
	);
}

/** The command path of each routed command's snapshot, recorded when an invocation reads it. */
export const snapshotPaths: WeakMap<CommandSnapshot, readonly string[]> = new WeakMap();

/**
 * The `COMMAND_NOT_FOUND` error Core raises for an unknown subcommand `name` of `command`, so
 * an action that takes any word (a fallback for scripts or plugins) can decline one and
 * `didYouMean()` still suggests a subcommand.
 *
 * @param command - The command whose subcommand `name` is not: usually the action's `command`
 * @param name - The word that names no subcommand
 *
 * @example
 * ```ts
 * .action(({ args, command }) => {
 *   if (!scripts.has(args.name)) throw unknownCommand(command, args.name);
 * })
 * ```
 */
export function unknownCommand(
	command: CommandSnapshot,
	name: string,
): CrustError<"COMMAND_NOT_FOUND"> {
	return commandNotFoundIn(command, name, snapshotPaths.get(command) ?? [command.meta.name]);
}

function commandNotFoundIn(
	parentCommand: CommandSnapshot,
	candidate: string,
	commandPath: readonly string[],
): CrustError<"COMMAND_NOT_FOUND"> {
	return new CrustError("COMMAND_NOT_FOUND", `Unknown command "${candidate}".`, {
		input: candidate,
		available: Object.entries(parentCommand.subCommands).flatMap(([name, child]) =>
			isListed(child) ? [name] : [],
		),
		commandPath: [...commandPath],
		parentCommand,
	});
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
 * load-bearing: error messages, help titles, and downstream extensions read
 * `commandPath` and assume canonical names.
 */
function findAliasMatch(
	subCommands: Record<string, CommandNode>,
	candidate: string,
): { canonicalName: string; node: CommandNode } | null {
	// Metadata only: building every child to read its aliases would defeat lazy preparation.
	for (const [name, meta] of childMetaOf(subCommands)) {
		if (meta.aliases?.includes(candidate)) {
			// SAFETY: childMetaOf yields only names present in the record.
			return { canonicalName: name, node: subCommands[name]! };
		}
	}
	return null;
}

/** The child `candidate` names, by canonical name first, then by alias. */
function findChild(
	subCommands: Record<string, CommandNode>,
	candidate: string,
): { canonicalName: string; node: CommandNode } | null {
	// hasOwn, not `in`: argv is untrusted, and `mycli constructor` would otherwise resolve
	// an inherited Object.prototype member and crash routing with a TypeError.
	const node = Object.hasOwn(subCommands, candidate) ? subCommands[candidate] : undefined;
	return node ? { canonicalName: candidate, node } : findAliasMatch(subCommands, candidate);
}

/**
 * The subcommands, from `node` down, that `rest` names before the first one that knows the
 * flag `token`: `app --force rm` where only `rm` has `--force`. Routing cannot step over the
 * flag itself, because only the command that knows a flag knows whether it takes a value.
 */
function subcommandKnowing(
	node: CommandNode,
	token: string,
	rest: readonly string[],
): string[] | undefined {
	const path: string[] = [];
	let isValue = false;
	for (const word of rest) {
		if (word === "--") return undefined;
		if (isValue) {
			isValue = false;
			continue;
		}
		let child: ReturnType<typeof findChild>;
		let match: ReturnType<typeof matchFlagToken>;
		try {
			child = findChild(node.subCommands, word);
			// This builds a lazy child off the route: one that cannot be built gives no hint.
			match = child ? matchFlagToken(child.node.flagSpellings, token) : undefined;
		} catch {
			return undefined;
		}
		if (!child) {
			// Routing would hand this word to the action's arguments, so no later subcommand runs.
			if (!word.startsWith("-") && node.run && node.args.length > 0) return undefined;
			// A known flag's value is not a subcommand name: routing sets both aside.
			const flag = matchFlagToken(node.flagSpellings, word);
			isValue = flag !== undefined && !(flag instanceof CrustError) && flag.pending !== undefined;
			// Otherwise a flag or a word routing rejects anyway.
			continue;
		}
		path.push(child.canonicalName);
		node = child.node;
		// `--force=1` on a boolean `--force` is still a flag this subcommand knows.
		if (
			!(
				match instanceof CrustError &&
				match.is("PARSE") &&
				match.details?.reason === "unknown-flag"
			)
		) {
			return path;
		}
	}
	return undefined;
}

/**
 * Resolve a command from an argv array by walking the subcommand tree.
 *
 * Subcommand matching happens BEFORE flag parsing, so:
 * `crust build --target bun-linux-x64` first resolves "build" as a subcommand,
 * then passes `["--target", "bun-linux-x64"]` to the build command's parser.
 *
 * Resolution rules:
 * 1. If `argv[0]` matches a subcommand key, recurse into that subcommand
 * 2. If `argv[0]` matches a sibling's `meta.aliases` entry, recurse into
 *    that sibling and record the **canonical** name in `commandPath`
 * 3. A flag the current command knows is set aside, with its value, and
 *    re-prepended for the resolved command's parser: the command that runs
 *    reads every flag wherever it was typed. A definition check makes each
 *    reused spelling take a value at every level or at none, so the value
 *    split here is the one the resolved command makes. A flag it does not
 *    know is reported by its parser, exactly as when typed after the name.
 * 4. A flag the current command does not know stops routing: its parser
 *    reports it, with a hint when `hint` is set and a later subcommand word knows it
 * 5. Any other word: when the current command has an action and declares
 *    arguments, it is an argument; otherwise it is a COMMAND_NOT_FOUND error
 *    whose `details.available` lists visible canonical sibling names (aliases
 *    are discoverable via `details.parentCommand.subCommands[name].meta.aliases`)
 * 6. When argv is exhausted, return the current command, with or without `run()`
 *
 * Implementation: linear scan over siblings on miss. Command trees are small
 * and resolution runs once per invocation, so the cost is negligible compared
 * to building/freezing a parallel alias→canonical map. The scan does NOT
 * mutate `CommandNode`.
 *
 * @param command - The root command to resolve from
 * @param argv - The argv array to resolve against
 * @param hint - Whether to raise rule 4's hint: set only when routing a command line
 * @returns The resolved command, argv, and the command path
 * @throws {CrustError} COMMAND_NOT_FOUND for a word that names no subcommand where no argument can take it
 * @throws {CrustError} PARSE, when `hint` is set, for a flag only a later subcommand knows, typed before that subcommand's name
 */
export function resolveCommand(
	command: CommandNode,
	argv: readonly string[],
	hint = false,
): CommandRoute {
	const path = [command.meta.name];

	let current: CommandNode = command;
	let routedArgv: readonly string[] = argv;
	// Known flags (and their values) encountered before a subcommand name,
	// re-prepended for the resolved command's parser in token order.
	const skippedFlagTokens: string[] = [];

	while (routedArgv.length > 0) {
		const subCommands = current.subCommands;
		if (Object.keys(subCommands).length === 0) {
			// No subcommands defined — argv goes to the parser
			break;
		}

		const candidate = routedArgv[0];

		if (!candidate) break;

		// `-` and `--` are not flags: the parser reads them.
		if (candidate.startsWith("-")) {
			const match = matchFlagToken(current.flagSpellings, candidate);
			if (match === undefined) break;
			if (match instanceof CrustError) {
				if (hint && match.is("PARSE") && match.details?.reason === "unknown-flag") {
					const later = subcommandKnowing(current, candidate, routedArgv.slice(1));
					if (later) {
						throw new CrustError(
							"PARSE",
							`${match.message}; flags of subcommand "${later.join(" ")}" go after its name`,
							match.details,
						);
					}
				}
				break;
			}
			skippedFlagTokens.push(candidate);
			routedArgv = routedArgv.slice(1);
			const value = routedArgv[0];
			if (match.pending && value !== undefined) {
				skippedFlagTokens.push(value);
				routedArgv = routedArgv.slice(1);
			}
			continue;
		}

		// We record the canonical sibling key on the path, NOT an alias the user
		// typed — downstream help/extensions assume `commandPath` only ever contains canonical names.
		const child = findChild(subCommands, candidate);
		if (child) {
			current = child.node;
			path.push(child.canonicalName);
			routedArgv = routedArgv.slice(1);
			continue;
		}

		// A command's action is its default: a word its arguments can take is theirs.
		if (current.run && current.args.length > 0) break;

		throw commandNotFound(current, candidate, path);
	}

	return {
		command: current,
		argv: [...skippedFlagTokens, ...routedArgv],
		commandPath: path,
	};
}
