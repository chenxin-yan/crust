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
	 * unless `init.signal` is given. Auth headers are sent only to the base URL's origin.
	 */
	fetch(path: string, init?: RequestInit): Promise<Response>;
}

/** `path` joined below `baseUrl`, keeping the base's own path; absolute URLs pass through. */
function resolveUrl(baseUrl: string, path: string): URL {
	return URL.canParse(path)
		? new URL(path)
		: new URL(`${baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`);
}

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
			fetch(path, init = {}) {
				const url = resolveUrl(options.baseUrl, path);
				const headers = new Headers(init.headers);
				if (url.origin === origin) {
					for (const [name, value] of authHeaders) if (!headers.has(name)) headers.set(name, value);
				}
				return fetch(url, { ...init, headers, signal: init.signal ?? input.signal });
			},
		};
	});
