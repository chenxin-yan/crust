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
	 * The Contexts whose owned flags this command parses, by name, with the flag names installed
	 * for each: provided here, inherited by an inline `.command()` child, declared with `.use()`
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
 * Register `flags` as owned by the Context `name`. The flags a `.use()` declares type the command;
 * the provider's flags are what its setup reads. A flag both define stays installed once: equal
 * definitions are shared, and the provider may customize a declared flag's spelling, help, or
 * default value (its definition wins) but not the values or presence the declared type promises.
 */
export function registerContextFlags(
	node: CommandNode,
	name: string,
	flags: FlagsDef,
	source: "declared" | "provided",
): void {
	const installed = [...(node.flagContexts.get(name) ?? [])];
	for (const [flag, def] of Object.entries(flags)) {
		if (!installed.includes(flag)) {
			registerFlag(node, flag, def, "owned");
			installed.push(flag);
			continue;
		}
		const current = node.ownedFlags[flag]!;
		if (sameDefinition(current, def)) continue;
		const [declared, provided] = source === "provided" ? [current, def] : [def, current];
		if (!keepsDeclaredValues(declared, provided)) {
			throw new CrustError(
				"DEFINITION",
				`Flag "${flag}" of Context "${name}" collides with the provider's definition on command "${node.meta.name}"`,
				{ subject: "flag", name: flag, reason: "flag-collision" },
			);
		}
		if (source === "provided") replaceFlag(node, flag, def);
	}
	node.flagContexts = new Map(node.flagContexts).set(name, installed);
}

/**
 * Register the owned flags of each declared Context and, transitively, of the Contexts its setup
 * uses: what the types know. Factories are visited once each, so two same-name factories declared
 * together both contribute. {@link checkProvidedContextFlags} checks the resolved providers.
 */
export function installContextFlags(
	node: CommandNode,
	factories: readonly AnyContextFactory[],
): void {
	for (const factory of declaredContextFactories(factories)) {
		registerContextFlags(node, factory.contextName, factory.ownedFlags, "declared");
	}
}

/**
 * Once `node`'s providers are final: each Context `factories` declare (transitively), and each
 * dependency of its resolved provider, must resolve to a provider whose owned flags `node` already
 * parses, compatibly. A same-name provider may customize a declared flag (its definition wins)
 * but not add one: the types know only the declared Contexts' flags.
 */
export function checkProvidedContextFlags(
	node: CommandNode,
	factories: readonly AnyContextFactory[],
): void {
	const names = declaredContextNames(factories);
	// A Set visits names added while iterating, so providers' dependencies are checked too.
	for (const name of names) {
		const provided = node.contexts.findLast(({ instance }) => instance.name === name)?.instance;
		if (!provided) continue;
		const installed = node.flagContexts.get(name) ?? [];
		const unparsed = Object.keys(provided.ownedFlags).find((flag) => !installed.includes(flag));
		if (unparsed !== undefined) {
			throw new CrustError(
				"DEFINITION",
				`Context "${name}" provided to command "${node.meta.name}" owns flag "${unparsed}", which the command does not parse: the Contexts it declares with .use() do not own it. Declare the provider's own Context, or add the flag to the declared one.`,
				{ subject: "context", name, reason: "context-flags-not-parsed" },
			);
		}
		registerContextFlags(node, name, provided.ownedFlags, "provided");
		for (const dependency of provided.use) names.add(dependency.contextName);
	}
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

// Whether every value `provided` parses fits the type `declared` promises the action: the same
// value type, a value whenever the declared one guarantees it, and input required only if the
// declared one requires it too.
function keepsDeclaredValues(declared: FlagDef, provided: FlagDef): boolean {
	if (
		declared.type !== provided.type ||
		Boolean(declared.multiple) !== Boolean(provided.multiple)
	) {
		return false;
	}
	if (declared.parse !== provided.parse || declared.schema !== provided.schema) return false;
	const present = (def: FlagDef) => def.required === true || def.default !== undefined;
	if (present(declared) && !present(provided)) return false;
	const inputRequired = (def: FlagDef) => def.required === true && def.default === undefined;
	if (inputRequired(provided) && !inputRequired(declared)) return false;
	const choices = declared.choices;
	return choices === undefined || (provided.choices?.every((c) => choices.includes(c)) ?? false);
}

function replaceFlag(node: CommandNode, name: string, def: FlagDef): void {
	delete node.ownedFlags[name];
	delete node.effectiveFlags[name];
	for (const [spelling, entry] of node.flagSpellings) {
		if (entry.canonicalName === name) node.flagSpellings.delete(spelling);
	}
	registerFlag(node, name, def, "owned");
}

// Frozen flag definitions compare structurally; functions and schema objects by identity.
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
