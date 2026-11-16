// The @crustjs/openapi bridge: bearerAuth() over resolveCredential() and a stored login, through
// a real apiClient Context. The API is a stubbed global fetch; the authorization server is
// the scripted fetch of the token source.
import { rmSync } from "node:fs";

import { Crust, defineCommand } from "@crustjs/core";
import { type ApiClient, apiClient, apiCommand, bearerAuth } from "@crustjs/openapi";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { createAuth } from "../src/client.ts";
import { credentialStoreInternals } from "../src/credentials.ts";
import { AbortError, CredentialMismatchError } from "../src/errors.ts";
import { fromEnv, fromStore, resolveCredential } from "../src/resolve.ts";
import type { TokenSource } from "../src/types.ts";
import { login, type TokenWorld, tokenWorld } from "./helpers.ts";

interface ApiCall {
	url: string;
	authorization: string | null;
}

const roots: string[] = [];

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
	vi.unstubAllGlobals();
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function world(options: Parameters<typeof tokenWorld>[0] = {}): TokenWorld {
	const created = tokenWorld(options);
	roots.push(created.root);
	return created;
}

/** Stubs the API: `respond` answers each request, which is recorded. */
function stubApi(respond: (call: ApiCall) => Response | Promise<Response>): ApiCall[] {
	const calls: ApiCall[] = [];
	vi.stubGlobal("fetch", async (url: URL, init: RequestInit) => {
		const call = { url: url.href, authorization: new Headers(init.headers).get("authorization") };
		calls.push(call);
		return respond(call);
	});
	return calls;
}

/** Runs `use` with the `api` Context of a CLI whose `auth` is `bearerAuth` over `sources`. */
async function withApi(
	tokens: TokenSource,
	use: (api: ApiClient) => Promise<void>,
	options: { baseUrl?: string; env?: Record<string, string>; signal?: AbortSignal } = {},
) {
	const app = new Crust("acme")
		.extend(
			apiCommand({
				spec: { openapi: "3.1.0", paths: {} },
				baseUrl: options.baseUrl ?? "https://api.example.com/v1",
				auth: bearerAuth((resolve) =>
					resolveCredential([fromEnv("ACME_TOKEN", options.env ?? {}), fromStore(tokens)], resolve),
				),
			}),
		)
		.add(
			defineCommand("call", {}, (command) =>
				command.use(apiClient).action(async ({ ctx }) => use(await ctx.api)),
			),
		);
	const outcome = await app.run(["call"], undefined, { signal: options.signal });
	if (outcome.status === "failed") throw outcome.error;
}

const unauthorized = () => new Response("expired", { status: 401 });

describe("bearer tokens for the API", () => {
	it.each([
		["https://api.example.com/v1", true],
		["https://api.example.com:443/v1", true],
		["https://eu.api.example.com/v1", false],
		["https://api.example.com.evil.example/v1", false],
		["https://api.example.com@evil.example/v1", false],
		["http://api.example.com/v1", false],
		["https://api.example.com:8443/v1", false],
		["https://api.example.com./v1", false],
	])("sends the token to %s only when its origin is the login's (%s)", async (baseUrl, allowed) => {
		const w = world();
		const tokens = w.source();
		await login(tokens, { expiresAt: undefined });
		const calls = stubApi(() => new Response("{}"));
		const result = withApi(tokens, (api) => api.fetch("/me").then(() => {}), { baseUrl });
		if (allowed) {
			await result;
			expect(calls.map((call) => call.authorization)).toEqual(["Bearer AT1"]);
		} else {
			await expect(result).rejects.toBeInstanceOf(CredentialMismatchError);
			expect(calls).toEqual([]);
		}
		expect(w.requests).toEqual([]);
	});

	it("sends no token after a redirect to another origin, and never one in a URL", async () => {
		const w = world();
		const tokens = w.source();
		await login(tokens, { accessToken: "SENTINEL_AT_1", expiresAt: undefined });
		const calls = stubApi(({ url }) =>
			url.startsWith("https://api.example.com")
				? new Response(null, { status: 302, headers: { location: "https://files.example/x" } })
				: new Response("{}"),
		);
		await withApi(tokens, (api) => api.fetch("/download").then(() => {}));
		expect(calls).toEqual([
			{ url: "https://api.example.com/v1/download", authorization: "Bearer SENTINEL_AT_1" },
			{ url: "https://files.example/x", authorization: null },
		]);
		for (const { url } of calls) {
			expect(url).not.toContain("SENTINEL");
			expect(new URL(url).searchParams.has("access_token")).toBe(false);
		}
	});

	it("refreshes once on a 401 and replays the request; a second 401 is returned", async () => {
		const w = world();
		const tokens = w.source();
		await login(tokens, { expiresAt: undefined });
		const calls = stubApi(({ authorization }) =>
			authorization === "Bearer AT1" || authorization === "Bearer AT2"
				? unauthorized()
				: new Response("{}"),
		);
		const statuses: number[] = [];
		await withApi(tokens, async (api) => {
			statuses.push((await api.fetch("/me")).status);
		});
		expect(statuses).toEqual([401]);
		expect(calls.map((call) => call.authorization)).toEqual(["Bearer AT1", "Bearer AT2"]);
		expect(w.tokenRequests()).toHaveLength(1);
	});

	it("pages after a refresh use the new token; parallel 401s share one refresh", async () => {
		const w = world();
		const tokens = w.source();
		await login(tokens, { expiresAt: undefined });
		const cancel = vi.spyOn(ReadableStream.prototype, "cancel");
		const calls = stubApi(({ authorization }) =>
			authorization === "Bearer AT1" ? unauthorized() : new Response("{}"),
		);
		await withApi(tokens, async (api) => {
			const responses = await Promise.all(
				Array.from({ length: 10 }, (_, page) => api.fetch(`/users?page=${page}`)),
			);
			expect(responses.map((response) => response.status)).toEqual(Array(10).fill(200));
			await api.fetch("/users?page=10");
		});
		expect(w.tokenRequests()).toHaveLength(1);
		expect(calls.filter((call) => call.authorization === "Bearer AT2")).toHaveLength(11);
		expect(cancel).toHaveBeenCalledTimes(10);
	});

	it("never refreshes an environment token, a caller's Authorization, or a 401 from another origin", async () => {
		const w = world();
		const tokens = w.source();
		await login(tokens, { expiresAt: undefined });
		const calls = stubApi(({ url }) =>
			url.endsWith("/moved")
				? new Response(null, { status: 302, headers: { location: "https://other.example/x" } })
				: unauthorized(),
		);
		await withApi(
			tokens,
			async (api) => {
				expect((await api.fetch("/me")).status).toBe(401);
			},
			{ env: { ACME_TOKEN: "ENV_TOKEN" } },
		);
		await withApi(tokens, async (api) => {
			await api.fetch("/me", { headers: { authorization: "Bearer mine" } });
			await api.fetch("/moved");
		});
		expect(calls.map((call) => call.authorization)).toEqual([
			"Bearer ENV_TOKEN",
			"Bearer mine",
			"Bearer AT1",
			null,
		]);
		expect(w.tokenRequests()).toHaveLength(0);
	});

	it("an abort during the refresh rejects without a retry", async () => {
		const controller = new AbortController();
		const w = world({
			token: () => {
				controller.abort();
				return new Promise<Response>(() => {});
			},
		});
		const tokens = w.source();
		await login(tokens, { expiresAt: undefined });
		const calls = stubApi(unauthorized);
		const error = await withApi(tokens, (api) => api.fetch("/me").then(() => {}), {
			signal: controller.signal,
		}).catch((caught: unknown) => caught);
		expect(error).toBeInstanceOf(AbortError);
		expect(calls).toHaveLength(1);
	});

	it("never refreshes on a 403 or a 5xx", async () => {
		const w = world();
		const tokens = w.source();
		await login(tokens, { expiresAt: undefined });
		const calls = stubApi(
			({ url }) => new Response(null, { status: url.endsWith("/a") ? 403 : 503 }),
		);
		await withApi(tokens, async (api) => {
			await api.fetch("/a");
			await api.fetch("/b");
		});
		expect(calls).toHaveLength(2);
		expect(w.tokenRequests()).toHaveLength(0);
	});

	it("reading the Context and a public request resolve no credential", async () => {
		const w = world();
		const tokens = w.source();
		await login(tokens);
		const internals = credentialStoreInternals(w.store);
		const spies = [
			vi.spyOn(internals, "read"),
			vi.spyOn(internals, "update"),
			vi.spyOn(internals, "lockIdentity"),
		];
		const calls = stubApi(() => new Response("{}"));
		await withApi(tokens, async (api) => {
			await api.fetch("/status", { auth: false });
		});
		for (const spy of spies) expect(spy).not.toHaveBeenCalled();
		expect(w.requests).toEqual([]);
		expect(calls).toEqual([{ url: "https://api.example.com/v1/status", authorization: null }]);
	});

	it("bearerAuth(auth.token) refreshes the client's login once on a 401", async () => {
		const w = world();
		await login(w.source(), { expiresAt: undefined });
		const auth = createAuth({
			app: w.app,
			issuer: w.issuer,
			clientId: "cli",
			apiOrigins: ["https://api.example.com"],
			fetch: w.fetch,
		});
		const calls = stubApi(({ authorization }) =>
			authorization === "Bearer AT1" ? unauthorized() : new Response("{}"),
		);
		const app = new Crust("acme")
			.extend(
				apiCommand({
					spec: { openapi: "3.1.0", paths: {} },
					baseUrl: "https://api.example.com/v1",
					auth: bearerAuth(auth.token),
				}),
			)
			.add(
				defineCommand("call", {}, (command) =>
					command
						.use(apiClient)
						.action(async ({ ctx }) => (await (await ctx.api).fetch("/me")).status),
				),
			);
		const outcome = await app.run(["call"]);
		expect(outcome).toMatchObject({ status: "completed", result: 200 });
		expect(calls.map((call) => call.authorization)).toEqual(["Bearer AT1", "Bearer AT2"]);
		expect(w.tokenRequests()).toHaveLength(1);
	});
});
