import type { ExtensionId } from "../identity.ts";
import { standardJsonSchema } from "../parsing/schema.ts";
import { isFlagNegatable } from "../parsing/spellings.ts";
import type {
	ArgDef,
	ArgExtras,
	CommandExtras,
	CommandMeta,
	CommandSection,
	DeclaredDefault,
	FlagDef,
	FlagEnv,
	FlagExtras,
	ValueType,
	VariadicMode,
} from "../types.ts";
import type { KeysOfAnyBranch } from "../validation/shared.ts";
import { builtChildOf, builtChildrenOf, childMetaOf, type CommandNode } from "./node.ts";

// ────────────────────────────────────────────────────────────────────────────
// CommandSnapshot — Readonly, serializable command description
// ────────────────────────────────────────────────────────────────────────────

/**
 * Serializable projection of a positional argument definition.
 *
 * Carries everything help/man/tooling surfaces need; `parse` functions and
 * Standard Schemas never cross the boundary (a schema's JSON Schema does, as
 * `inputSchema`).
 *
 * Fields with `undefined` values are dropped entirely (see `freezeCompact`),
 * so absent means "not declared" — except `required`, which is omitted when a
 * declared default makes the value optional. Keys packages add through
 * {@link ArgExtras} pass through with their values unchanged, so they are only
 * as serializable as those values.
 *
 * @example
 * For `{ name: "port", type: "number", default: 3000 }`:
 * ```ts
 * { name: "port", type: "number", default: 3000 }
 * // `required`/`variadic` keys absent — not declared on the def
 * ```
 */
// oxlint-disable-next-line no-generated-empty-object-type -- empty until a package augments ArgExtras.
export interface ArgSnapshot extends Readonly<ArgExtras> {
	/** Argument name as defined, e.g. `"file"`. */
	readonly name: string;
	/** Value type (`"string"`, `"number"`, …); absent for schema-backed args. */
	readonly type?: ValueType;
	/** Human-readable description for help text. */
	readonly description?: string;
	/**
	 * `true` when the argument must be given: declared `required`, or its schema rejects a
	 * missing value (one that validates synchronously).
	 */
	readonly required?: boolean;
	/** How the argument collects its values into an array; see `ArgDef`'s `variadic`. */
	readonly variadic?: VariadicMode;
	/** Static enum of accepted values, e.g. `["json", "text"]`. */
	readonly choices?: readonly string[];
	/** Declared default value; `URL` defaults are serialized to their `href` string. */
	readonly default?: unknown;
	/** The smallest value a `number` or `integer` argument accepts. */
	readonly min?: number;
	/** The largest value a `number` or `integer` argument accepts. */
	readonly max?: number;
	/**
	 * Draft 2020-12 JSON Schema of the values a schema-backed arg accepts
	 * (`~standard.jsonSchema.input`). Absent without a schema or when the schema
	 * cannot produce JSON Schema. Not frozen: treat it as immutable.
	 */
	readonly inputSchema?: Readonly<Record<string, unknown>>;
}

/**
 * Serializable projection of a flag definition. The flag's canonical name is
 * the key it sits under in {@link CommandSnapshot.flags}, not a field here.
 * Keys packages add through {@link FlagExtras} pass through unchanged, as in
 * {@link ArgSnapshot}.
 *
 * @example
 * For `{ verbose: { type: "boolean", short: "v", default: false } }`:
 * ```ts
 * snapshot.flags.verbose
 * // => { type: "boolean", short: "v", default: false, negatable: true }
 * ```
 */
// oxlint-disable-next-line no-generated-empty-object-type -- empty until a package augments FlagExtras.
export interface FlagSnapshot extends Readonly<FlagExtras> {
	/** Value type, e.g. `"boolean"`, `"string"`, `"count"`. */
	readonly type: FlagDef["type"];
	/** Human-readable description for help text. */
	readonly description?: string;
	/** Single-character short alias without the dash, e.g. `"v"` for `-v`. */
	readonly short?: string;
	/** Additional aliases without dashes; one-character aliases accept one or two dashes. */
	readonly aliases?: readonly string[];
	/**
	 * `true` when the flag must be given: declared `required`, or its schema rejects a missing
	 * value (one that validates synchronously).
	 */
	readonly required?: boolean;
	/** `true` when the flag can repeat and collects values into an array. */
	readonly multiple?: boolean;
	/** The value's name in documentation (`--memory <bytes>`); absent when not declared. */
	readonly valueName?: string;
	/** `true` when the flag accepts generated `--no-<name>` spellings: a boolean with `default: true` or `negatable: true`. */
	readonly negatable: boolean;
	/** Static enum of accepted values, e.g. `["debug", "info", "error"]`. */
	readonly choices?: readonly string[];
	/** Declared default value; `URL` defaults are serialized to their `href` string. */
	readonly default?: unknown;
	/** Declared environment variable names; never their values. */
	readonly env?: FlagEnv;
	/** The smallest value a `number` or `integer` flag accepts. */
	readonly min?: number;
	/** The largest value a `number` or `integer` flag accepts. */
	readonly max?: number;
	/** Delimiter that splits a repeatable flag's string argv values and environment text into occurrences. */
	readonly delimiter?: string;
	/**
	 * Draft 2020-12 JSON Schema of the values a schema-backed flag accepts
	 * (`~standard.jsonSchema.input`). Absent without a schema or when the schema
	 * cannot produce JSON Schema. Not frozen: treat it as immutable.
	 */
	readonly inputSchema?: Readonly<Record<string, unknown>>;
	/** `true` when the flag is left out of listings; it still parses. */
	readonly hidden?: boolean;
	/** Why the flag is deprecated, and what to use instead. */
	readonly deprecated?: string;
	/** An exclusive group's members (`type: "exclusive"`), keyed by their canonical names. */
	readonly flags?: Readonly<Record<string, FlagSnapshot>>;
	/**
	 * The Extension that declares this flag with its `flags` (e.g. `--help`,
	 * `--json`); absent for local and Context-owned flags. Command input
	 * (`commandInputSchema()` in `@crustjs/core/tooling`) leaves these flags out.
	 */
	readonly extension?: ExtensionId;
	/**
	 * `true` for a flag the command does not declare in its own `.flags()`: a Context-owned or
	 * recursive Extension flag. Help lists these under "Global options".
	 */
	readonly inherited?: true;
}

/**
 * Documentation headings set with `.group(title, block)`, in code order: the subcommands
 * or the own flags (by canonical name) the block registered. Help and the other documentation
 * surfaces read it; routing and parsing never do.
 */
export type CommandGroup =
	| { readonly title: string; readonly commands: readonly string[] }
	| { readonly title: string; readonly flags: readonly string[] };

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
 *     .flags({ force: { type: "boolean", short: "f" } })
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
	/**
	 * Command metadata, including routing and presentation options. Keys packages add through
	 * {@link CommandExtras} pass through unchanged, as in {@link ArgSnapshot}.
	 */
	readonly meta: Readonly<CommandMeta>;
	/** Whether the command defines a Command Action */
	readonly hasAction: boolean;
	/** Positional argument snapshots in declaration order. */
	readonly args: readonly ArgSnapshot[];
	/** Effective flags keyed by canonical flag name. */
	readonly flags: Readonly<Record<string, FlagSnapshot>>;
	/**
	 * Draft 2020-12 JSON Schema of the action result, from the command's
	 * `.output()` schema (`~standard.jsonSchema.output`). Absent without
	 * `.output()` or when the schema cannot produce JSON Schema. Not frozen:
	 * treat it as immutable.
	 */
	readonly outputSchema?: Readonly<Record<string, unknown>>;
	/**
	 * `true` when the command declared `.output()`, whether or not its schema can produce
	 * {@link CommandSnapshot.outputSchema}; absent otherwise.
	 */
	readonly output?: true;
	/**
	 * The Extension that contributed this command, or the Extension command it
	 * sits under (e.g. `completion`, `skills install`); absent for the application's own commands.
	 */
	readonly extension?: ExtensionId;
	/** The command's `.group()` headings; absent when it has none. */
	readonly groups?: readonly CommandGroup[];
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
	// fromEntries defines own properties, so a package-owned key named `__proto__` stays a key.
	const compact = Object.fromEntries(
		Object.entries(obj).filter(([, value]) => value !== undefined),
	);
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

/** The keys core reads on one kind of definition; `Extras` are the ones packages add. */
type CoreKeys<Def, Extras> = Exclude<KeysOfAnyBranch<Def>, keyof Extras>;

// Records, not lists, so a key core adds to a definition type and forgets here fails to compile.
const coreKeys = <K extends string>(keys: Record<K, true>): ReadonlySet<string> =>
	new Set(Object.keys(keys));

/** The keys every argument definition may hold that core reads. */
export const CORE_ARG_KEYS: ReadonlySet<string> = coreKeys<CoreKeys<ArgDef, ArgExtras>>({
	name: true,
	type: true,
	description: true,
	required: true,
	variadic: true,
	choices: true,
	default: true,
	min: true,
	max: true,
	schema: true,
	parse: true,
});

/** The keys every flag definition may hold that core reads. */
export const CORE_FLAG_KEYS: ReadonlySet<string> = coreKeys<CoreKeys<FlagDef, FlagExtras>>({
	type: true,
	description: true,
	short: true,
	aliases: true,
	required: true,
	valueName: true,
	multiple: true,
	negatable: true,
	choices: true,
	default: true,
	env: true,
	min: true,
	max: true,
	delimiter: true,
	schema: true,
	parse: true,
	hidden: true,
	deprecated: true,
	requires: true,
	flags: true,
});

/** The command metadata keys core reads. */
export const CORE_COMMAND_KEYS: ReadonlySet<string> = coreKeys<
	CoreKeys<CommandMeta, CommandExtras>
>({
	name: true,
	description: true,
	version: true,
	usage: true,
	examples: true,
	sections: true,
	aliases: true,
	hidden: true,
	deprecated: true,
});

/** The entries of `definition` whose keys core does not read: those packages add through the `Extras` interfaces. */
export function extraEntries(definition: object, core: ReadonlySet<string>): [string, unknown][] {
	return Object.entries(definition).filter(([key]) => !core.has(key));
}

/**
 * The parser fills a missing value from its default, so a defaulted def is never required.
 * A schema owns requiredness: `missing` is what it receives for an absent value.
 */
function effectiveRequired(def: ArgDef | FlagDef, missing: undefined | []): boolean | undefined {
	if (!def.schema) return def.default === undefined ? def.required : undefined;
	try {
		const result = def.schema["~standard"].validate(missing);
		if (!("then" in result)) return result.issues ? true : undefined;
		// Documentation cannot wait for an async schema; it is shown as optional.
		result.then(undefined, () => {});
	} catch {
		// A schema that throws on a missing value is shown as optional; parsing reports it.
	}
	return undefined;
}

function snapshotArg(def: ArgDef): ArgSnapshot {
	return freezeCompact({
		// Extras first, so a same-named extra never overrides a core field (also in snapshotFlag and projectMeta).
		...Object.fromEntries(extraEntries(def, CORE_ARG_KEYS)),
		name: def.name,
		type: def.type,
		description: def.description,
		required: effectiveRequired(def, def.variadic ? [] : undefined),
		variadic: def.variadic,
		choices: def.choices ? Object.freeze([...def.choices]) : undefined,
		default: serializableDefault(def.default),
		min: def.min,
		max: def.max,
		inputSchema: def.schema && standardJsonSchema(def.schema, "input"),
	});
}

function snapshotFlag(
	def: FlagDef,
	extension: ExtensionId | undefined,
	inherited?: true,
): FlagSnapshot {
	return freezeCompact({
		...Object.fromEntries(extraEntries(def, CORE_FLAG_KEYS)),
		type: def.type,
		description: def.description,
		short: def.short,
		aliases: def.aliases ? Object.freeze([...def.aliases]) : undefined,
		required: effectiveRequired(def, undefined),
		valueName: def.valueName,
		multiple: def.multiple,
		negatable: isFlagNegatable(def),
		choices: def.choices ? Object.freeze([...def.choices]) : undefined,
		default: serializableDefault(def.default),
		env: def.env,
		min: def.min,
		max: def.max,
		delimiter: def.delimiter,
		inputSchema: def.schema && standardJsonSchema(def.schema, "input"),
		hidden: def.hidden,
		deprecated: def.deprecated,
		flags:
			def.flags &&
			Object.freeze(
				Object.fromEntries(
					Object.entries(def.flags).map(([name, member]) => [
						name,
						snapshotFlag(member, undefined),
					]),
				),
			),
		extension,
		inherited,
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
	return projectNode(node, Object.freeze(subCommands));
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

function hasMutableDefault(node: CommandNode): boolean {
	return (
		node.args.some((def) => isMutableDefault(def.default)) ||
		Object.values(node.effectiveFlags).some((def) => isMutableDefault(def.default))
	);
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
	let verdict = !hasMutableDefault(node);
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
		const snapshot = projectNode(node, Object.freeze(subCommands));
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
		return projectNode(node, Object.freeze(subCommands), authored);
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
				outputSchema: { enumerable: true, get: () => body().outputSchema },
				output: { enumerable: true, get: () => body().output },
				extension: { enumerable: true, get: () => body().extension },
				groups: { enumerable: true, get: () => body().groups },
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
		flags[name] = snapshotFlag(
			def,
			node.extensionFlags?.get(name),
			Object.hasOwn(node.localFlags, name) || node.rootOnlyFlags?.has(name) ? undefined : true,
		);
	}
	return flags;
}

function projectMeta(
	meta: CommandMeta,
	sections: readonly CommandSection[] | undefined,
): Readonly<CommandMeta> {
	return freezeCompact({
		...Object.fromEntries(extraEntries(meta, CORE_COMMAND_KEYS)),
		name: meta.name,
		description: meta.description,
		version: meta.version,
		usage: meta.usage,
		examples: meta.examples ? Object.freeze([...meta.examples]) : undefined,
		sections: sections
			? Object.freeze(sections.map((section) => Object.freeze({ ...section })))
			: undefined,
		aliases: meta.aliases ? Object.freeze([...meta.aliases]) : undefined,
		hidden: meta.hidden,
		deprecated: meta.deprecated,
	});
}

function projectNode(
	node: CommandNode,
	subCommands: Readonly<Record<string, CommandSnapshot>>,
	authored = false,
): CommandSnapshot {
	const contributed = authored ? undefined : contributedSections.get(node);
	const sections = contributed
		? [...(node.meta.sections ?? []), ...contributed]
		: node.meta.sections;
	const outputSchema = node.outputSchema && standardJsonSchema(node.outputSchema, "output");
	// Projecting an argument or flag calls its schema, so both wait for a reader.
	let args: CommandSnapshot["args"] | undefined;
	let flags: CommandSnapshot["flags"] | undefined;
	const snapshot: CommandSnapshot = Object.freeze({
		meta: projectMeta(node.meta, sections),
		hasAction: node.run !== undefined,
		get args() {
			return (args ??= Object.freeze(node.args.map(snapshotArg)));
		},
		get flags() {
			return (flags ??= Object.freeze(snapshotFlags(node)));
		},
		...(outputSchema ? { outputSchema } : {}),
		...(node.outputSchema ? { output: true as const } : {}),
		...(node.extension ? { extension: node.extension } : {}),
		...(node.groups ? { groups: node.groups } : {}),
		subCommands,
	});
	// A mutable default is read now, so the snapshot agrees with what this invocation parsed.
	if (hasMutableDefault(node)) void [snapshot.args, snapshot.flags];
	return snapshot;
}
