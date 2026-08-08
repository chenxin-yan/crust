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
 */
export interface ArgSnapshot {
	readonly name: string;
	readonly type?: ValueType;
	readonly description?: string;
	readonly required?: boolean;
	readonly variadic?: boolean;
	readonly choices?: readonly string[];
	readonly default?: unknown;
}

/** Serializable projection of a flag definition. */
export interface FlagSnapshot {
	readonly type: ValueType;
	readonly description?: string;
	readonly short?: string;
	readonly aliases?: readonly string[];
	readonly required?: boolean;
	readonly multiple?: boolean;
	readonly noNegate?: boolean;
	readonly choices?: readonly string[];
	readonly default?: unknown;
}

/**
 * A readonly, serializable description of a command, exposed across public
 * API boundaries (Command Action context, Extension hooks, and
 * `COMMAND_NOT_FOUND` error details) instead of internal command nodes.
 *
 * `flags` contains the effective (Context-owned + local merged) flags — the same
 * set the parser accepts for the command.
 */
export interface CommandSnapshot {
	readonly meta: Readonly<CommandMeta>;
	/** Whether the command defines a Command Action */
	readonly hasAction: boolean;
	readonly args: readonly ArgSnapshot[];
	readonly flags: Readonly<Record<string, FlagSnapshot>>;
	readonly subCommands: Readonly<Record<string, CommandSnapshot>>;
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
			aliases: node.meta.aliases ? Object.freeze([...node.meta.aliases]) : undefined,
			hidden: node.meta.hidden,
		}),
		hasAction: node.run !== undefined,
		args: Object.freeze((node.args ?? []).map(snapshotArg)),
		flags: Object.freeze(flags),
		subCommands: Object.freeze(subCommands),
	});
}
