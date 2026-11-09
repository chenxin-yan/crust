import {
	type CommandDefinition,
	type CommandShape,
	type ContextInstance,
	type ExtensionFactory,
	type ExtensionId,
	CrustError,
	defineCommand,
	defineExtension,
	defineExtensionId,
} from "@crustjs/core";
import { type JsonValue, jsonErrorDetails } from "@crustjs/utils/json";

import {
	type ApiClient,
	type ApiClientOptions,
	apiClient,
	baseOriginUrl,
	fetchNextPage,
	resolveUrl,
} from "./client.ts";

const API: ExtensionId = /* @__PURE__ */ defineExtensionId("crust:openapi");

/**
 * An OpenAPI document; only `paths` and local `$ref` targets are read. Keys of `paths`
 * not starting with `/`, such as `x-*` extensions, are skipped.
 */
export interface OpenApiSpec {
	readonly paths?: Readonly<Record<string, unknown>>;
	readonly [key: string]: unknown;
}

/** A request for {@link ApiClient.fetch}; without `init`, the previous request's is reused. */
export interface ApiRequest {
	readonly path: string;
	readonly init?: RequestInit;
}

export interface ApiCommandOptions extends ApiClientOptions {
	/**
	 * The OpenAPI document, e.g. an imported JSON file bundled with the CLI and read offline;
	 * or a loader for it, called with the invocation's signal only when `api --list` or
	 * `api --spec` runs, e.g. a lazy `import()` of the JSON file that keeps it out of startup.
	 */
	readonly spec:
		| OpenApiSpec
		| ((input: { signal: AbortSignal }) => OpenApiSpec | Promise<OpenApiSpec>);
	/**
	 * The next page's request for `--paginate`, or `undefined` after the last page.
	 * Receives a copy of each successful response, so it may read the body. The next page
	 * must be http(s); off the base URL's origin it is requested without credential headers.
	 * Returning the previous request again (same URL and method, `init` reused) fails instead of looping.
	 */
	readonly paginate?: (
		response: Response,
	) => ApiRequest | undefined | Promise<ApiRequest | undefined>;
}

/**
 * A non-2xx response to `api <path>`; its body was already printed (to stderr under `--json`).
 * The `json()` Extension prints its `status`, `method`, and `url` as the error's `details`.
 */
export class ApiResponseError extends Error {
	override name = "ApiResponseError";

	/** The HTTP status code. */
	readonly status: number;
	/** The request method. */
	readonly method: string;
	/** The request URL without its query, fragment, or user info, any of which may hold a credential. */
	readonly url: string;

	constructor(
		status: number,
		message: string,
		request: { readonly method: string; readonly url: string },
	) {
		super(message);
		this.status = status;
		this.method = request.method;
		this.url = request.url;
		Object.defineProperty(this, jsonErrorDetails, {
			value: { status, method: request.method, url: request.url },
		});
	}
}

const METHODS = ["get", "put", "post", "delete", "options", "head", "patch", "trace"] as const;

/**
 * The value a local `$ref`'s JSON Pointer fragment (`#/...`, URI-encoded or not) points to
 * in `spec`, or `undefined`, also for other fragments such as `#anchor`.
 */
function refTarget(spec: OpenApiSpec, ref: string): unknown {
	let pointer: string;
	try {
		pointer = decodeURIComponent(ref.slice(1));
	} catch {
		return undefined;
	}
	if (pointer !== "" && !pointer.startsWith("/")) return undefined;
	let target: unknown = spec;
	for (const token of pointer.split("/").slice(1)) {
		const key = token.replaceAll("~1", "/").replaceAll("~0", "~");
		target =
			typeof target === "object" && target !== null && Object.hasOwn(target, key)
				? (target as Record<string, unknown>)[key]
				: undefined;
	}
	return target;
}

/** A Path Item with its own local `$ref`s (e.g. to `components.pathItems`) followed; sibling keys win. */
function pathItem(
	spec: OpenApiSpec,
	item: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
	let current: Record<string, unknown> = item;
	const seen = new Set<string>();
	for (
		let ref = current.$ref;
		typeof ref === "string" && ref.startsWith("#") && !seen.has(ref);
		ref = current.$ref
	) {
		seen.add(ref);
		const target = refTarget(spec, ref);
		if (typeof target !== "object" || target === null || Array.isArray(target)) break;
		const { $ref: _ref, ...siblings } = current;
		current = { ...target, ...siblings };
	}
	return current;
}

interface Operation {
	readonly method: string;
	readonly path: string;
	readonly operation: object;
	/** The path item's shared `parameters`. */
	readonly shared: unknown;
}

function operations(spec: OpenApiSpec): Operation[] {
	return Object.entries(spec.paths ?? {}).flatMap(([path, item]) => {
		if (!path.startsWith("/") || typeof item !== "object" || item === null) return [];
		const resolved = pathItem(spec, item as Readonly<Record<string, unknown>>);
		return METHODS.flatMap((method) => {
			const operation = resolved[method];
			return typeof operation === "object" && operation !== null
				? [{ method, path, operation, shared: resolved.parameters }]
				: [];
		});
	});
}

/** `spec`, or what its loader returns; a failure other than cancellation becomes a plain `Error`. */
async function loadSpec(
	spec: ApiCommandOptions["spec"],
	signal: AbortSignal,
): Promise<OpenApiSpec> {
	if (typeof spec !== "function") return spec;
	let loaded: unknown;
	try {
		loaded = await spec({ signal });
	} catch (cause) {
		// Core treats any Error named AbortError as cancellation, so it passes through like the signal's reason.
		if (
			(signal.aborted && cause === signal.reason) ||
			(cause instanceof Error && cause.name === "AbortError")
		) {
			throw cause;
		}
		const reason = cause instanceof Error ? cause.message : String(cause);
		throw new Error(`api: cannot load the OpenAPI document (${reason})`, { cause });
	}
	// The tag rejects a module namespace (null prototype) returned instead of its default export;
	// the prototype rejects class instances.
	const tag = Object.prototype.toString.call(loaded).slice(8, -1);
	const prototype = tag === "Object" ? Object.getPrototypeOf(loaded) : undefined;
	if (tag !== "Object" || (prototype !== Object.prototype && prototype !== null)) {
		const kind = tag === "Object" ? "class instance" : tag.toLowerCase();
		throw new Error(`api: cannot load the OpenAPI document (expected a plain object, got ${kind})`);
	}
	return loaded as OpenApiSpec;
}

type ListedOperation = {
	readonly method: string;
	readonly path: string;
	readonly operationId?: string;
	readonly summary?: string;
};

/** Each operation's method, path, and the `operationId` and `summary` the spec has. */
function listOperations(spec: OpenApiSpec): ListedOperation[] {
	return operations(spec).map(({ method, path, operation }) => {
		const { operationId, summary } = operation as { operationId?: unknown; summary?: unknown };
		return {
			method: method.toUpperCase(),
			path,
			...(typeof operationId === "string" && operationId !== "" ? { operationId } : {}),
			...(typeof summary === "string" && summary !== "" ? { summary } : {}),
		};
	});
}

function isLocalRef(ref: unknown): ref is string {
	return typeof ref === "string" && ref.startsWith("#");
}

/** `value` with its local `$ref` chain followed, stopping at a cycle or a dangling `$ref`. */
function deref(spec: OpenApiSpec, value: unknown): unknown {
	const seen = new Set<string>();
	for (;;) {
		const ref =
			typeof value === "object" && value !== null ? (value as { $ref?: unknown }).$ref : undefined;
		if (!isLocalRef(ref) || seen.has(ref)) return value;
		seen.add(ref);
		const target = refTarget(spec, ref);
		if (target === undefined) return value;
		value = target;
	}
}

/** The path item's `parameters`, minus those the operation redefines (same `name` and `in`), then the operation's. */
function mergeParameters(spec: OpenApiSpec, shared: unknown, own: unknown): unknown[] {
	const list = (parameters: unknown): unknown[] => (Array.isArray(parameters) ? parameters : []);
	const key = (parameter: unknown): string | undefined => {
		const { name, in: location } = (deref(spec, parameter) ?? {}) as {
			name?: unknown;
			in?: unknown;
		};
		return typeof name === "string" && typeof location === "string"
			? JSON.stringify([location, name])
			: undefined;
	};
	const redefined = new Set(list(own).map(key));
	return [
		...list(shared).filter((parameter) => {
			const id = key(parameter);
			return id === undefined || !redefined.has(id);
		}),
		...list(own),
	];
}

/**
 * `value` with local `$ref`s (`#/...`) followed, each target written once: a target used once is
 * inlined, keeping sibling keys; one used more often, or recursively, keeps its `$ref`s and is
 * written once under `$refs`, keyed by the `$ref` text. Inlining every use instead grows
 * exponentially with shared schemas, as in large public specs.
 */
function resolveRefs(value: unknown, spec: OpenApiSpec): unknown {
	const targets = new Map<string, unknown>();
	const target = (ref: string): unknown => {
		if (!targets.has(ref)) targets.set(ref, refTarget(spec, ref));
		return targets.get(ref);
	};
	// Uses of each resolvable `$ref`, counting every target's own `$ref`s once.
	const uses = new Map<string, number>();
	const count = (node: unknown): void => {
		if (typeof node !== "object" || node === null) return;
		for (const item of Object.values(node)) count(item);
		const { $ref } = node as { $ref?: unknown };
		if (!isLocalRef($ref) || target($ref) === undefined) return;
		const seen = uses.get($ref) ?? 0;
		uses.set($ref, seen + 1);
		if (seen === 0) count(target($ref));
	};
	count(value);

	const refs: Record<string, unknown> = {};
	const write = (node: unknown): unknown => {
		if (Array.isArray(node)) return node.map(write);
		if (typeof node !== "object" || node === null) return node;
		const { $ref, ...siblings } = node as { $ref?: unknown };
		const used = isLocalRef($ref) ? (uses.get($ref) ?? 0) : 0;
		if (used === 1) {
			const resolved = write(target($ref as string));
			return typeof resolved === "object" && resolved !== null && !Array.isArray(resolved)
				? { ...resolved, ...(write(siblings) as object) }
				: resolved;
		}
		if (used > 1 && !Object.hasOwn(refs, $ref as string)) {
			// Claimed before writing, so a recursive use stays a `$ref`.
			refs[$ref as string] = undefined;
			refs[$ref as string] = write(target($ref as string));
		}
		return Object.fromEntries(
			Object.entries(node).map(([key, item]) => [key, key === "$ref" ? item : write(item)]),
		);
	};
	const written = write(value);
	return Object.keys(refs).length > 0 ? { ...(written as object), $refs: refs } : written;
}

/**
 * The path item for a spec path, or the operation with that `operationId` with its method, path,
 * and the path item's shared `parameters`; local `$ref`s resolved by {@link resolveRefs}.
 */
function specFor(spec: OpenApiSpec, target: string): unknown {
	const paths = spec.paths ?? {};
	if (target.startsWith("/") && Object.hasOwn(paths, target)) {
		return resolveRefs(paths[target], spec);
	}
	const matches = operations(spec).filter(
		({ operation }) => (operation as { operationId?: unknown }).operationId === target,
	);
	const [match] = matches;
	if (match === undefined) {
		throw new Error(`No operation or path "${target}" in the OpenAPI spec`);
	}
	if (matches.length > 1) {
		const candidates = matches.map(({ method, path }) => `${method.toUpperCase()} ${path}`);
		throw new Error(
			`The operationId "${target}" is ambiguous in the OpenAPI spec (${candidates.join(", ")}): pass a path instead`,
		);
	}
	const { method, path, operation, shared } = match;
	const parameters = mergeParameters(
		spec,
		shared,
		(operation as { parameters?: unknown }).parameters,
	);
	return resolveRefs(
		{
			method: method.toUpperCase(),
			path,
			...operation,
			...(parameters.length > 0 ? { parameters } : {}),
		},
		spec,
	);
}

const JSON_NUMBER = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;

/** `key=value`; `true`, `false`, `null`, and JSON numbers become JSON values, like `gh api -F`. */
function parseField(field: string): [string, unknown] {
	const at = field.indexOf("=");
	if (at <= 0) {
		throw new CrustError("PARSE", "Invalid -F value: expected key=value.", { flag: "field" });
	}
	const value = field.slice(at + 1);
	const literals: Record<string, unknown> = { true: true, false: false, null: null };
	if (Object.hasOwn(literals, value)) return [field.slice(0, at), literals[value]];
	if (!JSON_NUMBER.test(value)) return [field.slice(0, at), value];
	const number = Number(value);
	// JSON.stringify would send Infinity as null.
	if (!Number.isFinite(number)) {
		throw new CrustError(
			"PARSE",
			`Invalid -F value for "${field.slice(0, at)}": the number is out of range.`,
			{ flag: "field" },
		);
	}
	return [field.slice(0, at), number];
}

// Methods fetch() normalizes to upper case; other methods are case-sensitive and sent as given.
const STANDARD_METHODS = new Set([
	"CONNECT",
	"DELETE",
	"GET",
	"HEAD",
	"OPTIONS",
	"PATCH",
	"POST",
	"PUT",
	"TRACE",
]);
/** RFC 9110 `token`, the grammar of a method. */
const METHOD_TOKEN = /^[!#$%&'*+.^_`|~\w-]+$/;

/** The method to send for `-X`, failing before any request for one that would not be sent as given. */
function parseMethod(method: string): string {
	if (!METHOD_TOKEN.test(method)) {
		throw new CrustError(
			"PARSE",
			"Invalid -X value: expected an HTTP method such as GET or PATCH, without spaces.",
			{ flag: "method" },
		);
	}
	const upper = method.toUpperCase();
	const normalized = STANDARD_METHODS.has(upper) ? upper : method;
	// Bun's fetch() sends a method it does not know as GET; Request shows what would be sent.
	let sent: string | undefined;
	try {
		sent = new Request("http://localhost/", { method: normalized }).method;
	} catch {
		// A method fetch() forbids, such as CONNECT.
	}
	if (sent !== normalized) {
		throw new CrustError("PARSE", `-X ${normalized}: this runtime's fetch() cannot send it.`, {
			flag: "method",
		});
	}
	return normalized;
}

function parseHeader(header: string): [string, string] {
	const at = header.indexOf(":");
	if (at <= 0) {
		throw new CrustError("PARSE", 'Invalid -H value: expected "Name: value".', { flag: "header" });
	}
	const entry: [string, string] = [header.slice(0, at).trim(), header.slice(at + 1).trim()];
	try {
		new Headers().append(...entry);
	} catch {
		// Neither the text nor the platform's error (which may quote it): a header can hold a token.
		throw new CrustError(
			"PARSE",
			"Invalid -H value: the header name or value has characters HTTP does not allow.",
			{ flag: "header" },
		);
	}
	return entry;
}

/** Inline text, `@path` (relative to the working directory), or `-` (all of stdin). */
async function readBody(value: string, signal: AbortSignal): Promise<string> {
	if (value !== "-" && !value.startsWith("@")) return value;
	try {
		return value === "-"
			? await (await import("@crustjs/utils/process")).readStdin(signal)
			: process.getBuiltinModule("node:fs").readFileSync(value.slice(1), "utf8");
	} catch (cause) {
		// Cancellation stays an abort, not a PARSE failure.
		if (signal.aborted && cause === signal.reason) throw cause;
		const name = value === "-" ? "stdin" : `"${value.slice(1)}"`;
		const reason = cause instanceof Error ? ` (${cause.message})` : "";
		throw new CrustError("PARSE", `--body: cannot read ${name}${reason}`, {
			flag: "body",
		}).withCause(cause);
	}
}

const pathArg = {
	name: "path",
	type: "string",
	description: "Request path below the API base URL, e.g. /users",
} as const;

const apiFlags = {
	list: { type: "boolean", noNegate: true, description: "List the API's operations" },
	spec: { type: "string", description: "Print the OpenAPI definition of an operationId or path" },
	method: {
		type: "string",
		short: "X",
		description: "HTTP method; default GET, or POST with fields or a body",
	},
	header: {
		type: "string",
		short: "H",
		multiple: true,
		description: "Request header, 'Key: Value'",
	},
	field: {
		type: "string",
		short: "F",
		multiple: true,
		description: "key=value; true, false, null, and numbers are sent as JSON",
	},
	body: { type: "string", description: "Request body: inline, @file, or - for stdin" },
	paginate: {
		type: "boolean",
		noNegate: true,
		description: "Fetch every page, printing each response body as one JSON line",
	},
} as const;

/** The contributed `api` command, spelled out because the exported factory needs a declared type. */
type ApiCommandDefinition = CommandDefinition<
	"api",
	readonly [],
	CommandShape<
		readonly [typeof pathArg],
		typeof apiFlags,
		{},
		JsonValue | undefined,
		{},
		readonly JsonValue[] | undefined
	>,
	{ api: ApiClient }
>;

/**
 * Provides the {@link apiClient} Context and contributes `api`: `api --list` and
 * `api --spec <operationId|path>` read the spec (calling its loader, if any); `api <path>` sends
 * a request through the client, prints the response body to stdout (a binary body as raw bytes),
 * and fails with {@link ApiResponseError} on a non-2xx status. Under the `json()` Extension's
 * `--json`, `api` returns its data as the command result instead: the operations, the
 * definition, or the parsed response body; `--paginate` yields each page body as an event.
 */
export const apiCommand: ExtensionFactory<
	[options: ApiCommandOptions],
	{ api: ApiClient },
	readonly [ContextInstance<"api", ApiClient, {}, {}>],
	{},
	readonly [ApiCommandDefinition],
	never,
	{}
> = /* @__PURE__ */ defineExtension(API).factory(
	(extension, { spec, paginate, ...client }: ApiCommandOptions) =>
		extension.provide(apiClient(client)).add(
			defineCommand(
				"api",
				{ description: "Call the HTTP API, or browse its OpenAPI spec" },
				(command) =>
					command
						.use(apiClient)
						.args(pathArg)
						.flags(apiFlags)
						.action(async ({ args, flags, ctx, signal, stdout, stderr }) => {
							// Under the json() Extension's `--json`, the result is the output: JSON data on stdout.
							const json = (flags as { json?: unknown }).json === true;
							if (flags.list) {
								const listed = listOperations(await loadSpec(spec, signal));
								if (json) return listed;
								for (const entry of listed) stdout(Object.values(entry).join(" "));
								return undefined;
							}
							if (flags.spec !== undefined) {
								const found = specFor(await loadSpec(spec, signal), flags.spec) as JsonValue;
								if (json) return found;
								stdout(JSON.stringify(found));
								return undefined;
							}
							if (args.path === undefined) {
								throw new CrustError(
									"VALIDATION",
									'Missing required argument "<path>" (or pass --list or --spec)',
								);
							}
							if (flags.paginate && paginate === undefined) {
								throw new Error("--paginate: this CLI does not configure pagination");
							}
							let url: URL;
							try {
								url = baseOriginUrl(client.baseUrl, args.path);
							} catch (cause) {
								const message = cause instanceof Error ? cause.message : String(cause);
								throw new CrustError("PARSE", message, { argument: "path" }).withCause(cause);
							}

							const fields = (flags.field ?? []).map(parseField);
							const body =
								flags.body === undefined ? undefined : await readBody(flags.body, signal);
							const method = parseMethod(
								flags.method ?? (fields.length > 0 || body !== undefined ? "POST" : "GET"),
							);
							const headers = new Headers((flags.header ?? []).map(parseHeader));
							let path = args.path;
							let requestBody = body;
							if (fields.length > 0) {
								// Fields go in the query when the method takes no body or --body is the body.
								if (body !== undefined || method === "GET" || method === "HEAD") {
									const query = new URLSearchParams(
										fields.map(([key, value]): [string, string] => [key, String(value)]),
									).toString();
									// Through `url.search`, so a `#fragment` does not swallow the query and the
									// path's own query stays as written (`searchParams` would re-encode it).
									url.search = url.search === "" ? query : `${url.search.slice(1)}&${query}`;
									path = url.href;
								} else {
									requestBody = JSON.stringify(Object.fromEntries(fields));
								}
							}
							if (requestBody !== undefined && !headers.has("content-type")) {
								headers.set("content-type", "application/json");
							}

							const api = await ctx.api;
							/** The response and body of each page: just one without --paginate. Fails after a non-2xx page. */
							async function* pages(): AsyncGenerator<Page> {
								let request: ApiRequest = { path, init: { method, headers, body: requestBody } };
								// What messages show: the request's path as given, never a query added by -F.
								let shown = args.path as string;
								// Snapshot at send time: a reused `init` may be mutated by `paginate` afterwards.
								let sentMethod = method;
								let response = await api.fetch(request.path, request.init);
								for (let pageNumber = 2; ; pageNumber++) {
									// Bun types `clone()` as undici's Response, which lacks Bun's Headers extras.
									const page = flags.paginate ? (response.clone() as Response) : undefined;
									yield { response, bytes: new Uint8Array(await response.arrayBuffer()) };
									if (!response.ok) {
										const failed = resolveUrl(client.baseUrl, request.path);
										throw new ApiResponseError(
											response.status,
											`${sentMethod} ${withoutQuery(shown)}: HTTP ${response.status} ${response.statusText}`.trimEnd(),
											{ method: sentMethod, url: failed.origin + failed.pathname },
										);
									}
									const next: ApiRequest | undefined =
										page && paginate ? await paginate(page) : undefined;
									if (next === undefined) return;
									const nextInit = next.init ?? request.init;
									const nextUrl = resolveUrl(client.baseUrl, next.path).href;
									// shortcut: compares only with the previous request, so a longer cycle (A→B→A) still loops; upgrade to a seen-set if that shows up.
									const nextMethod = nextInit?.method ?? "GET";
									if (
										nextInit === request.init &&
										nextMethod === sentMethod &&
										nextUrl === resolveUrl(client.baseUrl, request.path).href
									) {
										throw new Error(
											`--paginate: page ${pageNumber} repeats the previous request (${nextMethod} ${withoutQuery(nextUrl)})`,
										);
									}
									request = { path: next.path, init: nextInit };
									shown = next.path;
									sentMethod = nextMethod;
									response = await fetchNextPage(api, request.path, request.init);
								}
							}

							if (flags.paginate) {
								const decoder = new TextDecoder();
								if (!json) {
									for await (const { bytes } of pages()) stdout(compactJson(decoder.decode(bytes)));
									return undefined;
								}
								// Each page body is an event of json()'s NDJSON stream.
								return (async function* (): AsyncGenerator<JsonValue, undefined> {
									for await (const { response, bytes } of pages()) {
										const text = decoder.decode(bytes);
										if (response.ok) yield bodyValue(text);
										else if (text !== "") stderr(text.replace(/\r?\n$/, ""));
									}
									return undefined;
								})();
							}

							let result: JsonValue | undefined;
							for await (const { response, bytes } of pages()) {
								const text = bodyText(response, bytes);
								if (text === undefined) {
									const { getAmbientTerminalIO, writeProcessOutput } =
										await import("@crustjs/utils/terminal");
									// Bytes go only to the process's own stdout; injected output (`run()`) takes text lines.
									if (!json && getAmbientTerminalIO() === undefined) {
										writeProcessOutput(1, bytes);
									} else if (response.ok) {
										const type = response.headers.get("content-type") ?? "no Content-Type";
										throw new Error(
											json
												? `api: the response body is binary (${type}); --json prints only text and JSON bodies, so run without it to write the bytes to stdout`
												: `api: the response body is binary (${type}); its bytes go only to the process's stdout, not to captured output`,
										);
									}
								} else if (text !== "") {
									if (!json) stdout(text.replace(/\r?\n$/, ""));
									else if (response.ok) result = bodyValue(text);
									else stderr(text.replace(/\r?\n$/, ""));
								}
							}
							return result;
						}),
			),
		),
);

/** One response of `api <path>` with its body. */
interface Page {
	readonly response: Response;
	readonly bytes: Uint8Array;
}

/** `path` up to its query or fragment, which may hold a credential such as an `-F` field. */
function withoutQuery(path: string): string {
	return path.replace(/[?#][\s\S]*$/, "");
}

const TEXT_TYPE = /^text\/|[/+](?:json|xml|yaml|x-yaml|x-ndjson|javascript|x-www-form-urlencoded)$/;

/**
 * The body as text, or `undefined` for a binary body: one whose Content-Type is not textual
 * (text/*, JSON, XML, YAML, NDJSON, JavaScript, form data), or that is not valid UTF-8.
 */
function bodyText(response: Response, bytes: Uint8Array): string | undefined {
	const type = (response.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase();
	if (type && !TEXT_TYPE.test(type)) return undefined;
	try {
		return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
	} catch {
		return undefined;
	}
}

/** A body as JSON data: parsed when it is JSON (numbers as doubles), the text itself otherwise. */
function bodyValue(text: string): JsonValue {
	try {
		// json() rejects -0, which JSON text such as `-0.0` parses to.
		return JSON.parse(text, (_key, value: unknown) => (Object.is(value, -0) ? 0 : value));
	} catch {
		return text;
	}
}

/** A page body as one NDJSON line: JSON compacted, any other text (even empty) as a JSON string. */
function compactJson(text: string): string {
	try {
		JSON.parse(text);
	} catch {
		return JSON.stringify(text);
	}
	// Drops whitespace outside strings instead of re-serializing, which would round numbers to doubles.
	return text.replace(/"(?:[^"\\]|\\.)*"|\s+/g, (token) => (token[0] === '"' ? token : ""));
}
