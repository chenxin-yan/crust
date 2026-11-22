// Every error carries local text, a stable `code` and, where it applies, an HTTP `status`.
// Remote text (`error_description`, `error_uri`, bodies, headers, URLs with a query) never
// reaches a message, property or `cause`: an authorization server can echo secrets.

/**
 * Protocol error codes kept verbatim from an authorization server; any other code becomes
 * `"unknown"`. RFC 6749 §4.1.2.1 and §5.2, RFC 8628 §3.5, RFC 8707 §2, RFC 7009 §2.2.1.
 */
export const OAUTH_ERROR_CODES = [
	"invalid_request",
	"unauthorized_client",
	"access_denied",
	"unsupported_response_type",
	"invalid_scope",
	"server_error",
	"temporarily_unavailable",
	"invalid_client",
	"invalid_grant",
	"unsupported_grant_type",
	"authorization_pending",
	"slow_down",
	"expired_token",
	"invalid_target",
	"unsupported_token_type",
] as const;

/**
 * An allowlisted protocol code, `"unknown"` for any other remote code, or `"invalid_response"`
 * when the server's response breaks the protocol (missing or malformed fields).
 */
export type OAuthErrorCode = (typeof OAUTH_ERROR_CODES)[number] | "unknown" | "invalid_response";

/** Why a configuration or call was refused before (or instead of) contacting the server. */
export type OAuthConfigErrorReason =
	| "invalid-option"
	| "invalid-url"
	| "duplicate-issuer"
	| "duplicate-redirect-path"
	| "unknown-issuer"
	| "unknown-server"
	| "server-mismatch"
	| "reserved-parameter"
	| "duplicate-parameter"
	| "unsupported"
	| "mix-up-unprotected"
	| "loopback-unavailable"
	| "already-used";

/** Every `code` an {@link AuthError} can carry, taken from the error classes. */
export type AuthErrorCode = (
	| OAuthError
	| OAuthConfigError
	| HttpError
	| IssuerMismatchError
	| NetworkError
	| TimeoutError
	| AbortError
	| ResponseTooLargeError
	| LoginRequiresInteractionError
)["code"];

/** Base class of every error `@crustjs/auth` throws. Match on `code`, never on `message`. */
export class AuthError extends Error {
	readonly code: AuthErrorCode;

	constructor(code: AuthErrorCode, message: string) {
		super(message);
		this.name = "AuthError";
		this.code = code;
	}
}

/** The authorization server answered with an OAuth error, or broke the protocol. */
export class OAuthError extends AuthError {
	declare readonly code: OAuthErrorCode;
	/** HTTP status of the response, when the error came from an HTTP response. */
	readonly status: number | undefined;

	constructor(code: OAuthErrorCode, status?: number) {
		super(
			code,
			code === "invalid_response"
				? "The authorization server sent an invalid response"
				: `The authorization server returned an error: ${code}`,
		);
		this.name = "OAuthError";
		this.status = status;
	}
}

/** Maps a remote `error` value to an allowlisted {@link OAuthErrorCode}. */
export function oauthErrorCode(value: unknown): OAuthErrorCode {
	return (OAUTH_ERROR_CODES as readonly unknown[]).includes(value)
		? (value as OAuthErrorCode)
		: "unknown";
}

/** A configuration, option or server value was refused. */
export class OAuthConfigError extends AuthError {
	declare readonly code: "oauth-config";
	readonly reason: OAuthConfigErrorReason;

	constructor(reason: OAuthConfigErrorReason, message: string) {
		super("oauth-config", message);
		this.name = "OAuthConfigError";
		this.reason = reason;
	}
}

/** The authorization server answered with an HTTP status that carried no OAuth error. */
export class HttpError extends AuthError {
	declare readonly code: "http";
	readonly status: number;

	constructor(status: number) {
		super("http", `The authorization server answered with HTTP ${status}`);
		this.name = "HttpError";
		this.status = status;
	}
}

/** The issuer in metadata or an authorization response did not match the expected issuer. */
export class IssuerMismatchError extends AuthError {
	declare readonly code: "issuer-mismatch";
	readonly reason: "mismatch" | "missing";

	constructor(reason: "mismatch" | "missing") {
		super(
			"issuer-mismatch",
			reason === "missing"
				? "The authorization response has no issuer (iss), which this server requires"
				: "The issuer does not match the expected authorization server",
		);
		this.name = "IssuerMismatchError";
		this.reason = reason;
	}
}

/**
 * The request could not be sent or its response not read: DNS, connection, TLS or a broken
 * response stream. The underlying error is dropped: it can quote what was sent.
 */
export class NetworkError extends AuthError {
	declare readonly code: "network";

	constructor() {
		super("network", "Could not reach the authorization server");
		this.name = "NetworkError";
	}
}

/** An operation ran past its deadline. */
export class TimeoutError extends AuthError {
	declare readonly code: "timeout";

	constructor(message = "The operation timed out") {
		super("timeout", message);
		this.name = "TimeoutError";
	}
}

/** The caller's `AbortSignal` cancelled the operation. */
export class AbortError extends AuthError {
	declare readonly code: "abort";

	constructor() {
		super("abort", "The operation was aborted");
		this.name = "AbortError";
	}
}

/** A response body exceeded the size cap. */
export class ResponseTooLargeError extends AuthError {
	declare readonly code: "response-too-large";

	constructor() {
		super("response-too-large", "The authorization server's response is too large");
		this.name = "ResponseTooLargeError";
	}
}

/**
 * Login needs a person at a terminal but none is available. Throw it when
 * `detectLoginMode()` returns `"refuse"`.
 */
export class LoginRequiresInteractionError extends AuthError {
	declare readonly code: "login-requires-interaction";

	constructor(
		message = "Login needs a terminal. Run it in a terminal, choose the device login explicitly, or set a token in the environment.",
	) {
		super("login-requires-interaction", message);
		this.name = "LoginRequiresInteractionError";
	}
}
