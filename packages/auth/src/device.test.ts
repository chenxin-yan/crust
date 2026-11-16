import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { json, setupServer, uniqueIssuer } from "../tests/helpers.ts";
import { startDeviceFlow } from "./device.ts";
import { AbortError, OAuthConfigError, OAuthError } from "./errors.ts";

const DEVICE = {
	device_code: "SENTINEL_DEVICE",
	user_code: "WDJB-MJHT",
	verification_uri: "https://login.example/device",
	expires_in: 600,
	interval: 5,
};
const TOKEN = { access_token: "AT", token_type: "Bearer", expires_in: 3600 };
const pending = () => json({ error: "authorization_pending" }, 400);
const slowDown = () => json({ error: "slow_down" }, 400);
const success = () => json(TOKEN);

beforeEach(() => {
	vi.useFakeTimers({ now: 0 });
});

afterEach(() => {
	vi.useRealTimers();
});

/** A device flow whose token endpoint answers from `script`, one entry per poll. */
async function deviceSetup(
	device: Record<string, unknown>,
	script: (() => Response | Promise<Response>)[] = [],
	options: Parameters<typeof setupServer>[0] = {},
) {
	const issuer = uniqueIssuer();
	const pollTimes: number[] = [];
	const setup = await setupServer({
		...options,
		server: { issuer, ...options.server },
		routes: {
			[`${issuer}/device`]: () => json(device),
			[`${issuer}/token`]: () => {
				pollTimes.push(Date.now());
				const next = script.shift();
				if (!next) throw new Error("unexpected poll");
				return next();
			},
		},
	});
	return {
		...setup,
		pollTimes,
		start: () => startDeviceFlow(setup.server, { fetch: setup.fetch }),
	};
}

async function settle<T>(promise: Promise<T>, ms: number): Promise<unknown> {
	const result = promise.catch((error: unknown) => error);
	await vi.advanceTimersByTimeAsync(ms);
	return result;
}

describe("startDeviceFlow", () => {
	it("SEC-D1 waits the interval before every poll and adds 5 s per slow_down", async () => {
		const { start, pollTimes } = await deviceSetup(DEVICE, [
			pending,
			pending,
			slowDown,
			pending,
			success,
		]);
		const flow = await start();
		const tokens = await settle(flow.poll(), 40_000);
		expect(tokens).toMatchObject({ accessToken: "AT" });
		expect(pollTimes).toEqual([5_000, 10_000, 15_000, 25_000, 35_000]);
	});

	it("SEC-D1 SEC-D6 defaults a missing interval to 5 s", async () => {
		const { start, pollTimes } = await deviceSetup({ ...DEVICE, interval: undefined }, [success]);
		const flow = await start();
		await settle(flow.poll(), 6_000);
		expect(pollTimes).toEqual([5_000]);
	});

	it.each(["invalid_client", "access_denied", "expired_token", "foo"])(
		"SEC-D2 stops polling on %s",
		async (code) => {
			const { start, pollTimes } = await deviceSetup(DEVICE, [
				() => json({ error: code }, 400),
				pending,
			]);
			const flow = await start();
			const error = await settle(flow.poll(), 20_000);
			expect(error).toBeInstanceOf(OAuthError);
			expect((error as OAuthError).code).toBe(code === "foo" ? "unknown" : code);
			expect(pollTimes).toHaveLength(1);
		},
	);

	it("SEC-D3 doubles the wait after network failures", async () => {
		const offline = () => Promise.reject(new TypeError("fetch failed"));
		const { start, pollTimes } = await deviceSetup(DEVICE, [offline, offline, offline, success]);
		const flow = await start();
		const tokens = await settle(flow.poll(), 80_000);
		expect(tokens).toMatchObject({ accessToken: "AT" });
		expect(pollTimes).toEqual([5_000, 15_000, 35_000, 75_000]);
	});

	it.each([
		["0", 0],
		["-1", -1],
		["a string", "abc"],
		["null", null],
		["missing", undefined],
		["above the cap", 86_401],
	])("SEC-D4 rejects expires_in %s before showing a code", async (_name, expiresIn) => {
		const { start } = await deviceSetup({ ...DEVICE, expires_in: expiresIn });
		await expect(start()).rejects.toMatchObject({ code: "invalid_response" });
	});

	it("SEC-D4 expires at the deadline without another poll", async () => {
		const { start, pollTimes } = await deviceSetup({ ...DEVICE, expires_in: 12 }, [
			pending,
			pending,
			pending,
		]);
		const flow = await start();
		expect(flow.expiresAt).toBe(12_000);
		const result = flow.poll().catch((error: unknown) => error);
		await vi.advanceTimersByTimeAsync(11_999);
		expect(pollTimes).toEqual([5_000, 10_000]);
		await vi.advanceTimersByTimeAsync(1);
		const error = await result;
		expect(error).toBeInstanceOf(OAuthError);
		expect((error as OAuthError).code).toBe("expired_token");
		expect(pollTimes).toHaveLength(2);
	});

	it("SEC-D4 aborts a poll still in flight at the deadline", async () => {
		const signals: AbortSignal[] = [];
		const { server, fetch } = await deviceSetup({ ...DEVICE, expires_in: 8 }, [
			() => new Promise<Response>(() => {}),
		]);
		const flow = await startDeviceFlow(server, {
			fetch: (url, init) => {
				if (init.signal) signals.push(init.signal);
				return fetch(url, init);
			},
		});
		const error = await settle(flow.poll(), 8_000);
		expect(error).toMatchObject({ code: "expired_token" });
		expect(signals.at(-1)?.aborted).toBe(true);
	});

	it("SEC-D5 SEC-P1 aborts the sleep between polls without another request", async () => {
		const { start, pollTimes } = await deviceSetup(DEVICE, [pending, pending]);
		const flow = await start();
		const controller = new AbortController();
		const result = flow.poll({ signal: controller.signal }).catch((error: unknown) => error);
		await vi.advanceTimersByTimeAsync(7_000);
		controller.abort();
		expect(await result).toBeInstanceOf(AbortError);
		await vi.advanceTimersByTimeAsync(60_000);
		expect(pollTimes).toEqual([5_000]);
	});

	it("SEC-P1 rejects a pre-aborted start or poll without a request", async () => {
		const { server, fetch, requests, start } = await deviceSetup(DEVICE);
		const before = requests.length;
		await expect(
			startDeviceFlow(server, { fetch, signal: AbortSignal.abort() }),
		).rejects.toBeInstanceOf(AbortError);
		expect(requests.length).toBe(before);
		const flow = await start();
		await expect(flow.poll({ signal: AbortSignal.abort() })).rejects.toBeInstanceOf(AbortError);
	});

	it("SEC-D6 never polls before a long interval and floors a short one at 5 s", async () => {
		const long = await deviceSetup({ ...DEVICE, interval: 120 }, [success]);
		await settle((await long.start()).poll(), 121_000);
		expect(long.pollTimes).toEqual([120_000]);
		vi.setSystemTime(0);
		const zero = await deviceSetup({ ...DEVICE, interval: 0 }, [success]);
		await settle((await zero.start()).poll(), 6_000);
		expect(zero.pollTimes).toEqual([5_000]);
	});

	it("SEC-D6 expires without polling when the interval outlasts the code", async () => {
		const { start, pollTimes } = await deviceSetup({ ...DEVICE, interval: 500, expires_in: 300 }, [
			success,
		]);
		const flow = await start();
		const result = flow.poll().catch((error: unknown) => error);
		await vi.advanceTimersByTimeAsync(299_000);
		await vi.advanceTimersByTimeAsync(1_000);
		expect(await result).toMatchObject({ code: "expired_token" });
		expect(pollTimes).toEqual([]);
	});

	it.each([
		["a string", "5"],
		["negative", -1],
		["null", null],
		["above the cap", 1e9],
	])("SEC-D6 rejects interval %s before showing a code", async (_name, interval) => {
		const { start } = await deviceSetup({ ...DEVICE, interval });
		await expect(start()).rejects.toMatchObject({ code: "invalid_response" });
	});

	it("SEC-D7 always exposes the user code and the verification URI", async () => {
		const { start } = await deviceSetup({
			...DEVICE,
			verification_uri_complete: "https://login.example/device?user_code=WDJB-MJHT",
		});
		const flow = await start();
		expect(flow.userCode).toBe("WDJB-MJHT");
		expect(flow.verificationUri).toBe("https://login.example/device");
		expect(flow.verificationUriComplete).toBe("https://login.example/device?user_code=WDJB-MJHT");
		expect(Object.isFrozen(flow)).toBe(true);
	});

	it.each([
		["verification_uri", "javascript:alert(1)"],
		["verification_uri", "file:///etc/passwd"],
		["verification_uri", "http://evil.example/"],
		["verification_uri", "https://u:p@login.example/device"],
		["verification_uri", undefined],
		["verification_uri_complete", "http://evil.example/?c=1"],
	])("SEC-D8 SEC-DEC-15 rejects %s %s before display", async (name, value) => {
		const { start } = await deviceSetup({ ...DEVICE, [name]: value });
		await expect(start()).rejects.toBeInstanceOf(Error);
	});

	it.each([
		["device_code", undefined],
		["device_code", ""],
		["user_code", undefined],
		["user_code", "\x1b[2J\n"],
	])("SEC-D8 requires %s (%j)", async (name, value) => {
		const { start } = await deviceSetup({ ...DEVICE, [name]: value });
		await expect(start()).rejects.toMatchObject({ code: "invalid_response" });
	});

	it("SEC-D8 SEC-DEC-15 accepts a verification URI on another host and sanitizes the user code", async () => {
		const { start } = await deviceSetup({
			...DEVICE,
			user_code: "AB\x1b[2JCD\nEF",
			verification_uri: "https://microsoft.example/devicelogin",
		});
		const flow = await start();
		expect(flow.userCode).toBe("ABCDEF");
		expect(flow.verificationUri).toBe("https://microsoft.example/devicelogin");
	});

	it("SEC-D9 never exposes the device code on the flow", async () => {
		const { start } = await deviceSetup(DEVICE);
		const flow = await start();
		expect(JSON.stringify(flow)).not.toContain("SENTINEL_DEVICE");
		expect(Object.values(flow)).not.toContain("SENTINEL_DEVICE");
	});

	it("SEC-D10 polls with the device grant body over a form POST", async () => {
		const { start, requests, server } = await deviceSetup(DEVICE, [success]);
		const flow = await start();
		await settle(flow.poll(), 6_000);
		const poll = requests.find((request) => request.url === server.tokenEndpoint)!;
		expect(poll.method).toBe("POST");
		expect(poll.headers.get("content-type")).toBe("application/x-www-form-urlencoded");
		expect(Object.fromEntries(poll.body)).toEqual({
			grant_type: "urn:ietf:params:oauth:grant-type:device_code",
			device_code: "SENTINEL_DEVICE",
			client_id: "cli",
		});
		const start_ = requests.find((request) => request.url === server.deviceAuthorizationEndpoint)!;
		expect(Object.fromEntries(start_.body)).toEqual({ client_id: "cli" });
	});

	it("SEC-H7 refuses a server that does not offer the device grant", async () => {
		const listed = await deviceSetup(DEVICE, [], {
			metadata: { grant_types_supported: ["authorization_code"] },
		});
		const error = await listed.start().catch((caught: unknown) => caught);
		expect(error).toBeInstanceOf(OAuthConfigError);
		expect((error as OAuthConfigError).reason).toBe("unsupported");
		const missing = await deviceSetup(DEVICE, [], {
			metadata: { device_authorization_endpoint: undefined },
		});
		await expect(missing.start()).rejects.toMatchObject({ reason: "unsupported" });
	});

	it("SEC-D2 refuses a second poll() on the same flow", async () => {
		const { start } = await deviceSetup(DEVICE, [success]);
		const flow = await start();
		const first = flow.poll();
		await expect(flow.poll()).rejects.toMatchObject({ reason: "already-used" });
		await settle(first, 6_000);
	});
});
