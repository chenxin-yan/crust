import { inspect } from "node:util";

import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { defineServers } from "./config.ts";
import { OAuthConfigError } from "./errors.ts";

afterEach(() => {
	vi.unstubAllEnvs();
});

function reason(run: () => unknown): string | undefined {
	try {
		run();
	} catch (error) {
		if (error instanceof OAuthConfigError) return error.reason;
		throw error;
	}
	return undefined;
}

const server = (issuer: string, more: Record<string, unknown> = {}) => ({
	issuer,
	clientId: "cli",
	...more,
});

describe("defineServers", () => {
	it.each([
		["https://as.example/?t=1", "a query"],
		["https://as.example/?", "an empty query"],
		["https://as.example/#f", "a fragment"],
		["https://u@as.example/", "user info"],
		["https://u:p@as.example/", "a password"],
		["http://as.example", "plain http"],
		["as.example", "no scheme"],
		["ftp://as.example", "another scheme"],
	])("refuses the issuer %s (%s)", (issuer) => {
		expect(reason(() => defineServers({ servers: [server(issuer)] }))).toBe("invalid-url");
	});

	it("accepts loopback http issuers only with allowInsecureLoopback", () => {
		expect(reason(() => defineServers({ servers: [server("http://127.0.0.1:9000")] }))).toBe(
			"invalid-url",
		);
		expect(
			reason(() =>
				defineServers({
					servers: [server("http://127.0.0.1:9000", { allowInsecureLoopback: true })],
				}),
			),
		).toBeUndefined();
		expect(
			reason(() =>
				defineServers({
					servers: [server("http://[::1]:9000/tenant", { allowInsecureLoopback: true })],
				}),
			),
		).toBeUndefined();
		expect(
			reason(() =>
				defineServers({
					servers: [server("http://localhost:9000", { allowInsecureLoopback: true })],
				}),
			),
		).toBe("invalid-url");
		expect(
			reason(() =>
				defineServers({
					servers: [server("http://10.0.0.1:9000", { allowInsecureLoopback: true })],
				}),
			),
		).toBe("invalid-url");
		expect(
			reason(() =>
				defineServers({ servers: [server("https://as.example", { allowInsecureLoopback: true })] }),
			),
		).toBeUndefined();
	});

	it("never enables allowInsecureLoopback from the environment", () => {
		for (const name of [
			"ALLOW_INSECURE_LOOPBACK",
			"CRUST_AUTH_ALLOW_INSECURE_LOOPBACK",
			"allowInsecureLoopback",
			"OAUTH_INSECURE",
		]) {
			vi.stubEnv(name, "1");
		}
		vi.stubEnv("NODE_TLS_REJECT_UNAUTHORIZED", "0");
		expect(reason(() => defineServers({ servers: [server("http://127.0.0.1:9000")] }))).toBe(
			"invalid-url",
		);
		expect(
			defineServers({ servers: [server("https://as.example")] }).servers[0]!.allowInsecureLoopback,
		).toBe(false);
	});

	it("refuses a second entry for the same issuer", () => {
		expect(
			reason(() =>
				defineServers({
					servers: [
						server("https://as.example"),
						server("https://as.example", { clientId: "other" }),
					],
				}),
			),
		).toBe("duplicate-issuer");
		expect(
			reason(() =>
				defineServers({ servers: [server("https://as.example"), server("https://as.example/")] }),
			),
		).toBeUndefined();
	});

	it.each([
		"cb",
		"/a/../b",
		"/cb?x",
		"/cb#f",
		"/%63b",
		"//cb",
		"/cb/",
		"/cb/.",
		"/",
		"/a\\b",
		"/a b",
		42,
	])("refuses the redirectPath %s", (redirectPath) => {
		expect(
			reason(() => defineServers({ servers: [server("https://as.example", { redirectPath })] })),
		).toBe("invalid-option");
	});

	it.each(["/café", "/a<b", "/a{b}", '/a"b', "/a`b", "/a\x01b"])(
		"refuses the redirectPath %j, which a browser would send encoded",
		(redirectPath) => {
			expect(
				reason(() => defineServers({ servers: [server("https://as.example", { redirectPath })] })),
			).toBe("invalid-option");
		},
	);

	it("refuses a redirectPath another server also listens on", () => {
		expect(
			reason(() =>
				defineServers({
					servers: [
						server("https://a.example", { redirectPath: "/cb" }),
						server("https://b.example", { redirectPath: "/cb" }),
					],
				}),
			),
		).toBe("duplicate-redirect-path");
		expect(
			reason(() =>
				defineServers({
					servers: [
						server("https://a.example", { redirectPath: "/callback" }),
						server("https://b.example"),
					],
				}),
			),
		).toBe("duplicate-redirect-path");
		expect(
			reason(() =>
				defineServers({ servers: [server("https://a.example"), server("https://b.example")] }),
			),
		).toBeUndefined();
		expect(
			reason(() =>
				defineServers({
					servers: [
						server("https://a.example", { redirectPath: "/a/callback" }),
						server("https://b.example"),
					],
				}),
			),
		).toBeUndefined();
	});

	it.each([
		[{ servers: [] }],
		[{ servers: [{ issuer: "https://as.example", clientId: "" }] }],
		[{ servers: [{ issuer: "https://as.example", clientId: "cli", clientSecret: "" }] }],
		[{ servers: [server("https://as.example")], allowCustomIssuers: "yes" }],
		[{ servers: [server("https://as.example", { allowInsecureLoopback: "true" })] }],
		[undefined],
	])("validates untyped options at runtime: %j", (options) => {
		// SAFETY: untyped input on purpose; the runtime checks are under test.
		expect(reason(() => defineServers(options as never))).toBe("invalid-option");
	});

	it("keeps the client secret out of the printed config", () => {
		const config = defineServers({
			servers: [server("https://as.example", { clientSecret: "SENTINEL_SECRET" })],
		});
		expect(JSON.stringify(config)).not.toContain("SENTINEL_SECRET");
		expect(inspect(config, { depth: 10, showHidden: true })).not.toContain("SENTINEL_SECRET");
		expect(
			Object.isFrozen(config) &&
				Object.isFrozen(config.servers) &&
				Object.isFrozen(config.servers[0]),
		).toBe(true);
	});
});
