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

import {
	type ApiClient,
	type ApiClientOptions,
	apiClient,
	baseOriginUrl,
	fetchNextPage,
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
	/** The OpenAPI document bundled with the CLI, e.g. an imported JSON file; read offline. */
	readonly spec: OpenApiSpec;
	/**
	 * The next page's request for `--paginate`, or `undefined` after the last page.
	 * Receives a copy of each successful response, so it may read the body. The next page
	 * must be http(s); off the base URL's origin it is requested without credential headers.
	 */
	readonly paginate?: (
		response: Response,
	) => ApiRequest | undefined | Promise<ApiRequest | undefined>;
}

/** A non-2xx response to `api <path>`; its body was already printed to stdout. */
export class ApiResponseError extends Error {
	override name = "ApiResponseError";

	/** The HTTP status code. */
	readonly status: number;

	constructor(status: number, message: string) {
		super(message);
		this.status = status;
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

function operations(spec: OpenApiSpec): { method: string; path: string; operation: object }[] {
	return Object.entries(spec.paths ?? {}).flatMap(([path, item]) => {
		if (!path.startsWith("/") || typeof item !== "object" || item === null) return [];
		const resolved = pathItem(spec, item as Readonly<Record<string, unknown>>);
		return METHODS.flatMap((method) => {
			const operation = resolved[method];
			return typeof operation === "object" && operation !== null
				? [{ method, path, operation }]
				: [];
		});
	});
}

/** One line per operation: `METHOD path operationId summary`, omitting what the spec lacks. */
function listOperations(spec: OpenApiSpec): string[] {
	return operations(spec).map(({ method, path, operation }) => {
		const { operationId, summary } = operation as { operationId?: unknown; summary?: unknown };
		return [method.toUpperCase(), path, operationId, summary]
			.filter((part) => typeof part === "string" && part !== "")
			.join(" ");
	});
}

/** Follows local `$ref`s (`#/...`), keeping sibling keys; a `$ref` back into its own chain stays as is. */
function resolveRefs(value: unknown, spec: OpenApiSpec, chain: readonly string[]): unknown {
	if (Array.isArray(value)) return value.map((item) => resolveRefs(item, spec, chain));
	if (typeof value !== "object" || value === null) return value;
	const { $ref, ...siblings } = value as { $ref?: unknown };
	if (typeof $ref === "string" && $ref.startsWith("#") && !chain.includes($ref)) {
		const target = refTarget(spec, $ref);
		if (target !== undefined) {
			const resolved = resolveRefs(target, spec, [...chain, $ref]);
			return typeof resolved === "object" && resolved !== null && !Array.isArray(resolved)
				? { ...resolved, ...(resolveRefs(siblings, spec, chain) as object) }
				: resolved;
		}
	}
	return Object.fromEntries(
		Object.entries(value).map(([key, item]) => [key, resolveRefs(item, spec, chain)]),
	);
}

/**
 * The path item for a spec path, or the operation with that `operationId`, with
 * local `$ref`s resolved.
 */
function specFor(spec: OpenApiSpec, target: string): unknown {
	const paths = spec.paths ?? {};
	const found =
		target.startsWith("/") && Object.hasOwn(paths, target)
			? paths[target]
			: operations(spec).find(
					({ operation }) => (operation as { operationId?: unknown }).operationId === target,
				)?.operation;
	if (found === undefined) {
		throw new Error(`No operation or path "${target}" in the OpenAPI spec`);
	}
	return resolveRefs(found, spec, []);
}

const JSON_NUMBER = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;

/** `key=value`; `true`, `false`, `null`, and JSON numbers become JSON values, like `gh api -F`. */
function parseField(field: string): [string, unknown] {
	const at = field.indexOf("=");
	if (at <= 0) {
		throw new CrustError("PARSE", `--field: expected key=value, got "${field}"`, {
			flag: "field",
		});
	}
	const value = field.slice(at + 1);
	const literals: Record<string, unknown> = { true: true, false: false, null: null };
	if (Object.hasOwn(literals, value)) return [field.slice(0, at), literals[value]];
	if (!JSON_NUMBER.test(value)) return [field.slice(0, at), value];
	const number = Number(value);
	// JSON.stringify would send Infinity as null.
	if (!Number.isFinite(number)) {
		throw new CrustError("PARSE", `--field: "${field}" is out of range for a number`, {
			flag: "field",
		});
	}
	return [field.slice(0, at), number];
}

function parseHeader(header: string): [string, string] {
	const at = header.indexOf(":");
	if (at <= 0) {
		throw new CrustError("PARSE", `--header: expected "Key: Value", got "${header}"`, {
			flag: "header",
		});
	}
	const entry: [string, string] = [header.slice(0, at).trim(), header.slice(at + 1).trim()];
	try {
		new Headers().append(...entry);
	} catch (cause) {
		const reason = cause instanceof Error ? ` (${cause.message})` : "";
		throw new CrustError("PARSE", `--header: invalid header "${header}"${reason}`, {
			flag: "header",
		}).withCause(cause);
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
	CommandShape<readonly [typeof pathArg], typeof apiFlags, {}, void, {}, undefined>,
	{ api: ApiClient }
>;

/**
 * Provides the {@link apiClient} Context and contributes `api`: `api --list` and
 * `api --spec <operationId|path>` read the bundled spec offline; `api <path>` sends
 * a request through the client, prints the response body to stdout, and fails with
 * {@link ApiResponseError} on a non-2xx status.
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
						.action(async ({ args, flags, ctx, signal, stdout }) => {
							if (flags.list) {
								for (const line of listOperations(spec)) stdout(line);
								return;
							}
							if (flags.spec !== undefined) {
								stdout(JSON.stringify(specFor(spec, flags.spec)));
								return;
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
							const method = (
								flags.method ?? (fields.length > 0 || body !== undefined ? "POST" : "GET")
							).toUpperCase();
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
							let request: ApiRequest = { path, init: { method, headers, body: requestBody } };
							let response = await api.fetch(request.path, request.init);
							for (;;) {
								// Bun types `clone()` as undici's Response, which lacks Bun's Headers extras.
								const page = flags.paginate ? (response.clone() as Response) : undefined;
								const text = await response.text();
								if (flags.paginate) {
									stdout(compactJson(text));
								} else if (text !== "") {
									stdout(text.replace(/\r?\n$/, ""));
								}
								if (!response.ok) {
									throw new ApiResponseError(
										response.status,
										`${request.init?.method ?? "GET"} ${request.path}: HTTP ${response.status} ${response.statusText}`.trimEnd(),
									);
								}
								const next: ApiRequest | undefined =
									page && paginate ? await paginate(page) : undefined;
								if (next === undefined) return;
								request = { path: next.path, init: next.init ?? request.init };
								response = await fetchNextPage(api, request.path, request.init);
							}
						}),
			),
		),
);

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
