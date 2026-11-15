import { type AnyCrust, type CommandSnapshot, CrustError, type RunOutcome } from "@crustjs/core";
import { parseCommandInput, type RunInputPayload } from "@crustjs/core/tooling";
import { isJsonObject, parseJsonValue } from "@crustjs/utils/json";
// Type-only: the SDK loads inside the server functions, so CLIs pay for it only when `mcp` runs.
import type { CallToolResult, Server, Tool } from "@modelcontextprotocol/server";

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

/** Prepares the tools once; each call of the result builds a new server for them. */
async function serverFactory(app: AnyCrust, options: McpToolsOptions): Promise<() => Server> {
	const snapshot = await app.snapshot();
	const tools = toolsFromSnapshot(snapshot, options);
	const commandAt = (path: readonly string[]) =>
		path.reduce<CommandSnapshot>((command, name) => command.subCommands[name]!, snapshot);
	const byName = new Map<string, readonly [McpTool, CommandSnapshot]>(
		tools.map((tool) => [tool.name, [tool, commandAt(tool.path)]]),
	);
	const { ProtocolError, ProtocolErrorCode, Server } = await import("@modelcontextprotocol/server");
	return () => {
		const server = new Server(
			{ name: snapshot.meta.name, version: snapshot.meta.version ?? DEFAULT_SERVER_VERSION },
			{ capabilities: { tools: {} } },
		);
		server.setRequestHandler("tools/list", () => ({
			// Everything but the fields run() routing uses.
			tools: tools.map(
				// SAFETY: the schemas are JSON; Crust types their keywords `unknown`, the SDK `JSONValue`.
				({ path: _path, urlFields: _urlFields, argNames: _argNames, ...tool }) => tool as Tool,
			),
		}));
		server.setRequestHandler("tools/call", async (request, ctx) => {
			const entry = byName.get(request.params.name);
			if (!entry) {
				throw new ProtocolError(
					ProtocolErrorCode.InvalidParams,
					`Tool ${request.params.name} not found`,
				);
			}
			const [tool, command] = entry;
			let input: RunInputPayload;
			try {
				input = parseCommandInput(command, request.params.arguments ?? {});
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
 * since MCP requires its `structuredContent` otherwise.
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
