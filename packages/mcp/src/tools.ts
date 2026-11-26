import type { CommandSnapshot } from "@crustjs/core";
import {
	type CommandInputPropertySchema,
	type CommandInputSchema,
	commandInputFields,
	commandInputSchema,
	formatDescription,
	isListed,
} from "@crustjs/core/tooling";

/** JSON Schema fragment for one tool input property. */
export type McpPropertySchema = CommandInputPropertySchema;

/** JSON Schema object accepted by `tools/list` as a tool's `inputSchema`. */
export type McpToolInputSchema = CommandInputSchema;

/** JSON Schema object accepted by `tools/list` as a tool's `outputSchema`. */
export interface McpToolOutputSchema {
	readonly type: "object";
	readonly [keyword: string]: unknown;
}

/**
 * A command's MCP tool annotations, named as in the MCP specification's `ToolAnnotations`.
 * Every field is a hint for the client, not a guarantee.
 */
export interface McpToolAnnotations {
	/** Human-readable title of the tool. */
	readonly title?: string | undefined;
	/** The tool does not modify its environment. The specification's default is `false`. */
	readonly readOnlyHint?: boolean | undefined;
	/** The tool may destroy or overwrite data; meaningful only when not read-only. Default `true`. */
	readonly destructiveHint?: boolean | undefined;
	/** Repeating a call with the same arguments has no further effect; meaningful only when not read-only. Default `false`. */
	readonly idempotentHint?: boolean | undefined;
	/** The tool reaches outside entities, such as the web, rather than a closed domain. Default `true`. */
	readonly openWorldHint?: boolean | undefined;
}

/** One command exposed as an MCP tool. */
export interface McpTool {
	/** Canonical path joined with `_`; the root command uses its own name. */
	readonly name: string;
	readonly description?: string;
	readonly inputSchema: McpToolInputSchema;
	/** The command's `.output()` result in the shape of its `structuredContent`; see {@link toolsFromSnapshot}. */
	readonly outputSchema?: McpToolOutputSchema;
	/** The command's `mcp` hints. */
	readonly annotations?: McpToolAnnotations;
	/** Canonical command path for `app.run()`; `[]` is the root. */
	readonly path: readonly string[];
	/** Arg and flag names declared as `type: "url"`; their strings become `URL`s before `run()`. */
	readonly urlFields: readonly string[];
	/** Arg names; every other input property is a flag. */
	readonly argNames: readonly string[];
}

export interface McpToolsOptions {
	/**
	 * Canonical paths of Extension commands (e.g. `["schema"]`) to serve as tools,
	 * including everything under them; an unknown path or alias throws. A command
	 * with `mcp: false` stays out, and so does everything under it.
	 */
	readonly include?: readonly (readonly string[])[] | undefined;
}

/** Name of the command `mcp()` contributes; it sets `mcp: false`, so it is never a tool. */
export const MCP_COMMAND_NAME = "mcp";

/** MCP specification 2026-07-28, "Tool Names". */
const TOOL_NAME_PATTERN = /^[A-Za-z0-9_.-]{1,128}$/;

function formatPath(path: readonly string[]): string {
	return path.length === 0 ? "<root>" : path.join(" ");
}

/**
 * Whether every reference still resolves once the schema is nested under
 * `properties.result`: only `#/$defs/…` `$ref`s, which follow the hoisted
 * `$defs`, and no other `$` keyword (`$id`, `$anchor`, `$dynamicRef`, …).
 */
function survivesWrapping(value: unknown): boolean {
	if (typeof value !== "object" || value === null) return true;
	return Object.entries(value).every(([key, entry]) =>
		key === "$ref"
			? typeof entry === "string" && entry.startsWith("#/$defs/")
			: (!key.startsWith("$") || key === "$comment") && survivesWrapping(entry),
	);
}

/** A command's output JSON Schema as MCP `outputSchema`; see {@link toolsFromSnapshot}. */
function toolOutputSchema(
	schema: Readonly<Record<string, unknown>> | undefined,
): McpToolOutputSchema | undefined {
	if (schema === undefined) return undefined;
	if (schema.type === "object") return { ...schema, type: "object" };
	const types: unknown[] = [schema.type].flat();
	if (schema.type === undefined || types.includes("object")) return undefined;
	// `$schema` and `$defs` belong at the root, where `#/$defs/…` references resolve.
	const { $schema, $defs, ...result } = schema;
	if (!survivesWrapping(result) || !survivesWrapping($defs)) return undefined;
	return {
		...($schema === undefined ? {} : { $schema }),
		type: "object",
		properties: { result },
		required: ["result"],
		...($defs === undefined ? {} : { $defs }),
	};
}

/**
 * Enumerate the MCP tools a Command Snapshot exposes.
 *
 * Skips hidden commands, commands with `mcp: false`, and the subtrees of both,
 * as well as commands without a Command Action (the `mcp` command sets
 * `mcp: false`). Commands an Extension contributed (`completion`, `schema`,
 * `skills`, …; see `CommandSnapshot.extension`) are skipped too, unless an
 * `include` path selects them or an ancestor. The root is a tool only when it has an action. Tool names join the canonical path with `_`
 * (the root uses its own name), which is not injective: `a b_c` and `a_b c`
 * collide, and this throws naming both paths rather than renaming either.
 * Also throws when a name violates the MCP tool-name character set, or when an
 * `include` path is not a canonical command path. A command's `mcp` hints
 * become the tool's `annotations`.
 *
 * A command whose snapshot has an `outputSchema` (from `.output()`) gets an MCP
 * `outputSchema` describing its `structuredContent`: object schemas as
 * themselves, schemas that exclude objects (e.g. `number`, `array`) wrapped as
 * `{ result }` (with `$schema` and `$defs` kept at the root). Schemas that may
 * or may not describe an object (no top-level `type`, e.g. `anyOf`, or a `type`
 * list including `"object"`), or that wrapping would break (a `$ref` outside
 * `#/$defs/`, or another `$` keyword such as `$id`), are not advertised.
 */
export function toolsFromSnapshot(
	snapshot: CommandSnapshot,
	options: McpToolsOptions = {},
): readonly McpTool[] {
	// JSON keys are injective; join("\0") maps [""] onto the root's [].
	const pathKey = (path: readonly string[]) => JSON.stringify(path);
	// Walk the whole tree, not the pruned one below: a path under a hidden or `mcp: false` parent is valid.
	const known = new Set<string>();
	const collect = (command: CommandSnapshot, path: readonly string[]) => {
		known.add(pathKey(path));
		for (const [name, sub] of Object.entries(command.subCommands)) collect(sub, [...path, name]);
	};
	collect(snapshot, []);
	const unknown = (options.include ?? []).filter((path) => !known.has(pathKey(path)));
	if (unknown.length > 0) {
		throw new Error(
			`Unknown MCP include paths ${unknown.map((path) => `"${formatPath(path)}"`).join(", ")}; include takes canonical command paths`,
		);
	}
	const included = new Set((options.include ?? []).map(pathKey));
	const tools: McpTool[] = [];
	const owners = new Map<string, readonly string[]>();

	const visit = (command: CommandSnapshot, path: readonly string[], opted: boolean) => {
		const { mcp } = command.meta;
		if (!isListed(command) || mcp === false) return;
		opted ||= included.has(pathKey(path));
		// Extension commands manage the CLI itself, not the application's work.
		if (command.hasAction && (command.extension === undefined || opted)) {
			const name = path.length === 0 ? command.meta.name : path.join("_");
			if (!TOOL_NAME_PATTERN.test(name)) {
				throw new Error(
					`Command "${formatPath(path)}" would become MCP tool "${name}", which is not 1-128 characters of A-Z, a-z, 0-9, "_", "-", or "."`,
				);
			}
			const owner = owners.get(name);
			if (owner) {
				throw new Error(
					`Commands "${formatPath(owner)}" and "${formatPath(path)}" both become MCP tool "${name}"; rename one or set mcp: false on it`,
				);
			}
			owners.set(name, path);
			const outputSchema = toolOutputSchema(command.outputSchema);
			const { description, deprecated } = command.meta;
			const text = formatDescription(
				description,
				undefined,
				undefined,
				undefined,
				undefined,
				deprecated,
			);
			tools.push({
				name,
				...(text === "" ? {} : { description: text }),
				inputSchema: commandInputSchema(command, path),
				...(outputSchema === undefined ? {} : { outputSchema }),
				...(mcp === undefined ? {} : { annotations: mcp }),
				...commandInputFields(command),
				path,
			});
		}
		for (const [name, sub] of Object.entries(command.subCommands)) {
			visit(sub, [...path, name], opted);
		}
	};
	visit(snapshot, [], false);
	return tools;
}
