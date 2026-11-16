import {
	AbortError,
	HttpError,
	OAuthError,
	oauthErrorCode,
	ResponseTooLargeError,
	TimeoutError,
} from "./errors.ts";

/** Response body cap for every authorization-server request (DEC-08). */
export const MAX_RESPONSE_BYTES: number = 1024 * 1024;
/** Discovery, token and device requests (DEC-07). */
export const REQUEST_TIMEOUT_MS = 30_000;
/** Revocation requests (DEC-07). */
export const REVOCATION_TIMEOUT_MS = 10_000;

/** The `fetch` the library calls; injectable for tests and custom transports. */
export type Fetch = (input: string, init: RequestInit) => Promise<Response>;

/** A signal that aborts with {@link AbortError} on `signal`, or with `onTimeout()` after `ms`. */
export function linkSignal(
	signal: AbortSignal | undefined,
	ms: number,
	onTimeout: () => Error = () => new TimeoutError(),
): { signal: AbortSignal; clear(): void } {
	const controller = new AbortController();
	// setTimeout, not AbortSignal.timeout(), so fake timers drive it in tests.
	const timer = setTimeout(() => controller.abort(onTimeout()), ms);
	const onAbort = () => controller.abort(new AbortError());
	if (signal?.aborted) onAbort();
	else signal?.addEventListener("abort", onAbort, { once: true });
	return {
		signal: controller.signal,
		clear() {
			clearTimeout(timer);
			signal?.removeEventListener("abort", onAbort);
		},
	};
}

/** Rejects with {@link AbortError} when `signal` is already aborted (SEC-P1). */
export function throwIfAborted(signal: AbortSignal | undefined): void {
	if (signal?.aborted) throw new AbortError();
}

/** Status and parsed JSON body (`undefined` when the body is not JSON). */
export interface JsonResponse {
	status: number;
	body: unknown;
}

/**
 * Sends one request to the authorization server: never follows a redirect (SEC-E6), caps
 * the body while streaming (SEC-E5, DEC-08) and enforces a timeout (DEC-07). The request is
 * sent once; nothing here retries.
 */
export async function requestJson(
	fetchImpl: Fetch,
	url: string,
	init: { method: "GET" | "POST"; headers?: Record<string, string>; body?: URLSearchParams },
	options: { signal?: AbortSignal; timeoutMs?: number },
): Promise<JsonResponse> {
	throwIfAborted(options.signal);
	const link = linkSignal(options.signal, options.timeoutMs ?? REQUEST_TIMEOUT_MS);
	try {
		const response = await fetchImpl(url, {
			method: init.method,
			headers: { accept: "application/json", ...init.headers },
			body: init.body,
			redirect: "manual",
			signal: link.signal,
		});
		if ((response.status >= 300 && response.status < 400) || response.type === "opaqueredirect") {
			await response.body?.cancel().catch(() => {});
			throw new HttpError(response.status);
		}
		const text = await readCapped(response);
		let body: unknown;
		try {
			body = JSON.parse(text);
		} catch {
			body = undefined;
		}
		return { status: response.status, body };
	} catch (error) {
		throw link.signal.aborted ? link.signal.reason : error;
	} finally {
		link.clear();
	}
}

async function readCapped(response: Response): Promise<string> {
	if (Number(response.headers.get("content-length")) > MAX_RESPONSE_BYTES) {
		await response.body?.cancel().catch(() => {});
		throw new ResponseTooLargeError();
	}
	if (!response.body) return "";
	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		total += value.byteLength;
		if (total > MAX_RESPONSE_BYTES) {
			await reader.cancel().catch(() => {});
			throw new ResponseTooLargeError();
		}
		chunks.push(value);
	}
	return Buffer.concat(chunks).toString("utf8");
}

/** A JSON object body, or `undefined`. */
export function jsonObject(body: unknown): Record<string, unknown> | undefined {
	return typeof body === "object" && body !== null && !Array.isArray(body)
		? (body as Record<string, unknown>)
		: undefined;
}

/**
 * The error for a failed OAuth response (SEC-E4, O2): an allowlisted {@link OAuthError} when
 * the body is a JSON object with a string `error`, otherwise {@link HttpError}. Nothing from
 * the body except the allowlisted code is kept (SEC-K2).
 */
export function oauthFailure(response: JsonResponse): OAuthError | HttpError {
	const error = jsonObject(response.body)?.error;
	return typeof error === "string"
		? new OAuthError(oauthErrorCode(error), response.status)
		: new HttpError(response.status);
}
