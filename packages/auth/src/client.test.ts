/**
 * @module-tag windows
 * @module-tag macos
 */
import { once } from "node:events";
import { chmodSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { type AddressInfo, createServer } from "node:net";
import { join } from "node:path";

import { CrustStoreError } from "@crustjs/store";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
	callbackPath,
	configReason,
	fakeFetch,
	fakeKeyring,
	fakeTimersFrom,
	holdLock,
	login as storeLogin,
	isClosed,
	json,
	metadataFor,
	noKeyring,
	rawRequest,
	type RawResponse,
	restoreTerminal,
	settle,
	tempApp,
	terminal,
	uniqueIssuer,
	wellKnown,
} from "../tests/helpers.ts";
import { createAuth } from "./client.ts";
import { defineServers } from "./config.ts";
import { credentialStore, credentialStoreInternals } from "./credentials.ts";
import { deviceCodeMessage } from "./display.ts";
import {
	AbortError,
	CredentialKeyError,
	CredentialMismatchError,
	CredentialStoreCorruptError,
	LoginRequiredError,
	LoginRequiresInteractionError,
	OAuthConfigError,
	StaleCommitError,
	UnsafeStorageError,
} from "./errors.ts";
import { createTokenSource } from "./token-source.ts";
import type { AuthWarning, BrowserLoginPrompt, DeviceLoginPrompt, LoginOptions } from "./types.ts";

const openBrowser = vi.hoisted(() => vi.fn(async (_url: string, _options?: object) => true));
vi.mock("./browser.ts", () => ({ openBrowser }));

const DEVICE = {
	device_code: "SENTINEL_DEVICE",
	user_code: "WDJB-MJHT",
	verification_uri: "https://login.example/device",
	verification_uri_complete: "https://login.example/device?user_code=WDJB-MJHT",
	expires_in: 600,
	interval: 5,
};
const TOKEN = {
	access_token: "AT",
	refresh_token: "RT",
	token_type: "Bearer",
	expires_in: 3600,
	scope: "read",
};
const API = "https://api.example.com";
const roots: string[] = [];

const writes: string[] = [];

/** `status().storage` without a keyring and without a stored login. */
const noLogins = { kind: "file", plaintextRecords: 0 } as const;

beforeEach(() => {
	// No test reaches the OS keyring; the keyring tests install a fake.
	noKeyring();
	terminal({ tty: true });
	openBrowser.mockClear();
	writes.length = 0;
	for (const stream of [process.stdout, process.stderr]) {
		const write = stream.write.bind(stream);
		vi.spyOn(stream, "write").mockImplementation((chunk: unknown, ...rest: unknown[]) => {
			writes.push(String(chunk));
			return (write as (...args: unknown[]) => boolean)(chunk, ...rest);
		});
	}
});

afterEach(() => {
	restoreTerminal();
	vi.restoreAllMocks();
	vi.useRealTimers();
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

type Route = Parameters<typeof fakeFetch>[0][string];

/**
 * A fresh authorization server behind a fake fetch, a fresh state directory, and a client for
 * both. `routes` and `metadata` replace the defaults.
 */
function setup(
	routes: (issuer: string) => Record<string, Route> = () => ({}),
	options: {
		name?: string;
		scope?: string;
		ports?: number[];
		resource?: string | string[];
		env?: string;
		metadata?: Record<string, unknown>;
		strict?: boolean;
		onWarning?: (warning: AuthWarning) => void;
	} = {},
) {
	const temp = tempApp();
	roots.push(temp.root);
	const issuer = uniqueIssuer();
	const { metadata, ...rest } = options;
	const fake = fakeFetch({
		[wellKnown(issuer)]: () => json(metadataFor(issuer, metadata)),
		[`${issuer}/token`]: () => json(TOKEN),
		[`${issuer}/device`]: () => json(DEVICE),
		[`${issuer}/revoke`]: () => new Response(null, { status: 200 }),
		...routes(issuer),
	});
	const auth = createAuth({
		app: temp.app,
		issuer,
		clientId: "cli",
		apiOrigins: [API],
		scope: "read",
		fetch: fake.fetch,
		...rest,
	});
	const tokenRequests = () => fake.requests.filter(({ url }) => url === `${issuer}/token`);
	return { issuer, auth, ...temp, ...fake, tokenRequests };
}

/** An `onUrl` that plays the browser: it sends the callback for the URL it is given. */
function browser() {
	const seen: { prompt?: BrowserLoginPrompt; page?: Promise<RawResponse> } = {};
	const onUrl = (prompt: BrowserLoginPrompt) => {
		seen.prompt = prompt;
		const url = new URL(prompt.url);
		const redirectUri = url.searchParams.get("redirect_uri")!;
		// Not awaited: the page is answered once login() waits for the callback.
		seen.page = rawRequest(
			redirectUri,
			callbackPath(redirectUri, { code: "CODE", state: url.searchParams.get("state")! }),
		);
		// A login that fails before the exchange drops this connection.
		seen.page.catch(() => {});
	};
	return {
		onUrl,
		seen,
		redirectUri: () => new URL(seen.prompt!.url).searchParams.get("redirect_uri")!,
	};
}

/** A loopback port free right now. */
async function freePort(): Promise<number> {
	const server = createServer().listen(0, "127.0.0.1");
	await once(server, "listening");
	const { port } = server.address() as AddressInfo;
	server.close();
	await once(server, "close");
	return port;
}

/** A response that never comes; the request aborts `controller` when it arrives. */
function hang(controller: AbortController): Promise<Response> {
	controller.abort();
	return new Promise(() => {});
}

const noCode = () => {
	throw new Error("unexpected device login");
};
const noUrl = () => {
	throw new Error("unexpected browser login");
};

async function rejection(promise: Promise<unknown>): Promise<unknown> {
	return promise.then(
		() => undefined,
		(error: unknown) => error,
	);
}

describe("createAuth", () => {
	it("validates its options with the building blocks' rules and does no I/O", async () => {
		const fetch = vi.fn();
		const base = {
			app: "acme",
			issuer: "https://as.example",
			clientId: "cli",
			apiOrigins: [API],
			fetch,
		};
		const auth = createAuth(base);
		expect(Object.isFrozen(auth)).toBe(true);
		expect(fetch).not.toHaveBeenCalled();
		const reason = (options: object) =>
			configReason(Promise.resolve().then(() => createAuth({ ...base, ...options })));
		expect(await reason({ app: "" })).toBe("invalid-option");
		expect(await reason({ app: "  " })).toBe("invalid-option");
		expect(await reason({ app: "a/b" })).toBe("invalid-option");
		expect(await reason({ app: "a\\b" })).toBe("invalid-option");
		expect(await reason({ name: "" })).toBe("invalid-option");
		expect(await reason({ issuer: "http://as.example" })).toBe("invalid-url");
		expect(await reason({ clientId: "" })).toBe("invalid-option");
		expect(await reason({ clientSecret: "" })).toBe("invalid-option");
		expect(await reason({ redirectPath: "/a/../b" })).toBe("invalid-option");
		expect(await reason({ scope: " " })).toBe("invalid-option");
		expect(await reason({ resource: "api" })).toBe("invalid-option");
		expect(await reason({ resource: ["https://api.example.com/#v1"] })).toBe("invalid-option");
		expect(await reason({ resource: [42] })).toBe("invalid-option");
		expect(await reason({ ports: [70_000] })).toBe("invalid-option");
		expect(await reason({ hosts: ["localhost"] })).toBe("invalid-option");
		expect(await reason({ apiOrigins: [] })).toBe("invalid-option");
		expect(await reason({ apiOrigins: ["http://api.example.com"] })).toBe("invalid-url");
		expect(await reason({ env: " " })).toBe("invalid-option");
		expect(() =>
			createAuth({
				...base,
				issuer: "http://127.0.0.1:9000",
				allowInsecureLoopback: true,
				apiOrigins: ["http://127.0.0.1:9000"],
			}),
		).not.toThrow();
	});
});

it.skipIf(process.platform === "win32")(
	"createAuth() throws the store's PATH error when the state directory has no absolute base",
	() => {
		vi.stubEnv("XDG_STATE_HOME", "relative/state");
		vi.stubEnv("HOME", "relative-home");
		let error: unknown;
		try {
			createAuth({ app: "acme", issuer: "https://as.example", clientId: "cli", apiOrigins: [API] });
		} catch (caught) {
			error = caught;
		}
		expect(error).toBeInstanceOf(CrustStoreError);
		expect((error as CrustStoreError).is("PATH")).toBe(true);
	},
);

describe("login() in a browser", () => {
	it("signs in end to end with a detached login and closes the listener", async () => {
		const { auth, requests } = setup();
		const { login } = auth;
		const play = browser();
		expect(await login({ onUrl: play.onUrl, onCode: noCode })).toBeUndefined();
		expect(await auth.token()).toMatchObject({ value: "AT", source: "login" });
		expect((await play.seen.page!).status).toBe(200);
		const url = new URL(play.seen.prompt!.url);
		expect(url.searchParams.get("scope")).toBe("read");
		const exchange = requests.filter((request) => request.body.get("grant_type"));
		expect(exchange).toHaveLength(1);
		expect(exchange[0]!.body.get("code")).toBe("CODE");
		expect(await isClosed(play.redirectUri())).toBe(true);
	});

	it("writes nothing to stdout or stderr and opens no browser by itself", async () => {
		const { auth } = setup();
		await auth.login({ onUrl: browser().onUrl, onCode: noCode });
		expect(writes).toEqual([]);
		expect(openBrowser).not.toHaveBeenCalled();
	});

	it("open() opens exactly the session URL", async () => {
		const { auth } = setup();
		const play = browser();
		await auth.login({
			onUrl: async (prompt) => {
				await prompt.open();
				play.onUrl(prompt);
			},
			onCode: noCode,
		});
		expect(openBrowser).toHaveBeenCalledTimes(1);
		expect(openBrowser.mock.calls[0]![0]).toBe(play.seen.prompt!.url);
	});

	it("open() reports whether a browser was launched", async () => {
		const { auth } = setup();
		const play = browser();
		const opened: boolean[] = [];
		openBrowser.mockResolvedValueOnce(false);
		await auth.login({
			onUrl: async (prompt) => {
				opened.push(await prompt.open());
				play.onUrl(prompt);
			},
			onCode: noCode,
		});
		expect(opened).toEqual([false]);
	});

	it("sends resource in the authorization URL and the code exchange", async () => {
		const resource = ["https://api.example.com", "urn:example:api"];
		const { auth, requests } = setup(undefined, { resource });
		const play = browser();
		await auth.login({ onUrl: play.onUrl, onCode: noCode });
		expect(new URL(play.seen.prompt!.url).searchParams.getAll("resource")).toEqual(resource);
		const exchange = requests.filter((request) => request.body.get("grant_type"));
		expect(exchange.map((request) => request.body.getAll("resource"))).toEqual([resource]);
	});

	it("passes the scope override, the fixed port and the result page", async () => {
		const port = await freePort();
		const { auth } = setup(undefined, { scope: "read", ports: [port] });
		const play = browser();
		await auth.login({
			scope: "write",
			onUrl: play.onUrl,
			onCode: noCode,
			page: ({ outcome }) => `<p>${outcome} at Acme</p>`,
		});
		expect(new URL(play.seen.prompt!.url).searchParams.get("scope")).toBe("write");
		expect(new URL(play.redirectUri()).port).toBe(String(port));
		expect((await play.seen.page!).body).toBe("<p>success at Acme</p>");
	});

	it("fails with the error of a throwing onUrl and leaves no listener", async () => {
		const { auth, requests } = setup();
		let redirectUri = "";
		const thrown = new Error("onUrl failed");
		const error = await rejection(
			auth.login({
				onUrl: async ({ url }) => {
					redirectUri = new URL(url).searchParams.get("redirect_uri")!;
					throw thrown;
				},
				onCode: noCode,
			}),
		);
		expect(error).toBe(thrown);
		expect(await isClosed(redirectUri)).toBe(true);
		expect(requests.some((request) => request.body.get("grant_type"))).toBe(false);
		expect(await auth.status()).toEqual({ source: "none", storage: noLogins });
	});

	it("aborts while onUrl is pending: rejects at once, closes the listener, ignores the late result", async () => {
		const { auth } = setup();
		const controller = new AbortController();
		const unhandled = vi.fn();
		process.on("unhandledRejection", unhandled);
		let redirectUri = "";
		let fail!: (error: Error) => void;
		const login = auth.login({
			signal: controller.signal,
			onUrl: ({ url }) => {
				redirectUri = new URL(url).searchParams.get("redirect_uri")!;
				queueMicrotask(() => controller.abort());
				// A prompt the user never answers.
				return new Promise<void>((_resolve, reject) => {
					fail = reject;
				});
			},
			onCode: noCode,
		});
		expect(await rejection(login)).toBeInstanceOf(AbortError);
		expect(await isClosed(redirectUri)).toBe(true);
		fail(new Error("the prompt failed late"));
		await new Promise((resolve) => setImmediate(resolve));
		process.off("unhandledRejection", unhandled);
		expect(unhandled).not.toHaveBeenCalled();
	});

	it.each(["onUrl", "onCode"] as const)(
		"%s that aborts the login itself and rejects later leaves no unhandled rejection",
		async (callback) => {
			const { auth } = setup();
			const controller = new AbortController();
			const unhandled = vi.fn();
			process.on("unhandledRejection", unhandled);
			let fail!: (error: Error) => void;
			const prompt = () => {
				controller.abort();
				return new Promise<void>((_resolve, reject) => {
					fail = reject;
				});
			};
			const login = auth.login({
				device: callback === "onCode",
				signal: controller.signal,
				onUrl: callback === "onUrl" ? prompt : browser().onUrl,
				onCode: callback === "onCode" ? prompt : noCode,
			});
			expect(await rejection(login)).toBeInstanceOf(AbortError);
			fail(new Error("the prompt failed late"));
			await new Promise((resolve) => setImmediate(resolve));
			process.off("unhandledRejection", unhandled);
			expect(unhandled).not.toHaveBeenCalled();
		},
	);

	it("a second login after a failed one succeeds", async () => {
		const { auth } = setup();
		const thrown = new Error("onUrl failed");
		expect(
			await rejection(
				auth.login({
					onUrl: () => {
						throw thrown;
					},
					onCode: noCode,
				}),
			),
		).toBe(thrown);
		expect(await auth.login({ onUrl: browser().onUrl, onCode: noCode })).toBeUndefined();
		expect(await auth.token()).toMatchObject({ value: "AT", source: "login" });
	});

	it("aborts while waiting for the browser and leaves no listener", async () => {
		const { auth } = setup();
		const controller = new AbortController();
		let redirectUri = "";
		const login = auth.login({
			signal: controller.signal,
			onUrl: ({ url }) => {
				redirectUri = new URL(url).searchParams.get("redirect_uri")!;
				setTimeout(() => controller.abort(), 20);
			},
			onCode: noCode,
		});
		expect(await rejection(login)).toBeInstanceOf(AbortError);
		expect(await isClosed(redirectUri)).toBe(true);
		expect(await auth.status()).toEqual({ source: "none", storage: noLogins });
	});

	it("aborts during the code exchange and leaves no listener", async () => {
		const controller = new AbortController();
		const { auth } = setup((issuer) => ({ [`${issuer}/token`]: () => hang(controller) }));
		const play = browser();
		const error = await rejection(
			auth.login({ signal: controller.signal, onUrl: play.onUrl, onCode: noCode }),
		);
		expect(error).toBeInstanceOf(AbortError);
		expect(await isClosed(play.redirectUri())).toBe(true);
		expect(await auth.status()).toEqual({ source: "none", storage: noLogins });
	});

	it("aborts during discovery before any listener", async () => {
		const controller = new AbortController();
		const { auth } = setup((issuer) => ({ [wellKnown(issuer)]: () => hang(controller) }));
		const onUrl = vi.fn();
		const error = await rejection(auth.login({ signal: controller.signal, onUrl, onCode: noCode }));
		expect(error).toBeInstanceOf(AbortError);
		expect(onUrl).not.toHaveBeenCalled();
		expect(await auth.status()).toEqual({ source: "none", storage: noLogins });
	});
});

describe("login() with a device code", () => {
	it("shows the code through onCode, never the device code, and writes nothing", async () => {
		const { auth } = setup(undefined, { name: "Acme" });
		const prompts: DeviceLoginPrompt[] = [];
		await settle(
			auth.login({
				device: true,
				onUrl: noUrl,
				onCode: fakeTimersFrom((prompt) => void prompts.push(prompt)),
			}),
		);
		expect(await auth.token()).toMatchObject({ value: "AT", source: "login" });
		expect(prompts).toHaveLength(1);
		expect(prompts[0]).toEqual({
			userCode: DEVICE.user_code,
			verificationUri: DEVICE.verification_uri,
			verificationUriComplete: DEVICE.verification_uri_complete,
			expiresAt: expect.any(Number),
			message: deviceCodeMessage({
				app: "Acme",
				userCode: DEVICE.user_code,
				verificationUri: DEVICE.verification_uri,
			}),
		});
		expect(JSON.stringify(prompts)).not.toContain(DEVICE.device_code);
		expect(writes).toEqual([]);
	});

	it("names the app in the message by default", async () => {
		const { auth, app } = setup();
		let message = "";
		await settle(
			auth.login({
				device: true,
				onUrl: noUrl,
				onCode: fakeTimersFrom((prompt) => void (message = prompt.message)),
			}),
		);
		expect(message).toContain(`To sign in to ${app}, open:`);
	});

	it("sends resource in the device authorization request and every poll", async () => {
		const { auth, issuer, requests } = setup(undefined, { resource: "https://api.example.com" });
		await settle(auth.login({ device: true, onUrl: noUrl, onCode: fakeTimersFrom(() => {}) }));
		const sent = requests.filter(
			({ url }) => url === `${issuer}/device` || url === `${issuer}/token`,
		);
		expect(sent.map(({ url }) => url)).toEqual([`${issuer}/device`, `${issuer}/token`]);
		for (const request of sent) {
			expect(request.body.getAll("resource")).toEqual(["https://api.example.com"]);
		}
	});

	it("uses the device login where no browser can open", async () => {
		vi.stubEnv("SSH_CONNECTION", "1 2 3 4");
		const { auth } = setup();
		const onCode = vi.fn();
		await settle(auth.login({ onUrl: noUrl, onCode: fakeTimersFrom(onCode) }));
		expect(onCode).toHaveBeenCalledTimes(1);
	});

	it("aborts while onCode is pending: rejects at once and never polls", async () => {
		const { auth, requests, issuer } = setup();
		const controller = new AbortController();
		const login = auth.login({
			device: true,
			signal: controller.signal,
			onUrl: noUrl,
			onCode: () => {
				queueMicrotask(() => controller.abort());
				return new Promise<void>(() => {});
			},
		});
		expect(await rejection(login)).toBeInstanceOf(AbortError);
		expect(requests.some((request) => request.url === `${issuer}/token`)).toBe(false);
	});

	it("fails with the error of a rejecting onCode and never polls", async () => {
		const { auth, requests, issuer } = setup();
		const thrown = new Error("onCode failed");
		const error = await settle(
			auth.login({ device: true, onUrl: noUrl, onCode: async () => Promise.reject(thrown) }),
		);
		expect(error).toBe(thrown);
		expect(requests.some((request) => request.url === `${issuer}/token`)).toBe(false);
		expect(await auth.status()).toEqual({ source: "none", storage: noLogins });
	});

	it("aborts while starting and while polling", async () => {
		const starting = new AbortController();
		const first = setup((issuer) => ({ [`${issuer}/device`]: () => hang(starting) }));
		const onCode = vi.fn();
		const login = first.auth.login({ device: true, signal: starting.signal, onUrl: noUrl, onCode });
		expect(await settle(login)).toBeInstanceOf(AbortError);
		expect(onCode).not.toHaveBeenCalled();
		expect(await first.auth.status()).toEqual({ source: "none", storage: noLogins });

		const polling = new AbortController();
		const second = setup();
		const waiting = second.auth.login({
			device: true,
			signal: polling.signal,
			onUrl: noUrl,
			onCode: fakeTimersFrom(() => void setTimeout(() => polling.abort(), 1_000)),
		});
		expect(await settle(waiting)).toBeInstanceOf(AbortError);
		expect(second.requests.some((request) => request.body.get("grant_type"))).toBe(false);
		expect(await second.auth.status()).toEqual({ source: "none", storage: noLogins });
	});
});

describe("login() without a person at a terminal", () => {
	it.each([
		["on CI", { tty: true, ci: true }],
		["without a terminal", { tty: false }],
	])("refuses %s before any request", async (_name, state) => {
		terminal(state);
		const { auth, requests } = setup();
		const options: LoginOptions = { onUrl: noUrl, onCode: noCode };
		const error = await rejection(auth.login(options));
		expect(error).toBeInstanceOf(LoginRequiresInteractionError);
		expect((error as LoginRequiresInteractionError).code).toBe("login-requires-interaction");
		expect((error as Error).message).toContain("device login");
		expect((error as Error).message).not.toContain("ACME_TOKEN");
		expect(requests).toEqual([]);
	});

	it("names the token variable when env is configured", async () => {
		terminal({ tty: false });
		const { auth } = setup(undefined, { env: "ACME_TOKEN" });
		const error = await rejection(auth.login({ onUrl: noUrl, onCode: noCode }));
		expect((error as Error).message).toContain("or set ACME_TOKEN to a token");
	});

	it("runs the device login when asked to, even on CI", async () => {
		terminal({ tty: false, ci: true });
		const { auth } = setup();
		const onCode = vi.fn();
		expect(
			await settle(auth.login({ device: true, onUrl: noUrl, onCode: fakeTimersFrom(onCode) })),
		).toBeUndefined();
		expect(onCode).toHaveBeenCalledTimes(1);
	});
});

it("an OAuthConfigError from a building block reaches the caller", async () => {
	const { auth } = setup(undefined, { metadata: { authorization_endpoint: undefined } });
	const error = await rejection(auth.login({ onUrl: noUrl, onCode: noCode }));
	expect(error).toBeInstanceOf(OAuthConfigError);
	expect((error as OAuthConfigError).reason).toBe("unsupported");
});

/** Signs in through the browser and returns the client's world. */
async function signedIn(...args: Parameters<typeof setup>) {
	const world = setup(...args);
	await world.auth.login({ onUrl: browser().onUrl, onCode: noCode });
	return world;
}

describe("the stored login", () => {
	it("token() returns it, refreshes it when it is about to expire, and checks the API origin", async () => {
		let issued = 0;
		const { auth, tokenRequests } = await signedIn((issuer) => ({
			[`${issuer}/token`]: () => {
				issued += 1;
				return json({ ...TOKEN, access_token: `AT${issued}`, expires_in: issued === 1 ? 1 : 3600 });
			},
		}));
		const { token } = auth;
		const first = await token({ baseUrl: `${API}/v1` });
		expect(first).toMatchObject({ value: "AT2", source: "login" });
		expect(tokenRequests()).toHaveLength(2);
		expect(JSON.stringify(first)).not.toContain("AT2");
		expect((await first.refresh!({})).value).toBe("AT3");
		expect(await rejection(token({ baseUrl: "https://evil.example" }))).toBeInstanceOf(
			CredentialMismatchError,
		);
	});

	it("records the login's resource, and a refresh sends it as a token source would", async () => {
		const resource = ["https://api.example.com", "urn:example:api"];
		let issued = 0;
		const { auth, dir, tokenRequests } = await signedIn(
			(issuer) => ({
				[`${issuer}/token`]: () => {
					issued += 1;
					return json({
						...TOKEN,
						access_token: `AT${issued}`,
						expires_in: issued === 1 ? 1 : 3600,
					});
				},
			}),
			{ resource },
		);
		const { records } = JSON.parse(readFileSync(join(dir, "credentials.json"), "utf8"));
		expect(
			Object.values(records).map((record) => (record as { resource?: unknown }).resource),
		).toEqual([resource]);
		expect(await auth.token()).toMatchObject({ value: "AT2" });
		expect(tokenRequests().map((request) => request.body.get("grant_type"))).toEqual([
			"authorization_code",
			"refresh_token",
		]);
		expect(tokenRequests()[1]!.body.getAll("resource")).toEqual(resource);
	});

	it("token() without baseUrl serves the user-info address on the issuer; with it, the origin check refuses", async () => {
		const { auth, issuer } = await signedIn();
		expect(await auth.token()).toMatchObject({ value: "AT", source: "login" });
		expect(await rejection(auth.token({ baseUrl: `${issuer}/userinfo` }))).toBeInstanceOf(
			CredentialMismatchError,
		);
	});

	it("token() without a login throws LoginRequiredError", async () => {
		const { auth } = setup();
		const error = await rejection(auth.token());
		expect(error).toBeInstanceOf(LoginRequiredError);
		expect((error as LoginRequiredError).code).toBe("login-required");
	});

	it("an env token wins, and is never stored or refreshed", async () => {
		const { auth, dir, tokenRequests } = setup(undefined, { env: "ACME_TOKEN" });
		vi.stubEnv("ACME_TOKEN", "ENV_TOKEN");
		const envToken = await auth.token();
		expect(envToken).toEqual({ value: "ENV_TOKEN", source: "env" });
		expect(envToken.refresh).toBeUndefined();
		expect(await auth.status()).toEqual({ source: "env" });
		await auth.login({ onUrl: browser().onUrl, onCode: noCode });
		expect((await auth.token()).value).toBe("ENV_TOKEN");
		expect(readFileSync(join(dir, "credentials.json"), "utf8")).not.toContain("ENV_TOKEN");
		expect(tokenRequests()).toHaveLength(1);
		vi.stubEnv("ACME_TOKEN", "  ");
		expect(await auth.token()).toMatchObject({ value: "AT", source: "login" });
	});

	it.each(["corrupt", "unsafe"])(
		"status() with an env token reads neither the file nor the keyring, even when it is %s",
		async (state) => {
			const keyring = fakeKeyring();
			const { auth, dir } = await signedIn(undefined, { env: "ACME_TOKEN" });
			if (state === "corrupt") writeFileSync(join(dir, "credentials.json"), "{ not json");
			else if (process.platform !== "win32") chmodSync(dir, 0o777);
			vi.stubEnv("ACME_TOKEN", "ENV_TOKEN");
			const reads = keyring.calls.length;
			expect(await auth.status()).toEqual({ source: "env" });
			expect(keyring.calls.length).toBe(reads);
			expect((await auth.token()).value).toBe("ENV_TOKEN");
		},
	);

	it("an env token is trimmed and honors an aborted signal", async () => {
		const { auth } = setup(undefined, { env: "ACME_TOKEN" });
		vi.stubEnv("ACME_TOKEN", "  ENV_TOKEN\n");
		expect((await auth.token()).value).toBe("ENV_TOKEN");
		expect(await rejection(auth.token({ signal: AbortSignal.abort() }))).toBeInstanceOf(AbortError);
	});

	it("an abort while the commit waits for the file's lock stores nothing", async () => {
		const controller = new AbortController();
		const world = setup((issuer) => ({
			[`${issuer}/token`]: () => {
				// The commit is waiting for the held lock by the time this fires.
				setTimeout(() => controller.abort(), 50);
				return json(TOKEN);
			},
		}));
		const store = credentialStore({ app: world.app });
		const other = createTokenSource({
			config: defineServers({ servers: [{ issuer: world.issuer, clientId: "cli" }] }),
			identity: { issuer: world.issuer, clientId: "cli", apiOrigins: [API] },
			store,
		});
		const play = browser();
		let lock: { release(): Promise<void> } | undefined;
		const error = await rejection(
			world.auth.login({
				signal: controller.signal,
				onUrl: async (prompt) => {
					lock = await holdLock((fn) =>
						credentialStoreInternals(store).lockIdentity(other.key, fn),
					);
					play.onUrl(prompt);
				},
				onCode: noCode,
			}),
		);
		await lock!.release();
		expect(error).toBeInstanceOf(AbortError);
		expect(world.tokenRequests()).toHaveLength(1);
		expect(await world.auth.status()).toEqual({ source: "none", storage: noLogins });
	});

	it("status() throws for a login stored for another issuer", async () => {
		const { auth, app } = setup();
		const otherIssuer = uniqueIssuer();
		await storeLogin(
			createTokenSource({
				config: defineServers({ servers: [{ issuer: otherIssuer, clientId: "cli" }] }),
				identity: { issuer: otherIssuer, clientId: "cli", apiOrigins: [API] },
				store: credentialStore({ app }),
			}),
		);
		const error = await rejection(auth.status());
		expect(error).toBeInstanceOf(CredentialMismatchError);
		expect((error as CredentialMismatchError).reason).toBe("issuer");
	});

	it("status() throws for a credentials file that is a symbolic link", async () => {
		const { auth, dir, root } = await signedIn();
		const file = join(dir, "credentials.json");
		const target = join(root, "target.json");
		writeFileSync(target, readFileSync(file));
		rmSync(file);
		try {
			symlinkSync(target, file, "file");
		} catch (error) {
			// Windows without the symlink privilege: nothing to refuse.
			if ((error as NodeJS.ErrnoException).code === "EPERM") return;
			throw error;
		}
		expect(await rejection(auth.status())).toBeInstanceOf(UnsafeStorageError);
	});

	// Another user who can write to the directory could have planted the file.
	it.skipIf(process.platform === "win32")(
		"status() and token() refuse a login in a directory others can write to",
		async () => {
			const { auth, dir } = await signedIn();
			chmodSync(dir, 0o777);
			expect(await rejection(auth.status())).toBeInstanceOf(UnsafeStorageError);
			expect(await rejection(auth.token())).toBeInstanceOf(UnsafeStorageError);
		},
	);

	it("status() reports the three sources without a request or waiting for a lock", async () => {
		const { auth, app, issuer, fetch, requests } = setup();
		expect(await auth.status()).toEqual({ source: "none", storage: noLogins });
		await auth.login({ onUrl: browser().onUrl, onCode: noCode });
		const before = requests.length;
		// Another process of the app holds the login's lock.
		const store = credentialStore({ app });
		const other = createTokenSource({
			config: defineServers({ servers: [{ issuer, clientId: "cli" }] }),
			identity: { issuer, clientId: "cli", apiOrigins: [API] },
			store,
			fetch,
		});
		const lock = await holdLock((fn) =>
			credentialStoreInternals(store).lockIdentity(other.key, fn),
		);
		expect(await auth.status()).toEqual({
			source: "login",
			expiresAt: expect.any(Number),
			scope: "read",
			storage: { kind: "file", plaintextRecords: 1 },
		});
		await lock.release();
		expect(requests).toHaveLength(before);
	});

	it("status() throws for a corrupt file", async () => {
		const { auth, dir } = await signedIn();
		writeFileSync(join(dir, "credentials.json"), "{ not json");
		expect(await rejection(auth.status())).toBeInstanceOf(CredentialStoreCorruptError);
	});

	it("logout() deletes the login and revokes it, detached", async () => {
		const { auth, requests, issuer } = await signedIn();
		const { logout } = auth;
		expect(await logout()).toEqual({ local: "deleted", remote: "revoked" });
		expect(await auth.status()).toEqual({ source: "none", storage: noLogins });
		expect(requests.filter(({ url }) => url === `${issuer}/revoke`).length).toBeGreaterThan(0);
	});

	it("a logout while a login runs is not undone", async () => {
		const { auth } = setup();
		const play = browser();
		const error = await rejection(
			auth.login({
				onUrl: async (prompt) => {
					await auth.logout();
					play.onUrl(prompt);
				},
				onCode: noCode,
			}),
		);
		expect(error).toBeInstanceOf(StaleCommitError);
		expect(await auth.status()).toEqual({ source: "none", storage: noLogins });
	});
});

describe("storage", () => {
	it("encrypts the login under a key in the OS keyring by default; status() reads the key, never writes it", async () => {
		const keyring = fakeKeyring("napi-keyring");
		const warnings: AuthWarning[] = [];
		const { auth, app, dir } = setup(undefined, { onWarning: (warning) => warnings.push(warning) });
		expect(await auth.status()).toEqual({
			source: "none",
			storage: { kind: "napi-keyring", plaintextRecords: 0 },
		});
		await auth.login({ onUrl: browser().onUrl, onCode: noCode });
		const text = readFileSync(join(dir, "credentials.json"), "utf8");
		expect(JSON.parse(text).encryption).toEqual({
			kind: "aes-256-gcm",
			keyId: keyring.entry(app)!.keyId,
			keyring: "napi-keyring",
		});
		expect(text).not.toMatch(/"AT"|"RT"/);
		expect((await auth.token()).value).toBe("AT");
		const before = keyring.calls.length;
		expect((await auth.status()).storage).toEqual({ kind: "napi-keyring", plaintextRecords: 0 });
		expect(keyring.calls.length - before).toBeLessThanOrEqual(1);
		expect(keyring.writes()).toBe(1);
		expect(warnings).toEqual([]);
	});

	it("without a keyring, stores the login in plaintext and tells onWarning once, printing nothing", async () => {
		const warnings: AuthWarning[] = [];
		const { auth } = setup(undefined, { onWarning: (warning) => warnings.push(warning) });
		await auth.login({ onUrl: browser().onUrl, onCode: noCode });
		await auth.login({ onUrl: browser().onUrl, onCode: noCode });
		expect(warnings).toEqual([{ code: "plaintext-storage" }]);
		expect(writes).toEqual([]);
		expect((await auth.status()).storage).toEqual({ kind: "file", plaintextRecords: 1 });
	});

	it("strict refuses to store a login without a keyring, with a typed key error", async () => {
		const { auth } = setup(undefined, { strict: true });
		const error = await rejection(auth.login({ onUrl: browser().onUrl, onCode: noCode }));
		expect(error).toBeInstanceOf(CredentialKeyError);
		expect(error).toMatchObject({ code: "credential-key", reason: "unavailable" });
		expect(await auth.status()).toEqual({ source: "none", storage: noLogins });
	});

	it("rejects a strict or onWarning of the wrong type", () => {
		for (const options of [{ strict: "yes" }, { onWarning: "print" }]) {
			expect(() => setup(undefined, options as never)).toThrow(OAuthConfigError);
		}
	});
});

describe("without profiles", () => {
	it("writes the same credentials file bytes as before profiles existed, for login, refresh and logout", async () => {
		const temp = tempApp();
		roots.push(temp.root);
		vi.useFakeTimers({ toFake: ["Date"], now: Date.UTC(2026, 0, 1) });
		const issuer = "https://golden.example";
		let issued = 0;
		const { fetch } = fakeFetch({
			[wellKnown(issuer)]: () => json(metadataFor(issuer)),
			[`${issuer}/token`]: () => {
				issued += 1;
				return json({ ...TOKEN, access_token: `AT${issued}`, expires_in: issued === 1 ? 1 : 3600 });
			},
			[`${issuer}/revoke`]: () => new Response(null, { status: 200 }),
		});
		const auth = createAuth({ app: temp.app, issuer, clientId: "cli", apiOrigins: [API], fetch });
		// Random ids are numbered by first appearance; everything else is compared byte for byte.
		const ids = new Map<string, string>();
		const file = () =>
			readFileSync(join(temp.dir, "credentials.json"), "utf8").replace(
				/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g,
				(id) => ids.get(id) ?? (ids.set(id, `id-${ids.size + 1}`), `id-${ids.size}`),
			);
		await auth.login({ onUrl: browser().onUrl, onCode: noCode });
		const afterLogin = file();
		expect((await auth.token()).value).toBe("AT2");
		const afterRefresh = file();
		await auth.logout();
		expect([afterLogin, afterRefresh, file()]).toMatchInlineSnapshot(`
			[
			  "{
				"version": 1,
				"storeId": "id-1",
				"encryption": {
					"kind": "plaintext"
				},
				"records": {
					"default#qoqhgI6SdnPNKWNZ1a3M8AuWgbwS7niCcqo8mRUmu-k": {
						"epoch": "id-2",
						"identity": {
							"issuer": "https://golden.example",
							"clientId": "cli",
							"profile": "default",
							"apiOrigins": [
								"https://api.example.com"
							]
						},
						"generation": "id-3",
						"tokenType": "Bearer",
						"expiresAt": 1767225601000,
						"scope": "read",
						"secret": {
							"accessToken": "AT1",
							"refreshToken": "RT"
						}
					}
				}
			}",
			  "{
				"version": 1,
				"storeId": "id-1",
				"encryption": {
					"kind": "plaintext"
				},
				"records": {
					"default#qoqhgI6SdnPNKWNZ1a3M8AuWgbwS7niCcqo8mRUmu-k": {
						"epoch": "id-2",
						"identity": {
							"issuer": "https://golden.example",
							"clientId": "cli",
							"profile": "default",
							"apiOrigins": [
								"https://api.example.com"
							]
						},
						"generation": "id-4",
						"tokenType": "Bearer",
						"expiresAt": 1767229200000,
						"scope": "read",
						"secret": {
							"accessToken": "AT2",
							"refreshToken": "RT"
						}
					}
				}
			}",
			  "{
				"version": 1,
				"storeId": "id-1",
				"encryption": {
					"kind": "plaintext"
				},
				"records": {
					"default#qoqhgI6SdnPNKWNZ1a3M8AuWgbwS7niCcqo8mRUmu-k": {
						"epoch": "id-5",
						"identity": {
							"issuer": "https://golden.example",
							"clientId": "cli",
							"profile": "default",
							"apiOrigins": [
								"https://api.example.com"
							]
						},
						"tombstone": true
					}
				}
			}",
			]
		`);
	});
});

/**
 * A client with `profiles` over `setup()`'s server: every login gets the next token, `AT1`,
 * `AT2`, and so on.
 */
function profiled(options: { env?: string; profilesEnv?: string } = {}) {
	let issued = 0;
	const world = setup((issuer) => ({
		[`${issuer}/token`]: () => {
			issued += 1;
			return json({ ...TOKEN, access_token: `AT${issued}` });
		},
	}));
	const auth = createAuth({
		app: world.app,
		issuer: world.issuer,
		clientId: "cli",
		apiOrigins: [API],
		scope: "read",
		fetch: world.fetch,
		env: options.env,
		profiles: { env: options.profilesEnv },
	});
	const signIn = (client: Pick<typeof auth, "login">) =>
		client.login({ onUrl: browser().onUrl, onCode: noCode });
	const document = () => JSON.parse(readFileSync(join(world.dir, "credentials.json"), "utf8"));
	return { ...world, auth, signIn, document };
}

describe("profiles", () => {
	it("are absent without the profiles option, and status() names no profile", async () => {
		const { auth } = await signedIn();
		expect(Object.keys(auth).sort()).toEqual(["login", "logout", "status", "token"]);
		expect(await auth.status()).not.toHaveProperty("profile");
	});

	it("validates the profiles option", async () => {
		const base = { app: "acme", issuer: "https://as.example", clientId: "cli", apiOrigins: [API] };
		for (const profiles of [null, [], "work", { env: "" }, { env: " " }, { env: 7 }]) {
			const created = Promise.resolve().then(() =>
				createAuth({ ...base, profiles: profiles as never }),
			);
			expect(await configReason(created)).toBe("invalid-option");
		}
		const noOrigins = Promise.resolve().then(() =>
			createAuth({ ...base, apiOrigins: [], profiles: {} }),
		);
		expect(await configReason(noOrigins)).toBe("invalid-option");
		const auth = createAuth({ ...base, profiles: {} });
		expect(Object.isFrozen(auth) && Object.isFrozen(auth.profiles)).toBe(true);
		expect(Object.keys(auth).sort()).toEqual([
			"login",
			"logout",
			"profile",
			"profiles",
			"status",
			"token",
		]);
	});

	it("keep two logins side by side, each with its own token, refresh and logout, detached", async () => {
		const { auth, signIn, tokenRequests } = profiled();
		const { profile } = auth;
		const work = profile("work");
		await signIn(auth);
		await signIn(work);
		expect((await auth.token()).value).toBe("AT1");
		expect((await profile("default").token()).value).toBe("AT1");
		const { token } = work;
		const workToken = await token();
		expect(workToken.value).toBe("AT2");
		expect((await workToken.refresh!({})).value).toBe("AT3");
		expect((await auth.token()).value).toBe("AT1");
		expect(tokenRequests().map((request) => request.body.get("grant_type"))).toEqual([
			"authorization_code",
			"authorization_code",
			"refresh_token",
		]);
		expect(await work.status()).toMatchObject({
			source: "login",
			profile: { name: "work", via: "argument" },
		});
		expect(await work.logout()).toEqual({ local: "deleted", remote: "revoked" });
		expect(await work.status()).toMatchObject({ source: "none" });
		expect((await auth.token()).value).toBe("AT1");
		expect(await auth.profiles.list()).toEqual([{ name: "default", current: true }]);
	});

	it("pick the current profile: argument, then the env variable, then use(), then default", async () => {
		const { auth, signIn } = profiled({ profilesEnv: "ACME_PROFILE" });
		vi.stubEnv("ACME_PROFILE", "");
		const via = async (client: Pick<typeof auth, "status"> = auth) =>
			(await client.status()).profile;
		expect(await via()).toEqual({ name: "default", via: "default" });
		expect(await via(auth.profile())).toEqual({ name: "default", via: "default" });
		await signIn(auth.profile("work"));
		await auth.profiles.use("work");
		expect(await via()).toEqual({ name: "work", via: "current" });
		vi.stubEnv("ACME_PROFILE", " personal\n");
		expect(await via()).toEqual({ name: "personal", via: "env" });
		expect(await via(auth.profile(undefined))).toEqual({ name: "personal", via: "env" });
		expect(await via(auth.profile("work"))).toEqual({ name: "work", via: "argument" });
		vi.stubEnv("ACME_PROFILE", "  ");
		expect(await via()).toEqual({ name: "work", via: "current" });
		expect((await auth.token()).value).toBe("AT1");
	});

	it("a profile with no login is told to log in, by name, however it was picked", async () => {
		const { auth } = profiled({ profilesEnv: "ACME_PROFILE" });
		const missing = async (client: Pick<typeof auth, "token" | "status">, name: string) => {
			const error = await rejection(client.token());
			expect(error).toBeInstanceOf(LoginRequiredError);
			expect(error).toMatchObject({ reason: "missing" });
			expect((error as Error).message).toContain(`"${name}"`);
			expect(await client.status()).toMatchObject({ source: "none" });
		};
		await missing(auth, "default");
		await missing(auth.profile("work"), "work");
		vi.stubEnv("ACME_PROFILE", "personal");
		await missing(auth, "personal");
	});

	it("an env token wins for every profile, and status() then reads no file", async () => {
		const { auth, signIn, dir } = profiled({ env: "ACME_TOKEN", profilesEnv: "ACME_PROFILE" });
		await signIn(auth);
		vi.stubEnv("ACME_TOKEN", "ENV_TOKEN");
		vi.stubEnv("ACME_PROFILE", "personal");
		writeFileSync(join(dir, "credentials.json"), "{ not json");
		for (const client of [auth, auth.profile("work"), auth.profile()]) {
			expect(await client.token()).toEqual({ value: "ENV_TOKEN", source: "env" });
			expect(await client.status()).toEqual({ source: "env" });
		}
	});

	it("list() shows this server's logins by name, from the file only", async () => {
		const keyring = fakeKeyring();
		const { auth, signIn, app, requests } = profiled();
		await signIn(auth.profile("work"));
		await signIn(auth.profile("b-side"));
		await signIn(auth);
		await auth.profile("b-side").logout();
		const otherIssuer = uniqueIssuer();
		await storeLogin(
			createTokenSource({
				config: defineServers({ servers: [{ issuer: otherIssuer, clientId: "cli" }] }),
				identity: { issuer: otherIssuer, clientId: "cli", apiOrigins: [API], profile: "elsewhere" },
				store: credentialStore({ app, keyring: {} }),
			}),
		);
		const before = { requests: requests.length, keyring: keyring.calls.length };
		const { list } = auth.profiles;
		expect(await list()).toEqual([
			{ name: "default", current: true },
			{ name: "work", current: false },
		]);
		expect({ requests: requests.length, keyring: keyring.calls.length }).toEqual(before);
	});

	it("use() remembers a profile with a login, and refuses one without, writing nothing", async () => {
		const keyring = fakeKeyring();
		const { auth, signIn, document, dir } = profiled();
		await signIn(auth.profile("work"));
		await signIn(auth.profile("gone"));
		await auth.profile("gone").logout();
		const { use } = auth.profiles;
		for (const name of ["nobody", "gone"]) {
			const before = readFileSync(join(dir, "credentials.json"), "utf8");
			const error = await rejection(use(name));
			expect(error).toBeInstanceOf(LoginRequiredError);
			expect(error).toMatchObject({ reason: "missing" });
			expect((error as Error).message).toContain(`"${name}"`);
			expect(readFileSync(join(dir, "credentials.json"), "utf8")).toBe(before);
		}
		expect(await rejection(use("work", { signal: AbortSignal.abort() }))).toBeInstanceOf(
			AbortError,
		);
		expect(await auth.profiles.list()).toEqual([{ name: "work", current: false }]);
		expect(await use("work")).toBeUndefined();
		expect(await auth.profiles.list()).toEqual([{ name: "work", current: true }]);
		expect((await auth.token()).value).toBe("AT1");
		// The file stays encrypted; the remembered profile is not a secret.
		expect(document().encryption).toMatchObject({ kind: "aes-256-gcm" });
		expect(Object.values(document().currentProfile)).toEqual(["work"]);
		expect(keyring.writes()).toBe(1);
	});

	it("the remembered profile survives other profiles' logins, refreshes and logouts, and its own logout clears it", async () => {
		const { auth, signIn, document } = profiled();
		await signIn(auth.profile("work"));
		await auth.profiles.use("work");
		const personal = auth.profile("personal");
		await signIn(personal);
		await (
			await personal.token()
		).refresh!({});
		await personal.logout();
		expect((await auth.status()).profile).toEqual({ name: "work", via: "current" });
		await auth.profile("work").logout();
		expect((await auth.status()).profile).toEqual({ name: "default", via: "default" });
		expect(document()).not.toHaveProperty("currentProfile");
	});

	it("a login does not change the current profile", async () => {
		const { auth, signIn } = profiled();
		await signIn(auth.profile("work"));
		expect((await auth.status()).profile).toEqual({ name: "default", via: "default" });
	});

	it("refuse a bad name where it is received, without echoing it", async () => {
		const { auth } = profiled({ profilesEnv: "ACME_PROFILE" });
		const long = "a".repeat(65);
		for (const name of ["", ".work", "-work", "a/b", "a b", "wörk", "a#b", long]) {
			let error: unknown;
			try {
				auth.profile(name);
			} catch (caught) {
				error = caught;
			}
			expect(error).toMatchObject({ code: "oauth-config", reason: "invalid-option" });
			expect(await configReason(auth.profiles.use(name))).toBe("invalid-option");
			vi.stubEnv("ACME_PROFILE", name === "" ? "." : name);
			const fromEnv = await rejection(auth.token());
			expect(fromEnv).toMatchObject({ reason: "invalid-option" });
			expect((fromEnv as Error).message).toContain("ACME_PROFILE");
			for (const message of [(error as Error).message, (fromEnv as Error).message]) {
				if (name.length > 1) expect(message).not.toContain(name);
			}
		}
		vi.stubEnv("ACME_PROFILE", "");
		for (const name of ["a", "A_b-1.2", "0", "_x", "a".repeat(64)]) {
			expect(await auth.profile(name).status()).toMatchObject({ profile: { name } });
		}
	});
});
