// ────────────────────────────────────────────────────────────────────────────
// Command-tree introspection — builds canonical manifest from CommandSnapshot
// ────────────────────────────────────────────────────────────────────────────

import type { ArgSnapshot, CommandSnapshot, FlagSnapshot } from "@crustjs/core";

import { getSkillCommandAnnotations } from "./annotations.ts";
import type { ManifestArg, ManifestFlag, ManifestNode } from "./types.ts";

// ────────────────────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────────────────────

/**
 * Builds a canonical manifest tree from a root command definition.
 *
 * Walks the command tree (including nested `subCommands`) and normalizes
 * each node into a deterministic {@link ManifestNode} shape suitable for
 * rendering into markdown documentation.
 *
 * @param command - The root command to introspect
 * @returns The manifest tree rooted at the given command
 *
 * @example
 * ```ts
 * import type { CommandSnapshot } from "@crustjs/core";
 * import { buildManifest } from "@crustjs/skills";
 *
 * // Typically called from a plugin setup hook:
 * const manifest = buildManifest(context.rootCommand);
 * // manifest.children contains normalized nodes for subcommands
 * ```
 */
export function buildManifest(command: CommandSnapshot): ManifestNode {
	return buildNode(command, []);
}

// ────────────────────────────────────────────────────────────────────────────
// Internal helpers — recursive tree traversal and normalization
// ────────────────────────────────────────────────────────────────────────────

/**
 * Recursively builds a {@link ManifestNode} from a command and its parent path.
 *
 * @param command - Current command node to process
 * @param parentPath - Path segments from root to (but not including) this node
 */
function buildNode(command: CommandSnapshot, parentPath: string[]): ManifestNode {
	const name = normalizeName(command.meta.name);
	const path = [...parentPath, name];

	const args = normalizeArgs(command.args);
	const flags = normalizeFlags(command.flags);
	const children = normalizeChildren(command.subCommands, path);
	const annotations = getSkillCommandAnnotations(command);

	return {
		name,
		path,
		description: command.meta.description,
		usage: command.meta.usage,
		instructions: annotations?.instructions,
		runnable: command.hasHandler,
		args,
		flags,
		children,
	};
}

/**
 * Normalizes a command name to a stable, lower-case, trimmed segment.
 *
 * Strips whitespace and lowercases for deterministic path generation.
 */
function normalizeName(raw: string): string {
	return raw.trim().toLowerCase();
}

/**
 * Converts an `ArgsDef` tuple (or undefined) into a sorted array of
 * {@link ManifestArg} nodes. Positional ordering is preserved since
 * `ArgsDef` is an ordered tuple.
 */
function normalizeArgs(argsDef: readonly ArgSnapshot[] | undefined): ManifestArg[] {
	if (!argsDef || argsDef.length === 0) return [];

	// Preserve positional order — args are a tuple, not a record
	return argsDef.map(normalizeArg);
}

/**
 * Converts a single {@link ArgSnapshot} into a {@link ManifestArg}.
 */
function normalizeArg(arg: ArgSnapshot): ManifestArg {
	const result: ManifestArg = {
		name: arg.name,
		type: manifestType(arg.type),
		required: arg.required === true,
		variadic: arg.variadic === true,
	};

	if (arg.description !== undefined) {
		result.description = arg.description;
	}

	if (arg.default !== undefined) {
		result.default = serializeDefault(arg.default);
	}

	return result;
}

/**
 * Converts a `FlagsDef` record (or undefined) into a sorted array of
 * {@link ManifestFlag} nodes. Flags are sorted alphabetically by name
 * for deterministic output.
 */
function normalizeFlags(flagsDef: Record<string, FlagSnapshot> | undefined): ManifestFlag[] {
	if (!flagsDef) return [];

	const keys = Object.keys(flagsDef).sort();
	return keys.map((key) => {
		// oxlint-disable-next-line typescript/no-non-null-assertion -- key comes from Object.keys so value is guaranteed
		return normalizeFlag(key, flagsDef[key]!);
	});
}

/**
 * Converts a single {@link FlagSnapshot} into a {@link ManifestFlag}.
 *
 * @param name - The flag key from the `FlagsDef` record
 * @param flag - The flag definition
 */
function normalizeFlag(name: string, flag: FlagSnapshot): ManifestFlag {
	const result: ManifestFlag = {
		name,
		type: manifestType(flag.type),
		required: flag.required === true,
		multiple: flag.multiple === true,
		short: flag.short,
		aliases: flag.aliases ? [...flag.aliases].sort() : [],
	};

	if (flag.description !== undefined) {
		result.description = flag.description;
	}

	if (flag.default !== undefined) {
		result.default = serializeDefault(flag.default);
	}

	return result;
}

/**
 * Recursively builds child {@link ManifestNode} entries from a
 * `subCommands` record. Children are sorted alphabetically by
 * command name for deterministic output.
 *
 * @param subCommands - Record of subcommand name → command, or undefined
 * @param parentPath - Full path of the parent node
 */
function normalizeChildren(
	subCommands: Record<string, CommandSnapshot>,
	parentPath: string[],
): ManifestNode[] {
	const keys = Object.keys(subCommands).sort();
	return keys.map((key) => {
		// oxlint-disable-next-line typescript/no-non-null-assertion -- key comes from Object.keys so value is guaranteed
		return buildNode(subCommands[key]!, parentPath);
	});
}

/**
 * Map a `FlagSnapshot`/`ArgSnapshot` `type` literal onto the manifest's narrow
 * `"string" | "number" | "boolean"` union.
 *
 * The string-tokenised built-ins (`"url"`, `"path"`, `"json"`) all consume a string
 * token on the command line, so they collapse to `"string"` at the
 * manifest layer until we extend the manifest schema for them.
 */
function manifestType(type: string | undefined): "string" | "number" | "boolean" {
	if (type === "number" || type === "boolean") return type;
	return "string";
}

/**
 * Serializes a default value to a deterministic string representation.
 *
 * Arrays are serialized with `JSON.stringify` for stable output.
 * Primitives use `String()` conversion.
 */
function serializeDefault(value: unknown): string {
	if (Array.isArray(value)) {
		return JSON.stringify(value);
	}
	return String(value);
}
