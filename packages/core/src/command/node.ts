import type { AnyContextFactory, AnyContextInstance } from "../api/context.ts";
import type { ExtensionData } from "../api/extension.ts";
import { CrustError } from "../errors.ts";
import type { ExtensionId } from "../identity.ts";
import {
	flagSpellings,
	isFlagNegatable,
	normalizeFlag,
	type FlagSpelling,
} from "../parsing/spellings.ts";
import type { ArgsDef, CommandMeta, FlagDef, FlagsDef } from "../types.ts";
import type { CrustCommandContext } from "./crust.ts";

export const commandDefinitionInternal: unique symbol = Symbol.for("crust.commandDefinition");

/** Runtime-erased Command Action; typed builders and run() own the specific result contract. */
export type CommandAction = (ctx: CrustCommandContext) => unknown;

export interface CommandContext {
	instance: AnyContextInstance;
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
	/** Named subcommands keyed by name; read builder nodes through {@link subCommandsOf}. */
	subCommands: Record<string, CommandNode>;
	/** Builder-only children added by `.add()`, newest first, on top of `subCommands`. */
	addedChildren?: AddedChild;
	/** Contexts available to this command in provide order (construction order is pull-driven). */
	contexts: CommandContext[];
	/** Contexts `.provide()`d on this command itself; preparation installs their sections here. */
	providedContexts: readonly AnyContextInstance[];
	/** Declared command demands; validated when recipes are materialized. */
	demands: readonly AnyContextFactory[];
	/** Extensions registered via `.extend()` (root builder only) */
	extensions: ExtensionData[];
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
		providedContexts: [],
		demands: [],
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
	def = normalizeFlag(name, def);

	const incomingSpellings = flagSpellings(name, def);
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
	const entry = { canonicalName: name, def, negatable: isFlagNegatable(def) } as const;
	node.flagSpellings.set(name, { ...entry, kind: "canonical" });
	if (def.short !== undefined) node.flagSpellings.set(def.short, { ...entry, kind: "short" });
	for (const alias of def.aliases ?? []) node.flagSpellings.set(alias, { ...entry, kind: "alias" });
}

/** Copy the flag registry so `registerFlag` on the copy leaves `node` untouched. */
export function cloneFlagRegistry(
	node: CommandNode,
): Pick<CommandNode, "localFlags" | "ownedFlags" | "effectiveFlags" | "flagSpellings"> {
	return {
		localFlags: { ...node.localFlags },
		ownedFlags: { ...node.ownedFlags },
		effectiveFlags: { ...node.effectiveFlags },
		// Entries are immutable and already point at the effective definition
		// (see FlagSpelling), so only the Map container needs its own copy.
		flagSpellings: new Map(node.flagSpellings),
	};
}

/**
 * A persistent list cell: `.add()` prepends one per child instead of copying the
 * whole record, which made long `.add()` chains quadratic. Builders sharing a tail
 * stay independent because cells are never mutated.
 */
export interface AddedChild extends ChildEntry {
	readonly next: AddedChild | undefined;
}

/**
 * A child known by name and metadata before its node exists. `.add()` records
 * definitions this way so recipes run only when an invocation, snapshot, or
 * documentation pass first needs that command.
 */
export interface ChildEntry {
	readonly name: string;
	readonly meta: CommandMeta;
	/** Materializes the child once; a throwing recipe throws again on the next call. */
	readonly resolve: () => CommandNode;
}

/** The node's children in insertion order, without materializing pending ones. */
export function childEntriesOf(node: CommandNode): ChildEntry[] {
	const subCommands = node.subCommands;
	const entries: ChildEntry[] = [...childMetaOf(subCommands)].map(([name, meta]) => ({
		name,
		meta,
		resolve: () => subCommands[name]!,
	}));
	const added: AddedChild[] = [];
	for (let cell = node.addedChildren; cell; cell = cell.next) added.push(cell);
	for (let i = added.length - 1; i >= 0; i--) entries.push(added[i]!);
	return entries;
}

const childRecords = new WeakMap<AddedChild, Record<string, CommandNode>>();

/**
 * The node's children in insertion order, materializing pending ones; the result
 * is shared and must not be mutated.
 */
export function subCommandsOf(node: CommandNode): Record<string, CommandNode> {
	const head = node.addedChildren;
	if (head === undefined) return node.subCommands;
	let record = childRecords.get(head);
	if (record === undefined) {
		record = {};
		for (const entry of childEntriesOf(node)) record[entry.name] = entry.resolve();
		childRecords.set(head, record);
	}
	return record;
}

const lazyChildMeta = new WeakMap<object, ReadonlyMap<string, CommandMeta>>();

/**
 * A frozen children record whose nodes are built on first property access, so an
 * invocation prepares only the commands it routes through. Whole-tree readers
 * (`Object.entries`, spread, snapshots) still see and build every child.
 */
export function lazyChildRecord(
	entries: Iterable<ChildEntry>,
	build: (entry: ChildEntry) => CommandNode,
): Record<string, CommandNode> {
	const record: Record<string, CommandNode> = {};
	const meta = new Map<string, CommandMeta>();
	for (const entry of entries) {
		let built: CommandNode | undefined;
		Object.defineProperty(record, entry.name, {
			enumerable: true,
			get: () => (built ??= build(entry)),
		});
		meta.set(entry.name, entry.meta);
	}
	lazyChildMeta.set(record, meta);
	return Object.freeze(record);
}

/** Child metadata by name, read without building children when the record is lazy. */
export function childMetaOf(
	subCommands: Record<string, CommandNode>,
): Iterable<[string, CommandMeta]> {
	return (
		lazyChildMeta.get(subCommands) ??
		Object.entries(subCommands).map(([name, child]): [string, CommandMeta] => [name, child.meta])
	);
}

/** Clone a command subtree on access without mutating the builder graph. */
export function cloneCommandNode(node: CommandNode): CommandNode {
	// Spread first, then override every structural field with a decoupled copy.
	return {
		...node,
		// Section objects/arrays are never mutated in place (prepare replaces
		// them wholesale), so sharing them here is safe.
		meta: { ...node.meta },
		...cloneFlagRegistry(node),
		args: [...node.args],
		subCommands: lazyChildRecord(childEntriesOf(node), (entry) =>
			cloneCommandNode(entry.resolve()),
		),
		addedChildren: undefined,
		contexts: node.contexts.map((context) => ({ ...context })),
		providedContexts: [...node.providedContexts],
		demands: [...node.demands],
		extensions: [...node.extensions],
	};
}
