import {
	type CommandDefinition,
	type CommandShape,
	type ContextFactory,
	CrustError,
	defineCommand,
} from "@crustjs/core";
import type { JsonValue } from "@crustjs/utils/json";

import { type ApiClient, baseOriginUrl, fetchNextPage, resolveUrl } from "./client.ts";
import type { DefineApiOptions } from "./define-api.ts";
import { ApiResponseError } from "./request.ts";
import { isLocalRef, mergeParameters, rawOperations, refTarget } from "./spec-traversal.ts";

/**
 * An OpenAPI document; `api --list` and `--spec` read only `paths` and local `$ref` targets.
 * Keys of `paths` not starting with `/`, such as `x-*` extensions, are skipped.
 */
export interface OpenApiSpec {
	readonly paths?: Readonly<Record<string, unknown>>;
	readonly [key: string]: unknown;
}

/**
 * A request for {@link ApiClient.fetch}; without `init`, the previous request's is reused.
 * `init.auth: false` sends it without credentials, as for a public operation.
 */
export interface ApiRequest {
	readonly path: string;
	readonly init?: Parameters<ApiClient["fetch"]>[1];
}

/** A page request `--paginate` sent, with its method as sent: `paginate` may change a reused `init` afterwards. */
export interface SentPage extends ApiRequest {
	readonly method: string;
}

/**
 * The page request after `previous` for `next`, a `paginate` result; fails when `next` repeats
 * `previous` (same URL and method, `init` reused) instead of looping.
 */
export function nextPage(
	baseUrl: string,
	previous: SentPage,
	next: ApiRequest,
	pageNumber: number,
): SentPage {
	const init = next.init ?? previous.init;
	const method = init?.method ?? "GET";
	const url = resolveUrl(baseUrl, next.path).href;
	// shortcut: compares only with the previous request, so a longer cycle (A→B→A) still loops; upgrade to a seen-set if that shows up.
	if (
		init === previous.init &&
		method === previous.method &&
		url === resolveUrl(baseUrl, previous.path).href
	) {
		throw new Error(
			`--paginate: page ${pageNumber} repeats the previous request (${method} ${withoutQuery(url)})`,
		);
	}
	return { path: next.path, init, method };
}

type ListedOperation = {
	readonly method: string;
	readonly path: string;
	readonly operationId?: string;
	readonly summary?: string;
	/** The code of the problem that leaves its generated command out. */
	readonly unavailable?: string;
};

/**
 * Each operation's method, path, the `operationId` and `summary` the spec has, and the code of the
 * problem that leaves it out of the generated commands.
 */
function listOperations(
	spec: OpenApiSpec,
	unavailable: ReadonlyMap<string, string>,
): ListedOperation[] {
	return rawOperations(spec).map(({ method, path, operation }) => {
		const { operationId, summary } = operation as { operationId?: unknown; summary?: unknown };
		const code = unavailable.get(`${method.toUpperCase()} ${path}`);
		return {
			method: method.toUpperCase(),
			path,
			...(typeof operationId === "string" && operationId !== "" ? { operationId } : {}),
			...(typeof summary === "string" && summary !== "" ? { summary } : {}),
			...(code !== undefined && { unavailable: code }),
		};
	});
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
	const matches = rawOperations(spec).filter(
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

/** RFC 9110 `token`, the grammar of a method. */
const METHOD_TOKEN = /^[!#$%&'*+.^_`|~\w-]+$/;

/** The method to send for `-X`, upper-cased, failing before any request for one fetch() would not send. */
function parseMethod(method: string): string {
	if (!METHOD_TOKEN.test(method)) {
		throw new CrustError(
			"PARSE",
			"Invalid -X value: expected an HTTP method such as GET or PATCH, without spaces.",
			{ flag: "method" },
		);
	}
	// Like `gh api`. fetch() upper-cases only some methods and skips PATCH, so `patch` would get a 405.
	const normalized = method.toUpperCase();
	// Bun's fetch() sends a method it does not know as GET; Request shows what would be sent.
	// TODO: only the catch is needed once https://github.com/oven-sh/bun/issues/42497 is fixed.
	let sent: string | undefined;
	try {
		sent = new Request("http://localhost/", { method: normalized }).method;
	} catch {
		// A method fetch() forbids, such as CONNECT on Node.
	}
	if (sent !== normalized) {
		const problem = sent === undefined ? "cannot send it" : `would send it as ${sent}`;
		throw new CrustError("PARSE", `-X ${normalized}: this runtime's fetch() ${problem}.`, {
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

/** The contributed `api` command, spelled out because `defineApi()` needs a declared type. */
export type ApiCommandDefinition<Operations = unknown> = CommandDefinition<
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
	{ api: ApiClient<Operations> }
>;

/**
 * The `api` command over the `client` Context: `api --list` and `api --spec <operationId|path>`
 * read the spec from `loadSpec`, and `api --list` marks the `unavailable` operations; `api <path>` sends a request through the client, prints the
 * response body to stdout (its exact bytes to a pipe or file; as text to a terminal, failing
 * instead for a binary body), and fails with {@link ApiResponseError} on a non-2xx status. Under
 * the `json()` Extension's `--json`, `api` returns its data as the command result instead: the
 * operations, the definition, or the parsed response body; `--paginate` yields each page body as
 * an event.
 */
export function createApiCommand(
	client: ContextFactory<"api", void, ApiClient>,
	loadSpec: () => Promise<OpenApiSpec>,
	{
		baseUrl,
		paginate,
		unavailable,
	}: Pick<DefineApiOptions, "baseUrl" | "paginate"> & {
		/** The code of the problem that leaves each such operation out, by `METHOD path`. */
		readonly unavailable: () => ReadonlyMap<string, string>;
	},
): ApiCommandDefinition {
	return defineCommand(
		"api",
		{ description: "Call the HTTP API, or browse its OpenAPI spec" },
		(command) =>
			command
				.use(client)
				.args(pathArg)
				.flags(apiFlags)
				.action(async ({ args, flags, ctx, signal, stdout, stderr }) => {
					// Under the json() Extension's `--json`, the result is the output: JSON data on stdout.
					const json = (flags as { json?: unknown }).json === true;
					if (flags.list) {
						const listed = listOperations(await loadSpec(), unavailable());
						if (json) return listed;
						for (const { unavailable: code, ...entry } of listed) {
							const mark = code === undefined ? [] : [`[unavailable: ${code}]`];
							stdout([...Object.values(entry), ...mark].join(" "));
						}
						return undefined;
					}
					if (flags.spec !== undefined) {
						const found = specFor(await loadSpec(), flags.spec) as JsonValue;
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
						url = baseOriginUrl(baseUrl, args.path);
					} catch (cause) {
						const message = cause instanceof Error ? cause.message : String(cause);
						throw new CrustError("PARSE", message, { argument: "path" }).withCause(cause);
					}

					const fields = (flags.field ?? []).map(parseField);
					const body = flags.body === undefined ? undefined : await readBody(flags.body, signal);
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
						let request: SentPage = { path, init: { method, headers, body: requestBody }, method };
						// What messages show: the request's path as given, never a query added by -F.
						let shown = args.path as string;
						let response = await api.fetch(request.path, request.init);
						for (let pageNumber = 2; ; pageNumber++) {
							// Bun types `clone()` as undici's Response, which lacks Bun's Headers extras.
							const page = flags.paginate ? (response.clone() as Response) : undefined;
							yield { response, bytes: new Uint8Array(await response.arrayBuffer()) };
							if (!response.ok) {
								throw new ApiResponseError(
									response.status,
									`${request.method} ${withoutQuery(shown)}: HTTP ${response.status} ${response.statusText}`.trimEnd(),
								);
							}
							const next: ApiRequest | undefined =
								page && paginate ? await paginate(page) : undefined;
							if (next === undefined) return;
							request = nextPage(baseUrl, request, next, pageNumber);
							shown = next.path;
							response = await fetchNextPage(api, request.path, request.init);
						}
					}

					/** Prints each page's body; under --json, yields a successful page's body as JSON data instead. */
					async function* bodies(): AsyncGenerator<JsonValue, undefined> {
						const { getAmbientTerminalIO, writeProcessOutput } =
							await import("@crustjs/utils/terminal");
						// Why a body can only be printed as text; undefined when stdout is the process's own
						// pipe or file, which gets every body's exact bytes, like gh api and curl. A page is
						// one NDJSON line, JSON cannot hold bytes, injected output (`run()`) takes text lines,
						// and raw bytes can garble a terminal.
						let refusal: string | undefined;
						if (flags.paginate) refusal = "--paginate prints only text and JSON bodies";
						else if (json) {
							refusal =
								"--json prints only text and JSON bodies, so run without it to write the bytes to stdout";
						} else if (getAmbientTerminalIO() !== undefined) {
							refusal = "its bytes go only to the process's stdout, not to captured output";
						} else if (process.getBuiltinModule("node:tty").isatty(1)) {
							refusal = "redirect or pipe stdout to save it instead of printing it to the terminal";
						}
						for await (const { response, bytes } of pages()) {
							if (refusal === undefined) {
								writeProcessOutput(1, bytes);
								continue;
							}
							const text = bodyText(bytes);
							if (text === undefined) {
								if (response.ok) {
									const type = response.headers.get("content-type") ?? "no Content-Type";
									throw new Error(
										`api: ${flags.paginate ? "a --paginate page" : "the response"} body is binary (${type}); ${refusal}`,
									);
								}
								continue;
							}
							if (!json) {
								if (flags.paginate) stdout(compactJson(text));
								else if (text !== "") stdout(text.replace(/\r?\n$/, ""));
							} else if (!response.ok) {
								if (text !== "") stderr(text.replace(/\r?\n$/, ""));
							} else if (flags.paginate || text !== "") {
								yield bodyValue(text);
							}
						}
						return undefined;
					}
					// Each page body is an event of json()'s NDJSON stream.
					if (flags.paginate && json) return bodies();
					let result: JsonValue | undefined;
					for await (const value of bodies()) result = value;
					return result;
				}),
	);
}

/** One response of `api <path>` with its body. */
interface Page {
	readonly response: Response;
	readonly bytes: Uint8Array;
}

/** `path` up to its query or fragment, which may hold a credential such as an `-F` field. */
function withoutQuery(path: string): string {
	return path.replace(/[?#][\s\S]*$/, "");
}

/** The body as text, or `undefined` when it is not valid UTF-8. */
function bodyText(bytes: Uint8Array): string | undefined {
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
