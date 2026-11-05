import { isFlagNegatable } from "../parsing/spellings.ts";
import type {
	ArgDef,
	CommandMeta,
	CommandSection,
	DeclaredDefault,
	FlagDef,
	ValueType,
} from "../types.ts";
import { builtChildOf, builtChildrenOf, childMetaOf, type CommandNode } from "./node.ts";

// ────────────────────────────────────────────────────────────────────────────
// CommandSnapshot — Readonly, serializable command description
// ────────────────────────────────────────────────────────────────────────────

/**
 * Serializable projection of a positional argument definition.
 *
 * Carries everything help/man/tooling surfaces need; `parse` functions and
 * schemas never cross the boundary.
 *
 * Fields with `undefined` values are dropped entirely (see `freezeCompact`),
 * so absent means "not declared" — except `required`, which is omitted when a
 * declared default makes the value optional.
 *
 * @example
 * For `{ name: "port", type: "number", default: 3000 }`:
 * ```ts
 * { name: "port", type: "number", default: 3000 }
 * // `required`/`variadic` keys absent — not declared on the def
 * ```
 */
export interface ArgSnapshot {
	/** Argument name as defined, e.g. `"file"`. */
	readonly name: string;
	/** Value type (`"string"`, `"number"`, …); absent for schema-backed args. */
	readonly type?: ValueType;
	/** Human-readable description for help text. */
	readonly description?: string;
	/** `true` when parsing fails if the argument is missing. */
	readonly required?: boolean;
	/** `true` when the argument collects all remaining positionals into an array. */
	readonly variadic?: boolean;
	/** Static enum of accepted values, e.g. `["json", "text"]`. */
	readonly choices?: readonly string[];
	/** Declared default value; `URL` defaults are serialized to their `href` string. */
	readonly default?: unknown;
}

/**
 * Serializable projection of a flag definition. The flag's canonical name is
 * the key it sits under in {@link CommandSnapshot.flags}, not a field here.
 *
 * @example
 * For `{ verbose: { type: "boolean", short: "v", default: false } }`:
 * ```ts
 * snapshot.flags.verbose
 * // => { type: "boolean", short: "v", default: false, negatable: true }
 * ```
 */
export interface FlagSnapshot {
	/** Value type, e.g. `"boolean"`, `"string"`, `"number"`. */
	readonly type: ValueType;
	/** Human-readable description for help text. */
	readonly description?: string;
	/** Single-character short alias without the dash, e.g. `"v"` for `-v`. */
	readonly short?: string;
	/** Additional aliases without dashes; one-character aliases accept one or two dashes. */
	readonly aliases?: readonly string[];
	/** `true` when parsing fails if the flag is not provided. */
	readonly required?: boolean;
	/** `true` when the flag can repeat and collects values into an array. */
	readonly multiple?: boolean;
	/** `true` when the flag accepts generated `--no-<name>` spellings. */
	readonly negatable: boolean;
	/** `true` when a boolean flag opted out of the `--no-<name>` spelling. */
	readonly noNegate?: boolean;
	/** Static enum of accepted values, e.g. `["debug", "info", "error"]`. */
	readonly choices?: readonly string[];
	/** Declared default value; `URL` defaults are serialized to their `href` string. */
	readonly default?: unknown;
	/** Declared environment binding; never contains the variable's value. */
	readonly env?: Readonly<NonNullable<FlagDef["env"]>>;
	/** Delimiter that splits string argv values of a repeatable flag into occurrences. */
	readonly delimiter?: string;
}

/**
 * A readonly, serializable description of a command, exposed across public
 * API boundaries (Command Action context, Extension hooks, and
 * `COMMAND_NOT_FOUND` error details) instead of internal command nodes.
 *
 * `flags` contains the effective (Context-owned + local merged) flags — the same
 * set the parser accepts for the command.
 *
 * @example
 * ```ts
 * defineCommand("add", (cmd) =>
 *   cmd
 *     .args({ name: "name", type: "string", required: true })
 *     .flags({ name: "force", type: "boolean", short: "f" })
 *     .action(() => {}),
 * );
 * // snapshots to:
 * // {
 * //   meta: { name: "add" },
 * //   hasAction: true,
 * //   args: [{ name: "name", type: "string", required: true }],
 * //   flags: { force: { type: "boolean", short: "f", negatable: true } },
 * //   subCommands: {},
 * // }
 * ```
 */
export interface CommandSnapshot {
	/** Command metadata, including routing and presentation options. */
	readonly meta: Readonly<CommandMeta>;
	/** Whether the command defines a Command Action */
	readonly hasAction: boolean;
	/** Positional argument snapshots in declaration order. */
	readonly args: readonly ArgSnapshot[];
	/** Effective flags keyed by canonical flag name. */
	readonly flags: Readonly<Record<string, FlagSnapshot>>;
	/**
	 * Direct subcommand snapshots keyed by canonical name (includes hidden ones). In
	 * invocation snapshots a pending child exposes `meta` (except `meta.sections`)
	 * without being built; reading anything else builds it.
	 */
	readonly subCommands: Readonly<Record<string, CommandSnapshot>>;
}

/** Drop keys with `undefined` values so snapshots serialize cleanly, then freeze. */
function freezeCompact<T extends object>(obj: T): T {
	// Copy instead of `delete`: deleting keys drops V8 objects into slow dictionary mode.
	const compact: Partial<T> = {};
	// SAFETY: Object.keys returns exactly the enumerable string keys of T.
	for (const key of Object.keys(obj) as (keyof T)[]) {
		if (obj[key] !== undefined) compact[key] = obj[key];
	}
	// SAFETY: only keys whose value is `undefined` were left out, matching T's optional fields.
	return Object.freeze(compact as T);
}

type SerializableDefault = (ArgSnapshot | FlagSnapshot)["default"];

/**
 * URL defaults are the only non-JSON default values; serialize them as
 * strings. Array defaults are recursively copied and frozen. Object-valued
 * JSON defaults, including objects inside arrays, remain shared references
 * and are not frozen; callers must treat them as immutable.
 */
function serializableDefault(value: DeclaredDefault): SerializableDefault {
	if (value instanceof URL) return value.href;
	if (Array.isArray(value)) return Object.freeze(value.map(serializableDefault));
	return value;
}

/** The parser fills a missing value from its default, so a defaulted def is never required. */
function effectiveRequired(def: ArgDef | FlagDef): boolean | undefined {
	return def.default === undefined ? def.required : undefined;
}

function snapshotArg(def: ArgDef): ArgSnapshot {
	return freezeCompact({
		name: def.name,
		type: def.type,
		description: def.description,
		required: effectiveRequired(def),
		variadic: def.variadic,
		choices: def.choices ? Object.freeze([...def.choices]) : undefined,
		default: serializableDefault(def.default),
	});
}

function snapshotFlag(def: FlagDef): FlagSnapshot {
	return freezeCompact({
		type: def.type,
		description: def.description,
		short: def.short,
		aliases: def.aliases ? Object.freeze([...def.aliases]) : undefined,
		required: effectiveRequired(def),
		multiple: def.multiple,
		negatable: isFlagNegatable(def),
		noNegate: "noNegate" in def ? def.noNegate : undefined,
		choices: def.choices ? Object.freeze([...def.choices]) : undefined,
		default: serializableDefault(def.default),
		env: def.env ? freezeCompact({ name: def.env.name, delimiter: def.env.delimiter }) : undefined,
		delimiter: def.delimiter,
	});
}

/**
 * Project an internal command node (and its whole subtree) into a
 * {@link CommandSnapshot}.
 */
export function snapshotCommand(node: CommandNode): CommandSnapshot {
	const subCommands: Record<string, CommandSnapshot> = {};
	for (const [name, sub] of Object.entries(node.subCommands)) {
		subCommands[name] = snapshotCommand(sub);
	}
	return projectNode(node, snapshotFlags(node), Object.freeze(subCommands));
}

/**
 * Whether projecting `value` again could yield a different result: `URL` hrefs are
 * read live and unfrozen arrays are copied, so later mutations change the projection.
 */
function isMutableDefault(value: DeclaredDefault): boolean {
	if (value instanceof URL) return true;
	if (Array.isArray(value)) return !Object.isFrozen(value) || value.some(isMutableDefault);
	return false;
}

/**
 * Extension section contributions by target node. They live beside the frozen
 * prepared nodes instead of in their `meta`, so applying them never builds or
 * unfreezes the tree; projections append them after the node's own sections.
 */
const contributedSections = new WeakMap<CommandNode, readonly CommandSection[]>();

/** Record one Extension section contribution for `node`, after earlier ones. */
export function contributeSection(node: CommandNode, section: CommandSection): void {
	contributedSections.set(node, [...(contributedSections.get(node) ?? []), section]);
}

/** Verdicts for prepared subtrees, which never change once every command is built. */
const reusable = new WeakMap<CommandNode, boolean>();
/** Projections of reusable prepared subtrees, shared across invocations. */
const shared = new WeakMap<CommandNode, CommandSnapshot>();

/**
 * Whether one snapshot of `node` can serve every invocation: no default in the
 * subtree is mutable. `undefined` while a command in it is still pending, because
 * deciding would build it.
 */
function isReusable(node: CommandNode): boolean | undefined {
	const known = reusable.get(node);
	if (known !== undefined) return known;
	let verdict =
		!node.args.some((def) => isMutableDefault(def.default)) &&
		!Object.values(node.effectiveFlags).some((def) => isMutableDefault(def.default));
	if (verdict) {
		const children = builtChildrenOf(node);
		if (!children) return undefined;
		for (const child of children) {
			const childVerdict = isReusable(child);
			if (childVerdict === undefined) return undefined;
			verdict &&= childVerdict;
		}
	}
	reusable.set(node, verdict);
	return verdict;
}

/**
 * A per-invocation projector over a prepared tree: each node is projected once,
 * when first read, and its children only when they are read. An invocation that
 * reads root metadata (`rootCommand.meta.version`) or the routed command projects,
 * and builds, just those nodes, while walking `subCommands` still sees every child;
 * a pending child stays unbuilt until something past its static metadata is read.
 * Trees that are fully built and have no mutable defaults at the first read reuse
 * projections across invocations. Otherwise the entire invocation stays local,
 * even if its reads or another invocation make the tree reusable later. This keeps
 * `rootCommand.subCommands.x` the same object as a routed `command`.
 *
 * An `authored` projector omits Extension section contributions, even ones applied
 * after it was created, and never shares: shared projections include them.
 */
export function createSnapshotProjector(
	root: CommandNode,
	authored = false,
): (node: CommandNode) => CommandSnapshot {
	const projected = new Map<CommandNode, CommandSnapshot>();
	let reuse: boolean | undefined;
	const share = (node: CommandNode): CommandSnapshot => {
		const existing = shared.get(node);
		if (existing) return existing;
		const subCommands: Record<string, CommandSnapshot> = {};
		for (const [name, sub] of Object.entries(node.subCommands)) subCommands[name] = share(sub);
		const snapshot = projectNode(node, snapshotFlags(node), Object.freeze(subCommands));
		shared.set(node, snapshot);
		return snapshot;
	};
	const project = (node: CommandNode): CommandSnapshot => {
		// Never mix invocation-local snapshots with a shared ancestor or descendant.
		reuse ??= !authored && isReusable(root) === true;
		if (reuse) return share(node);
		const existing = projected.get(node);
		if (existing) return existing;
		const snapshot = projectLocal(node);
		projected.set(node, snapshot);
		return snapshot;
	};
	const projectLocal = (node: CommandNode): CommandSnapshot => {
		const subCommands: Record<string, CommandSnapshot> = {};
		// childMetaOf does not build lazily prepared children.
		for (const [name, meta] of childMetaOf(node.subCommands)) {
			let child: CommandSnapshot | undefined;
			Object.defineProperty(subCommands, name, {
				enumerable: true,
				get: () => (child ??= projectChild(node, name, meta)),
			});
		}
		return projectNode(node, snapshotFlags(node), Object.freeze(subCommands), authored);
	};
	/**
	 * A child that is not built yet is projected from its static metadata. Only
	 * `meta.sections` (a recipe's own Contexts add sections) and the body build it.
	 */
	const projectChild = (parent: CommandNode, name: string, meta: CommandMeta): CommandSnapshot => {
		const built = builtChildOf(parent.subCommands, name);
		if (built) return project(built);
		let full: CommandSnapshot | undefined;
		const body = (): CommandSnapshot => {
			if (full) return full;
			const node = parent.subCommands[name]!;
			full = projected.get(node) ?? projectLocal(node);
			// Later projections of this node, e.g. through its own children, return the stand-in.
			if (!projected.has(node)) projected.set(node, snapshot);
			return full;
		};
		const snapshot: CommandSnapshot = Object.freeze(
			// SAFETY: every CommandSnapshot field is defined below.
			Object.defineProperties({} as CommandSnapshot, {
				meta: {
					enumerable: true,
					value: Object.freeze(
						Object.defineProperty({ ...projectMeta(meta, undefined) }, "sections", {
							enumerable: true,
							get: () => body().meta.sections,
						}),
					),
				},
				hasAction: { enumerable: true, get: () => body().hasAction },
				args: { enumerable: true, get: () => body().args },
				flags: { enumerable: true, get: () => body().flags },
				subCommands: { enumerable: true, get: () => body().subCommands },
			}),
		);
		return snapshot;
	};
	return project;
}

function snapshotFlags(node: CommandNode): Record<string, FlagSnapshot> {
	const flags: Record<string, FlagSnapshot> = {};
	for (const [name, def] of Object.entries(node.effectiveFlags)) {
		flags[name] = snapshotFlag(def);
	}
	return flags;
}

function projectMeta(
	meta: CommandMeta,
	sections: readonly CommandSection[] | undefined,
): Readonly<CommandMeta> {
	return freezeCompact({
		name: meta.name,
		description: meta.description,
		version: meta.version,
		usage: meta.usage,
		sections: sections
			? Object.freeze(sections.map((section) => Object.freeze({ ...section })))
			: undefined,
		aliases: meta.aliases ? Object.freeze([...meta.aliases]) : undefined,
		hidden: meta.hidden,
	});
}

function projectNode(
	node: CommandNode,
	flags: Record<string, FlagSnapshot>,
	subCommands: Readonly<Record<string, CommandSnapshot>>,
	authored = false,
): CommandSnapshot {
	const contributed = authored ? undefined : contributedSections.get(node);
	const sections = contributed
		? [...(node.meta.sections ?? []), ...contributed]
		: node.meta.sections;
	return Object.freeze({
		meta: projectMeta(node.meta, sections),
		hasAction: node.run !== undefined,
		args: Object.freeze(node.args.map(snapshotArg)),
		flags: Object.freeze(flags),
		subCommands,
	});
}
