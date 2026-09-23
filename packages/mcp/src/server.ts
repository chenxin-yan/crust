import { type AnyCrust, CrustError, type RunOutcome } from "@crustjs/core";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
	type CallToolRequestParams,
	type CallToolResult,
	CallToolRequestSchema,
	ErrorCode,
	ListToolsRequestSchema,
	McpError,
} from "@modelcontextprotocol/sdk/types.js";

import { type McpTool, type McpToolsOptions, RAW_PROPERTY, toolsFromSnapshot } from "./tools.ts";

export type McpServerOptions = McpToolsOptions;

/** Server `version` when the root command declares none; the SDK requires one. */
export const DEFAULT_SERVER_VERSION = "0.0.0";

type JsonValue = string | number | boolean | null | readonly JsonValue[] | JsonObject;
interface JsonObject {
	readonly [key: string]: JsonValue;
}

/**
 * True when `JSON.stringify` round-trips the value without loss: finite numbers,
 * strings, booleans, `null`, arrays of such, and plain objects with only string
 * keys. `undefined`, functions, symbols, BigInt, `NaN`, class instances (`Date`,
 * `Map`, `URL`, …), symbol keys, and cycles are not. `ancestors` holds the
 * active path only, so one object referenced twice is not mistaken for a cycle.
 */
function isJsonValue(value: unknown, ancestors = new Set<object>()): value is JsonValue {
	if (value === null || typeof value === "string" || typeof value === "boolean") return true;
	if (typeof value === "number") return Number.isFinite(value);
	if (typeof value !== "object" || ancestors.has(value)) return false;
	if (!Array.isArray(value)) {
		const proto = Object.getPrototypeOf(value);
		if (proto !== Object.prototype && proto !== null) return false;
		if (Object.getOwnPropertySymbols(value).length > 0) return false;
	}
	ancestors.add(value);
	const items = Array.isArray(value) ? value : Object.values(value);
	const faithful = items.every((item) => isJsonValue(item, ancestors));
	ancestors.delete(value);
	return faithful;
}

function isJsonObject(value: JsonValue): value is JsonObject {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: JsonValue): value is string {
	return typeof value === "string";
}

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
 * holding the value's JSON. Any other `completed` result, and every `finished`
 * outcome, returns the captured stdout as text. `failed` sets `isError`.
 */
export function toolResultFromOutcome(outcome: RunOutcome<unknown>): CallToolResult {
	switch (outcome.status) {
		case "completed": {
			const { result } = outcome;
			if (!isJsonValue(result)) return text(outcome.stdout);
			return {
				content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
				structuredContent: isJsonObject(result) ? result : { result },
			};
		}
		case "finished":
			return text(outcome.stdout);
		case "failed":
			return { ...text(failureText(outcome)), isError: true };
	}
}

/** A client-supplied JSON value, or the `URL` built from one for a `url` field. */
type RunValue = JsonValue | URL | readonly (JsonValue | URL)[];

interface RunInputPayload {
	readonly args: Record<string, RunValue>;
	readonly flags: Record<string, RunValue>;
	readonly raw?: readonly string[];
}

type ToolArguments = NonNullable<CallToolRequestParams["arguments"]>;

/** Split the flat tool arguments back into `run()` input; `url` fields become `URL`s. */
function parseToolArguments(tool: McpTool, values: ToolArguments): RunInputPayload {
	// Null prototypes so a `__proto__` definition binds as an own property.
	const args: Record<string, RunValue> = Object.create(null);
	const flags: Record<string, RunValue> = Object.create(null);
	const toUrl = (value: JsonValue) => (isString(value) ? new URL(value) : value);
	let raw: readonly string[] | undefined;
	for (const [name, given] of Object.entries(values)) {
		if (given === undefined) continue;
		if (!isJsonValue(given)) {
			throw new CrustError("PARSE", `Expected a JSON value for "${name}"`);
		}
		if (name === RAW_PROPERTY) {
			if (!Array.isArray(given) || !given.every(isString)) {
				throw new CrustError("PARSE", `Expected an array of strings for "${RAW_PROPERTY}"`);
			}
			raw = given;
			continue;
		}
		const value = tool.urlFields.includes(name)
			? Array.isArray(given)
				? given.map(toUrl)
				: toUrl(given)
			: given;
		(tool.argNames.includes(name) ? args : flags)[name] = value;
	}
	return raw === undefined ? { args, flags } : { args, flags, raw };
}

/**
 * Build an MCP server whose tools are the application's commands.
 *
 * Tools come from `app.snapshot()` (Extension-contributed commands included)
 * via {@link toolsFromSnapshot}; each call runs `app.run(path, input)` with its
 * own captured stdout/stderr, so concurrent calls never share state and never
 * write to the process's stdout. The server is named after the root command,
 * with its `version` or {@link DEFAULT_SERVER_VERSION}.
 *
 * @throws when the snapshot cannot be prepared or the tool manifest is invalid
 */
export async function createMcpServer(
	app: AnyCrust,
	options: McpServerOptions = {},
): Promise<Server> {
	const snapshot = await app.snapshot();
	const tools = toolsFromSnapshot(snapshot, options);
	const byName = new Map(tools.map((tool) => [tool.name, tool]));
	const server = new Server(
		{ name: snapshot.meta.name, version: snapshot.meta.version ?? DEFAULT_SERVER_VERSION },
		{ capabilities: { tools: {} } },
	);
	server.setRequestHandler(ListToolsRequestSchema, () => ({
		tools: tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
	}));
	server.setRequestHandler(CallToolRequestSchema, async (request, { signal }) => {
		const tool = byName.get(request.params.name);
		if (!tool) {
			throw new McpError(ErrorCode.InvalidParams, `Tool ${request.params.name} not found`);
		}
		let input: RunInputPayload;
		try {
			input = parseToolArguments(tool, request.params.arguments ?? {});
		} catch (error) {
			// Input shaping failures (bad URL, bad raw) surface like action failures.
			return toolResultFromOutcome({ status: "failed", error, stdout: "", stderr: "" });
		}
		// SAFETY: `path` comes from this app's own snapshot and run() validates `input`; AnyCrust erases the typed link.
		return toolResultFromOutcome(await app.run(tool.path as never, input as never, { signal }));
	});
	return server;
}

/**
 * Serve over stdio and resolve once the client disconnects. The transport owns
 * stdout for protocol frames; nothing else in the process may write to it.
 */
export async function serveStdio(server: Server): Promise<void> {
	const closed = new Promise<void>((resolve) => {
		// oxlint-disable-next-line unicorn/prefer-add-event-listener -- Protocol exposes only the `onclose` property.
		server.onclose = resolve;
	});
	// The SDK transport only reads `data`; without this, a client hanging up would
	// leave the serving Command Action, and the process, waiting forever.
	process.stdin.once("end", () => {
		void server.close();
	});
	await server.connect(new StdioServerTransport());
	await closed;
}
