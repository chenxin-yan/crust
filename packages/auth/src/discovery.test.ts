/**
 * @module-tag windows
 * @module-tag macos
 */
import { spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:https";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import {
	configReason,
	fakeFetch,
	json,
	metadataFor,
	setupServer,
	uniqueIssuer,
	wellKnown,
} from "../tests/helpers.ts";
import { defineAuth } from "./config.ts";
import { discover } from "./discovery.ts";
import {
	AbortError,
	HttpError,
	IssuerMismatchError,
	NetworkError,
	ResponseTooLargeError,
	TimeoutError,
} from "./errors.ts";

afterEach(() => {
	vi.useRealTimers();
});

const hasOpenssl = spawnSync("openssl", ["version"], { timeout: 10_000 }).status === 0;

async function discoverWith(metadata: Record<string, unknown>, issuer = uniqueIssuer()) {
	const fake = fakeFetch({
		[wellKnown(issuer)]: () => json({ ...metadataFor(issuer), ...metadata }),
	});
	const config = defineAuth({ servers: [{ issuer, clientId: "cli" }] });
	return discover(config, issuer, { fetch: fake.fetch });
}

describe("discover", () => {
	// A throwaway self-signed certificate; *.pem files are never committed.
	it.skipIf(!hasOpenssl)(
		"SEC-H1 rejects a server whose TLS certificate does not verify",
		async () => {
			const dir = mkdtempSync(join(tmpdir(), "crust-auth-tls-"));
			const key = join(dir, "key.pem");
			const cert = join(dir, "cert.pem");
			const subject = ["-subj", "/CN=127.0.0.1", "-addext", "subjectAltName=IP:127.0.0.1"];
			const ec = ["-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1", "-nodes"];
			const made = spawnSync(
				"openssl",
				["req", "-x509", ...ec, "-keyout", key, "-out", cert, "-days", "1", ...subject],
				{
					timeout: 30_000,
				},
			);
			expect(made.status).toBe(0);
			let served = 0;
			const tls = createServer(
				{ key: readFileSync(key), cert: readFileSync(cert) },
				(_request, response) => {
					served += 1;
					response.end("{}");
				},
			);
			tls.listen(0, "127.0.0.1");
			await once(tls, "listening");
			try {
				const issuer = `https://127.0.0.1:${(tls.address() as AddressInfo).port}`;
				const config = defineAuth({ servers: [{ issuer, clientId: "cli" }] });
				const error = await discover(config, issuer).catch((caught: unknown) => caught);
				// The TLS handshake fails, so no request reaches the server.
				expect(error).toBeInstanceOf(NetworkError);
				expect(served).toBe(0);
			} finally {
				tls.close();
				rmSync(dir, { recursive: true, force: true });
			}
		},
	);

	it("SEC-H1 SEC-DEC-09 refuses a plain-http issuer", async () => {
		const config = defineAuth({
			servers: [{ issuer: "https://as.example", clientId: "cli" }],
			allowCustomIssuers: true,
		});
		expect(await configReason(discover(config, "http://as.example", { clientId: "cli" }))).toBe(
			"invalid-url",
		);
		expect(await configReason(discover(config, "http://127.0.0.1:9000", { clientId: "cli" }))).toBe(
			"invalid-url",
		);
	});

	it.each([
		["a trailing slash", (issuer: string) => `${issuer}/`],
		["different case", (issuer: string) => issuer.toUpperCase().replace("HTTPS", "https")],
		["another host", () => "https://evil.example"],
		["no issuer", () => undefined],
	])("SEC-H2 rejects metadata whose issuer has %s", async (_name, mutate) => {
		const issuer = uniqueIssuer();
		const error = await discoverWith({ issuer: mutate(issuer) }, issuer).catch(
			(caught: unknown) => caught,
		);
		expect(error).toBeInstanceOf(IssuerMismatchError);
		expect((error as IssuerMismatchError).reason).toBe("mismatch");
	});

	it("SEC-H3 inserts the well-known segment before the path, then falls back on 404 only", async () => {
		const issuer = uniqueIssuer("/x/");
		const origin = new URL(issuer).origin;
		const fake = fakeFetch({
			[`${origin}/x/.well-known/openid-configuration`]: () => json(metadataFor(issuer)),
		});
		const config = defineAuth({ servers: [{ issuer, clientId: "cli" }] });
		const server = await discover(config, issuer, { fetch: fake.fetch });
		expect(fake.requests.map((request) => request.url)).toEqual([
			`${origin}/.well-known/oauth-authorization-server/x`,
			`${origin}/x/.well-known/openid-configuration`,
		]);
		expect(server.issuer).toBe(issuer);
	});

	it("SEC-H3 does not fall back on a 500, and checks the issuer of the fallback document", async () => {
		const issuer = uniqueIssuer("/t");
		const origin = new URL(issuer).origin;
		const failing = fakeFetch({
			[`${origin}/.well-known/oauth-authorization-server/t`]: () => json({}, 500),
		});
		const config = defineAuth({ servers: [{ issuer, clientId: "cli" }] });
		await expect(discover(config, issuer, { fetch: failing.fetch })).rejects.toBeInstanceOf(
			HttpError,
		);
		expect(failing.requests).toHaveLength(1);
		const mismatched = fakeFetch({
			[`${origin}/t/.well-known/openid-configuration`]: () => json(metadataFor(`${issuer}/`)),
		});
		await expect(discover(config, issuer, { fetch: mismatched.fetch })).rejects.toBeInstanceOf(
			IssuerMismatchError,
		);
	});

	it("SEC-H3 SEC-DEC-07 does not fall back after a timeout", async () => {
		vi.useFakeTimers();
		const issuer = uniqueIssuer();
		const fake = fakeFetch({ [wellKnown(issuer)]: () => new Promise<Response>(() => {}) });
		const config = defineAuth({ servers: [{ issuer, clientId: "cli" }] });
		const pending = discover(config, issuer, { fetch: fake.fetch }).catch(
			(caught: unknown) => caught,
		);
		await vi.advanceTimersByTimeAsync(30_000);
		expect(await pending).toBeInstanceOf(TimeoutError);
		expect(fake.requests).toHaveLength(1);
	});

	it.each([
		["token_endpoint", "http://evil.example/t", "invalid-url"],
		["token_endpoint", "https://u:p@as.example/t", "invalid-url"],
		["token_endpoint", "https://as.example/t#f", "invalid-url"],
		["token_endpoint", "/token", "invalid-url"],
		["token_endpoint", 42, "invalid-url"],
		["revocation_endpoint", "http://as.example/revoke", "invalid-url"],
		["device_authorization_endpoint", "https://as.example/device?scope=x", "reserved-parameter"],
		["token_endpoint", "https://as.example/t?client_secret=x", "reserved-parameter"],
		["token_endpoint", "https://as.example/t?scope=x", "reserved-parameter"],
		["token_endpoint", "https://as.example/t?%63lient_id=x", "reserved-parameter"],
		["token_endpoint", "https://as.example/t?tenant=a&tenant=b", "duplicate-parameter"],
		["revocation_endpoint", "https://as.example/r?token=x", "reserved-parameter"],
	])("SEC-H4 SEC-E1 refuses %s %s", async (name, value, expected) => {
		expect(await configReason(discoverWith({ [name]: value }))).toBe(expected);
	});

	it.each([
		["http://evil.example/authorize", "invalid-url"],
		["https://u:p@as.example/a", "invalid-url"],
		["https://as.example/a#x", "invalid-url"],
		["http://127.0.0.1:9000/a", "invalid-url"],
		["https://as.example/authorize?client_id=x", "reserved-parameter"],
		["https://as.example/authorize?nonce=x", "reserved-parameter"],
		["https://as.example/authorize?tenant=a&tenant=b", "duplicate-parameter"],
		["https://as.example/authorize?tenant=a&%74enant=b", "duplicate-parameter"],
	])("SEC-B3 SEC-B1 refuses the authorization endpoint %s", async (value, expected) => {
		expect(await configReason(discoverWith({ authorization_endpoint: value }))).toBe(expected);
	});

	it("SEC-H4 SEC-E1 keeps endpoint queries exactly and allows cross-origin https endpoints", async () => {
		const issuer = uniqueIssuer();
		const server = await discoverWith(
			{
				authorization_endpoint: "https://login.vendor.example/authorize?tenant=t",
				token_endpoint: "https://tokens.vendor.example/t?tenant=t",
				device_authorization_endpoint: "https://tokens.vendor.example/device?tenant=t",
				revocation_endpoint: "https://tokens.vendor.example/revoke?tenant=t",
			},
			issuer,
		);
		expect(server.authorizationEndpoint).toBe("https://login.vendor.example/authorize?tenant=t");
		expect(server.tokenEndpoint).toBe("https://tokens.vendor.example/t?tenant=t");
		expect(server.deviceAuthorizationEndpoint).toBe(
			"https://tokens.vendor.example/device?tenant=t",
		);
		expect(server.revocationEndpoint).toBe("https://tokens.vendor.example/revoke?tenant=t");
	});

	it("SEC-DEC-09 SEC-H4 keeps every endpoint on the dev origin", async () => {
		const issuer = `http://127.0.0.1:${40_000 + (process.pid % 1000)}`;
		const routes = (metadata: Record<string, unknown>) =>
			fakeFetch({
				[`${issuer}/.well-known/oauth-authorization-server`]: () =>
					json(metadataFor(issuer, metadata)),
			});
		const config = defineAuth({
			servers: [{ issuer, clientId: "cli", allowInsecureLoopback: true }],
		});
		expect(
			await configReason(
				discover(config, issuer, {
					fetch: routes({ token_endpoint: "http://127.0.0.1:9001/t" }).fetch,
				}),
			),
		).toBe("invalid-url");
		expect(
			await configReason(
				discover(config, issuer, {
					fetch: routes({ token_endpoint: "https://as.example/t" }).fetch,
				}),
			),
		).toBe("invalid-url");
		expect(
			await configReason(
				discover(config, issuer, {
					fetch: routes({ token_endpoint: "http://localhost:9000/t" }).fetch,
				}),
			),
		).toBe("invalid-url");
		const server = await discover(config, issuer, { fetch: routes({}).fetch });
		expect(server.tokenEndpoint).toBe(`${issuer}/token`);
	});

	it("SEC-H5 SEC-E6 refuses a redirected metadata response", async () => {
		const issuer = uniqueIssuer();
		const fake = fakeFetch({
			[wellKnown(issuer)]: () =>
				new Response(null, { status: 307, headers: { location: "https://evil.example/m" } }),
		});
		const config = defineAuth({ servers: [{ issuer, clientId: "cli" }] });
		const error = await discover(config, issuer, { fetch: fake.fetch }).catch(
			(caught: unknown) => caught,
		);
		expect(error).toBeInstanceOf(HttpError);
		expect((error as HttpError).status).toBe(307);
		expect(fake.requests.map((request) => request.url)).toEqual([wellKnown(issuer)]);
	});

	it("SEC-H5 SEC-DEC-08 refuses a metadata document over 1 MiB", async () => {
		const issuer = uniqueIssuer();
		const fake = fakeFetch({
			[wellKnown(issuer)]: () => json({ ...metadataFor(issuer), padding: "x".repeat(1024 * 1024) }),
		});
		const config = defineAuth({ servers: [{ issuer, clientId: "cli" }] });
		await expect(discover(config, issuer, { fetch: fake.fetch })).rejects.toBeInstanceOf(
			ResponseTooLargeError,
		);
	});

	it("SEC-H6 caches metadata in memory for the process", async () => {
		const issuer = uniqueIssuer();
		const fake = fakeFetch({ [wellKnown(issuer)]: () => json(metadataFor(issuer)) });
		const config = defineAuth({ servers: [{ issuer, clientId: "cli" }] });
		await discover(config, issuer, { fetch: fake.fetch });
		await discover(config, issuer, { fetch: fake.fetch });
		expect(fake.requests).toHaveLength(1);
	});

	it.each([
		[["plain"], "unsupported"],
		["S256", "unsupported"],
		[[], "unsupported"],
	])("SEC-A5 refuses code_challenge_methods_supported %j", async (methods, expected) => {
		expect(await configReason(discoverWith({ code_challenge_methods_supported: methods }))).toBe(
			expected,
		);
	});

	it("SEC-A5 accepts S256 and a missing field", async () => {
		await expect(
			discoverWith({ code_challenge_methods_supported: ["plain", "S256"] }),
		).resolves.toBeDefined();
		await expect(
			discoverWith({ code_challenge_methods_supported: undefined }),
		).resolves.toBeDefined();
	});

	it("SEC-I3 SEC-I7 SEC-DEC-03 derives the iss policy from metadata and the server set", async () => {
		const single = await setupServer();
		expect(single.server.issPolicy).toBe("compare-if-present");
		const advertised = await setupServer({
			metadata: { authorization_response_iss_parameter_supported: true },
			others: [{ issuer: "https://other.example", clientId: "cli" }],
		});
		expect(advertised.server.issPolicy).toBe("required");
		const multi = await setupServer({
			others: [{ issuer: "https://other.example", clientId: "cli" }],
		});
		expect(multi.server.issPolicy).toBe("unprotected");
		const withPath = await setupServer({
			server: { redirectPath: "/acme/callback" },
			others: [{ issuer: "https://other.example", clientId: "cli" }],
		});
		expect(withPath.server.issPolicy).toBe("compare-if-present");
		expect(withPath.server.redirectPath).toBe("/acme/callback");
		const custom = await setupServer({ allowCustomIssuers: true });
		expect(custom.server.issPolicy).toBe("unprotected");
	});

	it("SEC-I6 SEC-I7 needs allowCustomIssuers and a client id for an undeclared issuer", async () => {
		const declared = uniqueIssuer();
		const custom = uniqueIssuer();
		const fake = fakeFetch({ [wellKnown(custom)]: () => json(metadataFor(custom)) });
		const pinned = defineAuth({ servers: [{ issuer: declared, clientId: "cli" }] });
		expect(await configReason(discover(pinned, custom, { clientId: "x", fetch: fake.fetch }))).toBe(
			"unknown-issuer",
		);
		const open = defineAuth({
			servers: [{ issuer: declared, clientId: "cli" }],
			allowCustomIssuers: true,
		});
		expect(await configReason(discover(open, custom, { fetch: fake.fetch }))).toBe(
			"invalid-option",
		);
		const server = await discover(open, custom, { clientId: "x", fetch: fake.fetch });
		expect(server.clientId).toBe("x");
		expect(server.redirectPath).toBe("/callback");
		expect(fake.requests).toHaveLength(1);
	});

	it("SEC-I6 allows two client ids at the same issuer", async () => {
		const issuer = uniqueIssuer();
		const fake = fakeFetch({ [wellKnown(issuer)]: () => json(metadataFor(issuer)) });
		const config = defineAuth({ servers: [{ issuer, clientId: "cli" }] });
		const first = await discover(config, issuer, { fetch: fake.fetch });
		const second = await discover(config, issuer, { fetch: fake.fetch, clientId: "other" });
		expect([first.clientId, second.clientId]).toEqual(["cli", "other"]);
		expect(second.tokenEndpoint).toBe(first.tokenEndpoint);
	});

	it("SEC-P1 rejects a pre-aborted signal without any request", async () => {
		const issuer = uniqueIssuer();
		const fake = fakeFetch({ [wellKnown(issuer)]: () => json(metadataFor(issuer)) });
		const config = defineAuth({ servers: [{ issuer, clientId: "cli" }] });
		await expect(
			discover(config, issuer, { fetch: fake.fetch, signal: AbortSignal.abort() }),
		).rejects.toBeInstanceOf(AbortError);
		expect(fake.requests).toHaveLength(0);
	});

	it("SEC-P1 aborts a metadata request in flight", async () => {
		const issuer = uniqueIssuer();
		const fake = fakeFetch({ [wellKnown(issuer)]: () => new Promise<Response>(() => {}) });
		const config = defineAuth({ servers: [{ issuer, clientId: "cli" }] });
		const controller = new AbortController();
		const pending = discover(config, issuer, { fetch: fake.fetch, signal: controller.signal });
		controller.abort();
		await expect(pending).rejects.toBeInstanceOf(AbortError);
	});

	it("SEC-H4 returns a frozen server and refuses a config not from defineAuth", async () => {
		const { server } = await setupServer();
		expect(Object.isFrozen(server)).toBe(true);
		const forged = {
			servers: [{ issuer: "https://as.example", clientId: "cli" }],
			allowCustomIssuers: false,
		};
		// SAFETY: a hand-made config on purpose.
		expect(await configReason(discover(forged as never, "https://as.example"))).toBe(
			"invalid-option",
		);
	});
});
