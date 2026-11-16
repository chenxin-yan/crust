// Compile-time contracts, enforced by check:types (not vp test).

import type { Pkce } from "./pkce.ts";
import type {
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
