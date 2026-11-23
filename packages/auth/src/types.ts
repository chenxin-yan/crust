import type { Fetch } from "./http.ts";

export type { Fetch } from "./http.ts";

/** One authorization server your CLI signs in with, as passed to `defineServers()`. */
export interface AuthServerOptions {
	/** Issuer identifier: an `https` URL with no query, fragment or user info. */
	issuer: string;
	/** Your CLI's client id, registered at the server as a public client. */
	clientId: string;
	/**
	 * Only for servers that insist on one. A secret shipped inside a CLI is not confidential
	 * and does not make the client confidential.
	 */
	clientSecret?: string;
	/**
	 * Loopback callback path registered with this server only, such as `/acme/callback`: plain
	 * ASCII a browser sends unchanged (no `%`, query, fragment, dot or empty segments).
	 * Unique among `servers`; with several servers it protects a server that sends no `iss`.
	 * Defaults to `/callback`.
	 */
	redirectPath?: string;
	/**
	 * Development only: allow plain `http` when the issuer is `http://127.0.0.1:<port>` or
	 * `http://[::1]:<port>` and every endpoint and verification URL is on that same origin.
	 * Set it in code; nothing reads it from the environment.
	 * @default false
	 */
	allowInsecureLoopback?: boolean;
}

/** Options of `defineServers()`. */
export interface DefineServersOptions {
	/** Every authorization server the CLI may use. Declare them in code, never from env. */
	servers: readonly AuthServerOptions[];
	/**
	 * Allow issuers that are not in `servers` (profiles in a later release). Makes the CLI
	 * multi-server: every server must then send `iss` or use its own `redirectPath`.
	 * @default false
	 */
	allowCustomIssuers?: boolean;
}

/** A declared server as kept in {@link AuthConfig}. The client secret is held privately. */
export interface AuthServerEntry {
	readonly issuer: string;
	readonly clientId: string;
	readonly redirectPath: string | undefined;
	readonly allowInsecureLoopback: boolean;
}

/** The validated, frozen result of `defineServers()`. */
export interface AuthConfig {
	readonly servers: readonly AuthServerEntry[];
	readonly allowCustomIssuers: boolean;
}

/**
 * How an authorization response's `iss` is checked:
 * - `"required"`: the response must carry `iss`, equal to the issuer;
 * - `"compare-if-present"`: a present `iss` must equal the issuer (one pinned server, or a distinct `redirectPath`);
 * - `"unprotected"`: browser login is refused with `mix-up-unprotected`.
 */
export type IssPolicy = "required" | "compare-if-present" | "unprotected";

/** A discovered authorization server, frozen. Created only by `discover()`. */
export interface AuthServer {
	readonly issuer: string;
	readonly clientId: string;
	/** The loopback callback path a browser login listens on. */
	readonly redirectPath: string;
	/** `undefined` for a device-only server. */
	readonly authorizationEndpoint: string | undefined;
	readonly tokenEndpoint: string;
	readonly deviceAuthorizationEndpoint: string | undefined;
	readonly revocationEndpoint: string | undefined;
	/**
	 * The OpenID Connect user-info address (`userinfo_endpoint`), for your own request with the
	 * access token as a bearer token; `undefined` when the metadata lists none.
	 */
	readonly userinfoEndpoint: string | undefined;
	/** Metadata `authorization_response_iss_parameter_supported`. */
	readonly issParameterSupported: boolean;
	readonly grantTypesSupported: readonly string[] | undefined;
	readonly issPolicy: IssPolicy;
}

/** Options of `discover()`. */
export interface DiscoverOptions {
	signal?: AbortSignal;
	/** Use this client id instead of the declared one. Required for a custom issuer. */
	clientId?: string;
	fetch?: Fetch;
}

/**
 * Tokens from a token response. `toJSON()` and `util.inspect()` print `[Redacted]`;
 * a spread copy or the bare strings are not protected.
 */
export interface TokenSet {
	readonly accessToken: string;
	/** Only bearer tokens are accepted. */
	readonly tokenType: "Bearer";
	/** Epoch milliseconds, from the request start; `undefined` when the server sent no `expires_in`. */
	readonly expiresAt: number | undefined;
	readonly refreshToken: string | undefined;
	readonly scope: string | undefined;
}

/** Options of `createAuthorizationSession()`. */
export interface AuthorizationSessionOptions {
	/**
	 * Loopback addresses to try in order; the first that binds is used. Register a redirect
	 * URI for each one you list.
	 * @default ["127.0.0.1"]
	 */
	hosts?: readonly ("127.0.0.1" | "::1")[];
	/**
	 * Ports to try in order. `0` picks a free port, which every compliant server accepts.
	 * @default [0]
	 */
	ports?: readonly number[];
	/** Space-separated scopes. Omitted from the request when unset. */
	scope?: string;
	/** RFC 8707 resource indicators: absolute URIs without a fragment. */
	resource?: string | readonly string[];
	/** Extra authorization request parameters. Library-managed names are refused. */
	extra?: Readonly<Record<string, string>>;
	signal?: AbortSignal;
}

/** What a custom result page receives: never a code, URL or server text. */
export interface CallbackPageView {
	outcome: "success" | "failure";
	/** An allowlisted OAuth error code when the server returned one. */
	errorCode?: string;
}

/** Options of `AuthorizationSession.wait()`. */
export interface WaitOptions {
	/** @default 300000 (5 minutes) */
	timeoutMs?: number;
	signal?: AbortSignal;
	/** Renders the browser result page; the library sets every header. A throw serves the default page. */
	page?: (view: CallbackPageView) => string;
}

/** One browser login: a loopback listener, `state`, PKCE and the issuer, frozen together. */
export interface AuthorizationSession {
	readonly issuer: string;
	readonly clientId: string;
	/** `http://127.0.0.1:<port><path>` or `http://[::1]:<port><path>`. */
	readonly redirectUri: string;
	/** Open or print this URL. It carries `state` and the PKCE challenge, which are not secrets. */
	readonly url: string;
	readonly state: string;
	readonly server: AuthServer;
	/**
	 * Waits for the browser callback and runs `onCallback` with its code once, then serves the
	 * result page and closes the listener. Rejects on timeout, abort or an error response.
	 */
	wait<T>(
		onCallback: (callback: { code: string }) => Promise<T>,
		options?: WaitOptions,
	): Promise<T>;
	/** Closes the listener. A pending `wait()` rejects with `AbortError`. */
	close(): void;
}

/** A started device login (RFC 8628). The device code itself is never exposed. */
export interface DeviceFlow {
	/** Sanitized for display. Always show it, even with `verificationUriComplete`. */
	readonly userCode: string;
	readonly verificationUri: string;
	readonly verificationUriComplete: string | undefined;
	/** Epoch milliseconds after which the code is no longer valid. */
	readonly expiresAt: number;
	/** Polls the token endpoint until the user approves, denies or the code expires. Call once. */
	poll(options?: { signal?: AbortSignal }): Promise<TokenSet>;
}

/** Options of `startDeviceFlow()`. */
export interface DeviceFlowOptions {
	scope?: string;
	resource?: string | readonly string[];
	signal?: AbortSignal;
	fetch?: Fetch;
}

/** The token endpoint client of one server. */
export interface TokenClient {
	/** Exchanges the code from `session.wait()`, using the session's redirect URI and verifier. Once per session. */
	exchangeCode(
		session: AuthorizationSession,
		code: string,
		options?: { signal?: AbortSignal },
	): Promise<TokenSet>;
	/** Sends a refresh-token grant. */
	refresh(
		refreshToken: string,
		options?: { scope?: string; resource?: string | readonly string[]; signal?: AbortSignal },
	): Promise<TokenSet>;
	/** Revokes a token (RFC 7009). HTTP 200 is success whatever the body says. */
	revoke(
		token: string,
		options?: { tokenTypeHint?: "refresh_token" | "access_token"; signal?: AbortSignal },
	): Promise<void>;
}

/** Input of `detectLoginMode()`. */
export interface LoginModeOptions {
	/** The user passed `--device`. */
	device?: boolean;
	/** The user passed `--no-browser`. */
	noBrowser?: boolean;
	/** @default process.env */
	env?: Readonly<Record<string, string | undefined>>;
	/** @default process.platform */
	platform?: string;
	/** @default process.stdin */
	stdin?: { readonly isTTY?: boolean };
	/** @default process.stdout */
	stdout?: { readonly isTTY?: boolean };
	/** @default process.stderr */
	stderr?: { readonly isTTY?: boolean };
}

/** Which login to run: a loopback browser login, a device-code login, or none. */
export type LoginMode = "browser" | "device" | "refuse";

/** Options of `createAuth()`: the one authorization server your CLI signs in with. */
export interface CreateAuthOptions extends AuthServerOptions {
	/**
	 * Your CLI's name, such as `acme`: a non-empty name without path separators. The login is
	 * stored in its state directory.
	 */
	app: string;
	/**
	 * The API origins the stored login's token may be sent to, such as
	 * `["https://api.acme.example"]`: `https` (plain `http` only on a development server's
	 * origin). Set them in code, never from env. A token from `env` is not checked against them.
	 */
	apiOrigins: readonly string[];
	/**
	 * An environment variable, such as `ACME_TOKEN`, whose value (trimmed) wins over the stored
	 * login when it is not blank.
	 */
	env?: string;
	/** Space-separated scopes every login asks for. Omitted from the request when unset. */
	scope?: string;
	/**
	 * RFC 8707 resource indicators every login asks tokens for, such as your API's URI:
	 * absolute URIs without a fragment. Omitted from the request when unset.
	 */
	resource?: string | readonly string[];
	/** The name the device-login message shows. @default app */
	name?: string;
	/** Loopback addresses the browser login tries in order. @default ["127.0.0.1"] */
	hosts?: AuthorizationSessionOptions["hosts"];
	/** Loopback ports the browser login tries in order; `0` picks a free one. @default [0] */
	ports?: AuthorizationSessionOptions["ports"];
	/** The `fetch` used for every request to the server. @default globalThis.fetch */
	fetch?: Fetch;
	/**
	 * Refuse to store a login without an OS keyring, with `CredentialKeyError` (`unavailable`),
	 * instead of storing its tokens in plaintext.
	 * @default false
	 */
	strict?: boolean;
	/**
	 * Turns on profiles: named logins, such as a work account and a personal one. The client then
	 * has `profile(name)` and `profiles`. `{}` is enough.
	 */
	profiles?: ProfilesOptions;
}

/** Options of `profiles` in `createAuth()`. */
export interface ProfilesOptions {
	/**
	 * An environment variable, such as `ACME_PROFILE`, whose value (trimmed) names the current
	 * profile when it is not blank. Read at each call; it wins over the profile chosen with
	 * `profiles.use()`.
	 */
	env?: string;
}

/**
 * A notice for your CLI to show; the library prints nothing. `"plaintext-storage"`: there is no
 * OS keyring, so a login's tokens were stored in plaintext.
 */
export type AuthWarning = { readonly code: "plaintext-storage" };

/** What `onUrl` receives in a browser login. */
export interface BrowserLoginPrompt {
	/** The authorization URL to show. It carries `state` and the PKCE challenge, which are not secrets. */
	readonly url: string;
	/**
	 * Opens `url` in the system browser, best effort; show `url` as well. Resolves `false` when
	 * no browser could be launched, so you can ask the user to open the URL by hand.
	 */
	readonly open: () => Promise<boolean>;
}

/** What `onCode` receives in a device login. The device code itself is never included. */
export interface DeviceLoginPrompt {
	/** Sanitized for display. Always show it, even with `verificationUriComplete`. */
	readonly userCode: string;
	readonly verificationUri: string;
	readonly verificationUriComplete: string | undefined;
	/** Epoch milliseconds after which the code is no longer valid. */
	readonly expiresAt: number;
	/** The default instructions: the URL and its host, the code and the anti-phishing warning. */
	readonly message: string;
}

/** Options of `login()`. */
export interface LoginOptions {
	/**
	 * The login to run: `"auto"` picks one for where the CLI runs; `"device"` and `"browser"`
	 * always run that one, even on CI, such as for a `--device` or `--web` flag.
	 * @default "auto"
	 */
	flow?: "auto" | "device" | "browser";
	signal?: AbortSignal;
	/** Replaces the configured `scope` for this login. */
	scope?: string;
	/** Shows the authorization URL of a browser login, and may open it. */
	onUrl: (prompt: BrowserLoginPrompt) => void | Promise<void>;
	/** Shows the code of a device login. */
	onCode: (prompt: DeviceLoginPrompt) => void | Promise<void>;
	/** Renders the browser result page; a throw serves the default page. */
	page?: (view: CallbackPageView) => string;
	/** Receives what you may want to tell the user, such as this login stored in plaintext. */
	onWarning?: (warning: AuthWarning) => void;
}

/** Options of `login()` on a client with `profiles`. */
export interface ProfileLoginOptions extends LoginOptions {
	/**
	 * The profile the login is stored as, instead of the current one. A function receives the
	 * new tokens after sign-in, such as to ask your API for the account name, and returns the
	 * name; nothing is stored when it throws or returns an invalid name.
	 */
	profile?: string | ((tokens: TokenSet) => string | Promise<string>);
}

/** Options of `token()`. */
export interface TokenOptions {
	signal?: AbortSignal;
	/** The API URL the token is for: the stored login's token is returned only for `apiOrigins`. */
	baseUrl?: string;
	/** Receives what you may want to tell the user, such as a refreshed login stored in plaintext. */
	onWarning?: (warning: AuthWarning) => void;
}

/** The token `token()` returns. Its `value` prints as `[Redacted]`. */
export interface AuthToken {
	readonly value: string;
	/** `"env"`: the `env` variable; `"login"`: the stored login. */
	readonly source: "env" | "login";
	/** Only for the stored login: refreshes it unless it already changed (for a 401). */
	readonly refresh?: (options: { signal?: AbortSignal }) => Promise<AuthToken>;
}

/** What `status()` reports, read without a request, a refresh or a lock. */
export interface AuthStatus {
	readonly source: "env" | "login" | "none";
	/** The stored login's expiry, in epoch milliseconds, when the server sent one. */
	readonly expiresAt?: number;
	/** The scope the server granted the stored login. */
	readonly scope?: string;
	/** Where stored logins are kept; absent for `"env"`, which reads no file or keyring. */
	readonly storage?: {
		/** The OS keyring holding the file's key, or `"file"` when tokens are stored in plaintext. */
		readonly kind: CredentialStoreStatus["kind"];
		/** Stored logins whose tokens are still plaintext, until their next login or refresh. */
		readonly plaintextRecords: number;
	};
}

/** What `status()` reports on a client with `profiles`. */
export interface ProfileAuthStatus extends AuthStatus {
	/**
	 * The profile and why it was picked: `"argument"`, the name given to `profile()`; `"env"`,
	 * the profiles `env` variable; `"current"`, the one chosen with `profiles.use()`;
	 * `"default"`, none of those. Absent for `"env"`.
	 */
	readonly profile?: {
		readonly name: string;
		readonly via: "argument" | "env" | "current" | "default";
	};
}

/** The client `createAuth()` returns. Its methods work detached from it. */
export interface AuthClient {
	/**
	 * Signs in and stores the login. With `flow: "auto"`: a browser login on a desktop, a device
	 * login elsewhere, and `LoginRequiresInteractionError` on CI or without a terminal. A logout
	 * that runs meanwhile is not undone: the login then fails with `StaleCommitError`.
	 */
	readonly login: (options: LoginOptions) => Promise<void>;
	/**
	 * The token to send: the `env` variable's when it is set, else the stored login's, refreshed
	 * first when it is about to expire. With `baseUrl`, the stored login's token is returned only
	 * when its origin is one of `apiOrigins`. No login → `LoginRequiredError`.
	 */
	readonly token: (options?: TokenOptions) => Promise<AuthToken>;
	/**
	 * Where the token would come from, the stored login's expiry and scope, and where logins are
	 * stored. Without an `env` token, reads the login file and asks the OS keyring for the key,
	 * within 5 seconds.
	 */
	readonly status: () => Promise<AuthStatus>;
	/** Deletes the stored login, then revokes it at the server as a best effort. */
	readonly logout: (options?: { signal?: AbortSignal }) => Promise<LogoutResult>;
}

/** A profile `profiles.list()` reports. */
export interface AuthProfile {
	readonly name: string;
	/** Whether it is the current profile: the one the client's own methods use. */
	readonly current: boolean;
}

/** The methods of one profile: its `status()` names the profile. */
export interface ProfileClient extends AuthClient {
	readonly status: () => Promise<ProfileAuthStatus>;
}

/**
 * The client `createAuth()` returns with `profiles`. Its own methods use the current profile:
 * the profiles `env` variable's, else the one chosen with `profiles.use()`, else `"default"`.
 */
export interface ProfileAuthClient extends ProfileClient {
	/** `login()`, which may store the login as another profile than the current one. */
	readonly login: (options: ProfileLoginOptions) => Promise<void>;
	/**
	 * The same methods for the profile `name`: 1 to 64 letters, digits, `-`, `_` and `.`, not
	 * starting with `.` or `-` (else `OAuthConfigError`). No name means the current profile. A
	 * profile's first login creates it.
	 */
	readonly profile: (name?: string) => ProfileClient;
	readonly profiles: {
		/**
		 * The profiles with a stored login for this server and client id, by name. Reads the login
		 * file only: no request, refresh, lock or keyring.
		 */
		readonly list: () => Promise<readonly AuthProfile[]>;
		/**
		 * Remembers `name` as the current profile. A profile without a stored login →
		 * `LoginRequiredError`. Its logout forgets it again.
		 */
		readonly use: (name: string, options?: { signal?: AbortSignal }) => Promise<void>;
	};
}

/** Options of `credentialStore()`. */
export interface CredentialStoreOptions {
	/** Your CLI's name: the file goes to its state directory (`$XDG_STATE_HOME/<app>`, or the platform's). */
	app: string;
	/**
	 * File name without `.json`.
	 * @default "credentials"
	 */
	name?: string;
	/**
	 * Milliseconds to wait for a lock held by another process before failing with
	 * `LockTimeoutError` or `LockRecoveryRequiredError`.
	 * @default 40000
	 */
	lockTimeout?: number;
	/**
	 * Encrypt the tokens with a key kept in the OS keyring. Without this option, tokens are
	 * stored in plaintext and no keyring is used.
	 */
	keyring?: KeyringOptions;
}

/** Options of the OS keyring that keeps the credentials file's key. */
export interface KeyringOptions {
	/**
	 * Without a keyring, refuse to store a secret (`CredentialKeyError`, `unavailable`) instead of
	 * storing it in plaintext.
	 * @default false
	 */
	strict?: boolean;
	/** Called once per process when a secret is stored in plaintext for want of a keyring. */
	onWarning?: (warning: AuthWarning) => void;
}

/** Where a credentials file's secrets are, as `status()` reports it. */
export interface CredentialStoreStatus {
	/**
	 * The OS keyring holding the file's key: `"bun-secrets"` or `"napi-keyring"`; `"file"` when
	 * there is none, so secrets are written in plaintext.
	 */
	readonly kind: "bun-secrets" | "napi-keyring" | "file";
	/** `"aes-256-gcm"` once a secret was encrypted; the file then never takes plaintext. */
	readonly encryption: "plaintext" | "aes-256-gcm";
	/** Whether the keyring answered with a valid key, the file's own when it records one. */
	readonly keyReadable: boolean;
	/** Live records whose secret is still plaintext, until their next login or refresh. */
	readonly plaintextRecords: number;
}

/** The private credentials file of an app, shared by its token sources. */
export interface CredentialStore {
	/** Absolute path of the file. */
	readonly path: string;
	/** Where the file's secrets are. Reads the file and the keyring (within 5 seconds); never writes. */
	status(options?: { signal?: AbortSignal }): Promise<CredentialStoreStatus>;
	/**
	 * Without `key`, deletes the file (a corrupt one too) and every login in it. Copy the file
	 * first to keep it. With `key` (a token source's `key`), replaces that credential with a
	 * logged-out record. Waiting for the lock is cancellable; the delete or write is not.
	 */
	resetCredentials(options?: { key?: string; signal?: AbortSignal }): Promise<void>;
}

/** Which login a token source reads and writes: stored with the tokens and checked on every use. */
export interface CredentialIdentity {
	/** A server of the config, or any issuer with `allowCustomIssuers`. */
	issuer: string;
	clientId: string;
	/** @default "default" */
	profile?: string;
	/**
	 * The API origins the token may be sent to, such as `["https://api.example.com"]`: `https`
	 * (plain `http` only on a development server's origin). Set them in code, never from env.
	 */
	apiOrigins: readonly string[];
}

/** Options of `createTokenSource()`. */
export interface TokenSourceOptions {
	config: AuthConfig;
	identity: CredentialIdentity;
	store: CredentialStore;
	/**
	 * Refresh this many milliseconds before the access token expires.
	 * @default 30000
	 */
	skewMs?: number;
	fetch?: Fetch;
}

/** An access token and the generation of the credential it came from. Prints as `[Redacted]`. */
export interface AccessToken {
	readonly value: string;
	/** Changes on every login and refresh. */
	readonly generation: string;
}

/** A stored credential, as committed by a login. Its tokens print as `[Redacted]`. */
export interface Credential {
	readonly identity: Readonly<Required<CredentialIdentity>>;
	readonly accessToken: string;
	readonly refreshToken: string | undefined;
	readonly expiresAt: number | undefined;
	readonly scope: string | undefined;
	readonly resource: readonly string[] | undefined;
	readonly tokenType: "Bearer";
	readonly generation: string;
	/**
	 * Logins this one logged out: when the keyring no longer held the file's key, every login
	 * stored under that old key, whichever identity it belongs to.
	 */
	readonly discarded: number;
}

/** An open login for one credential. Finish it with `commit()` or `cancel()`. */
export interface LoginTicket {
	/**
	 * Stores the tokens unless a login, logout or reset of this credential committed since
	 * `beginLogin()` (`StaleCommitError`). Pass the `resource` values the login requested. The
	 * ticket is finished afterwards, whatever the outcome.
	 */
	commit(
		tokens: TokenSet,
		options?: { resource?: readonly string[]; signal?: AbortSignal },
	): Promise<Credential>;
	/** Finishes the ticket; a commit still waiting for its lock writes nothing. Idempotent. */
	cancel(): void;
}

/** `logout()`'s outcome: the local logout and the revocation at the server, reported apart. */
export interface LogoutResult {
	/**
	 * `"absent"`: there was no login to delete; `"failed"`: the credential is still stored and
	 * nothing was revoked.
	 */
	readonly local: "deleted" | "absent" | "failed";
	/**
	 * `"unsupported"`: the server has no revocation endpoint; `"unknown"`: sent, but no answer
	 * arrived; `"skipped"`: not attempted, as there was no token to revoke.
	 */
	readonly remote: "revoked" | "unsupported" | "failed" | "unknown" | "skipped";
}

/** One credential in a credential store: its tokens, refresh and lifecycle. */
export interface TokenSource {
	/** The credential's key in the store, for `resetCredentials({ key })`. */
	readonly key: string;
	/**
	 * The access token, refreshed first when it expires within `skewMs`. Concurrent refreshes
	 * of one credential share one request, across token sources and processes. With `baseUrl`,
	 * its origin must be one of the credential's `apiOrigins`.
	 */
	get(options?: { signal?: AbortSignal; baseUrl?: string }): Promise<AccessToken>;
	/**
	 * Refreshes now, for a 401. With `ifGeneration`, a credential that changed since that
	 * generation is returned as is, without a request.
	 */
	forceRefresh(options?: {
		signal?: AbortSignal;
		ifGeneration?: string;
		baseUrl?: string;
	}): Promise<AccessToken>;
	/** Opens a login. One per credential at a time in a process (`LoginInProgressError`). */
	beginLogin(options?: { signal?: AbortSignal }): Promise<LoginTicket>;
	/** Logs out locally, then revokes the tokens at the server as a best effort. */
	logout(options?: { signal?: AbortSignal }): Promise<LogoutResult>;
}
