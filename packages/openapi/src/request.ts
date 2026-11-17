import { CrustError } from "@crustjs/core";
import { jsonErrorDetails } from "@crustjs/utils/json";

import type { ApiClient } from "./client.ts";
import { type Operation, type Param, isJsonMediaType } from "./operations.ts";
import type { CallInput } from "./typed-client.ts";

/** A request for {@link ApiClient.fetch}: the path below the base URL with its query, and `init`. */
export interface OperationRequest {
	readonly path: string;
	readonly init: RequestInit & { readonly method: string; readonly headers: Headers };
}

/**
 * A non-2xx response to `api <path>`, whose body was already printed (to stderr under `--json`),
 * or to `call()`. The `json()` Extension prints its `status` as the error's `details`.
 */
export class ApiResponseError extends Error {
	override name = "ApiResponseError";

	/** The HTTP status code. */
	readonly status: number;

	constructor(status: number, message: string) {
		super(message);
		this.status = status;
		Object.defineProperty(this, jsonErrorDetails, { value: { status } });
	}
}

const LOCATIONS = ["path", "query", "header"] as const;

/** Percent-encodes all but RFC 3986 unreserved characters, as RFC 6570 does; `encodeURIComponent` keeps `!'()*`. */
function encode(value: string | number | boolean): string {
	return encodeURIComponent(String(value)).replace(
		/[!'()*]/g,
		(char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
	);
}

function invalid(op: Operation, message: string): CrustError {
	return new CrustError("VALIDATION", `${op.id}: ${message}`);
}

/** An object literal or `Object.create(null)`: not an array, a class instance or a function. */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
	if (typeof value !== "object" || value === null) return false;
	const prototype = Object.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
}

type Scalar = string | number | boolean;
const isScalar = (value: unknown): value is Scalar =>
	typeof value === "string" || typeof value === "number" || typeof value === "boolean";

/**
 * The request for `op` with `input`: path parameters filled into the path template (style
 * `simple`), query parameters in style `form`, header parameters in style `simple`, each a scalar,
 * an array of scalars or an object of scalars serialized by its `explode`, and `body` as JSON.
 * Cookie parameters are never sent. Throws a `VALIDATION` error, before any request, for a missing
 * required input, a parameter the operation does not have, or one it cannot send, such as a path
 * value that would make an empty, `.` or `..` segment and so address another resource.
 */
export function buildRequest(op: Operation, input: CallInput = {}): OperationRequest {
	for (const location of LOCATIONS) {
		for (const name of Object.keys(input[location] ?? {})) {
			if (!op.params.some((param) => param.in === location && param.name === name)) {
				throw invalid(op, `no ${location} parameter "${name}"`);
			}
		}
	}

	const filled = new Map<string, string>();
	const query: string[] = [];
	const headers = new Headers();
	for (const param of op.params) {
		if (param.in === "cookie") {
			if (param.required)
				throw invalid(op, `the required cookie parameter "${param.name}" cannot be sent`);
			continue;
		}
		const values = input[param.in];
		// Own values only: a parameter may be named like an Object.prototype member.
		const value = values && Object.hasOwn(values, param.name) ? values[param.name] : undefined;
		if (value === undefined) {
			if (param.required) throw invalid(op, `missing the ${param.in} parameter "${param.name}"`);
			continue;
		}
		const { items, entries, explode } = serializable(op, param, value);
		if (param.in === "path") {
			filled.set(param.name, serialize(items, entries, explode, encode));
		} else if (param.in === "header") {
			try {
				headers.set(param.name, serialize(items, entries, explode, String));
			} catch {
				// Not the platform's error: Node's quotes the value, which may be a credential.
				throw invalid(
					op,
					`the header parameter "${param.name}" has characters HTTP does not allow`,
				);
			}
		} else if (!explode) {
			query.push(`${encode(param.name)}=${serialize(items, entries, false, encode)}`);
		} else if (entries) {
			for (const [key, item] of entries) query.push(`${encode(key)}=${encode(item)}`);
		} else {
			for (const item of items) query.push(`${encode(param.name)}=${encode(item)}`);
		}
	}

	// Segment by segment: a URL parser resolves an empty, `.` or `..` segment (even `%2E`) to
	// another resource, such as `DELETE /users/..` to the API's root.
	const path = op.path
		.split("/")
		.map((template) => {
			const names: string[] = [];
			const segment = template.replace(/\{([^}]+)\}/g, (placeholder, name: string) => {
				const value = filled.get(name);
				if (value === undefined) return placeholder;
				names.push(name);
				return value;
			});
			if (names.length > 0 && /^\.{0,2}$/.test(segment)) {
				throw invalid(
					op,
					`the path parameter "${names.join('", "')}" would make an empty, "." or ".." path segment`,
				);
			}
			return segment;
		})
		.join("/");

	let body: string | undefined;
	if (input.body !== undefined) {
		if (op.body === undefined) throw invalid(op, "the operation takes no request body");
		if (!isJsonMediaType(op.body.contentType)) {
			throw invalid(
				op,
				`the request body is ${op.body.contentType}; call() sends only JSON, so use fetch()`,
			);
		}
		try {
			body = JSON.stringify(input.body);
		} catch {
			// A cycle or a BigInt; the platform's message may quote the body.
		}
		// `undefined` for a function, a symbol, or a `toJSON()` returning it.
		if (body === undefined) throw invalid(op, "the request body cannot be sent as JSON");
		headers.set("content-type", op.body.contentType);
	} else if (op.body?.required) {
		throw invalid(op, "missing the request body");
	}

	return {
		path: query.length === 0 ? path : `${path}?${query.join("&")}`,
		init: { method: op.method.toUpperCase(), headers, ...(body !== undefined && { body }) },
	};
}

/**
 * `items` and an object's `entries` joined with commas: `a,b`, `k,v,k2,v2`, or exploded `k=v,k2=v2`.
 */
function serialize(
	items: readonly Scalar[],
	entries: readonly (readonly [string, Scalar])[] | undefined,
	explode: boolean,
	encodeValue: (value: Scalar) => string,
): string {
	if (entries === undefined) return items.map(encodeValue).join(",");
	return entries
		.map(([key, item]) =>
			explode
				? `${encodeValue(key)}=${encodeValue(item)}`
				: `${encodeValue(key)},${encodeValue(item)}`,
		)
		.join(",");
}

/**
 * `value` for `param`, which must be in its location's default style: its scalars, or for an object
 * its entries (properties set to `undefined` left out), and whether it explodes.
 */
function serializable(
	op: Operation,
	param: Param,
	value: unknown,
): {
	readonly items: readonly Scalar[];
	readonly entries?: readonly (readonly [string, Scalar])[];
	readonly explode: boolean;
} {
	const style = param.in === "query" ? "form" : "simple";
	if (param.contentType !== undefined || (param.style ?? style) !== style) {
		const how = param.contentType === undefined ? `style ${param.style}` : param.contentType;
		throw invalid(
			op,
			`the ${param.in} parameter "${param.name}" is in ${how}; call() sends only style ${style}, so use fetch()`,
		);
	}
	const explode = param.explode ?? style === "form";
	if (isScalar(value)) return { items: [value], explode };
	if (Array.isArray(value) && value.every(isScalar)) return { items: value, explode };
	if (isPlainObject(value)) {
		const entries = Object.entries(value).filter(([, item]) => item !== undefined);
		if (entries.every((entry): entry is [string, Scalar] => isScalar(entry[1]))) {
			return { items: [], entries, explode };
		}
	}
	throw invalid(
		op,
		`the ${param.in} parameter "${param.name}" must be a scalar, an array of scalars, or an object of scalars`,
	);
}

/**
 * Sends `op` through `fetch` (without credentials for a public operation, `security: []`) and
 * returns a 2xx response's JSON body, `undefined` for no content, or the unread `Response` of any
 * other media type. A non-2xx response rejects with an {@link ApiResponseError}.
 */
export async function callOperation(
	fetch: ApiClient["fetch"],
	op: Operation,
	input?: CallInput,
): Promise<unknown> {
	const { path, init } = buildRequest(op, input);
	const response = await fetch(path, op.security?.length === 0 ? { ...init, auth: false } : init);
	// Neither the query nor anything after it: a parameter may hold a credential.
	const shown = `${init.method} ${path.replace(/\?[\s\S]*$/, "")}`;
	if (!response.ok) {
		await response.body?.cancel();
		throw new ApiResponseError(
			response.status,
			`${shown}: HTTP ${response.status} ${response.statusText}`.trimEnd(),
		);
	}
	const type = response.headers.get("content-type");
	if (type !== null && isJsonMediaType(type)) {
		const text = await response.text();
		if (text === "") return undefined;
		try {
			return JSON.parse(text);
		} catch (cause) {
			throw new Error(`${shown}: the response is not valid JSON`, { cause });
		}
	}
	if (response.body === null || response.headers.get("content-length") === "0") {
		await response.body?.cancel();
		return undefined;
	}
	return response;
}
