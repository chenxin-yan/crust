import { type ContextFactory, type ContextSetup, defineContext } from "@crustjs/core";

export interface ApiClientOptions {
	/** URL request paths resolve against, e.g. `https://api.example.com/v1`. */
	readonly baseUrl: string;
	/**
	 * Headers added to requests to the base URL's origin, e.g. an `Authorization` header.
	 * Called once per invocation, when a command first reads the Context.
	 */
	readonly auth?: (
		input: ContextSetup,
	) =>
		| Readonly<Record<string, string>>
		| undefined
		| Promise<Readonly<Record<string, string>> | undefined>;
}

/** The `api` Context value: `fetch()` bound to the API's base URL and auth. */
export interface ApiClient {
	readonly baseUrl: string;
	/**
	 * `fetch()` for `path` below {@link ApiClient.baseUrl} (an absolute URL is used as is),
	 * with the `auth` headers the request does not set itself, only on the base URL's origin,
	 * and the invocation's signal unless `init.signal` is given. Redirects are followed here
	 * (up to 20 per request, http: and https: only); one to another origin than the base URL's
	 * continues without `Authorization` or any header named like an `auth` header.
	 */
	fetch(path: string, init?: RequestInit): Promise<Response>;
}

/** `path` joined below `baseUrl`, keeping the base's own path; absolute URLs pass through. */
function resolveUrl(baseUrl: string, path: string): URL {
	return URL.canParse(path)
		? new URL(path)
		: new URL(`${baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`);
}

/** One request of a chain: the first, a redirect's, or a next page's. */
interface Hop {
	readonly url: URL;
	readonly init: RequestInit & { readonly headers: Headers };
	/** Redirects followed to reach `url`: one count for the whole chain, across origins. */
	readonly redirects: number;
}

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
	init?: RequestInit,
): Promise<Response> {
	const fetchNext = nextPageFetchers.get(client);
	if (fetchNext === undefined) throw new TypeError("fetchNextPage: not an apiClient Context value");
	return fetchNext(path, init);
}

/**
 * The shared API client Context. {@link apiCommand} provides it, so app commands
 * declare `.use(apiClient)` and call `(await ctx.api).fetch("/users")`.
 */
export const apiClient: ContextFactory<"api", ApiClientOptions, ApiClient> =
	/* @__PURE__ */ defineContext("api").setup(async (input, options: ApiClientOptions) => {
		const origin = new URL(options.baseUrl).origin;
		const authHeaders = new Headers(await options.auth?.(input));
		const credentialHeaders = ["authorization", ...authHeaders.keys()];

		const firstHop = (url: URL, init: RequestInit = {}): Hop => ({
			url,
			init: { ...init, headers: new Headers(init.headers), signal: init.signal ?? input.signal },
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
			return { url: target, init: { ...from.init, method, body, headers }, redirects };
		}

		// Redirects are followed here, not by `fetch()`, which would forward headers other than
		// Authorization to any origin and restart its redirect count on every call.
		async function send(hop: Hop): Promise<Response> {
			const redirect = hop.init.redirect ?? "follow";
			for (;;) {
				const headers = new Headers(hop.init.headers);
				if (hop.url.origin === origin) {
					for (const [name, value] of authHeaders) {
						if (!headers.has(name)) headers.set(name, value);
					}
				}
				const response = await fetch(hop.url, {
					...hop.init,
					headers,
					redirect: redirect === "follow" ? "manual" : redirect,
				});
				const location = response.headers.get("location");
				if (redirect !== "follow" || !REDIRECT_STATUSES.has(response.status) || location === null) {
					return hop.redirects > 0 ? markRedirected(response) : response;
				}
				await response.body?.cancel();
				hop = step(hop, new URL(location, hop.url), response.status);
			}
		}

		const client: ApiClient = {
			baseUrl: options.baseUrl,
			fetch: (path, init) => send(firstHop(resolveUrl(options.baseUrl, path), init)),
		};
		nextPageFetchers.set(client, (path, init) => {
			const target = resolveUrl(options.baseUrl, path);
			return send(step(firstHop(target, init), target));
		});
		return client;
	});
