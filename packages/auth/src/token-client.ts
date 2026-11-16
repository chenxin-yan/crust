import { serverInternals } from "./discovery.ts";
import { OAuthConfigError, OAuthError, oauthErrorCode } from "./errors.ts";
import {
	type Fetch,
	jsonObject,
	type JsonResponse,
	oauthFailure,
	requestJson,
	REVOCATION_TIMEOUT_MS,
} from "./http.ts";
import { checkResources, checkScope } from "./params.ts";
import { sessionInternals } from "./session.ts";
import type { AuthServer, TokenClient, TokenSet } from "./types.ts";

const MAX_EXPIRES_IN_SECONDS = 10 * 365 * 24 * 60 * 60;
const INSPECT = Symbol.for("nodejs.util.inspect.custom");

/** A frozen token set whose `toJSON()` and `util.inspect()` hide the tokens (SEC-K3). */
function createTokenSet(fields: TokenSet): TokenSet {
	const redacted = () => ({
		...fields,
		accessToken: "[Redacted]",
		refreshToken: fields.refreshToken === undefined ? undefined : "[Redacted]",
	});
	return Object.freeze(
		Object.defineProperties(
			{ ...fields },
			{ toJSON: { value: redacted }, [INSPECT]: { value: redacted } },
		),
	);
}

/**
 * Validates a token response (SEC-E3, O2, DEC-12, DEC-18). Only the known fields are kept;
 * `id_token` and every other field are dropped unread.
 */
export function parseTokenResponse(response: JsonResponse, requestStart: number): TokenSet {
	if (response.status < 200 || response.status >= 300) throw oauthFailure(response);
	const body = jsonObject(response.body);
	if (!body) throw new OAuthError("invalid_response", response.status);
	if (body.error !== undefined) throw new OAuthError(oauthErrorCode(body.error), response.status);
	const { access_token, token_type, expires_in, refresh_token, scope } = body;
	const valid =
		typeof access_token === "string" &&
		access_token !== "" &&
		typeof token_type === "string" &&
		token_type.toLowerCase() === "bearer" &&
		(expires_in === undefined ||
			(typeof expires_in === "number" &&
				Number.isFinite(expires_in) &&
				expires_in > 0 &&
				expires_in <= MAX_EXPIRES_IN_SECONDS)) &&
		(refresh_token === undefined || (typeof refresh_token === "string" && refresh_token !== "")) &&
		(scope === undefined || typeof scope === "string");
	if (!valid) throw new OAuthError("invalid_response", response.status);
	return createTokenSet({
		accessToken: access_token,
		tokenType: "Bearer",
		expiresAt: expires_in === undefined ? undefined : requestStart + expires_in * 1000,
		refreshToken: refresh_token,
		scope,
	});
}

/**
 * Adds client authentication to a token-endpoint request (SEC-E7, DEC-11): `client_id` in
 * the body for a public client, or HTTP Basic with the form-urlencoded id and secret.
 */
export function clientAuthentication(
	server: AuthServer,
	body: URLSearchParams,
): Record<string, string> {
	const { clientSecret } = serverInternals(server);
	if (clientSecret === undefined) {
		body.set("client_id", server.clientId);
		return {};
	}
	const encode = (value: string) => new URLSearchParams({ v: value }).toString().slice(2);
	const credentials = Buffer.from(`${encode(server.clientId)}:${encode(clientSecret)}`).toString(
		"base64",
	);
	return { authorization: `Basic ${credentials}` };
}

/** POSTs a form to a token-style endpoint (SEC-E1): the endpoint URL is used exactly as configured. */
export function postForm(
	server: AuthServer,
	fetchImpl: Fetch,
	endpoint: string,
	body: URLSearchParams,
	options: { signal?: AbortSignal; timeoutMs?: number },
): Promise<JsonResponse> {
	const headers = {
		"content-type": "application/x-www-form-urlencoded",
		...clientAuthentication(server, body),
	};
	return requestJson(fetchImpl, endpoint, { method: "POST", headers, body }, options);
}

/** Creates the token-endpoint client of a discovered server (SEC-E1–E8). */
export function createTokenClient(
	server: AuthServer,
	options: { fetch?: Fetch } = {},
): TokenClient {
	serverInternals(server);
	const fetchImpl = options.fetch ?? fetch;
	const grant = async (body: URLSearchParams, signal: AbortSignal | undefined) => {
		const requestStart = Date.now();
		const response = await postForm(server, fetchImpl, server.tokenEndpoint, body, { signal });
		return parseTokenResponse(response, requestStart);
	};
	return Object.freeze({
		async exchangeCode(session, code, { signal } = {}) {
			const internals = sessionInternals(session);
			if (session.server !== server) {
				throw new OAuthConfigError("server-mismatch", "The session belongs to another server");
			}
			if (typeof code !== "string" || code === "") {
				throw new OAuthConfigError("invalid-option", "code must be a non-empty string");
			}
			// One exchange per session, even after a failed one: the code may be spent (SEC-E2).
			if (internals.exchanged) {
				throw new OAuthConfigError("already-used", "This session's code was already exchanged");
			}
			internals.exchanged = true;
			const body = new URLSearchParams({
				grant_type: "authorization_code",
				code,
				redirect_uri: session.redirectUri,
				code_verifier: internals.verifier,
			});
			for (const resource of internals.resource) body.append("resource", resource);
			return grant(body, signal);
		},
		async refresh(refreshToken, { scope, resource, signal } = {}) {
			if (typeof refreshToken !== "string" || refreshToken === "") {
				throw new OAuthConfigError("invalid-option", "refreshToken must be a non-empty string");
			}
			const body = new URLSearchParams({
				grant_type: "refresh_token",
				refresh_token: refreshToken,
			});
			if (checkScope(scope) !== undefined) body.set("scope", scope as string);
			for (const value of checkResources(resource)) body.append("resource", value);
			return grant(body, signal);
		},
		async revoke(token, { tokenTypeHint, signal } = {}) {
			if (!server.revocationEndpoint) {
				throw new OAuthConfigError("unsupported", "The server has no revocation endpoint");
			}
			if (typeof token !== "string" || token === "") {
				throw new OAuthConfigError("invalid-option", "token must be a non-empty string");
			}
			const body = new URLSearchParams({ token });
			if (tokenTypeHint !== undefined) body.set("token_type_hint", tokenTypeHint);
			const response = await postForm(server, fetchImpl, server.revocationEndpoint, body, {
				signal,
				timeoutMs: REVOCATION_TIMEOUT_MS,
			});
			// RFC 7009 §2.2: 200 is success and the body is not read.
			if (response.status !== 200) throw oauthFailure(response);
		},
	} satisfies TokenClient);
}
