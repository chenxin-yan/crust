/**
 * @module-tag windows
 * @module-tag macos
 */
import { once } from "node:events";
import { type AddressInfo, createServer } from "node:net";

import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
	callbackPath,
	configReason,
	fakeFetch,
	isClosed,
	json,
	metadataFor,
	rawRequest,
	type RawResponse,
	restoreTerminal,
	terminal,
	uniqueIssuer,
	wellKnown,
} from "../tests/helpers.ts";
import { createAuth } from "./client.ts";
import { deviceCodeMessage } from "./display.ts";
import { AbortError, LoginRequiresInteractionError, OAuthConfigError } from "./errors.ts";
import type { BrowserLoginPrompt, DeviceLoginPrompt, LoginOptions } from "./types.ts";

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
const TOKEN = { access_token: "AT", refresh_token: "RT", token_type: "Bearer", expires_in: 3600 };

const writes: string[] = [];

beforeEach(() => {
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
});

type Route = Parameters<typeof fakeFetch>[0][string];

/** A fresh authorization server behind a fake fetch, and a client for it. */
function setup(
	routes: (issuer: string) => Record<string, Route> = () => ({}),
	options: { name?: string; scope?: string; ports?: number[] } = {},
) {
	const issuer = uniqueIssuer();
	const fake = fakeFetch({
		[wellKnown(issuer)]: () => json(metadataFor(issuer)),
		[`${issuer}/token`]: () => json(TOKEN),
		[`${issuer}/device`]: () => json(DEVICE),
		...routes(issuer),
	});
	const auth = createAuth({
		app: "acme",
		issuer,
		clientId: "cli",
		scope: "read",
		fetch: fake.fetch,
		...options,
	});
	return { issuer, auth, ...fake };
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
		const base = { app: "acme", issuer: "https://as.example", clientId: "cli", fetch };
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
		expect(await reason({ ports: [70_000] })).toBe("invalid-option");
		expect(await reason({ hosts: ["localhost"] })).toBe("invalid-option");
		expect(() =>
			createAuth({ ...base, issuer: "http://127.0.0.1:9000", allowInsecureLoopback: true }),
		).not.toThrow();
	});
});

describe("login() in a browser", () => {
	it("signs in end to end with a detached login and closes the listener", async () => {
		const { auth, requests } = setup();
		const { login } = auth;
		const play = browser();
		const tokens = await login({ onUrl: play.onUrl, onCode: noCode });
		expect(tokens).toMatchObject({ accessToken: "AT", refreshToken: "RT" });
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
		expect(await auth.login({ onUrl: browser().onUrl, onCode: noCode })).toMatchObject({
			accessToken: "AT",
		});
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
	});

	it("aborts during discovery before any listener", async () => {
		const controller = new AbortController();
		const { auth } = setup((issuer) => ({ [wellKnown(issuer)]: () => hang(controller) }));
		const onUrl = vi.fn();
		const error = await rejection(auth.login({ signal: controller.signal, onUrl, onCode: noCode }));
		expect(error).toBeInstanceOf(AbortError);
		expect(onUrl).not.toHaveBeenCalled();
	});
});

describe("login() with a device code", () => {
	beforeEach(() => {
		vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
	});

	async function settle<T>(promise: Promise<T>, ms = 6_000): Promise<unknown> {
		const result = promise.catch((error: unknown) => error);
		await vi.advanceTimersByTimeAsync(ms);
		return result;
	}

	it("shows the code through onCode, never the device code, and writes nothing", async () => {
		const { auth } = setup(undefined, { name: "Acme" });
		const prompts: DeviceLoginPrompt[] = [];
		const tokens = await settle(
			auth.login({ device: true, onUrl: noUrl, onCode: (prompt) => void prompts.push(prompt) }),
		);
		expect(tokens).toMatchObject({ accessToken: "AT" });
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
		const { auth } = setup();
		let message = "";
		await settle(
			auth.login({
				device: true,
				onUrl: noUrl,
				onCode: (prompt) => void (message = prompt.message),
			}),
		);
		expect(message).toContain("To sign in to acme, open:");
	});

	it("uses the device login where no browser can open", async () => {
		vi.stubEnv("SSH_CONNECTION", "1 2 3 4");
		const { auth } = setup();
		const onCode = vi.fn();
		await settle(auth.login({ onUrl: noUrl, onCode }));
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
	});

	it("aborts while starting and while polling", async () => {
		const starting = new AbortController();
		const first = setup((issuer) => ({ [`${issuer}/device`]: () => hang(starting) }));
		const onCode = vi.fn();
		const login = first.auth.login({ device: true, signal: starting.signal, onUrl: noUrl, onCode });
		expect(await settle(login)).toBeInstanceOf(AbortError);
		expect(onCode).not.toHaveBeenCalled();

		const polling = new AbortController();
		const second = setup();
		const waiting = second.auth.login({
			device: true,
			signal: polling.signal,
			onUrl: noUrl,
			onCode: () => void setTimeout(() => polling.abort(), 1_000),
		});
		expect(await settle(waiting)).toBeInstanceOf(AbortError);
		expect(second.requests.some((request) => request.body.get("grant_type"))).toBe(false);
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
		expect(requests).toEqual([]);
	});

	it("runs the device login when asked to, even on CI", async () => {
		terminal({ tty: false, ci: true });
		vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
		const { auth } = setup();
		const onCode = vi.fn();
		const result = auth.login({ device: true, onUrl: noUrl, onCode }).catch((error) => error);
		await vi.advanceTimersByTimeAsync(6_000);
		expect(await result).toMatchObject({ accessToken: "AT" });
		expect(onCode).toHaveBeenCalledTimes(1);
	});
});

it("an OAuthConfigError from a building block reaches the caller", async () => {
	const issuer = uniqueIssuer();
	const fake = fakeFetch({
		[wellKnown(issuer)]: () => json(metadataFor(issuer, { authorization_endpoint: undefined })),
	});
	const auth = createAuth({ app: "acme", issuer, clientId: "cli", fetch: fake.fetch });
	const error = await rejection(auth.login({ onUrl: noUrl, onCode: noCode }));
	expect(error).toBeInstanceOf(OAuthConfigError);
	expect((error as OAuthConfigError).reason).toBe("unsupported");
});
