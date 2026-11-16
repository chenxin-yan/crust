import { existsSync, rmSync } from "node:fs";

import { withLock } from "@crustjs/store";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import {
	fakeFetch,
	holdLock,
	json,
	login,
	loginTokens,
	metadataFor,
	tokenResponse,
	tokenWorld,
	uniqueIssuer,
	wellKnown,
} from "../tests/helpers.ts";
import { defineServers } from "./config.ts";
import { credentialStore, credentialStoreInternals } from "./credentials.ts";
import { discover } from "./discovery.ts";
import {
	AbortError,
	CredentialMismatchError,
	LoginInProgressError,
	LoginRequiredError,
	OAuthConfigError,
	OAuthError,
	RefreshFailedError,
	RefreshOutcomeUnknownError,
	StaleCommitError,
} from "./errors.ts";
import { createTokenSource, refreshFlights } from "./token-source.ts";

const roots: string[] = [];

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
	vi.useRealTimers();
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** {@link tokenWorld}, removed after the test. */
function world(options: Parameters<typeof tokenWorld>[0] = {}) {
	const created = tokenWorld(options);
	roots.push(created.root);
	return created;
}

/** A promise and its resolve, to hold a scripted response until the test releases it. */
function gate() {
	const { promise, resolve } = Promise.withResolvers<void>();
	return { wait: promise, open: resolve };
}

const record = (w: ReturnType<typeof world>, key: string) => w.document().records[key];

describe("refresh", () => {
	it("SEC-F1 SEC-F2 SEC-DEC-10 persists the rotated refresh token before returning, and keeps the old one when none comes", async () => {
		let next = 2;
		const w = world({
			token: () => tokenResponse(`AT${next}`, next === 2 ? "RT2" : undefined, 60),
		});
		const source = w.source();
		await login(source);
		const first = await source.get();
		expect(first.value).toBe("AT2");
		expect(record(w, source.key).secret).toEqual({ accessToken: "AT2", refreshToken: "RT2" });

		next = 3;
		const second = await w.source({ skewMs: 120_000 }).get();
		expect(second.value).toBe("AT3");
		expect(record(w, source.key).secret).toEqual({ accessToken: "AT3", refreshToken: "RT2" });
		expect(w.tokenRequests().map((request) => request.body.get("refresh_token"))).toEqual([
			"RT1",
			"RT2",
		]);
	});

	it("SEC-F2 SEC-F9 returns no access token when the commit fails after a 200, and keeps the mark", async () => {
		const w = world();
		const source = w.source();
		await login(source);
		const internals = credentialStoreInternals(w.store);
		const update = internals.update;
		vi.spyOn(internals, "update")
			.mockImplementationOnce(update)
			.mockRejectedValueOnce(new Error("disk full"));
		await expect(source.get()).rejects.toBeInstanceOf(RefreshOutcomeUnknownError);
		expect(record(w, source.key).refreshInProgress).toBeDefined();
		expect(record(w, source.key).secret.refreshToken).toBe("RT1");
		await expect(w.source().get()).rejects.toBeInstanceOf(RefreshOutcomeUnknownError);
		expect(w.tokenRequests()).toHaveLength(1);
	});

	it("SEC-F3 SEC-Q1 shares one refresh among concurrent gets of two sources, and clears its slot", async () => {
		const held = gate();
		const w = world({
			token: async () => {
				await held.wait;
				return tokenResponse("AT2", "RT2");
			},
		});
		const [a, b] = [w.source(), w.source()];
		await login(a);
		const gets = [
			...Array.from({ length: 20 }, () => a.get()),
			...Array.from({ length: 10 }, () => b.get()),
		];
		await vi.waitFor(() => expect(w.tokenRequests()).toHaveLength(1));
		held.open();
		const tokens = await Promise.all(gets);
		expect(new Set(tokens.map((token) => token.value))).toEqual(new Set(["AT2"]));
		expect(w.tokenRequests()).toHaveLength(1);
		expect(refreshFlights.size).toBe(0);
	});

	it.each([
		["joining this process's refresh", false],
		["waiting for another process's refresh on the lock", true],
	])(
		"SEC-F3 SEC-F4 SEC-Q4 a get that starts after the mark is written waits, %s, and gets its token",
		async (_name, otherProcess) => {
			const held = gate();
			const w = world({
				token: async () => {
					await held.wait;
					return tokenResponse("AT2", "RT2");
				},
			});
			const a = w.source();
			await login(a);
			const first = a.get();
			await vi.waitFor(() => expect(w.tokenRequests()).toHaveLength(1));
			expect(record(w, a.key).refreshInProgress).toBeDefined();
			// Another process has no share in this process's single-flight slot.
			if (otherProcess) refreshFlights.clear();
			let settled = false;
			const second = w
				.source({ store: credentialStore({ app: w.app }) })
				.get()
				.finally(() => {
					settled = true;
				});
			await new Promise((resolve) => setTimeout(resolve, 100));
			expect(settled).toBe(false);
			held.open();
			const tokens = await Promise.all([first, second]);
			expect(tokens.map((token) => token.value)).toEqual(["AT2", "AT2"]);
			expect(w.tokenRequests()).toHaveLength(1);
		},
	);

	it("SEC-J6 SEC-F4 a 401 retry that starts while another process refreshes waits and adopts its token", async () => {
		const held = gate();
		const w = world({
			token: async () => {
				await held.wait;
				return tokenResponse("AT2", "RT2");
			},
		});
		const a = w.source();
		await login(a, { expiresAt: undefined });
		const stale = await a.get();
		const first = a.forceRefresh();
		await vi.waitFor(() => expect(w.tokenRequests()).toHaveLength(1));
		refreshFlights.clear();
		const retry = w.source().forceRefresh({ ifGeneration: stale.generation });
		held.open();
		await expect(Promise.all([first, retry])).resolves.toMatchObject([
			{ value: "AT2" },
			{ value: "AT2" },
		]);
		expect(w.tokenRequests()).toHaveLength(1);
	});

	it("SEC-F3 SEC-Q1 clears the slot after a failure; another credential refreshes on its own", async () => {
		let status = 400;
		const w = world({
			token: () => (status === 400 ? json({ error: "invalid_scope" }, 400) : tokenResponse("AT2")),
		});
		const source = w.source();
		await login(source);
		await expect(source.get()).rejects.toBeInstanceOf(OAuthError);
		expect(refreshFlights.size).toBe(0);
		status = 200;
		await expect(source.get()).resolves.toMatchObject({ value: "AT2" });
		expect(w.tokenRequests()).toHaveLength(2);
	});

	it("SEC-F4 adopts a credential committed while it waited for the lock, without a request", async () => {
		const w = world();
		const source = w.source();
		await login(source);
		const internals = credentialStoreInternals(w.store);
		const lock = await holdLock((fn) => internals.lockIdentity(source.key, fn));
		const pending = source.get();
		// Another process logs in again while this one waits.
		await internals.update((document) => {
			const current = document!;
			const raw = current.records[source.key] as Record<string, unknown>;
			return {
				...current,
				records: {
					...current.records,
					[source.key]: {
						...raw,
						generation: "g2",
						expiresAt: Date.now() + 3_600_000,
						secret: { accessToken: "AT_OTHER", refreshToken: "RT_OTHER" },
					},
				},
			};
		});
		await lock.release();
		await expect(pending).resolves.toMatchObject({ value: "AT_OTHER", generation: "g2" });
		expect(w.tokenRequests()).toHaveLength(0);
	});

	it("SEC-F5 SEC-DEC-10 an invalid_grant asks for a login, clears the mark and keeps the credential", async () => {
		const w = world({ token: () => json({ error: "invalid_grant" }, 400) });
		const source = w.source();
		await login(source);
		const error = await source.get().catch((caught: unknown) => caught);
		expect(error).toBeInstanceOf(LoginRequiredError);
		expect((error as LoginRequiredError).reason).toBe("invalid-grant");
		expect(record(w, source.key).refreshInProgress).toBeUndefined();
		expect(record(w, source.key).secret.refreshToken).toBe("RT1");
	});

	it.each([
		["a 503", () => new Response("", { status: 503 })],
		["a 502 with an HTML body", () => new Response("<html>bad gateway</html>", { status: 502 })],
		["a 504", () => new Response("", { status: 504 })],
		["a 400 with an HTML body", () => new Response("<html>no</html>", { status: 400 })],
		["a 200 with an invalid body", () => json({ token_type: "Bearer" })],
		[
			"ECONNREFUSED from an injected fetch",
			() => {
				throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } });
			},
		],
		[
			"ECONNRESET after the request was written",
			() => {
				throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNRESET" } });
			},
		],
	])(
		"SEC-F5 SEC-F9 treats %s as an uncertain outcome: the mark stays and nothing is sent again",
		async (_name, respond) => {
			const w = world({ token: respond });
			const source = w.source();
			await login(source);
			await expect(source.get()).rejects.toBeInstanceOf(RefreshOutcomeUnknownError);
			expect(record(w, source.key).refreshInProgress).toMatchObject({
				generation: record(w, source.key).generation,
			});
			// A restarted process, too.
			await expect(w.source().get()).rejects.toBeInstanceOf(RefreshOutcomeUnknownError);
			await expect(w.source().forceRefresh()).rejects.toBeInstanceOf(RefreshOutcomeUnknownError);
			expect(w.tokenRequests()).toHaveLength(1);
		},
	);

	it("SEC-F5 a refused scope is an OAuthError that clears the mark, so the next get retries", async () => {
		const w = world({ token: () => json({ error: "invalid_scope" }, 400) });
		const source = w.source();
		await login(source);
		await expect(source.get()).rejects.toBeInstanceOf(OAuthError);
		expect(record(w, source.key).refreshInProgress).toBeUndefined();
		await expect(source.get()).rejects.toBeInstanceOf(OAuthError);
		expect(w.tokenRequests()).toHaveLength(2);
	});

	it("SEC-F5 a timeout after dispatch is uncertain", async () => {
		vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
		const w = world({ token: () => new Promise<Response>(() => {}) });
		const source = w.source();
		await login(source);
		const pending = source.get().catch((error: unknown) => error);
		await vi.waitFor(() => expect(w.tokenRequests()).toHaveLength(1));
		await vi.advanceTimersByTimeAsync(30_000);
		expect(await pending).toBeInstanceOf(RefreshOutcomeUnknownError);
		expect(record(w, source.key).refreshInProgress).toBeDefined();
	});

	it("SEC-F5 a DNS failure of the runtime's own fetch proves nothing was sent: the mark is cleared", async () => {
		// Metadata is cached per issuer, so discovery here uses the fake and the refresh the real fetch.
		const issuer = uniqueIssuer();
		const fake = fakeFetch({
			[wellKnown(issuer)]: () =>
				json(metadataFor(issuer, { token_endpoint: "https://crust-auth-test.invalid/token" })),
		});
		const config = defineServers({ servers: [{ issuer, clientId: "cli" }] });
		await discover(config, issuer, { fetch: fake.fetch });
		const w = world();
		const source = createTokenSource({
			config,
			identity: { issuer, clientId: "cli", apiOrigins: ["https://api.example.com"] },
			store: w.store,
		});
		await login(source);
		await expect(source.get()).rejects.toBeInstanceOf(RefreshFailedError);
		expect(record(w, source.key).refreshInProgress).toBeUndefined();
	});

	it("SEC-F6 refreshes within the skew, and dates the new expiry from the request start", async () => {
		vi.useFakeTimers({ toFake: ["Date"] });
		vi.setSystemTime(1_000_000);
		const w = world({
			token: () => {
				vi.setSystemTime(1_010_000);
				return tokenResponse("AT2", "RT2", 60);
			},
		});
		const source = w.source();
		await login(source, { expiresAt: 1_000_000 + 40_000 });
		await expect(source.get()).resolves.toMatchObject({ value: "AT1" });
		vi.setSystemTime(1_000_000 + 10_001);
		const started = Date.now();
		await expect(source.get()).resolves.toMatchObject({ value: "AT2" });
		expect(record(w, source.key).expiresAt).toBe(started + 60_000);
	});

	it("SEC-F7 SEC-DEC-19 sends no scope, resends the resource, and keeps the granted scope", async () => {
		const w = world({ token: () => tokenResponse("AT2") });
		const source = w.source();
		const ticket = await source.beginLogin();
		await ticket.commit(loginTokens({ scope: "read write" }), {
			resource: ["urn:example:api", "https://api.example.com/v2"],
		});
		await source.get();
		const [request] = w.tokenRequests();
		expect(request!.body.has("scope")).toBe(false);
		expect(request!.body.getAll("resource")).toEqual([
			"urn:example:api",
			"https://api.example.com/v2",
		]);
		expect(record(w, source.key)).toMatchObject({
			scope: "read write",
			resource: ["urn:example:api", "https://api.example.com/v2"],
			identity: { apiOrigins: ["https://api.example.com"] },
		});
	});

	it("SEC-F8 SEC-J7 a credential of another issuer is never sent to the configured one", async () => {
		const w = world();
		await login(w.source());
		const other = uniqueIssuer();
		const config = defineServers({
			servers: [
				{ issuer: w.issuer, clientId: "cli" },
				{ issuer: other, clientId: "cli" },
			],
		});
		const overridden = createTokenSource({
			config,
			identity: { ...w.identity, issuer: other },
			store: w.store,
			fetch: w.fetch,
		});
		const error = await overridden.get().catch((caught: unknown) => caught);
		expect(error).toBeInstanceOf(CredentialMismatchError);
		expect((error as CredentialMismatchError).reason).toBe("issuer");
		const client = createTokenSource({
			config: w.config,
			identity: { ...w.identity, clientId: "other-cli" },
			store: w.store,
			fetch: w.fetch,
		});
		await expect(client.get()).rejects.toMatchObject({ reason: "client" });
		expect(w.requests).toHaveLength(0);
	});

	it("SEC-F9 writes the mark before the request is sent", async () => {
		const marks: unknown[] = [];
		const w = world({
			token: () => {
				marks.push(record(w, key).refreshInProgress);
				return tokenResponse("AT2");
			},
		});
		const source = w.source();
		const { key } = source;
		await login(source);
		const before = record(w, key).generation;
		await source.get();
		expect(marks).toEqual([{ generation: before, since: expect.any(String) }]);
		expect(record(w, key).refreshInProgress).toBeUndefined();
	});

	it("SEC-F9 sends nothing when the mark write fails", async () => {
		const w = world();
		const source = w.source();
		await login(source);
		vi.spyOn(credentialStoreInternals(w.store), "update").mockRejectedValueOnce(new Error("EIO"));
		await expect(source.get()).rejects.toBeInstanceOf(RefreshFailedError);
		expect(w.tokenRequests()).toHaveLength(0);
		expect(record(w, source.key).refreshInProgress).toBeUndefined();
	});

	it("SEC-F9 SEC-Q5 a reset during the refresh discards its tokens, even after another login", async () => {
		let afterReset: (() => Promise<unknown>) | undefined;
		const w = world({
			token: async () => {
				await w.store.resetCredentials();
				await afterReset?.();
				return tokenResponse("AT2", "RT2");
			},
		});
		const source = w.source();
		await login(source);
		const error = await source.get().catch((caught: unknown) => caught);
		expect(error).toMatchObject({ code: "login-required", reason: "store-changed" });
		expect(existsSync(w.file)).toBe(false);

		await login(source);
		afterReset = () => login(w.source({ identity: { ...w.identity, profile: "work" } }));
		await expect(source.get()).rejects.toMatchObject({ reason: "store-changed" });
		expect(record(w, source.key)).toBeUndefined();
	});

	it("SEC-F9 a new login or a logout clears the mark", async () => {
		const w = world({ token: () => new Response("", { status: 503 }) });
		const source = w.source();
		await login(source);
		await expect(source.get()).rejects.toBeInstanceOf(RefreshOutcomeUnknownError);
		await login(source, { expiresAt: undefined });
		expect(record(w, source.key).refreshInProgress).toBeUndefined();
		await expect(source.get()).resolves.toMatchObject({ value: "AT1" });

		await login(source);
		await expect(source.get()).rejects.toBeInstanceOf(RefreshOutcomeUnknownError);
		await source.logout();
		expect(record(w, source.key)).toEqual({
			epoch: expect.any(String),
			identity: expect.any(Object),
			tombstone: true,
		});
	});
});

describe("generation-conditional refresh", () => {
	it("SEC-J6 ten 401s on one stale token refresh once; a late 401 of the old token refreshes nothing", async () => {
		const w = world();
		const source = w.source();
		await login(source, { expiresAt: Date.now() + 3_600_000 });
		const stale = await source.get();
		const refreshed = await Promise.all(
			Array.from({ length: 10 }, () => source.forceRefresh({ ifGeneration: stale.generation })),
		);
		expect(new Set(refreshed.map((token) => token.value))).toEqual(new Set(["AT2"]));
		expect(w.tokenRequests()).toHaveLength(1);
		await expect(source.forceRefresh({ ifGeneration: stale.generation })).resolves.toMatchObject({
			value: "AT2",
		});
		expect(w.tokenRequests()).toHaveLength(1);
	});
});

describe("logout", () => {
	it("SEC-G1 SEC-G5 tombstones the record, then revokes the refresh token with a POST to the endpoint as configured", async () => {
		const order: string[] = [];
		const w = world({
			metadata: { revocation_endpoint: "https://revoke.example/revoke?tenant=a" },
			routes: {
				"https://revoke.example/revoke": (request) => {
					order.push(`revoke ${request.body.get("token_type_hint")}`);
					if (request.body.get("token_type_hint") === "refresh_token") {
						order.push(`tombstoned ${record(w, key).tombstone === true}`);
					}
					return new Response(null, { status: 200 });
				},
			},
		});
		const source = w.source();
		const { key } = source;
		await login(source);
		await expect(source.logout()).resolves.toEqual({ local: "deleted", remote: "revoked" });
		expect(order).toEqual(["revoke refresh_token", "tombstoned true", "revoke access_token"]);
		const revoke = w.requests.find((request) => request.url.startsWith("https://revoke.example"))!;
		expect(revoke.method).toBe("POST");
		expect(new URL(revoke.url).search).toBe("?tenant=a");
		expect(Object.fromEntries(revoke.body)).toEqual({
			token: "RT1",
			token_type_hint: "refresh_token",
			client_id: "cli",
		});
		await expect(source.get()).rejects.toMatchObject({ reason: "missing" });
	});

	it("SEC-G1 reports a server without revocation as unsupported", async () => {
		const w = world({ metadata: { revocation_endpoint: undefined } });
		const source = w.source();
		await login(source);
		await expect(source.logout()).resolves.toEqual({ local: "deleted", remote: "unsupported" });
	});

	it("SEC-G1 SEC-G2 sends no revocation when the tombstone can't be written, and the login keeps working", async () => {
		const w = world();
		const source = w.source();
		await login(source, { expiresAt: undefined });
		vi.spyOn(credentialStoreInternals(w.store), "update").mockRejectedValueOnce(new Error("EIO"));
		await expect(source.logout()).resolves.toEqual({ local: "failed", remote: "skipped" });
		expect(w.requests.filter((request) => request.url.endsWith("/revoke"))).toHaveLength(0);
		await expect(source.get()).resolves.toMatchObject({ value: "AT1" });
	});

	it("SEC-G1 SEC-J7 tombstones a credential of another identity without revoking it", async () => {
		const w = world();
		await login(w.source());
		const moved = w.source({
			identity: { ...w.identity, apiOrigins: ["https://api.other.example"] },
		});
		await expect(moved.get()).rejects.toMatchObject({ reason: "origin" });
		await expect(moved.logout()).resolves.toEqual({ local: "deleted", remote: "skipped" });
		expect(w.requests).toHaveLength(0);
		expect(record(w, moved.key).tombstone).toBe(true);
	});

	it("SEC-G2 reports a failed revocation apart from the local logout", async () => {
		const w = world();
		await login(w.source());
		const unavailable = fakeFetch({
			[wellKnown(w.issuer)]: () => json(metadataFor(w.issuer)),
			[`${w.issuer}/revoke`]: () => new Response("", { status: 503 }),
		});
		await expect(w.source({ fetch: unavailable.fetch }).logout()).resolves.toEqual({
			local: "deleted",
			remote: "failed",
		});
	});

	it("SEC-G2 SEC-P2 an abort after the tombstone leaves the revocation unknown; before it, nothing changes", async () => {
		const controller = new AbortController();
		const w = world();
		const source = w.source();
		await login(source, { expiresAt: undefined });
		const revoked = fakeFetch({
			[wellKnown(w.issuer)]: () => json(metadataFor(w.issuer)),
			[`${w.issuer}/revoke`]: () => {
				controller.abort();
				return new Promise<Response>(() => {});
			},
		});
		await expect(source.logout({ signal: AbortSignal.abort() })).rejects.toBeInstanceOf(AbortError);
		await expect(source.get()).resolves.toMatchObject({ value: "AT1" });
		await expect(
			w.source({ fetch: revoked.fetch }).logout({ signal: controller.signal }),
		).resolves.toEqual({ local: "deleted", remote: "unknown" });
	});

	it("SEC-G3 a 200 is success whatever its body; unsupported_token_type for the access token is not fatal", async () => {
		const w = world();
		await login(w.source());
		const answers = fakeFetch({
			[wellKnown(w.issuer)]: () => json(metadataFor(w.issuer)),
			[`${w.issuer}/revoke`]: (request) =>
				request.body.get("token_type_hint") === "refresh_token"
					? json({ error: "x" })
					: json({ error: "unsupported_token_type" }, 400),
		});
		await expect(w.source({ fetch: answers.fetch }).logout()).resolves.toEqual({
			local: "deleted",
			remote: "revoked",
		});
	});

	it.each([
		["a 503", "failed"],
		["an abort", "unknown"],
	])(
		"SEC-G2 reports %s of the access-token revocation after the refresh token was revoked",
		async (failure, remote) => {
			const w = world();
			await login(w.source());
			const controller = new AbortController();
			const answers = fakeFetch({
				[wellKnown(w.issuer)]: () => json(metadataFor(w.issuer)),
				[`${w.issuer}/revoke`]: (request) => {
					if (request.body.get("token_type_hint") === "refresh_token") return json({});
					if (failure === "a 503") return new Response("", { status: 503 });
					controller.abort();
					return new Promise<Response>(() => {});
				},
			});
			await expect(
				w.source({ fetch: answers.fetch }).logout({ signal: controller.signal }),
			).resolves.toEqual({ local: "deleted", remote });
		},
	);

	it("SEC-G2 SEC-P2 a logout waiting for the credentials file's lock is cancellable and writes nothing", async () => {
		const w = world();
		const source = w.source();
		await login(source, { expiresAt: undefined });
		const lock = await holdLock((fn) => withLock(w.file, fn));
		const controller = new AbortController();
		const logout = source.logout({ signal: controller.signal });
		await new Promise((resolve) => setTimeout(resolve, 50));
		controller.abort();
		await expect(logout).rejects.toBeInstanceOf(AbortError);
		await lock.release();
		await expect(source.get()).resolves.toMatchObject({ value: "AT1" });
		expect(w.requests.filter((request) => request.url.endsWith("/revoke"))).toEqual([]);
	});

	it("SEC-G4 SEC-DEC-07 a server that never answers ends the logout at the revocation timeout", async () => {
		const w = world();
		const source = w.source();
		await login(source);
		const reached = gate();
		const hung = fakeFetch({
			[wellKnown(w.issuer)]: () => json(metadataFor(w.issuer)),
			[`${w.issuer}/revoke`]: () => {
				reached.open();
				return new Promise<Response>(() => {});
			},
		});
		vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
		const result = w.source({ fetch: hung.fetch }).logout();
		await reached.wait;
		await vi.advanceTimersByTimeAsync(10_000);
		await expect(result).resolves.toEqual({ local: "deleted", remote: "unknown" });
		expect(record(w, source.key).tombstone).toBe(true);
	});
});

describe("login tickets", () => {
	it("SEC-Q2 allows one open login per credential in a process, released by every terminal path", async () => {
		const w = world();
		const source = w.source();
		const ticket = await source.beginLogin();
		await expect(w.source().beginLogin()).rejects.toBeInstanceOf(LoginInProgressError);
		ticket.cancel();
		ticket.cancel();
		await expect(ticket.commit(loginTokens())).rejects.toBeInstanceOf(OAuthConfigError);

		const controller = new AbortController();
		await source.beginLogin({ signal: controller.signal });
		controller.abort();
		const failing = await source.beginLogin();
		await expect(failing.commit({ accessToken: "" } as never)).rejects.toBeInstanceOf(
			OAuthConfigError,
		);
		await expect(failing.commit(loginTokens())).rejects.toBeInstanceOf(OAuthConfigError);
		await expect(login(source)).resolves.toMatchObject({ accessToken: "AT1" });
	});

	it("SEC-Q2 SEC-P2 a beginLogin waiting for the file's lock to create the document is cancellable", async () => {
		const w = world();
		const lock = await holdLock((fn) => withLock(w.file, fn));
		const controller = new AbortController();
		const begin = w.source().beginLogin({ signal: controller.signal });
		await new Promise((resolve) => setTimeout(resolve, 50));
		controller.abort();
		await expect(begin).rejects.toBeInstanceOf(AbortError);
		await lock.release();
		expect(existsSync(w.file)).toBe(false);
		// The guard was released too.
		(await w.source().beginLogin()).cancel();
	});

	it("SEC-Q2 creates the document when the file is absent, so the ticket observes a storeId", async () => {
		const w = world();
		const ticket = await w.source().beginLogin();
		expect(w.document()).toEqual({
			version: 1,
			storeId: expect.any(String),
			encryption: { kind: "plaintext" },
			records: {},
		});
		ticket.cancel();
	});

	it("SEC-Q2 SEC-Q5 a commit fails when another login or a logout committed since it began (deletion ABA)", async () => {
		const w = world();
		const source = w.source();
		const internals = credentialStoreInternals(w.store);
		const ticket = await source.beginLogin();
		// Another process logs in and out while this login runs.
		await internals.update((document) => ({
			...document!,
			records: { ...document!.records, [source.key]: { epoch: "other", tombstone: true } },
		}));
		await expect(ticket.commit(loginTokens())).rejects.toBeInstanceOf(StaleCommitError);
		await expect(source.get()).rejects.toMatchObject({ reason: "missing" });
	});

	it("SEC-Q2 SEC-M3 a ticket begun before a reset is stale, also when the file was absent and another login came between", async () => {
		const w = world();
		const source = w.source();
		const ticket = await source.beginLogin();
		await w.store.resetCredentials();
		await expect(ticket.commit(loginTokens())).rejects.toBeInstanceOf(StaleCommitError);

		const late = await source.beginLogin();
		await login(w.source({ identity: { ...w.identity, profile: "work" } }));
		await w.store.resetCredentials();
		await login(w.source({ identity: { ...w.identity, profile: "work" } }));
		await expect(late.commit(loginTokens())).rejects.toBeInstanceOf(StaleCommitError);
		expect(record(w, source.key)).toBeUndefined();
	});

	it("SEC-Q2 SEC-P2 a commit waiting for the lock writes nothing when cancelled or aborted", async () => {
		const w = world();
		const source = w.source();
		const internals = credentialStoreInternals(w.store);
		for (const stop of ["cancel", "abort"] as const) {
			const controller = new AbortController();
			const ticket = await source.beginLogin();
			const lock = await holdLock((fn) => internals.lockIdentity(source.key, fn));
			const commit = ticket.commit(loginTokens(), { signal: controller.signal });
			await new Promise((resolve) => setTimeout(resolve, 50));
			if (stop === "cancel") ticket.cancel();
			else controller.abort();
			await expect(commit).rejects.toBeInstanceOf(AbortError);
			await lock.release();
			expect(record(w, source.key)).toBeUndefined();
		}
	});
});

describe("lock-ordered lifecycle", () => {
	it("SEC-Q5 a logout during a refresh waits: the refresh's callers get the new token, then the session is logged out", async () => {
		const held = gate();
		const w = world({
			token: async () => {
				await held.wait;
				return tokenResponse("AT2", "RT2");
			},
		});
		const source = w.source();
		await login(source);
		const refreshing = source.get();
		await vi.waitFor(() => expect(w.tokenRequests()).toHaveLength(1));
		const loggingOut = source.logout();
		held.open();
		await expect(refreshing).resolves.toMatchObject({ value: "AT2" });
		await expect(loggingOut).resolves.toMatchObject({ local: "deleted" });
		await expect(source.get()).rejects.toBeInstanceOf(LoginRequiredError);
		expect(w.tokenRequests()).toHaveLength(1);
	});

	it("SEC-Q5 a login during a refresh commits after it; a refresh behind a logout sends nothing", async () => {
		const held = gate();
		const w = world({
			token: async () => {
				await held.wait;
				return tokenResponse("AT2", "RT2");
			},
		});
		const source = w.source();
		await login(source);
		const refreshing = source.get();
		await vi.waitFor(() => expect(w.tokenRequests()).toHaveLength(1));
		const relogin = login(source, { accessToken: "AT_LOGIN", expiresAt: undefined });
		held.open();
		await refreshing;
		await relogin;
		await expect(source.get()).resolves.toMatchObject({ value: "AT_LOGIN" });

		await login(source);
		const internals = credentialStoreInternals(w.store);
		const lock = await holdLock((fn) => internals.lockIdentity(source.key, fn));
		const queued = source.get();
		await internals.update((document) => ({
			...document!,
			records: { ...document!.records, [source.key]: { epoch: "logged-out", tombstone: true } },
		}));
		await lock.release();
		await expect(queued).rejects.toBeInstanceOf(LoginRequiredError);
		expect(w.tokenRequests()).toHaveLength(1);
	});

	it("SEC-Q5 a tombstone survives a restart", async () => {
		const w = world();
		await login(w.source());
		await w.source().logout();
		const restarted = createTokenSource({
			config: w.config,
			identity: w.identity,
			store: credentialStore({ app: w.app }),
			fetch: w.fetch,
		});
		await expect(restarted.get()).rejects.toMatchObject({ reason: "missing" });
	});
});

describe("cancellation", () => {
	it("SEC-P2 a refresh aborted before its mark sends nothing and leaves no mark", async () => {
		const w = world();
		const source = w.source();
		await login(source);
		const internals = credentialStoreInternals(w.store);
		const lock = await holdLock((fn) => internals.lockIdentity(source.key, fn));
		const controller = new AbortController();
		const pending = source.get({ signal: controller.signal });
		await new Promise((resolve) => setTimeout(resolve, 50));
		controller.abort();
		await expect(pending).rejects.toBeInstanceOf(AbortError);
		await lock.release();
		await new Promise((resolve) => setTimeout(resolve, 50));
		expect(w.tokenRequests()).toHaveLength(0);
		expect(record(w, source.key).refreshInProgress).toBeUndefined();
	});

	it("SEC-P4 SEC-P2 one waiter's abort detaches only that waiter; once sent, the refresh commits even if every waiter left", async () => {
		const held = gate();
		const w = world({
			token: async () => {
				await held.wait;
				return tokenResponse("AT2", "RT2");
			},
		});
		const source = w.source();
		await login(source);
		const leaving = new AbortController();
		const left = source.get({ signal: leaving.signal });
		const staying = source.get();
		await vi.waitFor(() => expect(w.tokenRequests()).toHaveLength(1));
		leaving.abort();
		await expect(left).rejects.toBeInstanceOf(AbortError);
		held.open();
		await expect(staying).resolves.toMatchObject({ value: "AT2" });

		const again = gate();
		const all = world({
			token: async () => {
				await again.wait;
				return tokenResponse("AT2", "RT2");
			},
		});
		const lone = all.source();
		await login(lone);
		const controller = new AbortController();
		const only = lone.get({ signal: controller.signal });
		await vi.waitFor(() => expect(all.tokenRequests()).toHaveLength(1));
		controller.abort();
		await expect(only).rejects.toBeInstanceOf(AbortError);
		again.open();
		await vi.waitFor(() => expect(record(all, lone.key).secret.refreshToken).toBe("RT2"));
		expect(record(all, lone.key).refreshInProgress).toBeUndefined();
	});

	it("SEC-P1 rejects a pre-aborted signal before any I/O", async () => {
		const w = world();
		const source = w.source();
		const aborted = { signal: AbortSignal.abort() };
		for (const call of [
			() => source.get(aborted),
			() => source.forceRefresh(aborted),
			() => source.beginLogin(aborted),
			() => source.logout(aborted),
			() => w.store.resetCredentials(aborted),
		]) {
			await expect(call()).rejects.toBeInstanceOf(AbortError);
		}
		expect(existsSync(w.dir)).toBe(false);
	});
});
