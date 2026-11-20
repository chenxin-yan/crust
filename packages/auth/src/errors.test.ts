import { inspect } from "node:util";

import { describe, expect, it } from "vite-plus/test";

import {
	AbortError,
	AuthError,
	CredentialKeyError,
	HttpError,
	IssuerMismatchError,
	LoginRequiredError,
	LoginRequiresInteractionError,
	NetworkError,
	OAuthConfigError,
	OAuthError,
	oauthErrorCode,
	ResponseTooLargeError,
	TimeoutError,
} from "./errors.ts";
import { oauthFailure } from "./http.ts";

describe("errors", () => {
	it.each([
		[new OAuthError("invalid_grant", 400), "OAuthError", "invalid_grant"],
		[new OAuthConfigError("unsupported", "x"), "OAuthConfigError", "oauth-config"],
		[new HttpError(502), "HttpError", "http"],
		[new IssuerMismatchError("missing"), "IssuerMismatchError", "issuer-mismatch"],
		[new NetworkError(), "NetworkError", "network"],
		[new TimeoutError(), "TimeoutError", "timeout"],
		[new AbortError(), "AbortError", "abort"],
		[new ResponseTooLargeError(), "ResponseTooLargeError", "response-too-large"],
		[new CredentialKeyError("unreadable"), "CredentialKeyError", "credential-key"],
		[
			new LoginRequiresInteractionError(),
			"LoginRequiresInteractionError",
			"login-requires-interaction",
		],
	])("%s has a stable name and code", (error, name, code) => {
		expect(error).toBeInstanceOf(AuthError);
		expect(error).toBeInstanceOf(Error);
		expect(error.name).toBe(name);
		expect(error.code).toBe(code);
	});

	it("a key error says what to do and keeps its reason", () => {
		const unreadable = new CredentialKeyError("unreadable");
		expect(unreadable.reason).toBe("unreadable");
		expect(unreadable.message).toContain("unlock");
		const unavailable = new CredentialKeyError("unavailable");
		expect(unavailable.reason).toBe("unavailable");
		expect(unavailable.message).toContain("keyring");
		expect(Object.keys(unavailable).sort()).toEqual(["code", "name", "reason"]);
	});

	it("a login-required error names the profile it was given", () => {
		expect(new LoginRequiredError("missing").message).toBe(
			"Not logged in, or the login expired; log in again",
		);
		const named = new LoginRequiredError("expired", "work");
		expect(named.reason).toBe("expired");
		expect(named.message).toBe(
			'Not logged in to profile "work", or the login expired; log in again',
		);
	});

	it("keeps allowlisted protocol codes and maps the rest to unknown", () => {
		expect(oauthErrorCode("access_denied")).toBe("access_denied");
		expect(oauthErrorCode("invalid_target")).toBe("invalid_target");
		expect(oauthErrorCode("unsupported_token_type")).toBe("unsupported_token_type");
		expect(oauthErrorCode("evil_SENTINEL")).toBe("unknown");
		expect(oauthErrorCode(42)).toBe("unknown");
		expect(oauthErrorCode("toString")).toBe("unknown");
	});

	it("keeps no remote text in any diagnostic", () => {
		const error = oauthFailure({
			status: 400,
			body: {
				error: "evil_SENTINEL",
				error_description: "SENTINEL_RT",
				error_uri: "https://SENTINEL.example",
			},
		});
		expect(error).toBeInstanceOf(OAuthError);
		expect(Object.keys(error).sort()).toEqual(["code", "name", "status"]);
		for (const printed of [
			error.message,
			error.stack,
			String(error),
			JSON.stringify(error),
			inspect(error, { depth: 10, showHidden: true }),
		]) {
			expect(printed).not.toContain("SENTINEL");
		}
		expect(error.cause).toBeUndefined();
		expect(oauthFailure({ status: 502, body: undefined })).toBeInstanceOf(HttpError);
	});
});
