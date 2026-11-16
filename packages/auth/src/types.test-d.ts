// Compile-time contracts, enforced by check:types (not vp test).

import type { AuthError, AuthErrorCode, OAuthError } from "./errors.ts";
import type { Pkce } from "./pkce.ts";
import type {
	AuthClient,
	AuthorizationSession,
	AuthorizationSessionOptions,
	AuthServer,
	DeviceFlowOptions,
	TokenClient,
	TokenSet,
} from "./types.ts";

type Equal<A, B> =
	(<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Expect<T extends true> = T;

// The exchange takes the session and a code; no redirect URI or endpoint.
export type ExchangeTakesOnlySessionCodeAndSignal = Expect<
	Equal<
		Parameters<TokenClient["exchangeCode"]>,
		[session: AuthorizationSession, code: string, options?: { signal?: AbortSignal }]
	>
>;

// No response type, response mode, PKCE method or nonce option.
export type SessionOptionKeys = Expect<
	Equal<
		keyof AuthorizationSessionOptions,
		"hosts" | "ports" | "scope" | "resource" | "extra" | "signal"
	>
>;
export type DeviceOptionKeys = Expect<
	Equal<keyof DeviceFlowOptions, "scope" | "resource" | "signal" | "fetch">
>;
export type OnlyS256 = Expect<Equal<Pkce["method"], "S256">>;

// Only bearer tokens.
export type OnlyBearer = Expect<Equal<TokenSet["tokenType"], "Bearer">>;

// Hosts are the two loopback literals.
export type LoopbackHosts = Expect<
	Equal<NonNullable<AuthorizationSessionOptions["hosts"]>[number], "127.0.0.1" | "::1">
>;

declare const session: AuthorizationSession;
declare const server: AuthServer;

// The session and the server are read-only.
// @ts-expect-error -- readonly
session.redirectUri = "http://evil.example/cb";
// @ts-expect-error -- readonly
session.state = "x";
// @ts-expect-error -- readonly
server.tokenEndpoint = "https://evil.example/token";
// @ts-expect-error -- the verifier is not on the session
void session.verifier;

declare const auth: AuthClient;
declare const onUrl: Parameters<AuthClient["login"]>[0]["onUrl"];
declare const onCode: Parameters<AuthClient["login"]>[0]["onCode"];

// login() has no default output: both callbacks are required.
void auth.login({ onUrl, onCode });
// @ts-expect-error -- onUrl is required
void auth.login({ onCode });
// @ts-expect-error -- onCode is required
void auth.login({ onUrl });
// @ts-expect-error -- the options are required
void auth.login();

// The prompt never carries the device code.
export type NoDeviceCodeInPrompt = Expect<
	Equal<
		keyof Parameters<typeof onCode>[0],
		"userCode" | "verificationUri" | "verificationUriComplete" | "expiresAt" | "message"
	>
>;

declare const error: AuthError;
// A misspelled code does not compile; a real one narrows.
// @ts-expect-error -- not an AuthErrorCode
void (error.code === "login-requird");
const narrowed = (caught: AuthError): "login-requires-interaction" | undefined =>
	caught.code === "login-requires-interaction" ? caught.code : undefined;
void narrowed;
export type ProtocolCodesAreAuthErrorCodes = Expect<
	Equal<Extract<AuthErrorCode, OAuthError["code"]>, OAuthError["code"]>
>;
