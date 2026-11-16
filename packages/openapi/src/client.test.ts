import { Crust, defineCommand } from "@crustjs/core";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { apiCommand } from "./api-command.ts";
import { bearerAuth } from "./bearer-auth.ts";
import {
	type ApiClient,
	type ApiClientOptions,
	type AuthAttempt,
	apiClient,
	fetchNextPage,
} from "./client.ts";

interface Call {
	url: string;
	authorization: string | null;
	body: string | undefined;
}

/** Stubs `fetch`: `respond` answers each call, which is recorded. */
function stubFetch(respond: (call: Call, index: number) => Response) {
	const calls: Call[] = [];
	vi.stubGlobal("fetch", async (url: URL, init: RequestInit) => {
		const call: Call = {
			url: url.href,
			authorization: new Headers(init.headers).get("authorization"),
			body: init.body == null ? undefined : String(init.body),
		};
		calls.push(call);
		return respond(call, calls.length - 1);
	});
	return calls;
}

const unauthorized = () => new Response("expired", { status: 401 });
const ok = () => new Response("{}");

/** Runs `use` with the `api` Context of an app configured with `auth`. */
async function withApi(auth: ApiClientOptions["auth"], use: (api: ApiClient) => Promise<void>) {
	const app = new Crust("tool")
		.extend(
			apiCommand({
				spec: { openapi: "3.1.0", paths: {} },
				baseUrl: "https://api.example.com/v1",
				auth,
			}),
		)
		.add(
			defineCommand("call", {}, (command) =>
				command.use(apiClient).action(async ({ ctx }) => use(await ctx.api)),
			),
		);
	const outcome = await app.run(["call"]);
	if (outcome.status === "failed") throw outcome.error;
}

/** An attempt with token `value` that refreshes to the next token once per call of `retry`. */
function attempts(values: string[], retries: string[] = []): AuthAttempt {
	const [value, ...rest] = values;
	return {
		headers: { authorization: `Bearer ${value}` },
		retry: async () => {
			retries.push(value!);
			return rest.length > 0 ? attempts(rest, retries) : undefined;
		},
	};
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("apiClient auth retry", () => {
	it("keeps working with an auth function that returns plain headers, and never retries it", async () => {
		const calls = stubFetch(unauthorized);
		const auth = vi.fn(() => ({ authorization: "Bearer plain" }));
		await withApi(auth, async (api) => {
			expect((await api.fetch("/me")).status).toBe(401);
		});
		expect(calls.map((call) => call.authorization)).toEqual(["Bearer plain"]);
		expect(auth).toHaveBeenCalledTimes(1);
	});

	it("passes the base URL as configured to auth", async () => {
		stubFetch(ok);
		const auth = vi.fn((_input: unknown, _client: { baseUrl: string }) => undefined);
		await withApi(auth, async (api) => {
			await api.fetch("/me");
		});
		expect(auth.mock.calls[0]![1]).toEqual({ baseUrl: "https://api.example.com/v1" });
	});

	it("retries a 401 once with the attempt retry returns, from the first hop, and keeps it for later requests and pages", async () => {
		const calls = stubFetch((call, index) => (index === 0 ? unauthorized() : ok()));
		const retries: string[] = [];
		const cancel = vi.spyOn(ReadableStream.prototype, "cancel");
		await withApi(
			() => attempts(["AT1", "AT2"], retries),
			async (api) => {
				expect((await api.fetch("/me", { method: "POST", body: "x=1" })).status).toBe(200);
				await api.fetch("/later");
				await fetchNextPage(api, "/users?page=2");
			},
		);
		expect(calls.map((call) => [call.url, call.authorization, call.body])).toEqual([
			["https://api.example.com/v1/me", "Bearer AT1", "x=1"],
			["https://api.example.com/v1/me", "Bearer AT2", "x=1"],
			["https://api.example.com/v1/later", "Bearer AT2", undefined],
			["https://api.example.com/v1/users?page=2", "Bearer AT2", undefined],
		]);
		expect(retries).toEqual(["AT1"]);
		expect(cancel).toHaveBeenCalledTimes(1);
	});

	it("returns the second 401 without a third request", async () => {
		const calls = stubFetch(unauthorized);
		await withApi(
			() => attempts(["AT1", "AT2", "AT3"]),
			async (api) => {
				expect((await api.fetch("/me")).status).toBe(401);
			},
		);
		expect(calls.map((call) => call.authorization)).toEqual(["Bearer AT1", "Bearer AT2"]);
	});

	it("returns the 401 when retry returns undefined, and its error when it throws", async () => {
		stubFetch(unauthorized);
		await withApi(
			() => attempts(["AT1"]),
			async (api) => {
				expect(await (await api.fetch("/me")).text()).toBe("expired");
			},
		);
		const failure = new Error("refresh failed");
		await expect(
			withApi(
				() => ({ headers: { authorization: "Bearer AT1" }, retry: () => Promise.reject(failure) }),
				async (api) => {
					await api.fetch("/me");
				},
			),
		).rejects.toBe(failure);
	});

	it("never retries a 403, a 5xx, a stream body, the caller's own Authorization, or an off-origin 401", async () => {
		const retries: string[] = [];
		const calls = stubFetch(({ url }) => {
			if (url.endsWith("/forbidden")) return new Response(null, { status: 403 });
			if (url.endsWith("/down")) return new Response(null, { status: 503 });
			if (url.endsWith("/moved")) {
				return new Response(null, {
					status: 302,
					headers: { location: "https://other.example/x" },
				});
			}
			return unauthorized();
		});
		await withApi(
			() => attempts(["AT1", "AT2"], retries),
			async (api) => {
				await api.fetch("/forbidden");
				await api.fetch("/down");
				await api.fetch("/stream", {
					method: "POST",
					body: new ReadableStream({ start: (controller) => controller.close() }),
					duplex: "half",
				});
				await api.fetch("/own", { headers: { authorization: "Bearer mine" } });
				await api.fetch("/moved");
			},
		);
		expect(retries).toEqual([]);
		expect(calls).toHaveLength(6);
		expect(calls[5]).toMatchObject({ url: "https://other.example/x", authorization: null });
	});
});

describe("bearerAuth", () => {
	it("sends the resolved value as a bearer token and retries a 401 with its refresh", async () => {
		const calls = stubFetch((call, index) => (index === 0 ? unauthorized() : ok()));
		const resolve = vi.fn(async (_options: { signal: AbortSignal; baseUrl: string }) => ({
			value: "AT1",
			refresh: async () => ({ value: "AT2" }),
		}));
		await withApi(bearerAuth(resolve), async (api) => {
			expect((await api.fetch("/me")).status).toBe(200);
		});
		expect(calls.map((call) => call.authorization)).toEqual(["Bearer AT1", "Bearer AT2"]);
		expect(resolve.mock.calls[0]![0].baseUrl).toBe("https://api.example.com/v1");
		expect(resolve.mock.calls[0]![0].signal).toBeInstanceOf(AbortSignal);
	});

	it("does not retry a credential without refresh", async () => {
		const calls = stubFetch(unauthorized);
		await withApi(
			bearerAuth(async () => ({ value: "ENV_TOKEN" })),
			async (api) => {
				expect((await api.fetch("/me")).status).toBe(401);
			},
		);
		expect(calls).toHaveLength(1);
	});
});
