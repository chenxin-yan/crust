import { type AnyCrust, type CommandSnapshot, CrustError, type RunOutcome } from "@crustjs/core";
import { parseCommandInput, type RunInputPayload } from "@crustjs/core/tooling";
import { isJsonObject, parseJsonValue } from "@crustjs/utils/json";
// Type-only: the SDK loads inside the server functions, so CLIs pay for it only when `mcp` runs.
import type { CallToolResult, Server, ServerContext, Tool } from "@modelcontextprotocol/server";

import { createToolIndex, type ToolEntry } from "./tool-index.ts";
import { type McpTool, type McpToolsOptions, toolsFromSnapshot } from "./tools.ts";

/** Server `version` when the root command declares none; the SDK requires one. */
export const DEFAULT_SERVER_VERSION = "0.0.0";

/** Leads an error result when a tool with an `outputSchema` produced only captured stdout. */
const OUTPUT_SCHEMA_UNMET =
	"The command finished without a JSON result for this tool's outputSchema; its stdout follows";

function text(value: string): CallToolResult {
	return { content: [{ type: "text", text: value }] };
}

type FailedOutcome = Extract<RunOutcome<unknown>, { status: "failed" }>;

/** `CrustError` renders as `<code>: <message>`; other errors as `<name>: <message>`; thrown non-errors via `String()`. */
function failureText({ error }: FailedOutcome): string {
	if (error instanceof CrustError) return `${error.code}: ${error.message}`;
	if (error instanceof Error) return `${error.name}: ${error.message}`;
	return String(error);
}

/**
 * Convert a captured outcome into a tool result.
 *
 * A JSON-faithful `completed` result becomes `structuredContent` (plain objects
 * as themselves, other JSON values wrapped as `{ result }`) plus a text block
 * holding the value's JSON. Any other `completed` result, and every `handled`
 * outcome, returns the captured stdout as text. `failed` sets `isError`.
 * Non-empty captured stderr (warnings, next steps) follows as one more text
 * block, whatever the status.
 */
export function toolResultFromOutcome(outcome: RunOutcome<unknown>): CallToolResult {
	const result = resultFromOutcome(outcome);
	if (!outcome.stderr) return result;
	return { ...result, content: [...result.content, { type: "text", text: outcome.stderr }] };
}

function resultFromOutcome(outcome: RunOutcome<unknown>): CallToolResult {
	switch (outcome.status) {
		case "completed": {
			try {
				// The copy is all the transport sees, so action getters run exactly once.
				const result = parseJsonValue(outcome.result);
				const json = JSON.stringify(
					result,
					// `-0` serializes as `0`; throwing takes the stdout fallback below.
					(_key, value) => {
						if (Object.is(value, -0)) throw new RangeError("-0 does not survive JSON");
						return value;
					},
					2,
				);
				return {
					content: [{ type: "text", text: json }],
					structuredContent: isJsonObject(result) ? result : { result },
				};
			} catch {
				// Non-JSON results and throwing getters keep the stdout fallback.
			}
			return text(outcome.stdout);
		}
		case "handled":
			return text(outcome.stdout);
		case "failed":
			return { ...text(failureText(outcome)), isError: true };
	}
}

/** What `tools/list` and `get_tool_details` say about a tool: everything but the fields run() routing uses. */
function listedTool({
	path: _path,
	urlFields: _urlFields,
	argNames: _argNames,
	...tool
}: McpTool): Tool {
	// SAFETY: the schemas are JSON; Crust types their keywords `unknown`, the SDK `JSONValue`.
	return tool as Tool;
}

/** Run one command tool for `tools/call`, or `call_tool` in progressive discovery. */
async function callCommandTool(
	app: AnyCrust,
	[tool, command]: ToolEntry,
	values: Readonly<Record<string, unknown>>,
	ctx: ServerContext,
): Promise<CallToolResult> {
	let input: RunInputPayload;
	try {
		input = parseCommandInput(command, values);
	} catch (error) {
		// Input shaping failures (bad URL, bad raw) surface like action failures.
		return toolResultFromOutcome({ status: "failed", error, stdout: "", stderr: "" });
	}
	const { signal, notify } = ctx.mcpReq;
	const progressToken = ctx.mcpReq._meta?.progressToken;
	let progress = 0;
	const onEvent =
		progressToken === undefined
			? undefined
			: (event: unknown) => {
					progress++;
					const message = typeof event === "string" ? { message: event } : {};
					notify({
						method: "notifications/progress",
						params: { progressToken, progress, ...message },
					}).catch(() => {
						// A lost progress notification must not fail the tool call.
					});
				};
	// SAFETY: `path` comes from this app's own snapshot and run() validates `input`; AnyCrust erases the typed link.
	const result = toolResultFromOutcome(
		await app.run(
			tool.path as never,
			input as never,
			onEvent === undefined ? { signal } : { signal, onEvent },
		),
	);
	// MCP requires structuredContent from a tool with an outputSchema unless isError is set.
	if (tool.outputSchema === undefined || result.structuredContent || result.isError) {
		return result;
	}
	return {
		content: [{ type: "text", text: OUTPUT_SCHEMA_UNMET }, ...result.content],
		isError: true,
	};
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

const SEARCH_LIMIT_DEFAULT = 5;
const SEARCH_LIMIT_MAX = 20;

/** The fixed tool set of progressive discovery. */
const DISCOVERY_TOOLS: Tool[] = [
	{
		name: "search_tools",
		description:
			"Find this server's tools for a task described in words. Returns their names and descriptions, best first, without their schemas.",
		inputSchema: {
			type: "object",
			properties: {
				query: { type: "string", description: 'The task in words, e.g. "rotate an API key"' },
				limit: {
					type: "integer",
					minimum: 1,
					maximum: SEARCH_LIMIT_MAX,
					default: SEARCH_LIMIT_DEFAULT,
				},
			},
			required: ["query"],
		},
	},
	{
		name: "get_tool_details",
		description: "Describe a tool: its description, inputSchema, and outputSchema when it has one.",
		inputSchema: {
			type: "object",
			properties: { name: { type: "string", description: "A name search_tools returned" } },
			required: ["name"],
		},
	},
	{
		name: "call_tool",
		description:
			"Call a tool with arguments that match its inputSchema. The result is the tool's own result.",
		inputSchema: {
			type: "object",
			properties: {
				name: { type: "string", description: "A name search_tools returned" },
				arguments: { type: "object", description: "Input matching the tool's inputSchema" },
			},
			required: ["name"],
		},
	},
];

/** Prepares the tools once; each call of the result builds a new server for them. */
async function serverFactory(app: AnyCrust, options: McpToolsOptions): Promise<() => Server> {
	const snapshot = await app.snapshot();
	const tools = toolsFromSnapshot(snapshot, options);
	const commandAt = (path: readonly string[]) =>
		path.reduce<CommandSnapshot>((command, name) => command.subCommands[name]!, snapshot);
	const byName = new Map<string, ToolEntry>(
		tools.map((tool) => [tool.name, [tool, commandAt(tool.path)]]),
	);
	const index =
		options.discovery === "progressive" ? createToolIndex([...byName.values()]) : undefined;
	const { ProtocolError, ProtocolErrorCode, Server } = await import("@modelcontextprotocol/server");
	const invalid = (message: string) => new ProtocolError(ProtocolErrorCode.InvalidParams, message);
	const toolNamed = (name: string): ToolEntry => {
		const entry = byName.get(name);
		if (!entry) throw invalid(`Tool ${name} not found`);
		return entry;
	};
	/** A discovery tool's own result, shaped like a command's. */
	const discovered = (result: unknown) =>
		toolResultFromOutcome({ status: "completed", result, stdout: "", stderr: "" });
	return () => {
		const server = new Server(
			{ name: snapshot.meta.name, version: snapshot.meta.version ?? DEFAULT_SERVER_VERSION },
			{ capabilities: { tools: {} } },
		);
		server.setRequestHandler("tools/list", () => ({
			tools: index === undefined ? tools.map(listedTool) : DISCOVERY_TOOLS,
		}));
		server.setRequestHandler("tools/call", async ({ params }, ctx) => {
			const values = params.arguments ?? {};
			if (index === undefined) return callCommandTool(app, toolNamed(params.name), values, ctx);
			switch (params.name) {
				case "search_tools": {
					const { query, limit = SEARCH_LIMIT_DEFAULT } = values;
					if (typeof query !== "string") throw invalid("search_tools: query must be a string");
					if (
						typeof limit !== "number" ||
						!Number.isInteger(limit) ||
						limit < 1 ||
						limit > SEARCH_LIMIT_MAX
					) {
						throw invalid(`search_tools: limit must be an integer from 1 to ${SEARCH_LIMIT_MAX}`);
					}
					return discovered(
						index
							.search(query, limit)
							.map(({ name, description }) =>
								description === undefined ? { name } : { name, description },
							),
					);
				}
				case "get_tool_details": {
					if (typeof values.name !== "string") {
						throw invalid("get_tool_details: name must be a string");
					}
					return discovered(listedTool(toolNamed(values.name)[0]));
				}
				case "call_tool": {
					if (typeof values.name !== "string") throw invalid("call_tool: name must be a string");
					const input = values.arguments === undefined ? {} : values.arguments;
					if (!isRecord(input)) throw invalid("call_tool: arguments must be an object");
					return callCommandTool(app, toolNamed(values.name), input, ctx);
				}
				default:
					throw invalid(`Tool ${params.name} not found`);
			}
		});
		return server;
	};
}

/**
 * Build an MCP server whose tools are the application's commands.
 *
 * Tools come from `app.snapshot()` via {@link toolsFromSnapshot} (Extension
 * commands only when `include` names them); each call runs `app.run(path, input)` with its
 * own captured stdout/stderr, so concurrent calls never share state and never
 * write to the process's stdout. The server is named after the root command,
 * with its `version` or {@link DEFAULT_SERVER_VERSION}. When a call carries a
 * `progressToken`, each event an async generator action yields sends a
 * `notifications/progress` with a running `progress` count and, for string
 * events, the string as `message`; failed sends are ignored. A tool with an
 * `outputSchema` whose call yields only captured stdout returns `isError`,
 * since MCP requires its `structuredContent` otherwise. With `discovery: "progressive"`,
 * `tools/list` returns only `search_tools`, `get_tool_details`, and `call_tool`, which
 * search, describe, and call the same tools.
 *
 * Connected to a transport, the server speaks MCP 2025-11-25 and earlier;
 * {@link serveStdio} also serves 2026-07-28.
 *
 * @throws when the snapshot cannot be prepared or the tool manifest is invalid
 */
export async function createMcpServer(
	app: AnyCrust,
	options: McpToolsOptions = {},
): Promise<Server> {
	return (await serverFactory(app, options))();
}

/**
 * Serve the application's commands as {@link createMcpServer} does, over
 * stdio, and resolve once the client disconnects. The client's opening
 * exchange picks the protocol: MCP 2026-07-28, or the `initialize` handshake
 * of 2025-11-25 and earlier. The transport owns stdout for protocol frames;
 * nothing else in the process may write to it.
 *
 * @throws before serving, when the snapshot cannot be prepared or the tool manifest is invalid
 */
export async function serveStdio(app: AnyCrust, options: McpToolsOptions = {}): Promise<void> {
	const createServer = await serverFactory(app, options);
	const { StdioServerTransport, serveStdio: serve } =
		await import("@modelcontextprotocol/server/stdio");
	const transport = new StdioServerTransport();
	// The SDK builds a server for the protocol the client opens with, and none before its first message.
	serve(createServer, { transport });
	await new Promise<void>((resolve) => {
		// So only the transport sees every hang-up.
		const teardown = transport.onclose;
		// oxlint-disable-next-line unicorn/prefer-add-event-listener -- Transport exposes only the `onclose` property.
		transport.onclose = () => {
			teardown?.();
			resolve();
		};
	});
}
