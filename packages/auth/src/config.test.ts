import { inspect } from "node:util";

import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { defineAuth } from "./config.ts";
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

describe("defineAuth", () => {
	it.each([
		["https://as.example/?t=1", "a query"],
		["https://as.example/?", "an empty query"],
		["https://as.example/#f", "a fragment"],
		["https://u@as.example/", "user info"],
		["https://u:p@as.example/", "a password"],
		["http://as.example", "plain http"],
		["as.example", "no scheme"],
		["ftp://as.example", "another scheme"],
	])("SEC-H8 refuses the issuer %s (%s)", (issuer) => {
		expect(reason(() => defineAuth({ servers: [server(issuer)] }))).toBe("invalid-url");
	});

	it("SEC-H8 SEC-DEC-09 accepts loopback http issuers only with allowInsecureLoopback", () => {
		expect(reason(() => defineAuth({ servers: [server("http://127.0.0.1:9000")] }))).toBe(
			"invalid-url",
		);
		expect(
			reason(() =>
				defineAuth({ servers: [server("http://127.0.0.1:9000", { allowInsecureLoopback: true })] }),
			),
		).toBeUndefined();
		expect(
			reason(() =>
				defineAuth({
					servers: [server("http://[::1]:9000/tenant", { allowInsecureLoopback: true })],
				}),
			),
		).toBeUndefined();
		expect(
			reason(() =>
				defineAuth({ servers: [server("http://localhost:9000", { allowInsecureLoopback: true })] }),
			),
		).toBe("invalid-url");
		expect(
			reason(() =>
				defineAuth({ servers: [server("http://10.0.0.1:9000", { allowInsecureLoopback: true })] }),
			),
		).toBe("invalid-url");
		expect(
			reason(() =>
				defineAuth({ servers: [server("https://as.example", { allowInsecureLoopback: true })] }),
			),
		).toBeUndefined();
	});

	it("SEC-DEC-09 cannot be enabled from the environment", () => {
		for (const name of [
			"ALLOW_INSECURE_LOOPBACK",
			"CRUST_AUTH_ALLOW_INSECURE_LOOPBACK",
			"allowInsecureLoopback",
			"OAUTH_INSECURE",
		]) {
			vi.stubEnv(name, "1");
		}
		vi.stubEnv("NODE_TLS_REJECT_UNAUTHORIZED", "0");
		expect(reason(() => defineAuth({ servers: [server("http://127.0.0.1:9000")] }))).toBe(
			"invalid-url",
		);
		expect(
			defineAuth({ servers: [server("https://as.example")] }).servers[0]!.allowInsecureLoopback,
		).toBe(false);
	});

	it("SEC-I6 refuses a second entry for the same issuer", () => {
		expect(
			reason(() =>
				defineAuth({
					servers: [
						server("https://as.example"),
						server("https://as.example", { clientId: "other" }),
					],
				}),
			),
		).toBe("duplicate-issuer");
		expect(
			reason(() =>
				defineAuth({ servers: [server("https://as.example"), server("https://as.example/")] }),
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
	])("SEC-C1 refuses the redirectPath %s", (redirectPath) => {
		expect(
			reason(() => defineAuth({ servers: [server("https://as.example", { redirectPath })] })),
		).toBe("invalid-option");
	});

	it.each(["/café", "/a<b", "/a{b}", '/a"b', "/a`b", "/a\x01b"])(
		"SEC-C1 SEC-C6 refuses the redirectPath %j, which a browser would send encoded",
		(redirectPath) => {
			expect(
				reason(() => defineAuth({ servers: [server("https://as.example", { redirectPath })] })),
			).toBe("invalid-option");
		},
	);

	it("SEC-I7 refuses a redirectPath another server also listens on", () => {
		expect(
			reason(() =>
				defineAuth({
					servers: [
						server("https://a.example", { redirectPath: "/cb" }),
						server("https://b.example", { redirectPath: "/cb" }),
					],
				}),
			),
		).toBe("duplicate-redirect-path");
		expect(
			reason(() =>
				defineAuth({
					servers: [
						server("https://a.example", { redirectPath: "/callback" }),
						server("https://b.example"),
					],
				}),
			),
		).toBe("duplicate-redirect-path");
		expect(
			reason(() =>
				defineAuth({ servers: [server("https://a.example"), server("https://b.example")] }),
			),
		).toBeUndefined();
		expect(
			reason(() =>
				defineAuth({
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
	])("SEC-I6 validates untyped options at runtime: %j", (options) => {
		// SAFETY: untyped input on purpose; the runtime checks are under test.
		expect(reason(() => defineAuth(options as never))).toBe("invalid-option");
	});

	it("SEC-DEC-11 SEC-K1 keeps the client secret out of the printed config", () => {
		const config = defineAuth({
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
