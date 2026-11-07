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
	 * with the `auth` headers the request does not set itself and the invocation's signal
	 * unless `init.signal` is given. Auth headers are sent only to the base URL's origin:
	 * while they apply, redirects are followed here, and a redirect to another origin
	 * continues without them.
	 */
	fetch(path: string, init?: RequestInit): Promise<Response>;
}

/** `path` joined below `baseUrl`, keeping the base's own path; absolute URLs pass through. */
function resolveUrl(baseUrl: string, path: string): URL {
	return URL.canParse(path)
		? new URL(path)
		: new URL(`${baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`);
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
// Request-body headers the Fetch standard drops when a redirect turns the request into a GET.
const BODY_HEADERS = ["content-encoding", "content-language", "content-location", "content-type"];

/**
 * The shared API client Context. {@link apiCommand} provides it, so app commands
 * declare `.use(apiClient)` and call `(await ctx.api).fetch("/users")`.
 */
export const apiClient: ContextFactory<"api", ApiClientOptions, ApiClient> =
	/* @__PURE__ */ defineContext("api").setup(async (input, options: ApiClientOptions) => {
		const origin = new URL(options.baseUrl).origin;
		const authHeaders = new Headers(await options.auth?.(input));
		return {
			baseUrl: options.baseUrl,
			async fetch(path, init = {}) {
				let url = resolveUrl(options.baseUrl, path);
				let { method = "GET", body } = init;
				const headers = new Headers(init.headers);
				const signal = init.signal ?? input.signal;
				const follow = (init.redirect ?? "follow") === "follow";
				// Redirects are followed here while auth applies: `fetch()` would forward the
				// injected headers (other than Authorization) to whatever origin a redirect names.
				for (let redirects = 0; ; redirects++) {
					const request = { ...init, method, body, headers: new Headers(headers), signal };
					if (url.origin !== origin) return fetch(url, request);
					for (const [name, value] of authHeaders) {
						if (!request.headers.has(name)) request.headers.set(name, value);
					}
					if (!follow || [...authHeaders].length === 0) return fetch(url, request);
					const response = await fetch(url, { ...request, redirect: "manual" });
					const location = response.headers.get("location");
					if (!REDIRECT_STATUSES.has(response.status) || location === null) return response;
					if (redirects === 20) throw new TypeError(`fetch ${url.href}: too many redirects`);
					await response.body?.cancel();
					const next = new URL(location, url);
					if (next.origin !== url.origin) headers.delete("authorization");
					const upper = method.toUpperCase();
					if (
						response.status === 303
							? upper !== "GET" && upper !== "HEAD"
							: response.status <= 302 && upper === "POST"
					) {
						method = "GET";
						body = null;
						for (const name of BODY_HEADERS) headers.delete(name);
					}
					url = next;
				}
			},
		};
	});
