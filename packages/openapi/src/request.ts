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

/**
 * The request for `op` with `input`: path parameters filled into the path template (style
 * `simple`), query parameters in style `form` (repeated per array item unless `explode` is
 * `false`, then comma-separated), header parameters in style `simple`, and `body` as JSON. Cookie
 * parameters are never sent. Throws a `VALIDATION` error, before any request, for a missing
 * required input, a parameter the operation does not have, or one it cannot send.
 */
export function buildRequest(op: Operation, input: CallInput = {}): OperationRequest {
	for (const location of LOCATIONS) {
		for (const name of Object.keys(input[location] ?? {})) {
			if (!op.params.some((param) => param.in === location && param.name === name)) {
				throw invalid(op, `no ${location} parameter "${name}"`);
			}
		}
	}

	let path = op.path;
	const query: string[] = [];
	const headers = new Headers();
	for (const param of op.params) {
		if (param.in === "cookie") {
			if (param.required)
				throw invalid(op, `the required cookie parameter "${param.name}" cannot be sent`);
			continue;
		}
		const value = input[param.in]?.[param.name];
		if (value === undefined) {
			if (param.required) throw invalid(op, `missing the ${param.in} parameter "${param.name}"`);
			continue;
		}
		const values = serializable(op, param, value);
		if (param.in === "path") {
			path = path.replaceAll(`{${param.name}}`, values.map(encode).join(","));
		} else if (param.in === "header") {
			headers.set(param.name, values.join(","));
		} else if (param.explode === false) {
			query.push(`${encode(param.name)}=${values.map(encode).join(",")}`);
		} else {
			for (const item of values) query.push(`${encode(param.name)}=${encode(item)}`);
		}
	}

	let body: string | undefined;
	if (input.body !== undefined) {
		if (op.body === undefined) throw invalid(op, "the operation takes no request body");
		if (!isJsonMediaType(op.body.contentType)) {
			throw invalid(
				op,
				`the request body is ${op.body.contentType}; call() sends only JSON, so use fetch()`,
			);
		}
		body = JSON.stringify(input.body);
		headers.set("content-type", op.body.contentType);
	} else if (op.body?.required) {
		throw invalid(op, "missing the request body");
	}

	return {
		path: query.length === 0 ? path : `${path}?${query.join("&")}`,
		init: { method: op.method.toUpperCase(), headers, ...(body !== undefined && { body }) },
	};
}

/** `value` as the scalars to send for `param`, which must be in its location's default style. */
function serializable(
	op: Operation,
	param: Param,
	value: unknown,
): readonly (string | number | boolean)[] {
	const style = param.in === "query" ? "form" : "simple";
	if (param.contentType !== undefined || (param.style ?? style) !== style) {
		const how = param.contentType === undefined ? `style ${param.style}` : param.contentType;
		throw invalid(
			op,
			`the ${param.in} parameter "${param.name}" is in ${how}; call() sends only style ${style}, so use fetch()`,
		);
	}
	const values = Array.isArray(value) ? value : [value];
	if (!values.every((item) => ["string", "number", "boolean"].includes(typeof item))) {
		throw invalid(
			op,
			`the ${param.in} parameter "${param.name}" must be a scalar or an array of scalars`,
		);
	}
	return values;
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
