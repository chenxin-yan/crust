import type { CrustPlugin } from "./plugins.ts";
import type { ArgsDef, CommandMeta, FlagDef, FlagsDef } from "./types.ts";

// ────────────────────────────────────────────────────────────────────────────
// CommandNode — Internal command tree node
// ────────────────────────────────────────────────────────────────────────────

/**
 * Internal representation of a single node in the command tree.
 *
 * Built by the `Crust` builder class; not part of the public API.
 * Each node carries its own local flags, the pre-computed effective
 * (inherited + local merged) flags, positional args, subcommands,
 * plugins, and lifecycle handlers.
 */
export interface CommandNode {
	/** Command metadata (name, description, usage) */
	meta: CommandMeta;
	/** Flags defined directly on this command via `.flags()` */
	localFlags: FlagsDef;
	/** Inherited flags merged with local flags (used by the parser) */
	effectiveFlags: FlagsDef;
	/** Positional argument definitions */
	args: ArgsDef | undefined;
	/** Named subcommands keyed by name */
	subCommands: Record<string, CommandNode>;
	/** Plugins registered via `.use()` */
	plugins: CrustPlugin[];
	/** Called before `run()` — useful for initialization */
	preRun?: (ctx: unknown) => void | Promise<void>;
	/** The main command handler */
	run?: (ctx: unknown) => void | Promise<void>;
	/** Called after `run()` (even if it throws) — useful for teardown */
	postRun?: (ctx: unknown) => void | Promise<void>;
}

// ────────────────────────────────────────────────────────────────────────────
// createCommandNode — Factory function
// ────────────────────────────────────────────────────────────────────────────

/**
 * Creates a new `CommandNode` with all fields initialized to defaults.
 *
 * @param name - The command name.
 * @returns A fresh `CommandNode` with empty flags, no args, no subcommands,
 *          no plugins, and no lifecycle handlers.
 */
export function createCommandNode(name: string): CommandNode {
	return {
		meta: { name },
		localFlags: {},
		effectiveFlags: {},
		args: undefined,
		subCommands: {},
		plugins: [],
		preRun: undefined,
		run: undefined,
		postRun: undefined,
	};
}

// ────────────────────────────────────────────────────────────────────────────
// computeEffectiveFlags — Runtime flag inheritance merge
// ────────────────────────────────────────────────────────────────────────────

/**
 * Merges inherited flags (only those with `inherit: true`) with local flags.
 *
 * Local flags override inherited flags with the same key. Non-inheritable
 * flags from the parent are excluded entirely.
 *
 * This is the runtime counterpart of the `EffectiveFlags` utility type.
 *
 * @param inherited - The parent's effective flags (or any FlagsDef).
 * @param local - The current command's locally-defined flags.
 * @returns A new `FlagsDef` containing inherited+local merged flags.
 */
export function computeEffectiveFlags(
	inherited: FlagsDef,
	local: FlagsDef,
): FlagsDef {
	const result: Record<string, FlagDef> = {};

	// Copy only inheritable flags from parent
	for (const [key, def] of Object.entries(inherited)) {
		if (def.inherit === true) {
			result[key] = def;
		}
	}

	// Local flags override inherited flags with the same key
	for (const [key, def] of Object.entries(local)) {
		result[key] = def;
	}

	return result;
}
