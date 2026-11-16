import { clientSecretOf, DEFAULT_REDIRECT_PATH, isAuthConfig } from "./config.ts";
import { AUTHORIZATION_PARAMS, checkIssuer, checkUrl, TOKEN_ENDPOINT_PARAMS } from "./endpoint.ts";
import { HttpError, IssuerMismatchError, OAuthConfigError, OAuthError } from "./errors.ts";
import { type Fetch, jsonObject, requestJson, throwIfAborted } from "./http.ts";
import type { AuthConfig, AuthServer, DiscoverOptions } from "./types.ts";

/** What the library keeps about a discovered server off the frozen public object. */
export interface ServerInternals {
	clientSecret: string | undefined;
	/** The dev origin, when plain HTTP is allowed for this server. */
	devOrigin: string | undefined;
}

const discovered = new WeakMap<AuthServer, ServerInternals>();
// Validated metadata per issuer, for this process only; never persisted.
const metadataCache = new Map<string, Record<string, unknown>>();

/** The internals of a server from `discover()`; anything else is refused. */
export function serverInternals(server: AuthServer): ServerInternals {
	const internals = discovered.get(server);
	if (!internals) {
		throw new OAuthConfigError("unknown-server", "Pass a server returned by discover()");
	}
	return internals;
}

async function fetchMetadata(
	issuer: string,
	fetchImpl: Fetch,
	signal: AbortSignal | undefined,
): Promise<Record<string, unknown>> {
	const url = new URL(issuer);
	const path = url.pathname.replace(/\/$/, "");
	// RFC 8414 §3 inserts the well-known segment before the issuer's path; on 404 only,
	// fall back to OIDC Discovery's appended form.
	let response = await requestJson(
		fetchImpl,
		`${url.origin}/.well-known/oauth-authorization-server${path}`,
		{ method: "GET" },
		{ signal },
	);
	if (response.status === 404) {
		response = await requestJson(
			fetchImpl,
			`${issuer.replace(/\/$/, "")}/.well-known/openid-configuration`,
			{ method: "GET" },
			{ signal },
		);
	}
	if (response.status !== 200) throw new HttpError(response.status);
	const metadata = jsonObject(response.body);
	if (!metadata) throw new OAuthError("invalid_response", response.status);
	// Exact code-point comparison: no normalization, trailing slash significant.
	if (metadata.issuer !== issuer) throw new IssuerMismatchError("mismatch");
	return metadata;
}

/**
 * Fetches and validates an issuer's metadata and returns a frozen server. The
 * issuer must be declared in `config`, or `allowCustomIssuers` set and `clientId` given.
 * Metadata is cached in memory for the process.
 */
export async function discover(
	config: AuthConfig,
	issuer: string,
	options: DiscoverOptions = {},
): Promise<AuthServer> {
	throwIfAborted(options.signal);
	if (!isAuthConfig(config)) {
		throw new OAuthConfigError("invalid-option", "Pass a config returned by defineServers()");
	}
	const entry = config.servers.find((server) => server.issuer === issuer);
	if (!entry && !config.allowCustomIssuers) {
		throw new OAuthConfigError("unknown-issuer", "The issuer is not one of the configured servers");
	}
	const clientId = options.clientId ?? entry?.clientId;
	if (typeof clientId !== "string" || clientId === "") {
		throw new OAuthConfigError("invalid-option", "A custom issuer needs a non-empty clientId");
	}
	// A custom issuer never gets the dev exception, a secret or a redirect path.
	const devOrigin = checkIssuer(issuer, entry?.allowInsecureLoopback ?? false);

	const metadata =
		metadataCache.get(issuer) ??
		(await fetchMetadata(issuer, options.fetch ?? fetch, options.signal));

	const methods = metadata.code_challenge_methods_supported;
	if (methods !== undefined && !(Array.isArray(methods) && methods.includes("S256"))) {
		throw new OAuthConfigError("unsupported", "The server does not support PKCE with S256");
	}
	const optionalUrl = (name: string, reserved: ReadonlySet<string>) =>
		metadata[name] === undefined ? undefined : checkUrl(metadata[name], name, devOrigin, reserved);
	const grantTypes = metadata.grant_types_supported;
	const issParameterSupported = metadata.authorization_response_iss_parameter_supported === true;
	const singlePinned = config.servers.length === 1 && !config.allowCustomIssuers;
	const server: AuthServer = Object.freeze({
		issuer,
		clientId,
		redirectPath: entry?.redirectPath ?? DEFAULT_REDIRECT_PATH,
		authorizationEndpoint: optionalUrl("authorization_endpoint", AUTHORIZATION_PARAMS),
		tokenEndpoint: checkUrl(
			metadata.token_endpoint,
			"token_endpoint",
			devOrigin,
			TOKEN_ENDPOINT_PARAMS,
		),
		deviceAuthorizationEndpoint: optionalUrl(
			"device_authorization_endpoint",
			TOKEN_ENDPOINT_PARAMS,
		),
		revocationEndpoint: optionalUrl("revocation_endpoint", TOKEN_ENDPOINT_PARAMS),
		issParameterSupported,
		grantTypesSupported:
			Array.isArray(grantTypes) && grantTypes.every((type) => typeof type === "string")
				? Object.freeze([...grantTypes])
				: undefined,
		// An advertised iss is required first; otherwise the mix-up policy: one pinned issuer, or a path only this server uses.
		issPolicy: issParameterSupported
			? "required"
			: singlePinned || entry?.redirectPath !== undefined
				? "compare-if-present"
				: "unprotected",
	});
	metadataCache.set(issuer, metadata);
	discovered.set(server, { clientSecret: entry && clientSecretOf(entry), devOrigin });
	return server;
}
