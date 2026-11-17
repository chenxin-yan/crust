// Test doubles: a scripted authorization server behind an injected fetch, raw loopback
// requests (fetch() would normalize the paths these tests send), and unique issuers so the
// process-wide metadata cache never leaks between tests.
import { mkdtempSync, readFileSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, vi } from "vite-plus/test";

import { defineServers } from "../src/config.ts";
import { credentialStore } from "../src/credentials.ts";
import { discover } from "../src/discovery.ts";
import { OAuthConfigError } from "../src/errors.ts";
import type { Fetch } from "../src/http.ts";
import { type KeyringBackend, type KeyringKind, keyrings } from "../src/keyring.ts";
import { createTokenSource } from "../src/token-source.ts";
import type {
	AuthConfig,
	AuthServer,
	AuthServerOptions,
	Credential,
	CredentialIdentity,
	CredentialStore,
	CredentialStoreOptions,
	DeviceLoginPrompt,
	TokenSet,
	TokenSource,
	TokenSourceOptions,
} from "../src/types.ts";

let counter = 0;

/** A fresh https issuer the metadata cache has never seen. */
export function uniqueIssuer(path = ""): string {
	counter += 1;
	return `https://as-${counter}-${process.pid}.example${path}`;
}

export interface RecordedRequest {
	url: string;
	method: string;
	headers: Headers;
	body: URLSearchParams;
}

type Handler = (request: RecordedRequest) => Response | Promise<Response>;

/** A JSON response. */
export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json", ...headers },
	});
}

/**
 * A fetch that answers from `routes`, keyed by origin + path (the query is kept in the
 * recorded URL). Unrouted URLs answer 404. A pending handler rejects on the request's signal.
 */
export function fakeFetch(routes: Record<string, Handler>): {
	fetch: Fetch;
	requests: RecordedRequest[];
} {
	const requests: RecordedRequest[] = [];
	const fetchImpl: Fetch = (url, init) => {
		const recorded: RecordedRequest = {
			url,
			method: init.method ?? "GET",
			headers: new Headers(init.headers),
			body: new URLSearchParams(init.body instanceof URLSearchParams ? init.body : ""),
		};
		requests.push(recorded);
		const { origin, pathname } = new URL(url);
		const handler =
			routes[`${origin}${pathname}`] ?? (() => new Response("not found", { status: 404 }));
		return new Promise((resolve, reject) => {
			const signal = init.signal;
			if (signal?.aborted) {
				reject(signal.reason);
				return;
			}
			signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
			Promise.resolve()
				.then(() => handler(recorded))
				.then(resolve, reject);
		});
	};
	return { fetch: fetchImpl, requests };
}

/** RFC 8414 metadata for `issuer`, endpoints on the issuer's origin. */
export function metadataFor(
	issuer: string,
	overrides: Record<string, unknown> = {},
): Record<string, unknown> {
	const origin = new URL(issuer).origin;
	return {
		issuer,
		authorization_endpoint: `${origin}/authorize`,
		token_endpoint: `${origin}/token`,
		device_authorization_endpoint: `${origin}/device`,
		revocation_endpoint: `${origin}/revoke`,
		code_challenge_methods_supported: ["S256"],
		...overrides,
	};
}

/** The RFC 8414 well-known URL of an issuer without a path. */
export function wellKnown(issuer: string): string {
	return `${new URL(issuer).origin}/.well-known/oauth-authorization-server`;
}

/**
 * A discovered server for a fresh issuer, backed by `routes` (metadata is added). `extra`
 * servers make the config multi-server.
 */
export async function setupServer(
	options: {
		metadata?: Record<string, unknown>;
		routes?: Record<string, Handler>;
		server?: Partial<AuthServerOptions>;
		others?: AuthServerOptions[];
		allowCustomIssuers?: boolean;
	} = {},
): Promise<{ server: AuthServer; fetch: Fetch; requests: RecordedRequest[]; issuer: string }> {
	const issuer = options.server?.issuer ?? uniqueIssuer();
	const fake = fakeFetch({
		[wellKnown(issuer)]: () => json(metadataFor(issuer, options.metadata)),
		...options.routes,
	});
	const config = defineServers({
		servers: [{ issuer, clientId: "cli", ...options.server }, ...(options.others ?? [])],
		allowCustomIssuers: options.allowCustomIssuers,
	});
	const server = await discover(config, issuer, { fetch: fake.fetch });
	return { server, fetch: fake.fetch, requests: fake.requests, issuer };
}

export interface RawResponse {
	status: number;
	headers: Record<string, string | string[] | undefined>;
	body: string;
}

/** Sends one raw HTTP request to a loopback listener; `path` is sent byte for byte. */
export function rawRequest(
	redirectUri: string,
	path: string,
	options: { method?: string; host?: string } = {},
): Promise<RawResponse> {
	const url = new URL(redirectUri);
	return new Promise((resolve, reject) => {
		const req = request(
			{
				host: url.hostname.replace(/^\[|\]$/g, ""),
				port: url.port,
				method: options.method ?? "GET",
				path,
				headers: { host: options.host ?? url.host },
				agent: false,
			},
			(response) => {
				let body = "";
				response.setEncoding("utf8");
				response.on("data", (chunk: string) => {
					body += chunk;
				});
				response.on("end", () =>
					resolve({ status: response.statusCode ?? 0, headers: response.headers, body }),
				);
			},
		);
		req.on("error", reject);
		req.end();
	});
}

/** The redirect URI's path plus `query`. */
export function callbackPath(redirectUri: string, query: Record<string, string>): string {
	return `${new URL(redirectUri).pathname}?${new URLSearchParams(query).toString()}`;
}

/** Whether a TCP connect to the listener of `redirectUri` is refused. */
export async function isClosed(redirectUri: string): Promise<boolean> {
	for (let attempt = 0; attempt < 50; attempt += 1) {
		try {
			await rawRequest(redirectUri, "/");
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ECONNREFUSED") return true;
		}
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
	return false;
}

/** The reason of the {@link OAuthConfigError} `promise` rejects with. */
export async function configReason(promise: Promise<unknown>): Promise<string> {
	const error = await promise.then(
		() => undefined,
		(caught: unknown) => caught,
	);
	expect(error).toBeInstanceOf(OAuthConfigError);
	return (error as OAuthConfigError).reason;
}

// detectLoginMode() reads the environment and the standard streams; tests set both.
const streams = [process.stdin, process.stdout, process.stderr];
const ttyDescriptors = streams.map((stream) => Object.getOwnPropertyDescriptor(stream, "isTTY"));

/** Makes the process look like a desktop terminal (`tty`), or not, and on CI or not. */
export function terminal(options: { tty: boolean; ci?: boolean }): void {
	vi.stubEnv("CI", options.ci ? "true" : undefined);
	vi.stubEnv("DISPLAY", ":0");
	for (const name of ["SSH_CONNECTION", "SSH_CLIENT", "SSH_TTY"]) vi.stubEnv(name, undefined);
	for (const stream of streams) {
		Object.defineProperty(stream, "isTTY", {
			value: options.tty,
			configurable: true,
			writable: true,
		});
	}
}

/** Undoes {@link terminal}. */
export function restoreTerminal(): void {
	vi.unstubAllEnvs();
	streams.forEach((stream, index) => {
		const descriptor = ttyDescriptors[index];
		if (descriptor) Object.defineProperty(stream, "isTTY", descriptor);
		else delete (stream as { isTTY?: boolean }).isTTY;
	});
}

/**
 * A fresh app whose state directory is under a new temporary directory: the state variable
 * is stubbed, so restore it with `vi.unstubAllEnvs()`. `dir` is where `credentials.json` goes.
 */
export function tempApp(): { app: string; root: string; dir: string } {
	counter += 1;
	const root = mkdtempSync(join(tmpdir(), "crust-auth-"));
	const app = `app-${counter}`;
	if (process.platform === "win32") {
		vi.stubEnv("LOCALAPPDATA", root);
		return { app, root, dir: join(root, app, "State") };
	}
	vi.stubEnv("XDG_STATE_HOME", root);
	return { app, root, dir: join(root, app) };
}

/** A token response for the scripted server. */
export const tokenResponse = (
	accessToken: string,
	refreshToken?: string,
	expiresIn = 3600,
): Response =>
	json({
		access_token: accessToken,
		token_type: "Bearer",
		expires_in: expiresIn,
		...(refreshToken === undefined ? {} : { refresh_token: refreshToken }),
	});

/** A token set as a login returns it, expired unless `expiresAt` says otherwise. */
export function loginTokens(fields: Partial<TokenSet> = {}): TokenSet {
	return {
		accessToken: "AT1",
		refreshToken: "RT1",
		tokenType: "Bearer",
		expiresAt: Date.now() - 1,
		scope: undefined,
		...fields,
	};
}

export interface TokenWorld {
	app: string;
	root: string;
	/** The state directory. */
	dir: string;
	issuer: string;
	config: AuthConfig;
	store: CredentialStore;
	identity: CredentialIdentity;
	fetch: Fetch;
	requests: RecordedRequest[];
	/** A token source of `identity` over `store` and the scripted server. */
	source(overrides?: Partial<TokenSourceOptions>): TokenSource;
	tokenRequests(): RecordedRequest[];
	/** `credentials.json`. */
	file: string;
	/** `credentials.json`, parsed. */
	document(): {
		storeId: string;
		encryption: { kind: string; keyId?: string };
		records: Record<string, any>;
	};
}

/**
 * A credentials file in a temporary state directory, a scripted server (`token` answers the
 * token endpoint) and a token source for `https://api.example.com`.
 */
export function tokenWorld(
	options: {
		token?: Handler;
		routes?: Record<string, Handler>;
		metadata?: Record<string, unknown>;
		identity?: Partial<CredentialIdentity>;
		lockTimeout?: number;
		keyring?: CredentialStoreOptions["keyring"];
	} = {},
): TokenWorld {
	const temp = tempApp();
	const issuer = uniqueIssuer();
	const fake = fakeFetch({
		[wellKnown(issuer)]: () => json(metadataFor(issuer, options.metadata)),
		[`${issuer}/token`]: options.token ?? (() => tokenResponse("AT2", "RT2")),
		...options.routes,
	});
	const config = defineServers({ servers: [{ issuer, clientId: "cli" }] });
	const store = credentialStore({
		app: temp.app,
		lockTimeout: options.lockTimeout ?? 5_000,
		keyring: options.keyring,
	});
	const identity: CredentialIdentity = {
		issuer,
		clientId: "cli",
		apiOrigins: ["https://api.example.com"],
		...options.identity,
	};
	const source = (overrides: Partial<TokenSourceOptions> = {}) =>
		createTokenSource({ config, identity, store, fetch: fake.fetch, ...overrides });
	const tokenRequests = () =>
		fake.requests.filter((recorded) => recorded.url === `${issuer}/token`);
	const file = join(temp.dir, "credentials.json");
	const document = () => JSON.parse(readFileSync(file, "utf8"));
	return {
		...temp,
		...fake,
		issuer,
		config,
		store,
		identity,
		source,
		tokenRequests,
		file,
		document,
	};
}

/** Commits a login of `tokens` through `source`. */
export async function login(
	source: TokenSource,
	tokens: Partial<TokenSet> = {},
): Promise<Credential> {
	const ticket = await source.beginLogin();
	return ticket.commit(loginTokens(tokens));
}

export interface FakeKeyring {
	backend: KeyringBackend;
	/** Stored values by `<service>\0<name>`. */
	entries: Map<string, string>;
	calls: { op: "get" | "set"; service: string; name: string }[];
	state: { get: "value" | "error" | "hang"; writeGate: Promise<void> | undefined };
	writes(): number;
	/** The stored entry of `app`, parsed. */
	entry(app: string): { keyId: string; key: string } | undefined;
}

/**
 * An in-memory OS keyring, installed as the backend every credential store of the test loads.
 * `get` is how the next reads answer: the stored value, an error, or never (past the deadline).
 * A write waits for `writeGate` when one is set.
 */
export function fakeKeyring(kind: KeyringKind = "bun-secrets"): FakeKeyring {
	const entries = new Map<string, string>();
	const calls: { op: "get" | "set"; service: string; name: string }[] = [];
	const state: FakeKeyring["state"] = {
		get: "value",
		writeGate: undefined,
	};
	const backend: KeyringBackend = {
		kind,
		async get(service, name) {
			calls.push({ op: "get", service, name });
			if (state.get === "error") throw new Error("The keyring is locked");
			if (state.get === "hang") return new Promise<never>(() => {});
			return entries.get(`${service}\0${name}`);
		},
		async set(service, name, value) {
			calls.push({ op: "set", service, name });
			await state.writeGate;
			entries.set(`${service}\0${name}`, value);
		},
	};
	vi.spyOn(keyrings, "load").mockResolvedValue(backend);
	return {
		backend,
		entries,
		calls,
		state,
		writes: () => calls.filter((call) => call.op === "set").length,
		entry: (app) => {
			const value = entries.get(`${app}\0credentials-key`);
			return value === undefined
				? undefined
				: (JSON.parse(value) as { keyId: string; key: string });
		},
	};
}

/** No OS keyring: every credential store of the test falls back to the plaintext file. */
export function noKeyring(): void {
	vi.spyOn(keyrings, "load").mockResolvedValue(undefined);
}

/** Takes a lock with `take` and holds it until `release()`; resolves once it is held. */
export async function holdLock(
	take: (fn: () => Promise<void>) => Promise<void>,
): Promise<{ release(): Promise<void> }> {
	const acquired = Promise.withResolvers<void>();
	const released = Promise.withResolvers<void>();
	const done = take(() => {
		acquired.resolve();
		return released.promise;
	});
	await Promise.race([acquired.promise, done]);
	return {
		async release() {
			released.resolve();
			await done;
		},
	};
}

/** An `onCode` that switches to fake timers first, so the device poll's waits can be skipped. */
export function fakeTimersFrom(
	onCode: (prompt: DeviceLoginPrompt) => void | Promise<void> = () => {},
): (prompt: DeviceLoginPrompt) => void | Promise<void> {
	return (prompt) => {
		vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
		return onCode(prompt);
	};
}

/**
 * Settles a device login: once {@link fakeTimersFrom} switched timers, a second of fake time
 * per event loop turn; the login file's I/O runs on real time meanwhile.
 */
export async function settle<T>(promise: Promise<T>): Promise<unknown> {
	const state = { done: false };
	const result = promise.then(
		(value) => value,
		(error: unknown) => error,
	);
	void result.finally(() => {
		state.done = true;
	});
	const deadline = Date.now() + 4_000;
	while (!state.done && Date.now() < deadline) {
		if (vi.isFakeTimers()) await vi.advanceTimersByTimeAsync(1_000);
		await new Promise((resolve) => setImmediate(resolve));
	}
	return result;
}
