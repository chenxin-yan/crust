import type { CommandSnapshot } from "@crustjs/core";
import {
	type CommandInputPropertySchema,
	type CommandInputSchema,
	commandInputSchema,
	isListed,
} from "@crustjs/core/tooling";

/** JSON Schema fragment for one tool input property. */
export type McpPropertySchema = CommandInputPropertySchema;

/** JSON Schema object accepted by `tools/list` as a tool's `inputSchema`. */
export type McpToolInputSchema = CommandInputSchema;

/** One command exposed as an MCP tool. */
export interface McpTool {
	/** Canonical path joined with `_`; the root command uses its own name. */
	readonly name: string;
	readonly description?: string;
	readonly inputSchema: McpToolInputSchema;
	/** Canonical command path for `app.run()`; `[]` is the root. */
	readonly path: readonly string[];
	/** Arg and flag names declared as `type: "url"`; their strings become `URL`s before `run()`. */
	readonly urlFields: readonly string[];
	/** Arg names; every other input property except `raw` is a flag. */
	readonly argNames: readonly string[];
}

export interface McpToolsOptions {
	/** Canonical command paths to leave out, including everything under them; an unknown path or alias throws. */
	readonly exclude?: readonly (readonly string[])[];
}

/** Name of the command `mcpExtension` contributes; never exposed as a tool. */
export const MCP_COMMAND_NAME = "mcp";

/** MCP specification 2025-11-25, "Tool Names". */
const TOOL_NAME_PATTERN = /^[A-Za-z0-9_.-]{1,128}$/;

function formatPath(path: readonly string[]): string {
	return path.length === 0 ? "<root>" : path.join(" ");
}

type ToolInput = Pick<McpTool, "inputSchema" | "urlFields" | "argNames">;

function toolInput(command: CommandSnapshot, path: readonly string[]): ToolInput {
	return {
		inputSchema: commandInputSchema(command, path),
		urlFields: [
			...command.args.filter((arg) => arg.type === "url").map((arg) => arg.name),
			...Object.entries(command.flags)
				.filter(([, flag]) => flag.type === "url")
				.map(([name]) => name),
		],
		argNames: command.args.map((arg) => arg.name),
	};
}

/**
 * Enumerate the MCP tools a Command Snapshot exposes.
 *
 * Skips hidden commands and their subtrees, commands without a Command Action,
 * the `mcp` command, and `exclude` paths with their subtrees. The root is a tool
 * only when it has an action. Tool names join the canonical path with `_`
 * (the root uses its own name), which is not injective: `a b_c` and `a_b c`
 * collide, and this throws naming both paths rather than renaming either.
 * Also throws when a name violates the MCP tool-name character set, or when an
 * `exclude` path is not a canonical command path (a typo or alias would
 * otherwise leave the command exposed).
 */
export function toolsFromSnapshot(
	snapshot: CommandSnapshot,
	options: McpToolsOptions = {},
): readonly McpTool[] {
	// JSON keys are injective; join("\0") maps [""] onto the root's [].
	const pathKey = (path: readonly string[]) => JSON.stringify(path);
	const excluded = new Set((options.exclude ?? []).map(pathKey));
	// Walk the whole tree, not the pruned one below: a path under a hidden or excluded parent is valid.
	const known = new Set<string>();
	const collect = (command: CommandSnapshot, path: readonly string[]) => {
		known.add(pathKey(path));
		for (const [name, sub] of Object.entries(command.subCommands)) collect(sub, [...path, name]);
	};
	collect(snapshot, []);
	const unknown = (options.exclude ?? []).filter((path) => !known.has(pathKey(path)));
	if (unknown.length > 0) {
		throw new Error(
			`Unknown MCP exclude paths ${unknown.map((path) => `"${formatPath(path)}"`).join(", ")}; exclude takes canonical command paths`,
		);
	}
	excluded.add(pathKey([MCP_COMMAND_NAME]));
	const tools: McpTool[] = [];
	const owners = new Map<string, readonly string[]>();

	const visit = (command: CommandSnapshot, path: readonly string[]) => {
		if (!isListed(command) || excluded.has(pathKey(path))) return;
		if (command.hasAction) {
			const name = path.length === 0 ? command.meta.name : path.join("_");
			if (!TOOL_NAME_PATTERN.test(name)) {
				throw new Error(
					`Command "${formatPath(path)}" would become MCP tool "${name}", which is not 1-128 characters of A-Z, a-z, 0-9, "_", "-", or "."`,
				);
			}
			const owner = owners.get(name);
			if (owner) {
				throw new Error(
					`Commands "${formatPath(owner)}" and "${formatPath(path)}" both become MCP tool "${name}"; rename one or exclude it`,
				);
			}
			owners.set(name, path);
			tools.push({
				name,
				...(command.meta.description === undefined
					? {}
					: { description: command.meta.description }),
				...toolInput(command, path),
				path,
			});
		}
		for (const [name, sub] of Object.entries(command.subCommands)) visit(sub, [...path, name]);
	};
	visit(snapshot, []);
	return tools;
}
