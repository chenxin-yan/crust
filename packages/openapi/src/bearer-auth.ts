import type { ContextBag, ContextMap } from "@crustjs/core";

import type { ApiAuth, AuthAttempt } from "./client.ts";

/** A bearer token, and for a stored login how to refresh it. */
export interface BearerCredential {
	readonly value: string;
	/** Called once after a 401: the credential to retry with. Leave it out for a token from env or a flag. */
	readonly refresh?: (options: { signal: AbortSignal }) => Promise<BearerCredential>;
}

/** What {@link bearerAuth} passes to its resolver. */
export interface BearerResolveOptions<Ctx extends ContextMap = {}> {
	/** The invocation's cancellation signal. */
	readonly signal: AbortSignal;
	/** The client's `baseUrl` as configured, so a stored login can check it may go there. */
	readonly baseUrl: string;
	/** The Contexts of the Context factories `.use()`d before `.auth()`. */
	readonly ctx: ContextBag<Ctx>;
}

/**
 * What `.auth()` takes for a bearer token: `Authorization: Bearer <value>` from `resolve`, called
 * on the first request that sends credentials. A 401 is retried once with `refresh()`.
 */
export function bearerAuth<Ctx extends ContextMap = {}>(
	resolve: (options: BearerResolveOptions<Ctx>) => BearerCredential | Promise<BearerCredential>,
): ApiAuth<Ctx> {
	const attempt = ({ value, refresh }: BearerCredential): AuthAttempt => ({
		headers: { authorization: `Bearer ${value}` },
		retry: refresh && (async (_response, { signal }) => attempt(await refresh({ signal }))),
	});
	return async ({ signal, ctx }, { baseUrl }) => attempt(await resolve({ signal, baseUrl, ctx }));
}
