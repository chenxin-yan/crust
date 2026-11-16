import type { Fetch } from "./http.ts";

export type { Fetch } from "./http.ts";

/** One authorization server your CLI signs in with, as passed to `defineAuth()`. */
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

/** Options of `defineAuth()`. */
export interface DefineAuthOptions {
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

/** The validated, frozen result of `defineAuth()`. */
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
