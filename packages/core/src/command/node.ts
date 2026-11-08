import type { StandardSchema } from "@crustjs/utils/schema";

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
	/** The Extension whose `.provide()` supplied it; a command's `.use()` of that Extension declares it. */
	extension?: ExtensionId;
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
	 * The flag-owning Contexts whose owned flags this command parses, by name, with the flag names
	 * installed for each: provided here, inherited by an inline `.command()` child, declared with `.use()`
	 * (with their dependencies), or used by an Extension hook. Never mutated; changes assign a new map.
	 */
	flagContexts: ReadonlyMap<string, readonly string[]>;
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
	demands: readonly (AnyContextInstance | AnyContextFactory)[];
	/**
	 * The factories inline `.command()` ancestors declared before this command: it parses their
	 * flags too, so preparation checks them against this command's providers.
	 */
	inheritedDemands: readonly AnyContextFactory[];
	/** Ids of Extensions this command uses for their Contexts; preparation checks the app extends each. */
	usedExtensions: readonly ExtensionId[];
	/** Extensions registered via `.extend()` (root builder only) */
	extensions: ExtensionData[];
	/**
	 * Root builder only, set with `extensions`: how many root `contexts` existed at
	 * each Extension's last registration. Its providers replace those and yield to later ones.
	 */
	extensionPositions?: ReadonlyMap<ExtensionId, number>;
	/** The Command Action */
	run?: CommandAction;
	/** Schema from `.output()` that validates and transforms the action result */
	outputSchema?: StandardSchema;
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
		flagContexts: new Map(),
		effectiveFlags: {},
		flagSpellings: new Map(),
		args: [],
		subCommands: {},
		contexts: [],
		providedContexts: [],
		demands: [],
		inheritedDemands: [],
		usedExtensions: [],
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
 * Register the owned flags of each declared Context and, transitively, of the Contexts its setup
 * uses: what the types know. A flag a same-name declaration or provider already installed is
 * shared; {@link checkProvidedContextFlags} requires every declaration to equal the provider.
 */
export function installContextFlags(
	node: CommandNode,
	factories: readonly AnyContextFactory[],
): void {
	// The map may be shared with other nodes: copy it once, on the first change.
	let flagContexts: Map<string, readonly string[]> | undefined;
	for (const { contextName, ownedFlags } of declaredContextFactories(factories)) {
		const installed = (flagContexts ?? node.flagContexts).get(contextName) ?? [];
		const added = Object.keys(ownedFlags).filter((flag) => !installed.includes(flag));
		if (added.length === 0) continue;
		for (const flag of added) registerFlag(node, flag, ownedFlags[flag]!, "owned");
		(flagContexts ??= new Map(node.flagContexts)).set(contextName, [...installed, ...added]);
	}
	if (flagContexts) node.flagContexts = flagContexts;
}

/**
 * Once `node`'s providers are final, for the `declared` Contexts (with their dependencies): a
 * provider of another factory must own exactly the flags of each same-name declaration, the
 * flags `node` parses; and the Contexts such a provider uses must own only flags `node` parses.
 */
export function checkProvidedContextFlags(
	node: CommandNode,
	declared: readonly AnyContextFactory[],
): void {
	if (declared.length === 0) return;
	const providers = new Map<string, AnyContextInstance>();
	for (const { instance } of node.contexts) providers.set(instance.name, instance);
	const factories = declaredContextFactories(declared);
	const visited = new Set(factories.map((factory) => factory.contextName));
	const replacementDependencies: AnyContextFactory[] = [];
	for (const factory of factories) {
		const name = factory.contextName;
		const provider = providers.get(name);
		if (!provider || provider.factory === factory) continue;
		if (!sameFlags(factory.ownedFlags, provider.ownedFlags)) {
			throw new CrustError(
				"DEFINITION",
				`Context "${name}" provided to command "${node.meta.name}" does not own the same flags as the Context "${name}" it declares with .use(). A provider of another factory must own exactly the declared flags: change the declared Context, or provide the same factory (for example its .of()).`,
				{ subject: "context", name, reason: "context-flags-not-parsed" },
			);
		}
		replacementDependencies.push(...provider.use);
	}
	// An array visits entries pushed while iterating, so dependencies are followed transitively.
	for (const { contextName: name } of replacementDependencies) {
		if (visited.has(name)) continue;
		visited.add(name);
		const provider = providers.get(name);
		if (!provider) continue;
		const installed = node.flagContexts.get(name) ?? [];
		const unparsed = Object.keys(provider.ownedFlags).find((flag) => !installed.includes(flag));
		if (unparsed !== undefined) {
			throw new CrustError(
				"DEFINITION",
				`Context "${name}", used by a replacement provider on command "${node.meta.name}", owns flag "${unparsed}", which the command does not parse. Declare it with .use(${name}) too, or provide the declared Context's own factory.`,
				{ subject: "context", name, reason: "context-flags-not-parsed" },
			);
		}
		replacementDependencies.push(...provider.use);
	}
}

/** The factories `demands` declare: a demanded instance (an Extension's provided Context) declares its own. */
export function demandedFactories(demands: CommandNode["demands"]): AnyContextFactory[] {
	return demands.map((demand) => ("contextName" in demand ? demand : demand.factory));
}

/** Declared factories and their dependencies, transitively, each once. */
function declaredContextFactories(factories: readonly AnyContextFactory[]): AnyContextFactory[] {
	const visited = new Set<AnyContextFactory>();
	const visit = (list: readonly AnyContextFactory[]): void => {
		for (const factory of list) {
			if (visited.has(factory)) continue;
			visited.add(factory);
			visit(factory.use);
		}
	};
	visit(factories);
	return [...visited];
}

/** Names of the Contexts whose flags {@link installContextFlags} installs for `factories`. */
export function declaredContextNames(factories: readonly AnyContextFactory[]): Set<string> {
	return new Set(declaredContextFactories(factories).map((factory) => factory.contextName));
}

// The same flag names with equal definitions; a schema, even a plain object, by identity.
function sameFlags(a: FlagsDef, b: FlagsDef): boolean {
	const names = Object.keys(a);
	return (
		names.length === Object.keys(b).length &&
		names.every((name) => {
			if (!Object.hasOwn(b, name)) return false;
			const { schema: schemaA, ...restA } = a[name]!;
			const { schema: schemaB, ...restB } = b[name]!;
			return schemaA === schemaB && sameDefinition(restA, restB);
		})
	);
}

// Frozen flag definitions compare structurally; functions and class instances by identity.
function sameDefinition(a: unknown, b: unknown): boolean {
	if (a === b) return true;
	if (Array.isArray(a)) {
		return Array.isArray(b) && a.length === b.length && a.every((v, i) => sameDefinition(v, b[i]));
	}
	if (!isPlainObject(a) || !isPlainObject(b)) return false;
	const keys = Object.keys(a);
	return (
		keys.length === Object.keys(b).length &&
		keys.every((key) => Object.hasOwn(b, key) && sameDefinition(a[key], b[key]))
	);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	if (typeof value !== "object" || value === null) return false;
	const proto: unknown = Object.getPrototypeOf(value);
	return proto === Object.prototype || proto === null;
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
	/** The definition `.add()` or an Extension contributed the child from. */
	readonly definition?: CommandDefinition;
}

/** The node's children in insertion order, without materializing pending ones. */
export function childEntriesOf(node: CommandNode): ChildEntry[] {
	const subCommands = node.subCommands;
	const definitions = lazyChildDefinitions.get(subCommands);
	const entries: ChildEntry[] = [...childMetaOf(subCommands)].map(([name, meta]) => ({
		name,
		meta,
		resolve: () => subCommands[name]!,
		definition: definitions?.get(name),
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
const lazyChildDefinitions = new WeakMap<object, ReadonlyMap<string, CommandDefinition>>();

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
	const definitions = new Map<string, CommandDefinition>();
	for (const entry of entries) {
		if (entry.definition) definitions.set(entry.name, entry.definition);
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
	lazyChildDefinitions.set(record, definitions);
	return Object.freeze(record);
}

/**
 * Canonical names from `root` through the command added from `definition` (by identity),
 * shallowest first, then in insertion order; `undefined` when no command was added from it.
 * Builds the children of every level it searches.
 */
export function commandPathOf(
	root: CommandNode,
	definition: CommandDefinition,
): readonly string[] | undefined {
	let level: { node: CommandNode; path: readonly string[] }[] = [
		{ node: root, path: [root.meta.name] },
	];
	while (level.length > 0) {
		for (const { node, path } of level) {
			for (const [name, candidate] of lazyChildDefinitions.get(node.subCommands) ?? []) {
				if (candidate === definition) return Object.freeze([...path, name]);
			}
		}
		// childEntriesOf keeps insertion order; Object.entries would put integer-like names first.
		level = level.flatMap(({ node, path }) =>
			childEntriesOf(node).map((entry) => ({
				node: entry.resolve(),
				path: [...path, entry.name],
			})),
		);
	}
	return undefined;
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
