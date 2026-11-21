import { inspect } from "node:util";

import { Crust, defineCommand } from "@crustjs/core";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { bearerAuth } from "./bearer-auth.ts";
import { type ApiAuth, type ApiClient, type AuthAttempt, fetchNextPage } from "./client.ts";
import { defineApi } from "./define-api.ts";

interface Call {
	url: string;
	method: string;
	authorization: string | null;
	body: string | undefined;
}

/** Stubs `fetch`: `respond` answers each call, which is recorded. */
function stubFetch(respond: (call: Call, index: number) => Response) {
	const calls: Call[] = [];
	vi.stubGlobal("fetch", async (url: URL, init: RequestInit) => {
		const call: Call = {
			url: url.href,
			method: init.method ?? "GET",
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
async function withApi(auth: ApiAuth, use: (api: ApiClient) => Promise<void>) {
	const acme = defineApi({
		spec: { openapi: "3.1.0", paths: {} },
		baseUrl: "https://api.example.com/v1",
	}).auth(auth);
	const app = new Crust("tool")
		.extend(acme.extension)
		.add(
			defineCommand("call", {}, (command) =>
				command.use(acme.client).action(async ({ ctx }) => use(await ctx.api)),
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

describe("api client auth retry", () => {
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

	it("retries only the redirected request that got the 401, never the write before it", async () => {
		const calls = stubFetch(({ url, authorization }) => {
			if (url.endsWith("/create")) {
				return new Response(null, { status: 303, headers: { location: "/v1/result" } });
			}
			return authorization === "Bearer AT1" ? unauthorized() : ok();
		});
		await withApi(
			() => attempts(["AT1", "AT2"]),
			async (api) => {
				const response = await api.fetch("/create", { method: "POST", body: "name=x" });
				expect(response.status).toBe(200);
				expect(response.redirected).toBe(true);
			},
		);
		expect(calls.map((call) => [call.method, call.url, call.authorization, call.body])).toEqual([
			["POST", "https://api.example.com/v1/create", "Bearer AT1", "name=x"],
			["GET", "https://api.example.com/v1/result", "Bearer AT1", undefined],
			["GET", "https://api.example.com/v1/result", "Bearer AT2", undefined],
		]);
	});

	it("resends the body a 307 kept, once, to the redirect target that got the 401", async () => {
		const calls = stubFetch(({ url, authorization }) => {
			if (url.endsWith("/upload")) {
				return new Response(null, { status: 307, headers: { location: "/v1/store" } });
			}
			return authorization === "Bearer AT1" ? unauthorized() : ok();
		});
		await withApi(
			() => attempts(["AT1", "AT2"]),
			async (api) => {
				expect((await api.fetch("/upload", { method: "PUT", body: "data" })).status).toBe(200);
			},
		);
		expect(calls.map((call) => [call.method, call.url, call.authorization, call.body])).toEqual([
			["PUT", "https://api.example.com/v1/upload", "Bearer AT1", "data"],
			["PUT", "https://api.example.com/v1/store", "Bearer AT1", "data"],
			["PUT", "https://api.example.com/v1/store", "Bearer AT2", "data"],
		]);
	});

	it("retries when retry reads the 401 body", async () => {
		const calls = stubFetch((_call, index) => (index === 0 ? unauthorized() : ok()));
		await withApi(
			() => ({
				headers: { authorization: "Bearer AT1" },
				retry: async (response) => {
					expect(await response.text()).toBe("expired");
					return { headers: { authorization: "Bearer AT2" } };
				},
			}),
			async (api) => {
				expect((await api.fetch("/me")).status).toBe(200);
			},
		);
		expect(calls.map((call) => call.authorization)).toEqual(["Bearer AT1", "Bearer AT2"]);
	});

	it("keeps retry's own error when it throws with the 401 body locked", async () => {
		stubFetch(unauthorized);
		const failure = new Error("refresh failed");
		const locked = vi.fn();
		await expect(
			withApi(
				() => ({
					headers: { authorization: "Bearer AT1" },
					retry: async (response) => {
						// Holds a reader, so the stream stays locked.
						response.body!.getReader();
						locked();
						throw failure;
					},
				}),
				async (api) => {
					await api.fetch("/me");
				},
			),
		).rejects.toBe(failure);
		expect(locked).toHaveBeenCalledTimes(1);
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

describe("api client auth headers and bodies", () => {
	it.each([
		["a header record", () => ({ authorization: "Bearer SECRET_SENTINEL\nx" })],
		[
			"an AuthAttempt",
			() => ({ headers: { authorization: "Bearer SECRET_SENTINEL\nx" } }) satisfies AuthAttempt,
		],
	])("rejects an invalid auth header value from %s without quoting it", async (_name, auth) => {
		const calls = stubFetch(ok);
		const error = await withApi(auth, async (api) => {
			await api.fetch("/me");
		}).catch((caught: unknown) => caught);
		expect(error).toBeInstanceOf(TypeError);
		expect((error as Error).message).toBe("The auth header value is not valid");
		expect((error as Error).cause).toBeUndefined();
		expect(inspect(error, { depth: 10, showHidden: true })).not.toContain("SECRET_SENTINEL");
		expect(calls).toEqual([]);
	});

	it.each([
		[
			"URLSearchParams",
			() => new URLSearchParams({ amount: "1" }),
			(body: URLSearchParams) => body.set("amount", "100"),
		],
		[
			"Uint8Array",
			() => new TextEncoder().encode("amount=1"),
			(body: Uint8Array) => body.set([0x39], 7),
		],
		[
			"FormData",
			() => {
				const form = new FormData();
				form.set("amount", "1");
				return form;
			},
			(body: FormData) => body.set("amount", "100"),
		],
	] as const)(
		"retries with the %s body as it was when the request was first sent",
		async (_name, create, mutate) => {
			const body = create();
			const sent: string[] = [];
			vi.stubGlobal("fetch", async (url: URL, init: RequestInit) => {
				sent.push(await new Response(init.body).text());
				if (sent.length > 1) return ok();
				// The caller changes its object while the first response is pending.
				(mutate as (value: typeof body) => void)(body);
				return unauthorized();
			});
			await withApi(
				() => attempts(["AT1", "AT2"]),
				async (api) => {
					expect((await api.fetch("/pay", { method: "POST", body })).status).toBe(200);
				},
			);
			expect(sent).toHaveLength(2);
			for (const text of sent) expect(text).toMatch(/amount(=|"\r\n\r\n)1(?!00)/);
		},
	);

	it("does not retry when the request set any header the attempt would have set", async () => {
		const retries: string[] = [];
		const calls = stubFetch(unauthorized);
		await withApi(
			() => ({
				...attempts(["AT1", "AT2"], retries),
				headers: { authorization: "Bearer AT1", "user-agent": "acme" },
			}),
			async (api) => {
				expect((await api.fetch("/me", { headers: { authorization: "Bearer mine" } })).status).toBe(
					401,
				);
			},
		);
		expect(retries).toEqual([]);
		expect(calls).toHaveLength(1);
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
