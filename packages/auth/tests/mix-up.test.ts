/**
 * @module-tag windows
 * @module-tag macos
 */
// Mix-up attack (RFC 9700 §4.4): an attacker's metadata names the honest authorization
// endpoint and the attacker's own token endpoint, and the honest server sends no `iss`.
// The loopback listener is real; both servers sit behind an injected fetch.
import { Server } from "node:http";

import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { defineServers } from "../src/config.ts";
import { discover } from "../src/discovery.ts";
import { AbortError, OAuthConfigError } from "../src/errors.ts";
import { createAuthorizationSession } from "../src/session.ts";
import { createTokenClient } from "../src/token-client.ts";
import type { AuthorizationSession, AuthServerOptions } from "../src/types.ts";
import {
	fakeFetch,
	json,
	rawRequest,
	type RecordedRequest,
	uniqueIssuer,
	wellKnown,
} from "./helpers.ts";

const sessions: AuthorizationSession[] = [];

afterEach(() => {
	for (const session of sessions.splice(0)) session.close();
	vi.restoreAllMocks();
});

/** Honest server H and attacker A; H redirects only to the path registered with it. */
function world(options: { attackerAdvertisesIss?: boolean } = {}) {
	const honest = uniqueIssuer();
	const attacker = uniqueIssuer();
	const attackerTokenRequests: RecordedRequest[] = [];
	let registeredPath = "/callback";
	const fake = fakeFetch({
		[wellKnown(honest)]: () =>
			json({
				issuer: honest,
				authorization_endpoint: `${honest}/authorize`,
				token_endpoint: `${honest}/token`,
			}),
		[wellKnown(attacker)]: () =>
			json({
				issuer: attacker,
				authorization_endpoint: `${honest}/authorize`,
				token_endpoint: `${attacker}/token`,
				authorization_response_iss_parameter_supported: options.attackerAdvertisesIss ?? false,
			}),
		[`${honest}/token`]: () => json({ access_token: "HONEST_AT", token_type: "Bearer" }),
		[`${attacker}/token`]: (request) => {
			attackerTokenRequests.push(request);
			return json({ access_token: "ATTACKER_AT", token_type: "Bearer" });
		},
	});
	/** The browser: H authenticates the user and redirects to its registered path, without iss. */
	const browse = async (session: AuthorizationSession) => {
		const url = new URL(session.url);
		const redirect = new URL(url.searchParams.get("redirect_uri")!);
		redirect.pathname = registeredPath;
		redirect.search = new URLSearchParams({
			code: "HONEST_CODE",
			state: url.searchParams.get("state")!,
		}).toString();
		return rawRequest(session.redirectUri, `${redirect.pathname}${redirect.search}`);
	};
	return {
		honest,
		attacker,
		fake,
		attackerTokenRequests,
		browse,
		register(path: string) {
			registeredPath = path;
		},
		config(
			servers: Partial<Record<"honest" | "attacker", Partial<AuthServerOptions>>>,
			allowCustomIssuers = false,
		) {
			return defineServers({
				servers: Object.entries(servers).map(([name, server]) => ({
					issuer: name === "honest" ? honest : attacker,
					clientId: "cli",
					...server,
				})),
				allowCustomIssuers,
			});
		},
	};
}

describe("mix-up defense", () => {
	it("refuses a multi-server login without iss or distinct paths, binding nothing", async () => {
		const w = world();
		const config = w.config({ honest: {}, attacker: {} });
		const server = await discover(config, w.attacker, { fetch: w.fake.fetch });
		const listen = vi.spyOn(Server.prototype, "listen");
		const error = await createAuthorizationSession(server).catch((caught: unknown) => caught);
		expect(error).toBeInstanceOf(OAuthConfigError);
		expect((error as OAuthConfigError).reason).toBe("mix-up-unprotected");
		expect(listen).not.toHaveBeenCalled();
	});

	it("with distinct paths, the honest code never reaches the attacker", async () => {
		const w = world();
		const config = w.config({
			honest: { redirectPath: "/honest/callback" },
			attacker: { redirectPath: "/attacker/callback" },
		});
		const server = await discover(config, w.attacker, { fetch: w.fake.fetch });
		const session = await createAuthorizationSession(server);
		sessions.push(session);
		w.register("/honest/callback");
		const client = createTokenClient(server, { fetch: w.fake.fetch });
		const onCallback = vi.fn(({ code }: { code: string }) => client.exchangeCode(session, code));
		const controller = new AbortController();
		const result = session
			.wait(onCallback, { signal: controller.signal })
			.catch((caught: unknown) => caught);
		expect((await w.browse(session)).status).toBe(404);
		controller.abort();
		expect(await result).toBeInstanceOf(AbortError);
		expect(onCallback).not.toHaveBeenCalled();
		expect(w.attackerTokenRequests).toHaveLength(0);
	});

	it("an iss-advertising attacker session rejects the honest response without iss", async () => {
		const w = world({ attackerAdvertisesIss: true });
		const config = w.config({ honest: {}, attacker: {} });
		const server = await discover(config, w.attacker, { fetch: w.fake.fetch });
		const session = await createAuthorizationSession(server);
		sessions.push(session);
		const client = createTokenClient(server, { fetch: w.fake.fetch });
		const result = session
			.wait(({ code }) => client.exchangeCode(session, code))
			.catch((caught: unknown) => caught);
		await w.browse(session);
		expect(await result).toMatchObject({ code: "issuer-mismatch", reason: "missing" });
		expect(w.attackerTokenRequests).toHaveLength(0);
	});

	it("accepts the honest server without iss when it is the one pinned issuer", async () => {
		const w = world();
		const config = w.config({ honest: {} });
		const server = await discover(config, w.honest, { fetch: w.fake.fetch });
		const session = await createAuthorizationSession(server);
		sessions.push(session);
		const client = createTokenClient(server, { fetch: w.fake.fetch });
		const result = session.wait(({ code }) => client.exchangeCode(session, code));
		expect((await w.browse(session)).status).toBe(200);
		expect((await result).accessToken).toBe("HONEST_AT");
	});

	it("refuses a custom issuer that does not advertise iss", async () => {
		const w = world();
		const config = w.config({ honest: {} }, true);
		const server = await discover(config, w.attacker, { fetch: w.fake.fetch, clientId: "cli" });
		await expect(createAuthorizationSession(server)).rejects.toMatchObject({
			reason: "mix-up-unprotected",
		});
	});

	it("refuses duplicate redirect paths across servers", () => {
		const w = world();
		expect(() =>
			w.config({ honest: { redirectPath: "/cb" }, attacker: { redirectPath: "/cb" } }),
		).toThrow(expect.objectContaining({ reason: "duplicate-redirect-path" }));
	});
});
