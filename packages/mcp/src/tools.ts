import type { ArgSnapshot, CommandSnapshot, FlagSnapshot, ValueType } from "@crustjs/core";

/** JSON Schema fragment for one tool input property. */
export interface McpPropertySchema {
	readonly type?: "string" | "number" | "boolean" | "array";
	readonly description?: string;
	readonly format?: "uri";
	readonly enum?: readonly string[];
	readonly items?: McpPropertySchema;
	readonly default?: unknown;
}

/** JSON Schema object accepted by `tools/list` as a tool's `inputSchema`. */
export interface McpToolInputSchema {
	readonly type: "object";
	readonly properties: Readonly<Record<string, McpPropertySchema>>;
	readonly required?: readonly string[];
}

/** One command exposed as an MCP tool. */
export interface McpTool {
	/** Canonical path joined with `_`; the root command uses its own name. */
	readonly name: string;
	readonly description?: string;
	readonly inputSchema: McpToolInputSchema;
	/** Canonical command path for `app.run()`; `[]` is the root. */
	readonly path: readonly string[];
	/** Arg and flag names declared as `type: "url"`; the server turns their strings into `URL`s. */
	readonly urlFields: readonly string[];
	/** Arg names, so the server can split the flat tool input back into `args` and `flags`. */
	readonly argNames: readonly string[];
}

export interface McpToolsOptions {
	/** Canonical command paths to leave out, including everything under them. */
	readonly exclude?: readonly (readonly string[])[];
}

/** Name of the command `mcpExtension` contributes; never exposed as a tool. */
export const MCP_COMMAND_NAME = "mcp";
/** Passthrough values land here and reach the action as `rawArgs`. */
export const RAW_PROPERTY = "raw";

/** MCP specification 2025-11-25, "Tool Names". */
const TOOL_NAME_PATTERN = /^[A-Za-z0-9_.-]{1,128}$/;

function valueSchema(
	type: ValueType | undefined,
	choices: readonly string[] | undefined,
): McpPropertySchema {
	if (choices) return { type: "string", enum: [...choices] };
	switch (type) {
		case "json":
			return {};
		case "url":
			return { type: "string", format: "uri" };
		case "number":
			return { type: "number" };
		case "boolean":
			return { type: "boolean" };
		case "string":
		case "path":
		// Only schema-backed args omit `type`; schema flags and custom `parse` are
		// indistinguishable from core definitions and map by their token type.
		case undefined:
			return { type: "string" };
	}
}

function propertySchema(def: ArgSnapshot | FlagSnapshot, list: boolean): McpPropertySchema {
	const value = valueSchema(def.type, def.choices);
	const schema: McpPropertySchema = list ? { type: "array", items: value } : value;
	return {
		...schema,
		...(def.description === undefined ? {} : { description: def.description }),
		...(def.default === undefined ? {} : { default: def.default }),
	};
}

function formatPath(path: readonly string[]): string {
	return path.length === 0 ? "<root>" : path.join(" ");
}

type ToolInput = Pick<McpTool, "inputSchema" | "urlFields" | "argNames">;

function toolInput(command: CommandSnapshot, path: readonly string[]): ToolInput {
	const properties: Record<string, McpPropertySchema> = {};
	const required: string[] = [];
	const urlFields: string[] = [];
	const claim = (name: string, def: ArgSnapshot | FlagSnapshot, list: boolean) => {
		if (name in properties || name === RAW_PROPERTY) {
			throw new Error(
				`Command "${formatPath(path)}" declares "${name}" more than once across args, flags, and "${RAW_PROPERTY}"; MCP tool input is one flat object`,
			);
		}
		properties[name] = propertySchema(def, list);
		if (def.required === true && def.default === undefined) required.push(name);
		if (def.type === "url") urlFields.push(name);
	};
	for (const arg of command.args) claim(arg.name, arg, arg.variadic === true);
	for (const [name, flag] of Object.entries(command.flags)) {
		claim(name, flag, flag.multiple === true);
	}
	properties[RAW_PROPERTY] = {
		type: "array",
		items: { type: "string" },
		description: "Passthrough values, as if written after `--`",
	};
	return {
		inputSchema:
			required.length === 0
				? { type: "object", properties }
				: { type: "object", properties, required },
		urlFields,
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
 * Also throws when a name violates the MCP tool-name character set.
 */
export function toolsFromSnapshot(
	snapshot: CommandSnapshot,
	options: McpToolsOptions = {},
): readonly McpTool[] {
	const excluded = new Set((options.exclude ?? []).map((path) => path.join("\0")));
	excluded.add(MCP_COMMAND_NAME);
	const tools: McpTool[] = [];
	const owners = new Map<string, readonly string[]>();

	const visit = (command: CommandSnapshot, path: readonly string[]) => {
		if (command.meta.hidden === true || excluded.has(path.join("\0"))) return;
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
