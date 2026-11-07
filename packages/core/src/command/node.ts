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
import type { CommandDefinition, CrustCommandContext } from "./crust.ts";

export const commandDefinitionInternal: unique symbol = Symbol.for("crust.commandDefinition");

/** Runtime-erased Command Action; typed builders and run() own the specific result contract. */
export type CommandAction = (ctx: CrustCommandContext) => unknown;

export interface CommandContext {
	instance: AnyContextInstance;
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
	/** Flags owned by the Contexts in {@link flagContexts}, plus recursive Extension flags once prepared */
	ownedFlags: FlagsDef;
	/**
	 * Names of the Contexts whose owned flags this command parses: provided here, inherited by
	 * an inline `.command()` child, declared with `.use()` (with their dependencies), or used by
	 * an Extension hook. Never mutated; changes assign a new array.
	 */
	flagContexts: readonly string[];
	/** Context-owned and local flags merged for parsing */
	effectiveFlags: FlagsDef;
	/** Cached canonical/short/alias table for the effective flags. */
	flagSpellings: Map<string, FlagSpelling>;
	/** Positional argument definitions */
	args: ArgsDef;
	/**
	 * Children of a materialized or prepared node, keyed by name: a lazy record whose
	 * children build on first read. Empty on builder nodes; read those through {@link subCommandsOf}.
	 */
	subCommands: Record<string, CommandNode>;
	/** Builder-stage children from `.add()` and `.command()`, newest first; cleared when the node is materialized or prepared. */
	addedChildren?: AddedChild;
	/** Contexts available to this command in provide order (construction order is pull-driven). */
	contexts: CommandContext[];
	/** Contexts `.provide()`d on this command itself; preparation installs their sections here. */
	providedContexts: readonly AnyContextInstance[];
	/** Declared command demands; validated when recipes are materialized. */
	demands: readonly AnyContextFactory[];
	/** Extensions registered via `.extend()` (root builder only) */
	extensions: ExtensionData[];
	/**
	 * Root builder only, set with `extensions`: how many root `contexts` existed at
	 * each Extension's last registration. Its providers replace those and yield to later ones.
	 */
	extensionPositions?: ReadonlyMap<ExtensionId, number>;
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
		flagContexts: [],
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

/**
 * Register the owned flags of each Context and, transitively, of the Contexts its setup uses,
 * once per Context name: a Context already parsed here (such as one an inline child inherited)
 * adds nothing. Flags come from the instance `node` resolves by that name, which may be another
 * same-name factory's; dependencies are both factories', so an `.of()` double parses the same flags.
 */
export function installContextFlags(
	node: CommandNode,
	factories: readonly AnyContextFactory[],
): void {
	for (const factory of factories) {
		const name = factory.contextName;
		if (node.flagContexts.includes(name)) continue;
		node.flagContexts = [...node.flagContexts, name];
		const provided = node.contexts.findLast(({ instance }) => instance.name === name)?.instance;
		for (const [flag, def] of Object.entries((provided ?? factory).ownedFlags)) {
			registerFlag(node, flag, def, "owned");
		}
		installContextFlags(node, provided ? [...factory.use, ...provided.use] : factory.use);
	}
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
	/** Lets preparation materialize a root child against a parent carrying Extension providers. */
	readonly definition: CommandDefinition;
	/** The builder node at `.add()` time: `.provide()` stays positional. */
	readonly parent: CommandNode;
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
	entries.push(...addedChildrenOf(node));
	return entries;
}

/** The node's `.add()` cells in insertion order. */
export function addedChildrenOf(node: CommandNode): AddedChild[] {
	const newestFirst: AddedChild[] = [];
	for (let cell = node.addedChildren; cell; cell = cell.next) newestFirst.push(cell);
	const added: AddedChild[] = [];
	for (let i = newestFirst.length - 1; i >= 0; i--) added.push(newestFirst[i]!);
	return added;
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
const lazyChildBuilt = new WeakMap<object, ReadonlyMap<string, CommandNode>>();

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
	const built = new Map<string, CommandNode>();
	for (const entry of entries) {
		Object.defineProperty(record, entry.name, {
			enumerable: true,
			get: () => {
				let child = built.get(entry.name);
				if (!child) built.set(entry.name, (child = build(entry)));
				return child;
			},
		});
		meta.set(entry.name, entry.meta);
	}
	lazyChildMeta.set(record, meta);
	lazyChildBuilt.set(record, built);
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

/** The named child if it is already built, else `undefined`; never builds it. */
export function builtChildOf(
	subCommands: Record<string, CommandNode>,
	name: string,
): CommandNode | undefined {
	const built = lazyChildBuilt.get(subCommands);
	return built ? built.get(name) : subCommands[name];
}

/** The node's children if every one is already built, else `undefined`; never builds one. */
export function builtChildrenOf(node: CommandNode): CommandNode[] | undefined {
	if (node.addedChildren) return undefined;
	const built = lazyChildBuilt.get(node.subCommands);
	if (!built) return Object.values(node.subCommands);
	return built.size === lazyChildMeta.get(node.subCommands)!.size ? [...built.values()] : undefined;
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
