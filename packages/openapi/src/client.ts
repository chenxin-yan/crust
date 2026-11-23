import {
	type AnyContextFactory,
	type ContextFactory,
	type ContextMap,
	type ContextSetup,
	defineContext,
} from "@crustjs/core";

import type { DefineApiOptions } from "./define-api.ts";
import type { Operation } from "./operations.ts";
import { callOperation } from "./request.ts";
import type { TypedCall, UntypedCall } from "./typed-client.ts";

/**
 * What `auth` may return to have a 401 retried: its headers, and how to get new ones.
 * `bearerAuth()` builds one.
 */
export interface AuthAttempt {
	readonly headers: Readonly<Record<string, string>>;
	/**
	 * Called at most once per request, when a request that carried these headers gets a 401:
	 * the attempt to replay the request with, which later requests and pages also use, or
	 * `undefined` to keep the 401. Leave it out for a credential that can't be refreshed.
	 */
	readonly retry?: (
		response: Response,
		options: { readonly signal: AbortSignal },
	) => Promise<AuthAttempt | undefined>;
}

/**
 * What a handle's `.auth()` takes: headers added to requests to the base URL's origin, e.g. an
 * `Authorization` header, or any default header such as `User-Agent` or an API-version header, or
 * an {@link AuthAttempt} with such headers. All of them are treated as credentials: they are never
 * sent off the base URL's origin.
 * Called at most once per invocation, on the first request that sends credentials: never for a
 * command that only reads the Context, nor for requests with `auth: false`. `input.ctx` has the
 * Contexts `Ctx` of the Context factories `.use()`d before `.auth()`; the second argument holds
 * the `baseUrl` as configured.
 */
export type ApiAuth<Ctx extends ContextMap = {}> = (
	input: ContextSetup<{}, Ctx>,
	client: { readonly baseUrl: string },
) =>
	| Readonly<Record<string, string>>
	| AuthAttempt
	| undefined
	| Promise<Readonly<Record<string, string>> | AuthAttempt | undefined>;

declare const authContexts: unique symbol;

/**
 * The `api` Context value: `fetch()` bound to the API's base URL and auth, and `call()` for an
 * operation of the spec, typed by `Operations` when a spec is registered in `Specs`. `AuthDeps` are
 * the Contexts its `.auth()` reads.
 */
export interface ApiClient<Operations = unknown, AuthDeps extends ContextMap = {}> {
	// Type only, and invariant: a command whose client's `auth` reads other Contexts than the app's client's fails to compile.
	readonly [authContexts]?: (deps: AuthDeps) => AuthDeps;
	readonly baseUrl: string;
	/**
	 * `fetch()` for `path` below {@link ApiClient.baseUrl} (an absolute URL is used as is, but
	 * must be on the base URL's origin: otherwise it rejects with a `TypeError` before any request),
	 * with the `auth` headers the request does not set itself, and the invocation's signal
	 * unless `init.signal` is given. Redirects are followed here
	 * (up to 20 per request, http: and https: only); one to another origin than the base URL's
	 * continues without `Authorization`, `Cookie`, `Proxy-Authorization`, or any header named like an `auth` header.
	 * With `auth: false` (e.g. a public operation), neither the request nor its redirects
	 * call `auth` or carry its headers.
	 */
	fetch(path: string, init?: RequestInit & { readonly auth?: false }): Promise<Response>;
	/**
	 * Sends the operation with this `operationId` through {@link ApiClient.fetch}, its request built
	 * from the spec and `input`, and resolves to the 2xx response's JSON body, `undefined` without
	 * content, or the unread `Response` for a media type the spec declares instead of JSON. Without a
	 * registered spec, any id compiles and the result is `unknown`. It rejects with:
	 * - a `VALIDATION` `CrustError`, before any request, for an input it cannot send;
	 * - an `Error` for an `operationId` the spec lacks or several operations share, or a spec it
	 *   cannot read;
	 * - an `ApiResponseError` (with `status`) for a non-2xx response, a 2xx in another media type
	 *   than the JSON the spec declares, or a JSON body that does not parse;
	 * - whatever `fetch()` rejects with, such as a network error, a refused redirect, or an error
	 *   `auth` throws.
	 */
	readonly call: unknown extends Operations ? UntypedCall : TypedCall<Operations>;
}

/** `path` joined below `baseUrl`, keeping the base's own path; absolute URLs pass through. */
export function resolveUrl(baseUrl: string, path: string): URL {
	return URL.canParse(path)
		? new URL(path)
		: new URL(`${baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`);
}

/**
 * `path` resolved like {@link ApiClient.fetch} does for a first request, which must stay on
 * `baseUrl`'s origin, so credentials set for the API never go to a host the caller named;
 * only redirects and next pages may leave it. Throws a `TypeError` for any other origin.
 */
export function baseOriginUrl(baseUrl: string, path: string): URL {
	const url = resolveUrl(baseUrl, path);
	const { origin } = new URL(baseUrl);
	if (url.origin !== origin) {
		throw new TypeError(`Cannot request ${url.href}: only URLs on ${origin} are allowed`);
	}
	return url;
}

/** One request of a chain: the first, a redirect's, or a next page's. */
interface Hop {
	readonly url: URL;
	readonly init: RequestInit & { readonly headers: Headers };
	/** Whether the `auth` headers go with requests to the base URL's origin. */
	readonly auth: boolean;
	/** Redirects followed to reach `url`: one count for the whole chain, across origins. */
	readonly redirects: number;
}

/** The `auth` headers a request attaches, and the retry of the attempt they came from. */
interface AuthState {
	readonly headers: Headers;
	readonly retry: AuthAttempt["retry"];
}

/** A body `fetch()` can send again: never a stream, which the first request consumed. */
const isReplayable = (body: RequestInit["body"]): boolean =>
	body == null ||
	typeof body === "string" ||
	body instanceof URLSearchParams ||
	body instanceof ArrayBuffer ||
	ArrayBuffer.isView(body) ||
	body instanceof Blob ||
	body instanceof FormData;

/**
 * A copy of a mutable replayable body, so the first request, its redirects and a retry all send
 * it as it was when `fetch()` was called.
 */
function snapshot(body: RequestInit["body"]): RequestInit["body"] {
	if (body instanceof URLSearchParams) return new URLSearchParams(body);
	if (body instanceof ArrayBuffer) return body.slice(0);
	if (ArrayBuffer.isView(body)) {
		return new Uint8Array(body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength));
	}
	if (body instanceof FormData) {
		const copy = new FormData();
		body.forEach((value, name) => copy.append(name, value));
		return copy;
	}
	return body;
}

/** Cancels a response body that `retry` may already have read or locked. */
const discard = (response: Response): Promise<void> =>
	response.body?.cancel().catch(() => {}) ?? Promise.resolve();

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const MAX_REDIRECTS = 20;
// Request-body headers the Fetch standard drops when a redirect turns the request into a GET.
const BODY_HEADERS = ["content-encoding", "content-language", "content-location", "content-type"];

/** `response` reporting `redirected`, as `fetch()` does after following a redirect, on its clones too. */
function markRedirected(response: Response): Response {
	const clone = response.clone.bind(response);
	return Object.defineProperties(response, {
		redirected: { value: true },
		// Bun types `clone()` as undici's Response, which lacks Bun's Headers extras.
		clone: { value: () => markRedirected(clone() as Response) },
	});
}

// Kept off the public ApiClient shape; only `api --paginate` requests next pages.
const nextPageFetchers = new WeakMap<ApiClient, ApiClient["fetch"]>();

/**
 * `client.fetch()` for a next page a response named: like a redirect target, it must be
 * http(s) and gets no credential headers off the base URL's origin, even ones the request set.
 */
export function fetchNextPage(
	client: ApiClient,
	path: string,
	init?: Parameters<ApiClient["fetch"]>[1],
): Promise<Response> {
	const fetchNext = nextPageFetchers.get(client);
	if (fetchNext === undefined) throw new TypeError("fetchNextPage: not an `api` Context value");
	return fetchNext(path, init);
}

/**
 * The `api` Context of one `defineApi()` handle; `call()` reads its operation through `findOperation`,
 * and `auth` reads the Contexts of `use`, which become the Context's dependencies.
 */
export function apiClientContext(
	options: Pick<DefineApiOptions, "baseUrl" | "fetch"> & { readonly auth?: ApiAuth },
	findOperation: (operationId: string) => Promise<Operation>,
	use: readonly AnyContextFactory[] = [],
): ContextFactory<"api", void, ApiClient> {
	const builder = defineContext("api").use(...use);
	return builder.setup(async (input) => {
		const origin = new URL(options.baseUrl).origin;
		// The headers the Fetch standard strips on a cross-origin redirect, plus every auth header name once `auth` ran.
		const credentialHeaders = ["authorization", "cookie", "proxy-authorization"];
		let authState: Promise<AuthState> | undefined;
		function toAuthState(result: Awaited<ReturnType<ApiAuth>>) {
			// A header value is a string, so an object `headers` marks an AuthAttempt.
			const attempt =
				typeof result?.headers === "object" && result.headers !== null
					? (result as AuthAttempt)
					: undefined;
			let headers: Headers;
			try {
				headers = new Headers(attempt ? attempt.headers : (result as Record<string, string>));
			} catch {
				// Node's error quotes the value, which is a credential.
				throw new TypeError("The auth header value is not valid");
			}
			credentialHeaders.push(...headers.keys());
			return { headers, retry: attempt?.retry };
		}
		const loadAuthState = async () =>
			toAuthState(await options.auth?.(input, { baseUrl: options.baseUrl }));

		const firstHop = (
			url: URL,
			{ auth, ...init }: Parameters<ApiClient["fetch"]>[1] = {},
		): Hop => ({
			url,
			init: {
				...init,
				body: snapshot(init.body),
				headers: new Headers(init.headers),
				signal: init.signal ?? input.signal,
			},
			auth: auth !== false,
			redirects: 0,
		});

		/**
		 * The request for `target` after `from`, for a redirect with `status` or, without one,
		 * a next page. Every move to a URL a response named goes through here, so the protocol,
		 * redirect limit, and credential rules cannot be bypassed.
		 */
		function step(from: Hop, target: URL, status?: number): Hop {
			from.init.signal?.throwIfAborted();
			if (target.protocol !== "http:" && target.protocol !== "https:") {
				throw new TypeError(`Cannot request ${target.href}: only http: and https: URLs`);
			}
			const headers = new Headers(from.init.headers);
			let { method = "GET", body } = from.init;
			if (status !== undefined) {
				if (from.redirects === MAX_REDIRECTS) {
					throw new TypeError(`fetch ${from.url.href}: too many redirects`);
				}
				const upper = method.toUpperCase();
				if (
					status === 303 ? upper !== "GET" && upper !== "HEAD" : status <= 302 && upper === "POST"
				) {
					method = "GET";
					body = null;
					for (const name of BODY_HEADERS) headers.delete(name);
				}
			}
			// The request may override an auth header's value; it is a credential either way.
			if (target.origin !== origin) for (const name of credentialHeaders) headers.delete(name);
			const redirects = from.redirects + (status === undefined ? 0 : 1);
			return { ...from, url: target, init: { ...from.init, method, body, headers }, redirects };
		}

		// Redirects are followed here, not by `fetch()`, which would forward headers other than
		// Authorization to any origin and restart its redirect count on every call.
		// A 401 to a request that carried the `auth` headers is sent again once, as that hop was sent
		// (never an earlier hop of the chain), with the attempt `retry` returns, which becomes the
		// invocation's auth state.
		async function send(first: Hop): Promise<Response> {
			const redirect = first.init.redirect ?? "follow";
			let retried = false;
			for (let hop = first; ;) {
				const headers = new Headers(hop.init.headers);
				let attached: AuthState | undefined;
				if (hop.auth && hop.url.origin === origin) {
					const state = await (authState ??= loadAuthState());
					// Retried only when every header of the attempt went as the library set it.
					let overridden = false;
					let sent = false;
					for (const [name, value] of state.headers) {
						if (headers.has(name)) overridden = true;
						else {
							headers.set(name, value);
							sent = true;
						}
					}
					if (sent && !overridden) attached = state;
				}
				const response = await (options.fetch ?? fetch)(hop.url, {
					...hop.init,
					headers,
					redirect: redirect === "follow" ? "manual" : redirect,
				});
				const signal = hop.init.signal ?? input.signal;
				if (
					response.status === 401 &&
					attached?.retry &&
					!retried &&
					isReplayable(hop.init.body) &&
					!signal.aborted
				) {
					retried = true;
					const next = await attached.retry(response, { signal }).catch(async (error: unknown) => {
						await discard(response);
						throw error;
					});
					if (next !== undefined) {
						await discard(response);
						authState = Promise.resolve(toAuthState(next));
						continue;
					}
				}
				const location = response.headers.get("location");
				if (redirect !== "follow" || !REDIRECT_STATUSES.has(response.status) || location === null) {
					return hop.redirects > 0 ? markRedirected(response) : response;
				}
				await response.body?.cancel();
				hop = step(hop, new URL(location, hop.url), response.status);
			}
		}

		const fetchPath: ApiClient["fetch"] = async (path, init) =>
			send(firstHop(baseOriginUrl(options.baseUrl, path), init));
		const client: ApiClient = {
			baseUrl: options.baseUrl,
			fetch: fetchPath,
			call: async (operationId, callInput) =>
				callOperation(fetchPath, await findOperation(operationId), callInput),
		};
		nextPageFetchers.set(client, (path, init) => {
			const target = resolveUrl(options.baseUrl, path);
			return send(step(firstHop(target, init), target));
		});
		return client;
	});
}
