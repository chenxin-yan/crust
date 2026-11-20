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
	| CredentialMismatchError
	| LoginRequiredError
	| LoginInProgressError
	| StaleCommitError
	| RefreshFailedError
	| RefreshOutcomeUnknownError
	| UnsafeStorageError
	| CredentialStoreCorruptError
	| CredentialKeyError
	| LockTimeoutError
	| LockRecoveryRequiredError
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

/** Which part of a stored credential's identity differs from the configured one. */
export type CredentialMismatchReason = "issuer" | "client" | "profile" | "origin";

/**
 * The stored credential belongs to another issuer, client, profile or set of API origins, or
 * the API's base URL is not one of its origins. Nothing was sent.
 */
export class CredentialMismatchError extends AuthError {
	declare readonly code: "credential-mismatch";
	readonly reason: CredentialMismatchReason;

	constructor(reason: CredentialMismatchReason) {
		super(
			"credential-mismatch",
			reason === "origin"
				? "The stored login is not for this API's origin; log in again"
				: `The stored login is for another ${reason === "client" ? "client id" : reason}; log in again`,
		);
		this.name = "CredentialMismatchError";
		this.reason = reason;
	}
}

/**
 * Why a login is needed:
 * - `"missing"`: no credential is stored, or it was logged out;
 * - `"expired"`: the access token expired and there is no refresh token;
 * - `"invalid-grant"`: the server refused the refresh token;
 * - `"store-changed"`: the credentials file was reset while a refresh ran, so its tokens were discarded;
 * - `"key-missing"`: the login is encrypted, and the OS keyring no longer holds the file's key;
 * - `"key-mismatch"`: the login is encrypted, and the OS keyring holds another key than the file's;
 * - `"key-other-keyring"`: the login is encrypted under a key the other runtime's keyring holds
 *   (`Bun.secrets` or `@napi-rs/keyring`), which this runtime can't reach.
 */
export type LoginRequiredReason =
	| "missing"
	| "expired"
	| "invalid-grant"
	| "store-changed"
	| "key-missing"
	| "key-mismatch"
	| "key-other-keyring";

/** There is no usable credential: the user must log in. */
export class LoginRequiredError extends AuthError {
	declare readonly code: "login-required";
	readonly reason: LoginRequiredReason;

	constructor(reason: LoginRequiredReason) {
		super("login-required", "Not logged in, or the login expired; log in again");
		this.name = "LoginRequiredError";
		this.reason = reason;
	}
}

/** Another login for the same credential is open in this process. */
export class LoginInProgressError extends AuthError {
	declare readonly code: "login-in-progress";

	constructor() {
		super("login-in-progress", "Another login for this credential is in progress");
		this.name = "LoginInProgressError";
	}
}

/**
 * A login, logout or reset committed after this login began, so its tokens were not stored.
 * Start the login again.
 */
export class StaleCommitError extends AuthError {
	declare readonly code: "stale-commit";

	constructor() {
		super("stale-commit", "The credential changed while this login ran; nothing was stored");
		this.name = "StaleCommitError";
	}
}

/**
 * A refresh failed before the server could have rotated the refresh token, so the stored
 * credential is unchanged and a later refresh may succeed.
 */
export class RefreshFailedError extends AuthError {
	declare readonly code: "refresh-failed";

	constructor() {
		super("refresh-failed", "Could not refresh the login; try again");
		this.name = "RefreshFailedError";
	}
}

/**
 * A refresh was sent and its outcome is unknown: the server may have rotated the refresh
 * token. It is never retried automatically; only a new login (or a logout) clears it.
 */
export class RefreshOutcomeUnknownError extends AuthError {
	declare readonly code: "refresh-outcome-unknown";

	constructor() {
		super(
			"refresh-outcome-unknown",
			"An earlier token refresh did not finish, so the login can't be used safely; log in again",
		);
		this.name = "RefreshOutcomeUnknownError";
	}
}

/** The credentials directory or file is unsafe: a symbolic link, another user's, or a directory others can write to. */
export class UnsafeStorageError extends AuthError {
	declare readonly code: "unsafe-storage";
	readonly path: string;

	constructor(path: string) {
		super(
			"unsafe-storage",
			`Refusing to use ${path}: the directory must be yours and not writable by other users, and neither it nor the file may be a symbolic link`,
		);
		this.name = "UnsafeStorageError";
		this.path = path;
	}
}

/**
 * The credentials file, or one record of it (`key`), can't be read. Nothing is changed
 * automatically; `resetCredentials()` deletes the file, or tombstones the record.
 */
export class CredentialStoreCorruptError extends AuthError {
	declare readonly code: "credential-store-corrupt";
	readonly path: string;
	/** The record that is invalid; `undefined` when the whole file is. */
	readonly key: string | undefined;

	constructor(path: string, options: { key?: string; newerVersion?: boolean } = {}) {
		super(
			"credential-store-corrupt",
			options.newerVersion
				? `${path} was written by a newer version of this CLI; update it`
				: options.key === undefined
					? `${path} is corrupt; reset the credentials and log in again`
					: `The credential ${options.key} in ${path} is corrupt; reset it and log in again`,
		);
		this.name = "CredentialStoreCorruptError";
		this.path = path;
		this.key = options.key;
	}
}

/**
 * The OS keyring's file key can't be used:
 * - `"unreadable"`: the login is encrypted, and the keyring did not answer, refused, or holds an
 *   invalid key. Nothing was changed: unlock the keyring and retry;
 * - `"unavailable"`: a secret must be stored and the keyring can't take the key (`strict` with no
 *   keyring, or a key write that failed or timed out). Nothing was stored.
 */
export class CredentialKeyError extends AuthError {
	declare readonly code: "credential-key";
	readonly reason: "unavailable" | "unreadable";

	constructor(reason: "unavailable" | "unreadable") {
		super(
			"credential-key",
			reason === "unreadable"
				? "Can't read the login's key from the OS keyring; unlock the keyring and try again"
				: "Can't store the login's key in the OS keyring, so the login was not stored",
		);
		this.name = "CredentialKeyError";
		this.reason = reason;
	}
}

/** The owner a lock file names. */
export interface LockOwner {
	readonly ownerId: string;
	readonly pid: number;
	readonly host: string;
	readonly platform: string;
	/** ISO 8601. */
	readonly createdAt: string;
}

/** A credentials lock was not acquired before its deadline: its owner is still running. */
export class LockTimeoutError extends AuthError {
	declare readonly code: "lock-timeout";
	/** The lock file. */
	readonly path: string;
	readonly owner: LockOwner | undefined;
	readonly manualStep: string;

	constructor(path: string, owner: LockOwner | undefined, manualStep: string) {
		super("lock-timeout", `Timed out waiting for ${path}, held by a running process`);
		this.name = "LockTimeoutError";
		this.path = path;
		this.owner = owner;
		this.manualStep = manualStep;
	}
}

/**
 * A credentials lock (or its `.recover` file) is held by an owner this process can't judge, so
 * it is never taken over automatically. Follow `manualStep`.
 */
export class LockRecoveryRequiredError extends AuthError {
	declare readonly code: "lock-recovery-required";
	/** The lock or `.recover` file to delete after `manualStep`. */
	readonly path: string;
	readonly owner: LockOwner | undefined;
	readonly manualStep: string;

	constructor(path: string, owner: LockOwner | undefined, manualStep: string) {
		super("lock-recovery-required", `${path} needs manual recovery: ${manualStep}`);
		this.name = "LockRecoveryRequiredError";
		this.path = path;
		this.owner = owner;
		this.manualStep = manualStep;
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
