import type { ContextInstance } from "../api/context.ts";
import type { Extension } from "../api/extension.ts";
import { CrustError } from "../errors.ts";
import type { ExtensionId } from "../identity.ts";
import { addFlagSpellingEntries, type FlagSpelling } from "../parsing/spellings.ts";
import type { ArgsDef, CommandMeta, FlagDef, FlagsDef } from "../types.ts";
import type { CrustCommandContext } from "./crust.ts";

/** Runtime-erased Command Action; typed builders and run() own the specific result contract. */
// oxlint-disable-next-line anti-slop/no-unknown-returns -- runtime nodes erase each command's result generic; typed run() re-derives it.
export type CommandAction = (ctx: CrustCommandContext) => unknown;

export interface CommandContext {
	instance: ContextInstance;
	extensionId?: ExtensionId;
}

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
	/** Cached canonical/short/alias table for the effective flags. */
	flagSpellings: Map<string, FlagSpelling>;
	/** Positional argument definitions */
	args: ArgsDef;
	/** Named subcommands keyed by name */
	subCommands: Record<string, CommandNode>;
	/** Contexts available to this command in provide order (construction order is pull-driven). */
	contexts: CommandContext[];
	/** Extensions registered via `.extend()` (root builder only) */
	extensions: Extension[];
	/** The Command Action */
	run?: CommandAction;
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
		args: [],
		subCommands: {},
		contexts: [],
		extensions: [],
		run: undefined,
	};
}

/** Register one effective flag and its source-owned state with a single collision policy. */
export function registerFlag(
	node: CommandNode,
	name: string,
	def: FlagDef,
	source: "local" | "owned",
): void {
	const incomingSpellings = [name, def.short, ...(def.aliases ?? [])].filter(
		(spelling): spelling is string => spelling !== undefined,
	);
	if (new Set(incomingSpellings).size !== incomingSpellings.length) {
		throw new CrustError(
			"DEFINITION",
			`Flag "${name}" repeats one of its own spellings on command "${node.meta.name}"`,
			{ subject: "flag", name, reason: "flag-collision" },
		);
	}
	const existingName = Object.hasOwn(node.effectiveFlags, name)
		? name
		: incomingSpellings
				.map((spelling) => node.flagSpellings.get(spelling)?.canonicalName)
				.find((existing) => existing !== undefined);
	if (existingName !== undefined) {
		throw new CrustError(
			"DEFINITION",
			`Flag "${name}" collides with existing flag "${existingName}" on command "${node.meta.name}"`,
			{ subject: "flag", name, reason: "flag-collision" },
		);
	}
	(source === "local" ? node.localFlags : node.ownedFlags)[name] = def;
	node.effectiveFlags[name] = def;
	addFlagSpellingEntries(node.flagSpellings, name, def);
}
