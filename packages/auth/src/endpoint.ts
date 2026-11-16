import { OAuthConfigError } from "./errors.ts";

// One URL policy for every issuer, endpoint, verification URI and browser URL (SEC-B3, E1,
// H4, H8, L1, DEC-09): HTTPS, no userinfo, no fragment. Plain HTTP only on the dev origin.

/** Names the library sets on an authorization request; rejected in `extra` and the endpoint query (SEC-B1). */
export const AUTHORIZATION_PARAMS: ReadonlySet<string> = new Set([
	"response_type",
	"client_id",
	"redirect_uri",
	"state",
	"code_challenge",
	"code_challenge_method",
	"scope",
	"resource",
	"nonce",
	"response_mode",
	"request",
	"request_uri",
]);

/** Names rejected in a token, device or revocation endpoint query (SEC-E1). */
export const TOKEN_ENDPOINT_PARAMS: ReadonlySet<string> = new Set([
	"client_id",
	"client_secret",
	"code",
	"code_verifier",
	"refresh_token",
	"access_token",
	"token",
	"token_type_hint",
	"device_code",
	"grant_type",
	"redirect_uri",
	"scope",
	"resource",
]);

// URL.hostname keeps the brackets of an IPv6 literal.
const LOOPBACK_LITERALS = new Set(["127.0.0.1", "[::1]"]);

function invalid(what: string, why: string): OAuthConfigError {
	return new OAuthConfigError("invalid-url", `${what} ${why}`);
}

function parseAbsolute(value: unknown, what: string): URL {
	if (typeof value !== "string") throw invalid(what, "must be a URL string");
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		throw invalid(what, "must be an absolute URL");
	}
	if (value.includes("#")) throw invalid(what, "must not have a fragment");
	if (url.username || url.password) throw invalid(what, "must not contain a user name or password");
	return url;
}

/**
 * Validates an issuer identifier (SEC-H8) and returns its DEC-09 dev origin: the issuer's
 * own origin when `allowInsecureLoopback` is set and the issuer is `http://127.0.0.1` or
 * `http://[::1]`, otherwise `undefined` (HTTPS only).
 */
export function checkIssuer(issuer: unknown, allowInsecureLoopback: boolean): string | undefined {
	const url = parseAbsolute(issuer, "issuer");
	if ((issuer as string).includes("?")) throw invalid("issuer", "must not have a query");
	if (url.protocol === "https:") return undefined;
	if (url.protocol === "http:" && allowInsecureLoopback && LOOPBACK_LITERALS.has(url.hostname)) {
		return url.origin;
	}
	throw invalid(
		"issuer",
		"must use https (plain http only for 127.0.0.1 or [::1] with allowInsecureLoopback)",
	);
}

/**
 * Validates an endpoint or browser URL against the policy above and returns it unchanged.
 * With a dev origin, the URL must be on exactly that origin; otherwise it must be HTTPS.
 * `reserved` names, and any name repeated after decoding, are refused in its query.
 */
export function checkUrl(
	value: unknown,
	what: string,
	devOrigin: string | undefined,
	reserved?: ReadonlySet<string>,
): string {
	const url = parseAbsolute(value, what);
	if (devOrigin !== undefined ? url.origin !== devOrigin : url.protocol !== "https:") {
		throw invalid(what, devOrigin ? `must be on ${devOrigin}` : "must use https");
	}
	if (reserved) queryNames(url, what, reserved);
	return value as string;
}

/** Decoded query names of `url`, each at most once and none of them `reserved` (SEC-B1, E1). */
export function queryNames(url: URL, what: string, reserved: ReadonlySet<string>): Set<string> {
	const names = new Set<string>();
	for (const name of url.searchParams.keys()) {
		if (reserved.has(name)) {
			throw new OAuthConfigError(
				"reserved-parameter",
				`${what} must not set the "${name}" parameter`,
			);
		}
		if (names.has(name)) {
			// The name is not quoted: it can come from server metadata (SEC-K2).
			throw new OAuthConfigError("duplicate-parameter", `${what} repeats a query parameter`);
		}
		names.add(name);
	}
	return names;
}
