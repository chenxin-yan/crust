// Compile-time contracts, enforced by check:types (not vp test).

import { type ApiAuth, bearerAuth } from "@crustjs/openapi";

import { createAuth } from "./client.ts";
import {
	type AuthError,
	type AuthErrorCode,
	LoginRequiredError,
	type OAuthError,
} from "./errors.ts";
import type * as oauth from "./oauth.ts";
import type { Pkce } from "./pkce.ts";
import type {
	AuthClient,
	AuthorizationSession,
	AuthorizationSessionOptions,
	AuthServer,
	CreateAuthOptions,
	DeviceFlowOptions,
	ProfileAuthClient,
	ProfileAuthStatus,
	ProfileClient,
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

// What a session or the device flow does internally is not a building block.
// @ts-expect-error -- not exported from @crustjs/auth/oauth
export type NoCreatePkce = typeof oauth.createPkce;
// @ts-expect-error -- not exported from @crustjs/auth/oauth
export type NoRandomState = typeof oauth.randomState;
// @ts-expect-error -- not exported from @crustjs/auth/oauth
export type NoPkce = oauth.Pkce;
// @ts-expect-error -- not exported from @crustjs/auth/oauth
export type NoRedactUrl = typeof oauth.redactUrl;
// @ts-expect-error -- not exported from @crustjs/auth/oauth
export type NoSanitizeDisplay = typeof oauth.sanitizeDisplay;

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

declare const client: AuthClient;
declare const onUrl: Parameters<AuthClient["login"]>[0]["onUrl"];
declare const onCode: Parameters<AuthClient["login"]>[0]["onCode"];

// login() has no default output: both callbacks are required.
void client.login({ onUrl, onCode });
// @ts-expect-error -- onUrl is required
void client.login({ onCode });
// @ts-expect-error -- onCode is required
void client.login({ onUrl });
// @ts-expect-error -- the options are required
void client.login();
// The flow is one of three; `device` is gone.
void client.login({ onUrl, onCode, flow: "browser" });
// @ts-expect-error -- not a flow
void client.login({ onUrl, onCode, flow: "web" });
// @ts-expect-error -- replaced by flow
void client.login({ onUrl, onCode, device: true });
// Warnings go to the call that stores the login, not to createAuth().
void client.login({ onUrl, onCode, onWarning: () => {} });
void client.token({ onWarning: () => {} });
export type NoCreateAuthWarning = Expect<
	Equal<"onWarning" extends keyof CreateAuthOptions ? true : false, false>
>;

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
export type KeyErrorsAreAuthErrorCodes = Expect<
	Equal<Extract<AuthErrorCode, "credential-key">, "credential-key">
>;
const narrowed = (caught: AuthError): "login-requires-interaction" | undefined =>
	caught.code === "login-requires-interaction" ? caught.code : undefined;
void narrowed;
export type ProtocolCodesAreAuthErrorCodes = Expect<
	Equal<Extract<AuthErrorCode, OAuthError["code"]>, OAuthError["code"]>
>;

// The client's token() is bearerAuth()'s resolver as is, detached: it fits structurally, with no
// dependency between the packages.
export const clientAuth: ApiAuth = bearerAuth(client.token);

// Profiles are opt-in, also in the types: only a client created with `profiles` has them.
declare const serverOptions: Omit<CreateAuthOptions, "profiles">;
const withoutProfiles = createAuth(serverOptions);
// @ts-expect-error -- no profiles without the profiles option
void withoutProfiles.profile;
// @ts-expect-error -- no profiles without the profiles option
void withoutProfiles.profiles;
declare const offStatus: Awaited<ReturnType<typeof withoutProfiles.status>>;
// @ts-expect-error -- a client without profiles never reports one
void offStatus.profile;
const withProfiles: ProfileAuthClient = createAuth({ ...serverOptions, profiles: {} });
void withProfiles;
// A variable of the wide options type may or may not turn profiles on: the four verbs only.
declare const wide: CreateAuthOptions;
// @ts-expect-error -- not known to have profiles
const fromWide: ProfileAuthClient = createAuth(wide);
void fromWide;

declare const profiled: ProfileAuthClient;
// A profile is the same four verbs; no name means the current profile.
export type ProfileIsAClient = Expect<
	Equal<ReturnType<ProfileAuthClient["profile"]>, ProfileClient>
>;
export const profileAsClient: AuthClient = profiled.profile("work");
export type ProfileStatus = Expect<
	Equal<Awaited<ReturnType<ProfileClient["status"]>>, ProfileAuthStatus>
>;
declare const flag: string | undefined;
void profiled.profile(flag).login({ onUrl, onCode });
// Only the client's own login() may store as another profile, named before or after sign-in.
void profiled.login({ onUrl, onCode, profile: "work" });
void profiled.login({ onUrl, onCode, profile: async (tokens: TokenSet) => tokens.scope ?? "x" });
// @ts-expect-error -- a profile's login() is already for that profile
void profiled.profile("work").login({ onUrl, onCode, profile: "other" });
// @ts-expect-error -- no profiles without the profiles option
void withoutProfiles.login({ onUrl, onCode, profile: "work" });
export const profileAuth: ApiAuth = bearerAuth(profiled.profile("work").token);
export type ListedProfiles = Expect<
	Equal<
		Awaited<ReturnType<ProfileAuthClient["profiles"]["list"]>>,
		readonly { readonly name: string; readonly current: boolean }[]
	>
>;
export type StatusProfile = Expect<
	Equal<
		ProfileAuthStatus["profile"],
		{ readonly name: string; readonly via: "argument" | "env" | "current" | "default" } | undefined
	>
>;
// @ts-expect-error -- use() needs a name
void profiled.profiles.use();

// The client names the profile in its errors; the public error class takes only a reason.
// @ts-expect-error -- no profile argument
void new LoginRequiredError("missing", "work");
