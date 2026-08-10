import type { ContextInstance } from "../api/context.ts";
import type { Extension } from "../api/extension.ts";
import type { FlagSpelling } from "../parsing/spellings.ts";
import type { ArgsDef, CommandMeta, FlagsDef } from "../types.ts";

// ────────────────────────────────────────────────────────────────────────────
// CommandNode — Internal command tree node
// ────────────────────────────────────────────────────────────────────────────

/**
 * Internal representation of a single node in the command tree.
 *
 * Built by the `Crust` builder class; not part of the public API.
 * Each node carries its own local flags, the pre-computed effective
 * (Context-owned + local merged) flags, positional args, subcommands,
 * extensions, and the Command Action.
 */
export interface CommandNode {
	/** Command metadata (name, description, usage) */
	meta: CommandMeta;
	/** Flags defined directly on this command via `.flags()` */
	localFlags: FlagsDef;
	/** Accumulated flags owned by Contexts provided on this command path */
	ownedFlags: FlagsDef;
	/** Context-owned and local flags merged for parsing */
	effectiveFlags: FlagsDef;
	/** Cached canonical/short/alias table for the normalized effective flags. */
	flagSpellings: Map<string, FlagSpelling>;
	/** Positional argument definitions */
	args: ArgsDef | undefined;
	/** Named subcommands keyed by name */
	subCommands: Record<string, CommandNode>;
	/** Context instances available to this command in cached topological order. */
	contexts: ContextInstance[];
	/** Extensions registered via `.extend()` (root builder only) */
	extensions: Extension[];
	/** The Command Action */
	run?: (ctx: unknown) => void | Promise<void>;
}

// ────────────────────────────────────────────────────────────────────────────
// createCommandNode — Factory function
// ────────────────────────────────────────────────────────────────────────────

/**
 * Creates a new `CommandNode` with all fields initialized to defaults.
 *
 * @param name - The command name.
 * @returns A fresh `CommandNode` with empty flags, no args, no subcommands,
 *          no extensions, and no action.
 */
export function createCommandNode(name: string): CommandNode {
	return {
		meta: { name },
		localFlags: {},
		ownedFlags: {},
		effectiveFlags: {},
		flagSpellings: new Map(),
		args: undefined,
		subCommands: {},
		contexts: [],
		extensions: [],
		run: undefined,
	};
}
