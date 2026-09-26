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

function isJsonPrimitive(value: unknown): value is string | number | boolean | null {
	return (
		value === null ||
		typeof value === "string" ||
		typeof value === "boolean" ||
		(typeof value === "number" && Number.isFinite(value))
	);
}

function isObject(value: unknown): value is object {
	return typeof value === "object" && value !== null;
}

/**
 * Detached copy of a value `JSON.stringify` round-trips without loss, reading each
 * property once so getters cannot change between validation and serialization.
 * Accepts finite numbers, strings, booleans, `null`, dense plain arrays of such,
 * and plain or null-prototype objects whose own keys are all enumerable strings
 * (copied as plain objects; `__proto__` stays an own key). Throws on `undefined`,
 * functions (including `toJSON` hooks, which never run), symbols, BigInt, `NaN`,
 * class instances (`Date`, `Map`, `URL`, Array subclasses, …), array holes,
 * non-index array keys, symbol or non-enumerable keys, and cycles. `-0` is kept
 * because `JSON.parse` yields it for client input; results reject it when
 * serialized. `copies` maps each object to its finished copy, or `undefined`
 * while it is being copied: an object referenced twice reuses one capture, and
 * reaching an in-progress object is a cycle.
 */
function parseJsonValue(
	value: unknown,
	copies = new Map<object, JsonValue | undefined>(),
): JsonValue {
	if (isJsonPrimitive(value)) return value;
	if (!isObject(value)) throw new TypeError("Not JSON data");
	if (copies.has(value)) {
		const copy = copies.get(value);
		if (copy === undefined) throw new TypeError("Cycle");
		return copy;
	}
	if (Object.getOwnPropertySymbols(value).length > 0) throw new TypeError("Symbol key");
	const proto = Object.getPrototypeOf(value);
	const names = Object.getOwnPropertyNames(value);
	if (Array.isArray(value)) {
		// Holes serialize as `null` and named keys are dropped: require exactly the indices plus `length`.
		if (proto !== Array.prototype || names.length !== value.length + 1) {
			throw new TypeError("Not a dense plain array");
		}
		if (!Array.from(value.keys()).every((index) => Object.hasOwn(value, index))) {
			throw new TypeError("Array hole");
		}
	} else {
		if (proto !== Object.prototype && proto !== null) throw new TypeError("Not a plain object");
		// Non-enumerable keys are dropped.
		if (!names.every((name) => Object.prototype.propertyIsEnumerable.call(value, name))) {
			throw new TypeError("Non-enumerable key");
		}
	}
	copies.set(value, undefined);
	const copy = Array.isArray(value)
		? Array.from({ length: value.length }, (_, index) => parseJsonValue(value[index], copies))
		: // `fromEntries` defines own properties, so a `__proto__` key cannot set the prototype.
			Object.fromEntries(
				Object.entries(value).map(([key, item]) => [key, parseJsonValue(item, copies)] as const),
			);
	copies.set(value, copy);
	return copy;
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
	for (const [name, value] of Object.entries(values)) {
		if (value === undefined) continue;
		let given: JsonValue;
		try {
			given = parseJsonValue(value);
		} catch {
			throw new CrustError("PARSE", `Expected a JSON value for "${name}"`);
		}
		if (name === RAW_PROPERTY) {
			if (!Array.isArray(given) || !given.every(isString)) {
				throw new CrustError("PARSE", `Expected an array of strings for "${RAW_PROPERTY}"`);
			}
			raw = given;
			continue;
		}
		(tool.argNames.includes(name) ? args : flags)[name] = tool.urlFields.includes(name)
			? Array.isArray(given)
				? given.map(toUrl)
				: toUrl(given)
			: given;
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
