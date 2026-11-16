/**
 * @module-tag windows
 * @module-tag macos
 */
// SEC-K1 gate: run both logins with sentinel secrets, including a hostile server that echoes
// them back, and check every diagnostic sink. Network bodies sent on purpose are not sinks.
import { inspect } from "node:util";

import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { defineAuth } from "../src/config.ts";
import { startDeviceFlow } from "../src/device.ts";
import { discover } from "../src/discovery.ts";
import { createAuthorizationSession } from "../src/session.ts";
import { createTokenClient } from "../src/token-client.ts";
import {
	callbackPath,
	fakeFetch,
	json,
	metadataFor,
	rawRequest,
	type RecordedRequest,
	uniqueIssuer,
	wellKnown,
} from "./helpers.ts";

const STATIC = {
	code: "SENTINEL_CODE",
	accessToken: "SENTINEL_AT_1",
	refreshToken: "SENTINEL_RT_1",
	idToken: "SENTINEL_IDT",
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
	const verifier = request.body.get("code_verifier");
	if (verifier) secrets.add(verifier);
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

afterEach(() => {
	vi.restoreAllMocks();
	vi.useRealTimers();
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
	const config = defineAuth({
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
	it("SEC-K1 SEC-E8 SEC-C13 SEC-DEC-17 a successful browser login leaks nothing", async () => {
		await browserLogin(success);
		expect(secrets.size).toBeGreaterThan(Object.keys(STATIC).length);
		expectNoSecretInSinks();
	});

	it("SEC-K1 SEC-D9 SEC-DEC-17 a successful device login leaks nothing", async () => {
		await deviceLogin(success);
		expectNoSecretInSinks();
	});

	it.each(Object.keys(hostile))(
		"SEC-K1 SEC-K2 SEC-E8 a server echoing secrets through %s leaks nothing",
		async (name) => {
			await browserLogin(hostile[name]!);
			await deviceLogin(hostile[name]!);
			expectNoSecretInSinks();
		},
	);

	it("SEC-K1 SEC-C11 SEC-K2 an error callback echoing secrets leaks nothing", async () => {
		await browserLogin(success, (state) => ({
			error: `x${echoAll()}`,
			error_description: `<script>${echoAll()}</script>`,
			error_uri: `https://x.example/${echoAll()}`,
			state,
		}));
		expectNoSecretInSinks();
	});
});
