import type { ArgDef, CommandMeta, FlagDef, ValueType } from "../types.ts";
import type { CommandNode } from "./node.ts";

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
 * so absent means "not declared".
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
	/** Value type (`"string"`, `"number"`, …); absent for schema/raw args. */
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
 * // => { type: "boolean", short: "v", default: false }
 * ```
 */
export interface FlagSnapshot {
	/** Value type, e.g. `"boolean"`, `"string"`, `"number"`. */
	readonly type: ValueType;
	/** Human-readable description for help text. */
	readonly description?: string;
	/** Single-character short alias without the dash, e.g. `"v"` for `-v`. */
	readonly short?: string;
	/** Additional long aliases without dashes, e.g. `["out"]` for `--out`. */
	readonly aliases?: readonly string[];
	/** `true` when parsing fails if the flag is not provided. */
	readonly required?: boolean;
	/** `true` when the flag can repeat and collects values into an array. */
	readonly multiple?: boolean;
	/** `true` when a boolean flag opted out of the `--no-<name>` spelling. */
	readonly noNegate?: boolean;
	/** Static enum of accepted values, e.g. `["debug", "info", "error"]`. */
	readonly choices?: readonly string[];
	/** Declared default value; `URL` defaults are serialized to their `href` string. */
	readonly default?: unknown;
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
 * //   flags: { force: { type: "boolean", short: "f" } },
 * //   subCommands: {},
 * // }
 * ```
 */
/** Serializable identity and optional tooling metadata for a loaded Extension. */
export interface ExtensionSnapshot {
	/** Extension name passed to `defineExtension`, e.g. `"help"`. */
	readonly name: string;
	/** JSON-serializable Extension-owned data for build tooling. */
	readonly metadata?: unknown;
}

export interface CommandSnapshot {
	/** Command metadata: `name`, `description`, `usage`, `sections`, `aliases`, `hidden`. */
	readonly meta: Readonly<CommandMeta>;
	/** Whether the command defines a Command Action */
	readonly hasAction: boolean;
	/** Positional argument snapshots in declaration order. */
	readonly args: readonly ArgSnapshot[];
	/** Effective flags keyed by canonical flag name. */
	readonly flags: Readonly<Record<string, FlagSnapshot>>;
	/** Direct subcommand snapshots keyed by canonical name (includes hidden ones). */
	readonly subCommands: Readonly<Record<string, CommandSnapshot>>;
	/** Loaded Extensions. Present on the application root snapshot only. */
	readonly extensions?: readonly ExtensionSnapshot[];
}

/** Drop keys with `undefined` values so snapshots serialize cleanly, then freeze. */
function freezeCompact<T extends object>(obj: T): T {
	for (const key of Object.keys(obj) as (keyof T)[]) {
		if (obj[key] === undefined) delete obj[key];
	}
	return Object.freeze(obj);
}

/**
 * URL defaults are the only non-JSON default values; serialize them as
 * strings. Array defaults (multi-value flags, variadic args) are copied and
 * frozen so the snapshot cannot observe later mutation of the source def.
 */
function serializableDefault(value: unknown): unknown {
	if (value instanceof URL) return value.href;
	if (Array.isArray(value)) return Object.freeze(value.map(serializableDefault));
	return value;
}

function snapshotArg(def: ArgDef): ArgSnapshot {
	const d = def as {
		name: string;
		type?: ValueType;
		description?: string;
		required?: boolean;
		variadic?: boolean;
		choices?: readonly string[];
		default?: unknown;
	};
	return freezeCompact({
		name: d.name,
		type: d.type,
		description: d.description,
		required: d.required,
		variadic: d.variadic,
		choices: d.choices ? Object.freeze([...d.choices]) : undefined,
		default: serializableDefault(d.default),
	});
}

function snapshotFlag(def: FlagDef): FlagSnapshot {
	const d = def as {
		type: ValueType;
		description?: string;
		short?: string;
		aliases?: readonly string[];
		required?: boolean;
		multiple?: boolean;
		noNegate?: boolean;
		choices?: readonly string[];
		default?: unknown;
	};
	return freezeCompact({
		type: d.type,
		description: d.description,
		short: d.short,
		aliases: d.aliases ? Object.freeze([...d.aliases]) : undefined,
		required: d.required,
		multiple: d.multiple,
		noNegate: d.noNegate,
		choices: d.choices ? Object.freeze([...d.choices]) : undefined,
		default: serializableDefault(d.default),
	});
}

/**
 * Project an internal command node (and its whole subtree) into a
 * {@link CommandSnapshot}.
 */
export function snapshotCommand(node: CommandNode): CommandSnapshot {
	const flags: Record<string, FlagSnapshot> = {};
	for (const [name, def] of Object.entries(node.effectiveFlags)) {
		flags[name] = snapshotFlag(def);
	}

	const subCommands: Record<string, CommandSnapshot> = {};
	for (const [name, sub] of Object.entries(node.subCommands)) {
		subCommands[name] = snapshotCommand(sub);
	}

	// Enumerable symbol-keyed annotations (e.g. skills' command annotations)
	// pass through so annotation-driven tooling can read them off snapshots.
	// JSON/structuredClone ignore symbol keys, so serializability holds.
	const annotations: Record<symbol, unknown> = {};
	for (const sym of Object.getOwnPropertySymbols(node)) {
		if (Object.getOwnPropertyDescriptor(node, sym)?.enumerable) {
			annotations[sym] = (node as unknown as Record<symbol, unknown>)[sym];
		}
	}

	return Object.freeze({
		...annotations,
		meta: freezeCompact({
			name: node.meta.name,
			description: node.meta.description,
			usage: node.meta.usage,
			sections: node.meta.sections
				? Object.freeze(node.meta.sections.map((section) => Object.freeze({ ...section })))
				: undefined,
			aliases: node.meta.aliases ? Object.freeze([...node.meta.aliases]) : undefined,
			hidden: node.meta.hidden,
		}),
		hasAction: node.run !== undefined,
		args: Object.freeze((node.args ?? []).map(snapshotArg)),
		flags: Object.freeze(flags),
		subCommands: Object.freeze(subCommands),
	});
}
