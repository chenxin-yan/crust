import { inspect } from "node:util";

import { describe, expect, it } from "vite-plus/test";

import {
	AbortError,
	AuthError,
	HttpError,
	IssuerMismatchError,
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
		[
			new LoginRequiresInteractionError(),
			"LoginRequiresInteractionError",
			"login-requires-interaction",
		],
	])("SEC-O1 %s has a stable name and code", (error, name, code) => {
		expect(error).toBeInstanceOf(AuthError);
		expect(error).toBeInstanceOf(Error);
		expect(error.name).toBe(name);
		expect(error.code).toBe(code);
	});

	it("SEC-K2 keeps allowlisted protocol codes and maps the rest to unknown", () => {
		expect(oauthErrorCode("access_denied")).toBe("access_denied");
		expect(oauthErrorCode("invalid_target")).toBe("invalid_target");
		expect(oauthErrorCode("unsupported_token_type")).toBe("unsupported_token_type");
		expect(oauthErrorCode("evil_SENTINEL")).toBe("unknown");
		expect(oauthErrorCode(42)).toBe("unknown");
		expect(oauthErrorCode("toString")).toBe("unknown");
	});

	it("SEC-K2 SEC-E4 keeps no remote text in any diagnostic", () => {
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
