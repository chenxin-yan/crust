import { once } from "node:events";
import { Server } from "node:http";
import { connect } from "node:net";

import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { callbackPath, isClosed, rawRequest, setupServer } from "../tests/helpers.ts";
import {
	AbortError,
	IssuerMismatchError,
	OAuthConfigError,
	OAuthError,
	TimeoutError,
} from "./errors.ts";
import type { LoopbackListener } from "./loopback.ts";
import { pkceChallenge } from "./pkce.ts";
import type {
	AuthorizationSession,
	AuthorizationSessionOptions,
	CallbackPageView,
} from "./types.ts";

// Pass-through wrapper so tests can count binds and inject a listener whose path differs.
const loopback = vi.hoisted(() => ({
	pathOverride: undefined as string | undefined,
	last: undefined as LoopbackListener | undefined,
}));
vi.mock("./loopback.ts", async (importOriginal) => {
	const actual = await importOriginal<typeof import("./loopback.ts")>();
	return {
		...actual,
		listenLoopback: vi.fn(async (...args: Parameters<typeof actual.listenLoopback>) => {
			const listener = await actual.listenLoopback(...args);
			loopback.last = listener;
			return loopback.pathOverride ? { ...listener, path: loopback.pathOverride } : listener;
		}),
	};
});

const { listenLoopback } = await import("./loopback.ts");
const { createAuthorizationSession, DEFAULT_WAIT_MS, sessionInternals } =
	await import("./session.ts");

const sessions: AuthorizationSession[] = [];

afterEach(() => {
	for (const session of sessions.splice(0)) session.close();
	loopback.pathOverride = undefined;
	vi.useRealTimers();
	vi.restoreAllMocks();
	vi.mocked(listenLoopback).mockClear();
});

async function open(
	options: AuthorizationSessionOptions = {},
	setup: Parameters<typeof setupServer>[0] = {},
) {
	const { server } = await setupServer(setup);
	const session = await createAuthorizationSession(server, options);
	sessions.push(session);
	return session;
}

const good = (session: AuthorizationSession, extra: Record<string, string> = {}) =>
	callbackPath(session.redirectUri, { code: "CODE", state: session.state, ...extra });

function waitFor(
	session: AuthorizationSession,
	options: Parameters<AuthorizationSession["wait"]>[1] = {},
) {
	const onCallback = vi.fn(async ({ code }: { code: string }) => code);
	const result = session.wait(onCallback, options).then(
		(value) => ({ value }),
		(error: unknown) => ({ error }),
	);
	return { onCallback, result };
}

async function configReason(promise: Promise<unknown>): Promise<string> {
	const error = await promise.then(
		() => undefined,
		(caught: unknown) => caught,
	);
	expect(error).toBeInstanceOf(OAuthConfigError);
	return (error as OAuthConfigError).reason;
}

describe("createAuthorizationSession", () => {
	it("SEC-A3 SEC-B2 SEC-DEC-02 SEC-DEC-20 builds a code request with S256 PKCE and state", async () => {
		const session = await open();
		const params = new URL(session.url).searchParams;
		expect(params.getAll("response_type")).toEqual(["code"]);
		expect(params.getAll("code_challenge_method")).toEqual(["S256"]);
		expect(params.getAll("code_challenge")).toHaveLength(1);
		expect(params.getAll("state")).toEqual([session.state]);
		expect(params.get("client_id")).toBe("cli");
		expect(params.has("response_mode")).toBe(false);
		expect(params.has("nonce")).toBe(false);
	});

	it("SEC-A9 SEC-B6 puts only a random state and no default scope in the URL", async () => {
		const session = await open();
		const params = new URL(session.url).searchParams;
		expect(params.get("state")).toMatch(/^[A-Za-z0-9_-]{43}$/);
		expect(params.has("scope")).toBe(false);
		expect(session.url).not.toContain("scope=");
		const scoped = await open({ scope: "read write" });
		expect(new URL(scoped.url).searchParams.get("scope")).toBe("read write");
	});

	it.each([
		[{ state: "x" }, "reserved-parameter"],
		[{ resource: "urn:a" }, "reserved-parameter"],
		[{ response_mode: "fragment" }, "reserved-parameter"],
		[{ request_uri: "urn:x" }, "reserved-parameter"],
		[{ request: "jwt" }, "reserved-parameter"],
		[{ nonce: "n" }, "reserved-parameter"],
		[{ code_challenge_method: "plain" }, "reserved-parameter"],
		[{ "": "x" }, "invalid-option"],
		[{ a: 1 }, "invalid-option"],
	])("SEC-B1 SEC-A4 refuses extra %j without binding", async (extra, expected) => {
		const { server } = await setupServer();
		// SAFETY: untyped extra values on purpose.
		expect(await configReason(createAuthorizationSession(server, { extra: extra as never }))).toBe(
			expected,
		);
		expect(listenLoopback).not.toHaveBeenCalled();
	});

	it.each([
		[
			"https://login.example/authorize?tenant=a%20b&sig=~&x=a+b",
			"https://login.example/authorize?tenant=a%20b&sig=~&x=a+b&",
		],
		["https://login.example/authorize?", "https://login.example/authorize?"],
		["https://login.example/authorize?tenant=t&", "https://login.example/authorize?tenant=t&"],
		["https://login.example/authorize", "https://login.example/authorize?"],
		["https://login.example/authorize&", "https://login.example/authorize&?"],
	])("SEC-B1 keeps the endpoint %s byte for byte", async (endpoint, prefix) => {
		const session = await open(
			{ extra: { "a&b": "c d" } },
			{ metadata: { authorization_endpoint: endpoint } },
		);
		expect(session.url.startsWith(`${prefix}response_type=code&`)).toBe(true);
		const url = new URL(session.url);
		expect(url.pathname).toBe(new URL(endpoint).pathname);
		expect(url.searchParams.get("response_type")).toBe("code");
		expect(url.searchParams.get("a&b")).toBe("c d");
	});

	it("SEC-B1 keeps the endpoint query once and refuses names that repeat it", async () => {
		const endpoint = {
			metadata: { authorization_endpoint: "https://login.example/authorize?tenant=t" },
		};
		const session = await open({}, endpoint);
		expect(new URL(session.url).searchParams.getAll("tenant")).toEqual(["t"]);
		const { server } = await setupServer(endpoint);
		expect(await configReason(createAuthorizationSession(server, { extra: { tenant: "b" } }))).toBe(
			"duplicate-parameter",
		);
		const encoded = await setupServer({
			metadata: { authorization_endpoint: "https://login.example/authorize?%74enant=a" },
		});
		expect(
			await configReason(createAuthorizationSession(encoded.server, { extra: { tenant: "b" } })),
		).toBe("duplicate-parameter");
		expect(listenLoopback).toHaveBeenCalledTimes(1);
	});

	it("SEC-B1 SEC-B5 encodes extra values and repeats only the typed resource", async () => {
		const session = await open({
			resource: ["urn:example:api", "https://a.example/v1/x"],
			extra: { "a&b": "c d", audience: "api" },
		});
		const params = new URL(session.url).searchParams;
		expect(params.getAll("resource")).toEqual(["urn:example:api", "https://a.example/v1/x"]);
		expect(params.get("a&b")).toBe("c d");
		expect(params.getAll("state")).toHaveLength(1);
	});

	it.each(["/relative", "https://a.example/#f", "", 7])(
		"SEC-B5 refuses the resource %j",
		async (resource) => {
			const { server } = await setupServer();
			// SAFETY: untyped resource values on purpose.
			expect(
				await configReason(createAuthorizationSession(server, { resource: resource as never })),
			).toBe("invalid-option");
		},
	);

	it.each([
		[{ hosts: ["0.0.0.0"] }],
		[{ hosts: ["localhost"] }],
		[{ hosts: ["::"] }],
		[{ hosts: [] }],
		[{ hosts: ["127.0.0.1", "127.0.0.1"] }],
		[{ ports: [70000] }],
		[{ ports: [-1] }],
		[{ ports: [1.5] }],
		[{ ports: [] }],
		[{ scope: "" }],
	])("SEC-C1 refuses %j before listening", async (options) => {
		const { server } = await setupServer();
		// SAFETY: untyped options on purpose.
		expect(await configReason(createAuthorizationSession(server, options as never))).toBe(
			"invalid-option",
		);
		expect(listenLoopback).not.toHaveBeenCalled();
	});

	it("SEC-C1 SEC-C2 SEC-C3 SEC-DEC-04 SEC-DEC-05 binds 127.0.0.1 on an ephemeral port by default", async () => {
		const first = await open();
		const second = await open();
		expect(first.redirectUri).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/);
		expect(loopback.last!.server.address()).toMatchObject({ address: "127.0.0.1" });
		expect(new URL(first.redirectUri).port).not.toBe(new URL(second.redirectUri).port);
		expect(first.redirectUri).not.toContain("localhost");
	});

	it("SEC-C3 SEC-C5 tries the next fixed port when one is taken, then fails with a typed error", async () => {
		const taken = await open();
		const port = Number(new URL(taken.redirectUri).port);
		expect(await configReason(open({ ports: [port] }))).toBe("loopback-unavailable");
		const next = await open({ ports: [port, 0] });
		expect(new URL(next.redirectUri).port).not.toBe(String(port));
		const listen = vi.spyOn(Server.prototype, "listen");
		await open();
		expect(JSON.stringify(listen.mock.calls[0]![0])).not.toContain("reusePort");
	});

	it("SEC-C16 SEC-DEC-04 falls back to [::1] only when 127.0.0.1 cannot bind", async () => {
		const original = Server.prototype.listen;
		vi.spyOn(Server.prototype, "listen").mockImplementation(function (
			this: Server,
			...args: unknown[]
		) {
			const [options] = args as [{ host?: string }];
			if (options?.host === "127.0.0.1") {
				process.nextTick(() =>
					this.emit("error", Object.assign(new Error("unavailable"), { code: "EADDRNOTAVAIL" })),
				);
				return this;
			}
			return (original as (...a: unknown[]) => Server).apply(this, args);
		});
		const session = await open({ hosts: ["127.0.0.1", "::1"] });
		expect(session.redirectUri).toMatch(/^http:\/\/\[::1\]:\d+\/callback$/);
		expect(loopback.last!.server.address()).toMatchObject({ address: "::1" });
		const { onCallback, result } = waitFor(session);
		expect((await rawRequest(session.redirectUri, good(session))).status).toBe(200);
		expect(await result).toEqual({ value: "CODE" });
		expect(onCallback).toHaveBeenCalledTimes(1);
		expect(await configReason(open())).toBe("loopback-unavailable");
	});

	it("SEC-A6 SEC-C9 SEC-A8 ignores wrong or missing state without consuming the slot", async () => {
		const session = await open();
		const { onCallback, result } = waitFor(session);
		const wrongLength = callbackPath(session.redirectUri, { code: "x", state: "WRONG" });
		const sameLength = callbackPath(session.redirectUri, {
			code: "x",
			state:
				`${session.state.slice(0, -1)}A` === session.state
					? `${session.state.slice(0, -1)}B`
					: `${session.state.slice(0, -1)}A`,
		});
		const missing = callbackPath(session.redirectUri, { code: "x" });
		for (const path of [wrongLength, sameLength, missing]) {
			expect((await rawRequest(session.redirectUri, path)).status).toBe(400);
		}
		expect(onCallback).not.toHaveBeenCalled();
		expect(
			(
				await rawRequest(
					session.redirectUri,
					callbackPath(session.redirectUri, { code: "y", state: session.state }),
				)
			).status,
		).toBe(200);
		expect(await result).toEqual({ value: "y" });
		expect(onCallback).toHaveBeenCalledTimes(1);
	});

	it("SEC-A7 accepts a valid callback once", async () => {
		const session = await open();
		let release!: () => void;
		const onCallback = vi.fn(
			() => new Promise<string>((resolve) => (release = () => resolve("done"))),
		);
		const result = session.wait(onCallback);
		const first = rawRequest(session.redirectUri, good(session));
		await vi.waitFor(() => expect(onCallback).toHaveBeenCalled());
		expect((await rawRequest(session.redirectUri, good(session))).status).toBe(400);
		release();
		expect((await first).status).toBe(200);
		expect(await result).toBe("done");
		await expect(rawRequest(session.redirectUri, good(session))).rejects.toMatchObject({
			code: "ECONNREFUSED",
		});
		expect(onCallback).toHaveBeenCalledTimes(1);
	});

	it.each([
		["POST", "/callback"],
		["GET", "/callback/"],
		["GET", "/CALLBACK"],
		["GET", "/callback%2f"],
		["GET", "//callback"],
		["GET", "/x/../callback"],
		["GET", "/%2e%2e/callback"],
		["GET", "/callback/."],
		["GET", "/%63allback"],
		["GET", "/favicon.ico"],
	])("SEC-C6 answers %s %s with 404 and keeps waiting", async (method, path) => {
		const session = await open();
		const { onCallback, result } = waitFor(session);
		const response = await rawRequest(
			session.redirectUri,
			`${path}?code=x&state=${session.state}`,
			{ method },
		);
		expect(response.status).toBe(404);
		expect(response.headers.connection).toBe("close");
		expect(response.headers["cache-control"]).toBe("no-store");
		expect(onCallback).not.toHaveBeenCalled();
		expect((await rawRequest(session.redirectUri, good(session))).status).toBe(200);
		expect(await result).toEqual({ value: "CODE" });
	});

	it("SEC-C6 SEC-C7 refuses an absolute-form request target", async () => {
		const session = await open();
		const { onCallback, result } = waitFor(session);
		expect(
			(
				await rawRequest(
					session.redirectUri,
					`${session.redirectUri}?code=x&state=${session.state}`,
				)
			).status,
		).toBe(404);
		expect(onCallback).not.toHaveBeenCalled();
		await rawRequest(session.redirectUri, good(session));
		expect(await result).toEqual({ value: "CODE" });
	});

	it.each([
		["a repeated code", (state: string) => `code=a&code=b&state=${state}`],
		["a repeated state", (state: string) => `code=a&state=${state}&state=${state}`],
		["a repeated iss", (state: string) => `code=a&state=${state}&iss=x&iss=y`],
		["a repeated error", (state: string) => `error=a&error=b&state=${state}`],
		["both code and error", (state: string) => `code=a&error=access_denied&state=${state}`],
	])("SEC-C7 answers 400 to %s and keeps waiting", async (_name, query) => {
		const session = await open();
		const { onCallback, result } = waitFor(session);
		const path = new URL(session.redirectUri).pathname;
		expect((await rawRequest(session.redirectUri, `${path}?${query(session.state)}`)).status).toBe(
			400,
		);
		expect(onCallback).not.toHaveBeenCalled();
		await rawRequest(session.redirectUri, good(session));
		expect(await result).toEqual({ value: "CODE" });
	});

	it.each(["evil.example:PORT", "localhost:PORT", "127.0.0.1", "127.0.0.1:1"])(
		"SEC-C8 SEC-DEC-06 refuses Host %s",
		async (host) => {
			const session = await open();
			const { onCallback, result } = waitFor(session);
			const port = new URL(session.redirectUri).port;
			const response = await rawRequest(session.redirectUri, good(session), {
				host: host.replace("PORT", port),
			});
			expect(response.status).toBe(421);
			expect(onCallback).not.toHaveBeenCalled();
			expect(
				(await rawRequest(session.redirectUri, good(session), { host: `127.0.0.1:${port}` }))
					.status,
			).toBe(200);
			expect(await result).toEqual({ value: "CODE" });
		},
	);

	it("SEC-C10 surfaces an error response with its allowlisted code and no exchange", async () => {
		const session = await open();
		const { onCallback, result } = waitFor(session);
		const response = await rawRequest(
			session.redirectUri,
			callbackPath(session.redirectUri, { error: "access_denied", state: session.state }),
		);
		expect(response.status).toBe(400);
		const { error } = (await result) as { error: OAuthError };
		expect(error).toBeInstanceOf(OAuthError);
		expect(error.code).toBe("access_denied");
		expect(onCallback).not.toHaveBeenCalled();
	});

	it("SEC-C10 SEC-I2 checks iss before the error", async () => {
		const session = await open();
		const { onCallback, result } = waitFor(session);
		await rawRequest(
			session.redirectUri,
			callbackPath(session.redirectUri, {
				error: "access_denied",
				state: session.state,
				iss: "https://evil.example",
			}),
		);
		const { error } = (await result) as { error: IssuerMismatchError };
		expect(error).toBeInstanceOf(IssuerMismatchError);
		expect(error.reason).toBe("mismatch");
		expect(onCallback).not.toHaveBeenCalled();
	});

	it("SEC-I2 rejects a mismatched iss and accepts an equal one", async () => {
		const session = await open();
		const mismatch = waitFor(session);
		await rawRequest(session.redirectUri, good(session, { iss: "https://evil.example" }));
		expect(((await mismatch.result) as { error: unknown }).error).toBeInstanceOf(
			IssuerMismatchError,
		);
		expect(mismatch.onCallback).not.toHaveBeenCalled();
		const matching = await open();
		const accepted = waitFor(matching);
		await rawRequest(matching.redirectUri, good(matching, { iss: matching.issuer }));
		expect(await accepted.result).toEqual({ value: "CODE" });
	});

	it("SEC-I3 SEC-C10 requires iss when the server advertises it", async () => {
		const session = await open(
			{},
			{ metadata: { authorization_response_iss_parameter_supported: true } },
		);
		expect(session.server.issPolicy).toBe("required");
		const { onCallback, result } = waitFor(session);
		await rawRequest(session.redirectUri, good(session));
		const { error } = (await result) as { error: IssuerMismatchError };
		expect(error).toBeInstanceOf(IssuerMismatchError);
		expect(error.reason).toBe("missing");
		expect(onCallback).not.toHaveBeenCalled();
	});

	it("SEC-I4 compares a present iss from a server that does not advertise it", async () => {
		const session = await open();
		expect(session.server.issParameterSupported).toBe(false);
		const { result } = waitFor(session);
		await rawRequest(session.redirectUri, good(session, { iss: session.issuer }));
		expect(await result).toEqual({ value: "CODE" });
		const other = await open();
		const mismatch = waitFor(other);
		await rawRequest(other.redirectUri, good(other, { iss: `${other.issuer}/` }));
		expect(((await mismatch.result) as { error: unknown }).error).toBeInstanceOf(
			IssuerMismatchError,
		);
	});

	it("SEC-I7 accepts a missing iss for one pinned issuer", async () => {
		const session = await open();
		expect(session.server.issPolicy).toBe("compare-if-present");
		const { result } = waitFor(session);
		await rawRequest(session.redirectUri, good(session));
		expect(await result).toEqual({ value: "CODE" });
	});

	it("SEC-I7 SEC-DEC-03 refuses an unprotected multi-server login before binding", async () => {
		const multi = await setupServer({
			others: [{ issuer: "https://other.example", clientId: "cli" }],
		});
		const listen = vi.spyOn(Server.prototype, "listen");
		expect(await configReason(createAuthorizationSession(multi.server))).toBe("mix-up-unprotected");
		const custom = await setupServer({ allowCustomIssuers: true });
		expect(await configReason(createAuthorizationSession(custom.server))).toBe(
			"mix-up-unprotected",
		);
		expect(listen).not.toHaveBeenCalled();
		expect(listenLoopback).not.toHaveBeenCalled();
	});

	it("SEC-I7 closes the listener when its path differs from the declared one", async () => {
		const { server } = await setupServer({
			server: { redirectPath: "/acme/callback" },
			others: [{ issuer: "https://other.example", clientId: "cli" }],
		});
		loopback.pathOverride = "/callback";
		expect(await configReason(createAuthorizationSession(server))).toBe("mix-up-unprotected");
		expect(loopback.last!.server.listening).toBe(false);
	});

	it("SEC-I7 serves only the declared per-issuer path", async () => {
		const session = await open(
			{},
			{
				server: { redirectPath: "/acme/callback" },
				others: [{ issuer: "https://other.example", clientId: "cli" }],
			},
		);
		expect(session.redirectUri).toMatch(/\/acme\/callback$/);
		const { onCallback, result } = waitFor(session);
		expect(
			(await rawRequest(session.redirectUri, `/callback?code=x&state=${session.state}`)).status,
		).toBe(404);
		expect(onCallback).not.toHaveBeenCalled();
		await rawRequest(session.redirectUri, good(session));
		expect(await result).toEqual({ value: "CODE" });
	});

	it("SEC-K6 exposes a printable URL that carries the challenge, never the verifier", async () => {
		const session = await open();
		const { verifier } = sessionInternals(session);
		expect(new URL(session.url).searchParams.get("code_challenge")).toBe(
			await pkceChallenge(verifier),
		);
		expect(session.url).not.toContain(verifier);
		expect(JSON.stringify(session)).not.toContain(verifier);
	});

	it("SEC-I1 freezes the session and keeps the verifier off it", async () => {
		const session = await open();
		expect(Object.isFrozen(session)).toBe(true);
		expect(Object.keys(session).sort()).toEqual([
			"clientId",
			"close",
			"issuer",
			"redirectUri",
			"server",
			"state",
			"url",
			"wait",
		]);
		expect(session.server.issuer).toBe(session.issuer);
	});

	it("SEC-C11 sets the security headers on default and custom pages", async () => {
		for (const page of [undefined, () => "<p>custom</p>"]) {
			const session = await open();
			const { result } = waitFor(session, { page });
			const response = await rawRequest(session.redirectUri, good(session));
			expect(response.headers).toMatchObject({
				"referrer-policy": "no-referrer",
				"cache-control": "no-store",
				"x-content-type-options": "nosniff",
				"content-security-policy": "default-src 'none'; style-src 'unsafe-inline'",
				connection: "close",
			});
			expect(response.body).not.toMatch(/https?:\/\//);
			if (page) expect(response.body).toBe("<p>custom</p>");
			await result;
		}
	});

	it("SEC-C11 never renders server text and gives a custom page only the outcome and code", async () => {
		const session = await open();
		const views: CallbackPageView[] = [];
		const { result } = waitFor(session, {
			page: (view) => {
				views.push(view);
				return `<p>${view.outcome}</p>`;
			},
		});
		await rawRequest(
			session.redirectUri,
			callbackPath(session.redirectUri, {
				error: "access_denied",
				error_description: "<script>SENTINEL</script>",
				error_uri: "https://SENTINEL.example",
				state: session.state,
			}),
		);
		await result;
		expect(views).toEqual([{ outcome: "failure", errorCode: "access_denied" }]);
		const plain = await open();
		const plainWait = waitFor(plain);
		const response = await rawRequest(
			plain.redirectUri,
			callbackPath(plain.redirectUri, {
				error: "evil<script>",
				error_description: "<script>SENTINEL</script>",
				state: plain.state,
			}),
		);
		await plainWait.result;
		expect(response.body).not.toContain("<script>");
		expect(response.body).not.toContain("SENTINEL");
		expect(response.body).toContain("(unknown)");
	});

	it("SEC-C11 SEC-O3 serves the default page when a custom page throws", async () => {
		const session = await open();
		const { result } = waitFor(session, {
			page: () => {
				throw new Error("broken renderer");
			},
		});
		const response = await rawRequest(
			session.redirectUri,
			callbackPath(session.redirectUri, { error: "access_denied", state: session.state }),
		);
		expect(response.body).toContain("Sign-in failed");
		const { error } = (await result) as { error: OAuthError };
		expect(error.code).toBe("access_denied");
		expect(await isClosed(session.redirectUri)).toBe(true);
	});

	it("SEC-C12 SEC-C13 never redirects and never echoes the code", async () => {
		const session = await open();
		const { result } = waitFor(session);
		const response = await rawRequest(
			session.redirectUri,
			callbackPath(session.redirectUri, {
				code: "SENTINEL_CODE",
				state: session.state,
				redirect_to: "https://evil.example",
			}),
		);
		expect(response.status).toBe(200);
		expect(response.headers.location).toBeUndefined();
		expect(response.body).not.toContain("SENTINEL_CODE");
		expect(JSON.stringify(response.headers)).not.toContain("SENTINEL_CODE");
		expect(response.body).not.toContain(session.state);
		await result;
	});

	it("SEC-O3 serves a failure page and rejects when onCallback throws", async () => {
		const session = await open();
		const failure = new Error("exchange failed");
		const result = session
			.wait(async () => {
				throw failure;
			})
			.catch((error: unknown) => error);
		const response = await rawRequest(session.redirectUri, good(session));
		expect(response.status).toBe(400);
		expect(response.body).toContain("Sign-in failed");
		expect(await result).toBe(failure);
		expect(await isClosed(session.redirectUri)).toBe(true);
	});

	it("SEC-C4 closes the listener after success, failure, timeout and abort", async () => {
		const ok = await open();
		const okWait = waitFor(ok);
		await rawRequest(ok.redirectUri, good(ok));
		await okWait.result;
		expect(await isClosed(ok.redirectUri)).toBe(true);

		const timedOut = await open();
		expect(await waitFor(timedOut, { timeoutMs: 20 }).result).toEqual({
			error: expect.any(TimeoutError),
		});
		expect(await isClosed(timedOut.redirectUri)).toBe(true);

		const aborted = await open();
		const controller = new AbortController();
		const abortedWait = waitFor(aborted, { signal: controller.signal });
		controller.abort();
		expect(await abortedWait.result).toEqual({ error: expect.any(AbortError) });
		expect(await isClosed(aborted.redirectUri)).toBe(true);

		const closed = await open();
		const closedWait = waitFor(closed);
		closed.close();
		expect(await closedWait.result).toEqual({ error: expect.any(AbortError) });
		expect(await isClosed(closed.redirectUri)).toBe(true);
	});

	it("SEC-C14 SEC-DEC-07 times out after 5 minutes by default", async () => {
		expect(DEFAULT_WAIT_MS).toBe(300_000);
		const session = await open();
		vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
		const { result } = waitFor(session);
		await vi.advanceTimersByTimeAsync(299_999);
		await vi.advanceTimersByTimeAsync(1);
		expect(await result).toEqual({ error: expect.any(TimeoutError) });
		vi.useRealTimers();
		expect(await isClosed(session.redirectUri)).toBe(true);
	});

	it("SEC-C14 SEC-P1 rejects a pre-aborted signal without listening", async () => {
		const { server } = await setupServer();
		await expect(
			createAuthorizationSession(server, { signal: AbortSignal.abort() }),
		).rejects.toBeInstanceOf(AbortError);
		expect(listenLoopback).not.toHaveBeenCalled();
		const session = await open();
		expect(await waitFor(session, { signal: AbortSignal.abort() }).result).toEqual({
			error: expect.any(AbortError),
		});
		expect(await isClosed(session.redirectUri)).toBe(true);
	});

	it.each(["success", "failure"])(
		"SEC-C4 SEC-C14 settles wait() with the %s and closes the listener when the browser left during onCallback",
		async (result) => {
			const session = await open();
			let finish!: () => void;
			const failure = new Error("exchange failed");
			const onCallback = vi.fn(
				() =>
					new Promise<string>((resolve, reject) => {
						finish = () => (result === "success" ? resolve("tokens") : reject(failure));
					}),
			);
			const waiting = session.wait(onCallback, { timeoutMs: 60_000 }).then(
				(value) => ({ value }),
				(error: unknown) => ({ error }),
			);
			const browser = connect(Number(new URL(session.redirectUri).port), "127.0.0.1");
			browser.on("error", () => {});
			await once(browser, "connect");
			browser.write(
				`GET ${good(session)} HTTP/1.1\r\nHost: ${new URL(session.redirectUri).host}\r\n\r\n`,
			);
			await vi.waitFor(() => expect(onCallback).toHaveBeenCalled());
			// The user closes the tab: the server sees the connection end before the page is ready.
			browser.destroy();
			await new Promise((resolve) => setTimeout(resolve, 100));
			finish();
			expect(await waiting).toEqual(
				result === "success" ? { value: "tokens" } : { error: failure },
			);
			expect(await isClosed(session.redirectUri)).toBe(true);
		},
	);

	it("SEC-C14 settles wait() on close() after the browser left during onCallback", async () => {
		const session = await open();
		const onCallback = vi.fn(() => new Promise<string>(() => {}));
		const waiting = session
			.wait(onCallback, { timeoutMs: 60_000 })
			.catch((error: unknown) => error);
		const browser = connect(Number(new URL(session.redirectUri).port), "127.0.0.1");
		browser.on("error", () => {});
		await once(browser, "connect");
		browser.write(
			`GET ${good(session)} HTTP/1.1\r\nHost: ${new URL(session.redirectUri).host}\r\n\r\n`,
		);
		await vi.waitFor(() => expect(onCallback).toHaveBeenCalled());
		browser.destroy();
		await new Promise((resolve) => setTimeout(resolve, 100));
		session.close();
		expect(await waiting).toBeInstanceOf(AbortError);
		expect(await isClosed(session.redirectUri)).toBe(true);
	});

	it.each(["timeout", "abort", "close"])(
		"SEC-C14 SEC-P1 settles wait() and closes the listener on %s while onCallback runs",
		async (stop) => {
			const session = await open();
			const controller = new AbortController();
			let finish!: (value: string) => void;
			const onCallback = vi.fn(() => new Promise<string>((resolve) => (finish = resolve)));
			const result = session
				.wait(onCallback, {
					timeoutMs: stop === "timeout" ? 200 : 60_000,
					signal: controller.signal,
				})
				.then(
					(value) => ({ value }),
					(error: unknown) => ({ error }),
				);
			const browser = rawRequest(session.redirectUri, good(session)).catch(
				(error: unknown) => error,
			);
			await vi.waitFor(() => expect(onCallback).toHaveBeenCalled());
			if (stop === "abort") controller.abort();
			if (stop === "close") session.close();
			expect(await result).toEqual({
				error: expect.any(stop === "timeout" ? TimeoutError : AbortError),
			});
			expect(await isClosed(session.redirectUri)).toBe(true);
			expect(await browser).toBeInstanceOf(Error);
			// The callback finishing late changes nothing.
			finish("late");
			expect(await result).toEqual({
				error: expect.any(stop === "timeout" ? TimeoutError : AbortError),
			});
		},
	);

	it("SEC-C14 SEC-P3 destroys a kept-alive browser connection on abort", async () => {
		const session = await open();
		const controller = new AbortController();
		const { result } = waitFor(session, { signal: controller.signal });
		const url = new URL(session.redirectUri);
		const socket = connect(Number(url.port), "127.0.0.1");
		socket.on("error", () => {});
		await once(socket, "connect");
		socket.write(`GET /callback HTTP/1.1\r\nHost: ${url.host}\r\n`);
		const closed = new Promise((resolve) => socket.once("close", resolve));
		controller.abort();
		expect(await result).toEqual({ error: expect.any(AbortError) });
		await closed;
		expect(socket.destroyed).toBe(true);
	});

	it("SEC-C15 sends Connection: close on every response", async () => {
		const session = await open();
		const { result } = waitFor(session);
		for (const path of ["/nope", good(session, { state: "x" })]) {
			expect((await rawRequest(session.redirectUri, path)).headers.connection).toBe("close");
		}
		expect((await rawRequest(session.redirectUri, good(session))).headers.connection).toBe("close");
		await result;
	});

	it("SEC-C15 closes an idle connection that sends nothing", async () => {
		const actual = await vi.importActual<typeof import("./loopback.ts")>("./loopback.ts");
		const listener = await actual.listenLoopback(["127.0.0.1"], [0], "/callback", () => {}, 200);
		try {
			expect(listener.server.headersTimeout).toBe(200);
			expect(listener.server.requestTimeout).toBe(200);
			const socket = connect(listener.port, "127.0.0.1");
			socket.on("error", () => {});
			await once(socket, "connect");
			const started = Date.now();
			await new Promise((resolve) => socket.once("close", resolve));
			expect(Date.now() - started).toBeLessThan(3_000);
		} finally {
			listener.close();
		}
		expect(actual.LOOPBACK_IDLE_TIMEOUT_MS).toBe(10_000);
	});

	it("SEC-A4 surfaces an authorization error without retrying another method", async () => {
		const session = await open();
		const { result } = waitFor(session);
		await rawRequest(
			session.redirectUri,
			callbackPath(session.redirectUri, { error: "invalid_request", state: session.state }),
		);
		expect(((await result) as { error: OAuthError }).error.code).toBe("invalid_request");
		expect(listenLoopback).toHaveBeenCalledTimes(1);
		await expect(session.wait(async () => "x")).rejects.toMatchObject({ reason: "already-used" });
	});
});
