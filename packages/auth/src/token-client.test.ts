import { inspect } from "node:util";

import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { json, setupServer, uniqueIssuer } from "../tests/helpers.ts";
import { TOKEN_ENDPOINT_PARAMS } from "./endpoint.ts";
import {
	AbortError,
	HttpError,
	OAuthConfigError,
	OAuthError,
	ResponseTooLargeError,
	TimeoutError,
} from "./errors.ts";
import { pkceChallenge } from "./pkce.ts";
import { createAuthorizationSession } from "./session.ts";
import { createTokenClient } from "./token-client.ts";
import type { AuthorizationSession } from "./types.ts";

const sessions: AuthorizationSession[] = [];

afterEach(() => {
	for (const session of sessions.splice(0)) session.close();
	vi.useRealTimers();
});

const bearer = {
	access_token: "AT",
	token_type: "Bearer",
	expires_in: 3600,
	refresh_token: "RT",
	scope: "read",
};

/** A server whose token endpoint answers with `token`, a session and its client. */
async function tokenSetup(
	token: () => Response | Promise<Response>,
	options: Parameters<typeof setupServer>[0] = {},
) {
	const issuer = uniqueIssuer();
	const setup = await setupServer({
		...options,
		server: { issuer, ...options.server },
		routes: { [`${issuer}/token`]: token, ...options.routes },
	});
	const session = await createAuthorizationSession(setup.server);
	sessions.push(session);
	const client = createTokenClient(setup.server, { fetch: setup.fetch });
	const tokenRequests = () =>
		setup.requests.filter((request) => request.url === setup.server.tokenEndpoint);
	return { ...setup, session, client, tokenRequests };
}

describe("createTokenClient", () => {
	it("SEC-E2 SEC-B4 exchanges the code with the session's redirect URI and verifier", async () => {
		const { session, client, tokenRequests } = await tokenSetup(() => json(bearer));
		const tokens = await client.exchangeCode(session, "CODE");
		expect(tokens.accessToken).toBe("AT");
		const [request] = tokenRequests();
		expect(request!.method).toBe("POST");
		expect(request!.headers.get("content-type")).toBe("application/x-www-form-urlencoded");
		expect([...request!.body.keys()].sort()).toEqual([
			"client_id",
			"code",
			"code_verifier",
			"grant_type",
			"redirect_uri",
		]);
		expect(request!.body.get("grant_type")).toBe("authorization_code");
		expect(request!.body.get("code")).toBe("CODE");
		const url = new URL(session.url);
		// Byte-identical redirect_uri in both requests, on the listener's port.
		expect(request!.body.get("redirect_uri")).toBe(url.searchParams.get("redirect_uri"));
		expect(request!.body.get("redirect_uri")).toBe(session.redirectUri);
		expect(await pkceChallenge(request!.body.get("code_verifier")!)).toBe(
			url.searchParams.get("code_challenge"),
		);
	});

	it("SEC-E2 sends one exchange per session and never retries", async () => {
		const { session, client, tokenRequests } = await tokenSetup(() => json({}, 500));
		const error = await client.exchangeCode(session, "CODE").catch((caught: unknown) => caught);
		expect(error).toBeInstanceOf(HttpError);
		expect((error as HttpError).status).toBe(500);
		await expect(client.exchangeCode(session, "CODE")).rejects.toMatchObject({
			reason: "already-used",
		});
		expect(tokenRequests()).toHaveLength(1);
	});

	it("SEC-E1 posts to the endpoint URL exactly as configured, never adding a query", async () => {
		const { session, client, requests, server } = await tokenSetup(() => json(bearer), {
			metadata: { token_endpoint: "https://tokens.example/token?tenant=t" },
			routes: { "https://tokens.example/token": () => json(bearer) },
		});
		await client.exchangeCode(session, "SECRET_CODE");
		const request = requests.at(-1)!;
		expect(request.url).toBe(server.tokenEndpoint);
		expect(new URL(request.url).search).toBe("?tenant=t");
		expect(request.url).not.toContain("SECRET_CODE");
		// Every body field the client sends is a name refused in endpoint queries, so a
		// body field can never duplicate an endpoint query parameter.
		for (const name of request.body.keys()) expect(TOKEN_ENDPOINT_PARAMS.has(name)).toBe(true);
	});

	it.each([
		[{ ...bearer, token_type: "bearer" }, "AT"],
		[{ ...bearer, token_type: "BEARER" }, "AT"],
	])("SEC-E3 accepts token_type %j", async (body) => {
		const { session, client } = await tokenSetup(() => json(body));
		expect((await client.exchangeCode(session, "C")).tokenType).toBe("Bearer");
	});

	it.each([
		["token_type mac", { ...bearer, token_type: "mac" }],
		["token_type DPoP", { ...bearer, token_type: "DPoP" }],
		["no token_type", { ...bearer, token_type: undefined }],
		["expires_in as a string", { ...bearer, expires_in: "3600" }],
		["negative expires_in", { ...bearer, expires_in: -1 }],
		["zero expires_in", { ...bearer, expires_in: 0 }],
		["null expires_in", { ...bearer, expires_in: null }],
		["expires_in over ten years", { ...bearer, expires_in: 1e12 }],
		["empty access_token", { ...bearer, access_token: "" }],
		["numeric access_token", { ...bearer, access_token: 1 }],
		["numeric refresh_token", { ...bearer, refresh_token: 1 }],
		["a non-object body", ["AT"]],
	])("SEC-E3 SEC-DEC-18 rejects a token response with %s", async (_name, body) => {
		const { session, client } = await tokenSetup(() => json(body));
		const error = await client.exchangeCode(session, "C").catch((caught: unknown) => caught);
		expect(error).toBeInstanceOf(OAuthError);
		expect((error as OAuthError).code).toBe("invalid_response");
	});

	it("SEC-E3 SEC-DEC-12 drops id_token and unknown fields; a missing expires_in stays unknown", async () => {
		vi.useFakeTimers({ now: 1_000_000, toFake: ["Date"] });
		const { session, client } = await tokenSetup(() =>
			json({ access_token: "AT", token_type: "Bearer", id_token: "SENTINEL_IDT", foo: "bar" }),
		);
		const tokens = await client.exchangeCode(session, "C");
		expect(tokens.expiresAt).toBeUndefined();
		expect(Object.keys(tokens).sort()).toEqual([
			"accessToken",
			"expiresAt",
			"refreshToken",
			"scope",
			"tokenType",
		]);
		expect(inspect(tokens, { showHidden: true, depth: 5 })).not.toContain("SENTINEL_IDT");
		expect(JSON.stringify({ ...tokens })).not.toContain("SENTINEL_IDT");
	});

	it("SEC-E3 computes expiresAt from the request start", async () => {
		vi.useFakeTimers({ now: 1_000_000, toFake: ["Date"] });
		const { session, client } = await tokenSetup(() => {
			vi.setSystemTime(1_010_000);
			return json({ ...bearer, expires_in: 60 });
		});
		expect((await client.exchangeCode(session, "C")).expiresAt).toBe(1_060_000);
	});

	it("SEC-K3 prints token sets redacted", async () => {
		const { session, client } = await tokenSetup(() =>
			json({ ...bearer, access_token: "SENTINEL_AT", refresh_token: "SENTINEL_RT" }),
		);
		const tokens = await client.exchangeCode(session, "C");
		for (const printed of [
			JSON.stringify(tokens),
			inspect(tokens),
			inspect(tokens, { depth: 10 }),
			String(tokens),
		]) {
			expect(printed).not.toContain("SENTINEL");
		}
		expect(JSON.parse(JSON.stringify(tokens))).toMatchObject({
			accessToken: "[Redacted]",
			refreshToken: "[Redacted]",
			scope: "read",
		});
	});

	it("SEC-O2 SEC-E3 treats a 200 carrying error, and a 400 without one, as failures", async () => {
		const ok = await tokenSetup(() =>
			json({ error: "x", access_token: "AT", token_type: "Bearer" }),
		);
		await expect(ok.client.exchangeCode(ok.session, "C")).rejects.toMatchObject({
			code: "unknown",
			status: 200,
		});
		const empty = await tokenSetup(() => json({}, 400));
		const error = await empty.client
			.exchangeCode(empty.session, "C")
			.catch((caught: unknown) => caught);
		expect(error).toBeInstanceOf(HttpError);
		expect((error as HttpError).status).toBe(400);
	});

	it("SEC-E4 maps errors to allowlisted codes and never echoes the body", async () => {
		const html = await tokenSetup(() => new Response("<h1>SENTINEL gateway</h1>", { status: 502 }));
		const gateway = await html.client
			.exchangeCode(html.session, "C")
			.catch((caught: unknown) => caught);
		expect(gateway).toBeInstanceOf(HttpError);
		expect((gateway as HttpError).status).toBe(502);
		expect(String(gateway)).not.toContain("SENTINEL");

		const grant = await tokenSetup(() =>
			json({ error: "invalid_grant", error_description: "SENTINEL_RT" }, 400),
		);
		const invalid = await grant.client
			.exchangeCode(grant.session, "C")
			.catch((caught: unknown) => caught);
		expect(invalid).toMatchObject({ code: "invalid_grant", status: 400 });

		const hostile = await tokenSetup(() =>
			json(
				{
					error: "evil_SENTINEL",
					error_description: "SENTINEL_RT",
					error_uri: "https://SENTINEL.example",
				},
				400,
			),
		);
		const unknown = await hostile.client
			.exchangeCode(hostile.session, "C")
			.catch((caught: unknown) => caught);
		expect(unknown).toBeInstanceOf(OAuthError);
		expect((unknown as OAuthError).code).toBe("unknown");
		const error = unknown as Error;
		for (const printed of [
			error.message,
			error.stack,
			String(error),
			JSON.stringify(error),
			inspect(error, { depth: 10, showHidden: true }),
		]) {
			expect(printed).not.toContain("SENTINEL");
		}
		expect(error.cause).toBeUndefined();
	});

	it("SEC-E5 SEC-DEC-08 aborts an endless body at the cap", async () => {
		let cancelled = false;
		const { session, client } = await tokenSetup(
			() =>
				new Response(
					new ReadableStream({
						pull(controller) {
							controller.enqueue(new Uint8Array(64 * 1024).fill(32));
						},
						cancel() {
							cancelled = true;
						},
					}),
					{ status: 200 },
				),
		);
		await expect(client.exchangeCode(session, "C")).rejects.toBeInstanceOf(ResponseTooLargeError);
		expect(cancelled).toBe(true);
	});

	it("SEC-E5 rejects a Content-Length over the cap before reading", async () => {
		let pulled = 0;
		const { session, client } = await tokenSetup(
			() =>
				new Response(
					new ReadableStream(
						{
							pull(controller) {
								pulled += 1;
								controller.enqueue(new Uint8Array(1));
								controller.close();
							},
						},
						{ highWaterMark: 0 },
					),
					{ status: 200, headers: { "content-length": String(2 * 1024 * 1024) } },
				),
		);
		await expect(client.exchangeCode(session, "C")).rejects.toBeInstanceOf(ResponseTooLargeError);
		expect(pulled).toBe(0);
	});

	it("SEC-E5 SEC-DEC-07 times out a server that never answers", async () => {
		vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
		const { session, client } = await tokenSetup(() => new Promise<Response>(() => {}));
		const pending = client.exchangeCode(session, "C").catch((caught: unknown) => caught);
		await vi.advanceTimersByTimeAsync(30_000);
		expect(await pending).toBeInstanceOf(TimeoutError);
	});

	it("SEC-E6 refuses a redirect and never contacts its target", async () => {
		const { session, client, requests } = await tokenSetup(
			() =>
				new Response(null, { status: 307, headers: { location: "https://evil.example/token" } }),
		);
		const error = await client.exchangeCode(session, "C").catch((caught: unknown) => caught);
		expect(error).toMatchObject({ code: "http", status: 307 });
		expect(requests.some((request) => request.url.includes("evil.example"))).toBe(false);
		// fetch() itself must not follow: a 307 would replay the code and verifier.
		const init = vi.fn(async (_url: string, _init: RequestInit) => json({}, 400));
		await createTokenClient(session.server, { fetch: init })
			.refresh("RT")
			.catch(() => {});
		expect(init.mock.calls[0]![1].redirect).toBe("manual");
	});

	it("SEC-E7 SEC-DEC-11 uses HTTP Basic with form-encoded credentials for a configured secret", async () => {
		const { session, client, tokenRequests } = await tokenSetup(() => json(bearer), {
			server: { clientId: "a b:c", clientSecret: "p/w+d" },
		});
		await client.exchangeCode(session, "C");
		const [request] = tokenRequests();
		const header = request!.headers.get("authorization")!;
		expect(header.startsWith("Basic ")).toBe(true);
		expect(Buffer.from(header.slice(6), "base64").toString()).toBe("a+b%3Ac:p%2Fw%2Bd");
		expect(request!.body.has("client_secret")).toBe(false);
		expect(request!.body.has("client_id")).toBe(false);
	});

	it("SEC-E7 sends only client_id for a public client", async () => {
		const { session, client, tokenRequests } = await tokenSetup(() => json(bearer));
		await client.exchangeCode(session, "C");
		const [request] = tokenRequests();
		expect(request!.headers.has("authorization")).toBe(false);
		expect(request!.body.get("client_id")).toBe("cli");
		expect(request!.body.has("client_secret")).toBe(false);
	});

	it("SEC-I1 refuses a session from another server or not from createAuthorizationSession", async () => {
		const first = await tokenSetup(() => json(bearer));
		const second = await tokenSetup(() => json(bearer));
		await expect(first.client.exchangeCode(second.session, "C")).rejects.toMatchObject({
			reason: "server-mismatch",
		});
		await expect(first.client.exchangeCode({ ...first.session }, "C")).rejects.toMatchObject({
			reason: "unknown-server",
		});
		expect(first.tokenRequests()).toHaveLength(0);
		expect(second.tokenRequests()).toHaveLength(0);
		expect(() => createTokenClient({ ...first.server })).toThrow(OAuthConfigError);
	});

	it("SEC-B5 sends each resource on the token request", async () => {
		const { server } = await setupServer();
		const session = await createAuthorizationSession(server, {
			resource: ["urn:a", "https://api.example/v1/x"],
		});
		sessions.push(session);
		const tokenFetch = vi.fn(async () => json(bearer));
		await createTokenClient(server, { fetch: tokenFetch }).exchangeCode(session, "C");
		const body = (tokenFetch.mock.calls[0] as unknown as [string, RequestInit])[1]
			.body as URLSearchParams;
		expect(body.getAll("resource")).toEqual(["urn:a", "https://api.example/v1/x"]);
	});

	it("SEC-E1 refreshes and revokes with POSTed forms on the configured URLs", async () => {
		const setup = await setupServer({
			metadata: { revocation_endpoint: "https://revoke.example/r?tenant=t" },
		});
		const calls: { url: string; init: RequestInit }[] = [];
		const client = createTokenClient(setup.server, {
			fetch: async (url, init) => {
				calls.push({ url, init });
				return url.startsWith("https://revoke.example") ? json({ error: "x" }) : json(bearer);
			},
		});
		const refreshed = await client.refresh("RT1", { scope: "read", resource: "urn:a" });
		expect(refreshed.refreshToken).toBe("RT");
		await client.revoke("RT", { tokenTypeHint: "refresh_token" });
		const [refresh, revoke] = calls;
		expect(Object.fromEntries(refresh!.init.body as URLSearchParams)).toEqual({
			grant_type: "refresh_token",
			refresh_token: "RT1",
			scope: "read",
			resource: "urn:a",
			client_id: "cli",
		});
		expect(revoke!.url).toBe("https://revoke.example/r?tenant=t");
		expect(revoke!.init.method).toBe("POST");
		expect(Object.fromEntries(revoke!.init.body as URLSearchParams)).toEqual({
			token: "RT",
			token_type_hint: "refresh_token",
			client_id: "cli",
		});
		const noRevocation = await setupServer({ metadata: { revocation_endpoint: undefined } });
		await expect(createTokenClient(noRevocation.server).revoke("RT")).rejects.toMatchObject({
			reason: "unsupported",
		});
	});

	it("SEC-P1 rejects pre-aborted exchange, refresh and revoke calls without a request", async () => {
		const { session, client, tokenRequests, requests } = await tokenSetup(() => json(bearer));
		const before = requests.length;
		const signal = AbortSignal.abort();
		await expect(client.exchangeCode(session, "C", { signal })).rejects.toBeInstanceOf(AbortError);
		await expect(client.refresh("RT", { signal })).rejects.toBeInstanceOf(AbortError);
		await expect(client.revoke("RT", { signal })).rejects.toBeInstanceOf(AbortError);
		expect(requests.length).toBe(before);
		expect(tokenRequests()).toHaveLength(0);
	});
});
