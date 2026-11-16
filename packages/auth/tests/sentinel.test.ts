/**
 * @module-tag windows
 * @module-tag macos
 */
// Run both logins with sentinel secrets, including a hostile server that echoes
// them back, and check every diagnostic sink. Network bodies sent on purpose are not sinks.
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { inspect } from "node:util";

import { Crust, defineCommand } from "@crustjs/core";
import { apiClient, apiCommand, bearerAuth } from "@crustjs/openapi";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { createAuth } from "../src/client.ts";
import { defineServers } from "../src/config.ts";
import { credentialStore, credentialStoreInternals } from "../src/credentials.ts";
import { startDeviceFlow } from "../src/device.ts";
import { discover } from "../src/discovery.ts";
import { LockRecoveryRequiredError } from "../src/errors.ts";
import { fromEnv, fromStore, resolveCredential } from "../src/resolve.ts";
import { createAuthorizationSession } from "../src/session.ts";
import { createTokenClient } from "../src/token-client.ts";
import {
	callbackPath,
	fakeFetch,
	json,
	login,
	metadataFor,
	rawRequest,
	type RecordedRequest,
	restoreTerminal,
	terminal,
	tokenWorld,
	uniqueIssuer,
	wellKnown,
} from "./helpers.ts";

const STATIC = {
	code: "SENTINEL_CODE",
	accessToken: "SENTINEL_AT_1",
	refreshToken: "SENTINEL_RT_1",
	idToken: "SENTINEL_IDT",
	refreshedAccessToken: "SENTINEL_AT_2",
	refreshedRefreshToken: "SENTINEL_RT_2",
	envToken: "SENTINEL_ENV",
	deviceCode: "SENTINEL_DEVICE",
	secret: "SENTINEL_SECRET",
};

/** Every value a sink must never show: the static sentinels plus what the client sent. */
const secrets = new Set<string>(Object.values(STATIC));
const sinks: string[] = [];

function record(value: unknown, seen = new Set<unknown>()): void {
	if (seen.has(value)) return;
	seen.add(value);
	sinks.push(
		String(value),
		inspect(value, { depth: 10 }),
		inspect(value, { depth: 10, showHidden: true }),
	);
	try {
		sinks.push(JSON.stringify(value) ?? "");
	} catch {
		// Not serializable: inspect covers it.
	}
	if (value instanceof Error) {
		sinks.push(value.message, value.stack ?? "");
		record(value.cause, seen);
	}
}

function captureSecretsFrom(request: RecordedRequest): void {
	for (const name of ["code_verifier", "refresh_token", "token"]) {
		const value = request.body.get(name);
		if (value) secrets.add(value);
	}
	const authorization = request.headers.get("authorization");
	if (authorization) {
		secrets.add(authorization);
		secrets.add(authorization.slice("Basic ".length));
	}
}

beforeEach(() => {
	for (const method of ["log", "error", "warn", "info", "debug"] as const) {
		vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
			sinks.push(args.map((arg) => inspect(arg)).join(" "));
		});
	}
	for (const stream of [process.stdout, process.stderr]) {
		const write = stream.write.bind(stream);
		vi.spyOn(stream, "write").mockImplementation((chunk: unknown, ...rest: unknown[]) => {
			sinks.push(String(chunk));
			return (write as (...args: unknown[]) => boolean)(chunk, ...rest);
		});
	}
});

const roots: string[] = [];

afterEach(() => {
	restoreTerminal();
	vi.restoreAllMocks();
	vi.useRealTimers();
	vi.unstubAllEnvs();
	vi.unstubAllGlobals();
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const echoAll = () => [...secrets].join(" ");

/** Responses a hostile server sends, each echoing every secret it has seen. */
const hostile: Record<string, () => Response> = {
	"error_description and error_uri": () =>
		json(
			{
				error: "invalid_grant",
				error_description: echoAll(),
				error_uri: `https://x.example/${encodeURIComponent(echoAll())}`,
			},
			400,
		),
	"an unknown error code": () => json({ error: echoAll() }, 400),
	"a non-JSON body": () => new Response(`<pre>${echoAll()}</pre>`, { status: 502 }),
	"a response header": () =>
		json({ error: "invalid_request" }, 400, { "x-echo": echoAll().replace(/[^\x20-\x7e]/g, "") }),
	"a 200 with an error": () =>
		json({ error: echoAll(), access_token: STATIC.accessToken, token_type: "Bearer" }),
	"an invalid token type": () => json({ access_token: STATIC.accessToken, token_type: echoAll() }),
	// Transport failures: the error a fetch implementation throws quotes what was sent.
	"a throwing transport": () => {
		throw Object.assign(new Error(`connect failed: ${echoAll()}`), {
			cause: new Error(echoAll()),
			body: echoAll(),
		});
	},
	"a failing response stream": () =>
		new Response(
			new ReadableStream({
				start(controller) {
					controller.enqueue(new TextEncoder().encode(`{"access_token":"${STATIC.accessToken}"`));
					controller.error(new Error(`stream reset: ${echoAll()}`));
				},
			}),
		),
};

function world(token: () => Response) {
	const issuer = uniqueIssuer();
	const fake = fakeFetch({
		[wellKnown(issuer)]: () => json(metadataFor(issuer)),
		[`${issuer}/token`]: (request) => {
			captureSecretsFrom(request);
			return token();
		},
		[`${issuer}/device`]: (request) => {
			captureSecretsFrom(request);
			return json({
				device_code: STATIC.deviceCode,
				user_code: "WDJB-MJHT",
				verification_uri: "https://login.example/device",
				expires_in: 600,
			});
		},
	});
	const config = defineServers({
		servers: [{ issuer, clientId: "cli", clientSecret: STATIC.secret }],
	});
	return { issuer, fake, config };
}

const success = () =>
	json({
		access_token: STATIC.accessToken,
		refresh_token: STATIC.refreshToken,
		id_token: STATIC.idToken,
		token_type: "Bearer",
		expires_in: 60,
	});

async function browserLogin(
	token: () => Response,
	query?: (state: string) => Record<string, string>,
) {
	const w = world(token);
	const server = await discover(w.config, w.issuer, { fetch: w.fake.fetch });
	record(server);
	record(w.config);
	const session = await createAuthorizationSession(server);
	record(session);
	const client = createTokenClient(server, { fetch: w.fake.fetch });
	const result = session
		.wait(({ code }) => client.exchangeCode(session, code))
		.then(
			(tokens) => record(tokens),
			(error: unknown) => record(error),
		);
	const page = await rawRequest(
		session.redirectUri,
		callbackPath(
			session.redirectUri,
			query?.(session.state) ?? { code: STATIC.code, state: session.state },
		),
	);
	sinks.push(page.body, JSON.stringify(page.headers));
	await result;
	return w;
}

async function deviceLogin(token: () => Response) {
	vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
	const w = world(token);
	const server = await discover(w.config, w.issuer, { fetch: w.fake.fetch });
	const flow = await startDeviceFlow(server, { fetch: w.fake.fetch });
	record(flow);
	const result = flow.poll().then(
		(tokens) => record(tokens),
		(error: unknown) => record(error),
	);
	// Long enough for a poll that keeps failing to back off until the code expires.
	await vi.advanceTimersByTimeAsync(700_000);
	await result;
	vi.useRealTimers();
}

/** The same logins through `createAuth()`; what its callbacks receive is a sink too. */
async function clientLogins(token: () => Response) {
	terminal({ tty: true });
	const w = world(token);
	const auth = createAuth({
		app: "acme",
		issuer: w.issuer,
		clientId: "cli",
		clientSecret: STATIC.secret,
		fetch: w.fake.fetch,
	});
	record(auth);
	let page: Promise<{ body: string; headers: unknown }> | undefined;
	await auth
		.login({
			onUrl: (prompt) => {
				record(prompt);
				const url = new URL(prompt.url);
				const redirectUri = url.searchParams.get("redirect_uri")!;
				page = rawRequest(
					redirectUri,
					callbackPath(redirectUri, { code: STATIC.code, state: url.searchParams.get("state")! }),
				);
			},
			onCode: () => {
				throw new Error("unexpected device login");
			},
		})
		.then(record, record);
	const response = await page!;
	sinks.push(response.body, JSON.stringify(response.headers));

	vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
	const device = auth
		.login({
			device: true,
			onUrl: () => {
				throw new Error("unexpected browser login");
			},
			onCode: (prompt) => record(prompt),
		})
		.then(record, record);
	await vi.advanceTimersByTimeAsync(700_000);
	await device;
	vi.useRealTimers();
}

function expectNoSecretInSinks() {
	expect(sinks.length).toBeGreaterThan(0);
	for (const secret of secrets) {
		for (const sink of sinks) {
			if (sink.includes(secret))
				throw new Error(`A diagnostic sink leaked ${secret.slice(0, 12)}…: ${sink.slice(0, 200)}`);
		}
	}
}

describe("secret sentinel gate", () => {
	it("a successful browser login leaks nothing", async () => {
		await browserLogin(success);
		expect(secrets.size).toBeGreaterThan(Object.keys(STATIC).length);
		expectNoSecretInSinks();
	});

	it("a successful device login leaks nothing", async () => {
		await deviceLogin(success);
		expectNoSecretInSinks();
	});

	it("successful logins through the client leak nothing", async () => {
		await clientLogins(success);
		expectNoSecretInSinks();
	});

	it.each(Object.keys(hostile))(
		"a server echoing secrets through %s leaks nothing",
		async (name) => {
			await browserLogin(hostile[name]!);
			await deviceLogin(hostile[name]!);
			await clientLogins(hostile[name]!);
			expectNoSecretInSinks();
		},
	);

	it("an error callback echoing secrets leaks nothing", async () => {
		await browserLogin(success, (state) => ({
			error: `x${echoAll()}`,
			error_description: `<script>${echoAll()}</script>`,
			error_uri: `https://x.example/${echoAll()}`,
			state,
		}));
		expectNoSecretInSinks();
	});
});

/** A stored login of the sentinel tokens, refreshed and revoked by `respond`. */
async function storedLogin(respond: () => Response) {
	const w = tokenWorld({
		token: (request) => {
			captureSecretsFrom(request);
			return respond();
		},
	});
	roots.push(w.root);
	const revoking = fakeFetch({
		[wellKnown(w.issuer)]: () => json(metadataFor(w.issuer)),
		[`${w.issuer}/token`]: (request) => {
			captureSecretsFrom(request);
			return respond();
		},
		[`${w.issuer}/revoke`]: (request) => {
			captureSecretsFrom(request);
			return respond();
		},
	});
	const source = w.source({ fetch: revoking.fetch });
	record(
		await login(source, { accessToken: STATIC.accessToken, refreshToken: STATIC.refreshToken }),
	);
	return { w, source };
}

const refreshed = () =>
	json({
		access_token: STATIC.refreshedAccessToken,
		refresh_token: STATIC.refreshedRefreshToken,
		token_type: "Bearer",
		expires_in: 3600,
	});

describe("secret sentinel gate: stored credentials", () => {
	it("a refresh, a resolution and a logout leak nothing", async () => {
		const { source } = await storedLogin(refreshed);
		record(await source.get());
		const resolved = await resolveCredential([fromEnv("ACME_TOKEN", {}), fromStore(source)]);
		record(resolved);
		record(await resolveCredential([fromEnv("ACME_TOKEN", { ACME_TOKEN: STATIC.envToken })]));
		record(await source.logout());
		expectNoSecretInSinks();
	});

	it.each(Object.keys(hostile))(
		"a server echoing secrets through %s leaks nothing from a refresh or logout",
		async (name) => {
			const { source } = await storedLogin(hostile[name]!);
			await source.get().then(record, record);
			await source.logout().then(record, record);
			expectNoSecretInSinks();
		},
	);

	it.each([
		["stored", `${STATIC.accessToken}\nx`, STATIC.refreshedAccessToken],
		["refreshed", STATIC.accessToken, `${STATIC.refreshedAccessToken}\nx`],
	])(
		"a %s token that is not a valid header value leaks nothing through bearerAuth",
		async (_name, stored, refreshedValue) => {
			secrets.add(stored).add(refreshedValue);
			const { source } = await storedLogin(() =>
				json({ access_token: refreshedValue, token_type: "Bearer", expires_in: 3600 }),
			);
			await (
				await source.beginLogin()
			).commit({
				accessToken: stored,
				refreshToken: STATIC.refreshToken,
				tokenType: "Bearer",
				expiresAt: undefined,
				scope: undefined,
			});
			const api = vi.fn(async () => new Response("expired", { status: 401 }));
			vi.stubGlobal("fetch", api);
			const app = new Crust("acme")
				.extend(
					apiCommand({
						spec: { openapi: "3.1.0", paths: {} },
						baseUrl: "https://api.example.com",
						auth: bearerAuth((options) => resolveCredential([fromStore(source)], options)),
					}),
				)
				.add(
					defineCommand("call", {}, (command) =>
						command.use(apiClient).action(async ({ ctx }) => (await ctx.api).fetch("/me")),
					),
				);
			const outcome = await app.run(["call"]);
			expect(outcome.status).toBe("failed");
			record(outcome);
			sinks.push(outcome.stdout, outcome.stderr);
			expect(api.mock.calls.length).toBe(stored === STATIC.accessToken ? 1 : 0);
			expectNoSecretInSinks();
		},
	);

	it("a corrupt file and a lock error leak nothing", async () => {
		const { w, source } = await storedLogin(refreshed);
		let lockPath = "";
		// A lock left by a process on another platform: never taken over, reported with its owner.
		await credentialStoreInternals(w.store).lockIdentity(source.key, async () => {
			const lockFile = readdirSync(w.dir).find((file) => file.endsWith(".lock"))!;
			lockPath = join(w.dir, lockFile);
		});
		writeFileSync(
			lockPath,
			JSON.stringify({
				ownerId: "foreign",
				pid: 1,
				host: "other",
				platform: "other",
				createdAt: new Date().toISOString(),
			}),
		);
		const locked = await w
			.source({ store: credentialStore({ app: w.app, lockTimeout: 50 }) })
			.get()
			.catch((error: unknown) => error);
		expect(locked).toBeInstanceOf(LockRecoveryRequiredError);
		record(locked);
		rmSync(lockPath);
		mkdirSync(w.dir, { recursive: true });
		writeFileSync(w.file, `{"version":1,"records":{"x":"${STATIC.refreshToken}`);
		await source.get().then(record, record);
		await source.logout().then(record, record);
		expectNoSecretInSinks();
	});
});
