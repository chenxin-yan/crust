import type { ApiClientOptions, AuthAttempt } from "./client.ts";

/** A bearer token, and for a stored login how to refresh it. */
export interface BearerCredential {
	readonly value: string;
	/** Called once after a 401: the credential to retry with. Leave it out for a token from env or a flag. */
	readonly refresh?: (options: { signal: AbortSignal }) => Promise<BearerCredential>;
}

/** What {@link bearerAuth} passes to its resolver. */
export interface BearerResolveOptions {
	/** The invocation's cancellation signal. */
	readonly signal: AbortSignal;
	/** The client's `baseUrl` as configured, so a stored login can check it may go there. */
	readonly baseUrl: string;
}

/**
 * The `auth` option for a bearer token: `Authorization: Bearer <value>` from `resolve`, called
 * on the first request that sends credentials. A 401 is retried once with `refresh()`.
 */
export function bearerAuth(
	resolve: (options: BearerResolveOptions) => BearerCredential | Promise<BearerCredential>,
): NonNullable<ApiClientOptions["auth"]> {
	const attempt = ({ value, refresh }: BearerCredential): AuthAttempt => ({
		headers: { authorization: `Bearer ${value}` },
		retry: refresh && (async (_response, { signal }) => attempt(await refresh({ signal }))),
	});
	return async (input, { baseUrl }) => attempt(await resolve({ signal: input.signal, baseUrl }));
}
