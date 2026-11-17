import { Crust, CrustError, defineCommand } from "@crustjs/core";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import type { ApiClient } from "./client.ts";
import { defineApi } from "./define-api.ts";
import { type Operation, operations } from "./operations.ts";
import { ApiResponseError, buildRequest } from "./request.ts";

const spec = {
	openapi: "3.1.0",
	security: [{ token: [] }],
	paths: {
		"/users/{id}/posts/{slug}": {
			parameters: [
				{ name: "id", in: "path", required: true, schema: { type: "string" } },
				{ name: "slug", in: "path", required: true, schema: { type: "string" } },
			],
			get: {
				operationId: "getPost",
				parameters: [
					{ name: "tags", in: "query", schema: { type: "array", items: { type: "string" } } },
					{
						name: "fields",
						in: "query",
						explode: false,
						schema: { type: "array", items: { type: "string" } },
					},
					{ name: "draft", in: "query", schema: { type: "boolean" } },
					{ name: "X-Trace", in: "header", schema: { type: "string" } },
					{ name: "session", in: "cookie", schema: { type: "string" } },
				],
				responses: { "200": { description: "ok" } },
			},
		},
		"/users": {
			post: {
				operationId: "createUser",
				requestBody: {
					required: true,
					content: { "application/merge-patch+json": { schema: { type: "object" } } },
				},
				responses: { "201": { description: "created" } },
			},
		},
		"/status": {
			get: { operationId: "status", security: [], responses: { "200": { description: "ok" } } },
		},
		"/reports/{id}": {
			get: {
				operationId: "getReport",
				parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
				responses: {
					"200": {
						description: "The report, as JSON or XML",
						content: {
							"application/json": { schema: { type: "object" } },
							"application/xml": { schema: { type: "string" } },
						},
					},
				},
			},
		},
		"/feed": {
			get: {
				operationId: "getFeed",
				responses: {
					"200": {
						description: "ok",
						content: { "application/vnd.feed+json": { schema: { type: "object" } } },
					},
					"202": { description: "queued", content: { "text/plain": { schema: {} } } },
				},
			},
		},
		"/export": {
			get: {
				operationId: "export",
				responses: { "200": { description: "ok", content: { "text/csv": { schema: {} } } } },
			},
		},
		"/maps/{at}/{near}": {
			get: {
				operationId: "locate",
				parameters: [
					{ name: "at", in: "path", required: true, schema: { type: "object" } },
					{ name: "near", in: "path", required: true, explode: true, schema: { type: "object" } },
					{ name: "filter", in: "query", schema: { type: "object" } },
					{ name: "range", in: "query", explode: false, schema: { type: "object" } },
					{ name: "X-At", in: "header", schema: { type: "object" } },
					{ name: "X-Near", in: "header", explode: true, schema: { type: "object" } },
				],
				responses: { "200": { description: "ok" } },
			},
		},
		"/inherited": {
			get: {
				operationId: "inherited",
				parameters: ["toString", "constructor", "__proto__"].map((name) => ({
					name,
					in: "query",
					schema: { type: "string" },
				})),
				responses: { "200": { description: "ok" } },
			},
		},
		"/upload": {
			post: {
				operationId: "upload",
				parameters: [
					{ name: "filter", in: "query", style: "deepObject", schema: { type: "object" } },
					{ name: "session", in: "cookie", required: true, schema: { type: "string" } },
				],
				requestBody: { content: { "multipart/form-data": { schema: { type: "object" } } } },
				responses: { "200": { description: "ok" } },
			},
		},
	},
};

const byId = new Map(operations(spec).operations.map((op) => [op.id, op]));
const op = (id: string): Operation => byId.get(id)!;

/** `buildRequest()`'s result as plain data. */
function request(id: string, input?: Parameters<typeof buildRequest>[1]) {
	const { path, init } = buildRequest(op(id), input);
	return { path, method: init.method, headers: Object.fromEntries(init.headers), body: init.body };
}

/** The error `buildRequest()` throws. */
function failure(id: string, input?: Parameters<typeof buildRequest>[1]): unknown {
	try {
		buildRequest(op(id), input);
	} catch (error) {
		return error;
	}
	throw new Error("buildRequest did not throw");
}

describe("buildRequest", () => {
	it("fills and percent-encodes the path, and serializes the query by explode and the headers", () => {
		expect(
			request("getPost", {
				path: { id: "a b/c", slug: "it's (all)*!" },
				query: { tags: ["x y", "z&"], fields: ["id", "na,me"], draft: false },
				header: { "X-Trace": "t1" },
			}),
		).toEqual({
			path: "/users/a%20b%2Fc/posts/it%27s%20%28all%29%2A%21?tags=x%20y&tags=z%26&fields=id,na%2Cme&draft=false",
			method: "GET",
			headers: { "x-trace": "t1" },
			body: undefined,
		});
	});

	it("leaves out optional parameters that are not given, and sends no cookie", () => {
		expect(request("getPost", { path: { id: 1, slug: true }, query: { tags: undefined } })).toEqual(
			{ path: "/users/1/posts/true", method: "GET", headers: {}, body: undefined },
		);
	});

	it("sends the body as JSON with the operation's media type", () => {
		expect(request("createUser", { body: { name: "Ada" } })).toEqual({
			path: "/users",
			method: "POST",
			headers: { "content-type": "application/merge-patch+json" },
			body: '{"name":"Ada"}',
		});
	});

	it.each([
		["getPost", { path: { id: "1" } }, 'getPost: missing the path parameter "slug"'],
		["getPost", { path: { id: "1", slug: "s", other: "x" } }, 'getPost: no path parameter "other"'],
		[
			"getPost",
			{ path: { id: "1", slug: "s" }, query: { id: "1" } },
			'getPost: no query parameter "id"',
		],
		[
			"getPost",
			{ path: { id: "1", slug: "s" }, query: { draft: { yes: { deep: true } } as never } },
			'getPost: the query parameter "draft" must be a scalar, an array of scalars, or an object of scalars',
		],
		["createUser", {}, "createUser: missing the request body"],
		["status", { body: {} }, "status: the operation takes no request body"],
		["upload", {}, 'upload: the required cookie parameter "session" cannot be sent'],
	])("rejects %s with %j before any request", (id, input, message) => {
		const error = failure(id, input);

		expect(error).toBeInstanceOf(CrustError);
		expect(error).toMatchObject({ code: "VALIDATION", message });
	});

	it("serializes object parameters by style and explode", () => {
		expect(
			request("locate", {
				path: { at: { x: 1, y: "a b" }, near: { x: 1, y: 2 } },
				query: { filter: { role: "admin", team: "a&b" }, range: { min: 1, max: 5 } },
				header: { "X-At": { x: 1, y: 2 }, "X-Near": { x: 1, y: 2 } },
			}),
		).toEqual({
			path: "/maps/x,1,y,a%20b/x=1,y=2?role=admin&team=a%26b&range=min,1,max,5",
			method: "GET",
			headers: { "x-at": "x,1,y,2", "x-near": "x=1,y=2" },
			body: undefined,
		});
	});

	it("reads only a parameter's own value, whatever its name", () => {
		expect(request("inherited", { query: {} }).path).toBe("/inherited");
		const query: Record<string, string> = JSON.parse(
			'{"toString":"a","constructor":"b","__proto__":"c"}',
		);
		expect(request("inherited", { query }).path).toBe(
			"/inherited?toString=a&constructor=b&__proto__=c",
		);
	});

	it.each(["", ".", ".."])(
		"rejects the path value %j, which would address another resource",
		(value) => {
			const error = failure("getPost", { path: { id: value, slug: "s" } });

			expect(error).toBeInstanceOf(CrustError);
			expect(error).toMatchObject({
				code: "VALIDATION",
				message: 'getPost: the path parameter "id" would make an empty, "." or ".." path segment',
			});
		},
	);

	it("rejects a header value HTTP does not allow without repeating it", () => {
		const error = failure("getPost", {
			path: { id: "1", slug: "s" },
			header: { "X-Trace": "SECRET_SENTINEL\nx" },
		});

		expect(error).toBeInstanceOf(CrustError);
		expect(error).toMatchObject({
			code: "VALIDATION",
			message: 'getPost: the header parameter "X-Trace" has characters HTTP does not allow',
		});
		expect((error as Error).cause).toBeUndefined();
		expect(JSON.stringify(error, Object.getOwnPropertyNames(error))).not.toContain("SECRET");
	});

	it("sends a null body as JSON", () => {
		expect(request("createUser", { body: null }).body).toBe("null");
	});

	it.each([
		["a function", () => 1],
		["a symbol", Symbol("body")],
		["toJSON returning undefined", { toJSON: () => undefined }],
		[
			"a cycle",
			(() => {
				const cycle: Record<string, unknown> = {};
				cycle.self = cycle;
				return cycle;
			})(),
		],
		["a BigInt", { total: 1n }],
	])("rejects a body that is %s before any request", (_, body) => {
		const error = failure("createUser", { body });

		expect(error).toBeInstanceOf(CrustError);
		expect(error).toMatchObject({
			code: "VALIDATION",
			message: "createUser: the request body cannot be sent as JSON",
		});
		expect((error as Error).cause).toBeUndefined();
	});

	it("asks for JSON when the operation declares a JSON 2xx response, unless the input sets Accept", () => {
		expect(request("getReport", { path: { id: "1" } }).headers).toEqual({
			accept: "application/json",
		});
		expect(request("getFeed").headers).toEqual({
			accept: "application/vnd.feed+json, application/json",
		});
		expect(request("export").headers).toEqual({});
		expect(
			request("getReport", { path: { id: "1" }, header: { ACCEPT: "application/xml" } }).headers,
		).toEqual({ accept: "application/xml" });
	});

	it("names what call() cannot send and points to fetch()", () => {
		const unsent = {
			...op("upload"),
			params: op("upload").params.filter((param) => param.in !== "cookie"),
		};

		expect(() => buildRequest(unsent, { query: { filter: "x" } })).toThrow(
			'upload: the query parameter "filter" is in style deepObject; call() sends only style form, so use fetch()',
		);
		expect(() => buildRequest(unsent, { body: {} })).toThrow(
			"upload: the request body is multipart/form-data; call() sends only JSON, so use fetch()",
		);
	});
});

describe("call()", () => {
	const fetched: { url: string; method: string; headers: Record<string, string>; body?: string }[] =
		[];
	let respond: () => Response;
	afterEach(() => {
		vi.unstubAllGlobals();
		fetched.length = 0;
	});

	/** Runs `use` with the client of an app over `spec`, with fetch answering `response`. */
	async function withClient<T>(response: () => Response, use: (api: ApiClient) => Promise<T>) {
		respond = response;
		vi.stubGlobal("fetch", async (url: URL, init: RequestInit) => {
			fetched.push({
				url: url.href,
				method: init.method ?? "GET",
				headers: Object.fromEntries(new Headers(init.headers)),
				...(init.body != null && { body: String(init.body) }),
			});
			return respond();
		});
		const acme = defineApi({
			spec,
			baseUrl: "https://api.example.com/v1",
			auth: () => ({ authorization: "Bearer secret" }),
		});
		const app = new Crust("tool")
			.extend(acme.extension)
			.add(
				defineCommand("call", {}, (command) =>
					command.use(acme.client).action(async ({ ctx }) => use(await ctx.api)),
				),
			);
		const outcome = await app.run(["call"]);
		if (outcome.status === "failed") throw outcome.error;
		return outcome.status === "completed" ? (outcome.result as T) : undefined;
	}

	it("sends the request below the base URL with auth and returns the parsed JSON body", async () => {
		const result = await withClient(
			() => Response.json({ id: "1", title: "Hi" }),
			(api) => api.call("createUser", { body: { name: "Ada" } }),
		);

		expect(result).toEqual({ id: "1", title: "Hi" });
		expect(fetched).toEqual([
			{
				url: "https://api.example.com/v1/users",
				method: "POST",
				headers: { authorization: "Bearer secret", "content-type": "application/merge-patch+json" },
				body: '{"name":"Ada"}',
			},
		]);
	});

	it("sends reserved characters in a path value as one segment, and no request for a dot segment", async () => {
		const errors = await withClient(
			() => Response.json({}),
			async (api) => [
				await api.call("getPost", { path: { id: "a/b?c#d%", slug: "..x" } }),
				...(await Promise.all(
					["", ".", ".."].map((id) =>
						api.call("getPost", { path: { id, slug: "s" } }).catch((caught: unknown) => caught),
					),
				)),
			],
		);

		expect(fetched.map(({ url }) => url)).toEqual([
			"https://api.example.com/v1/users/a%2Fb%3Fc%23d%25/posts/..x",
		]);
		expect(errors?.slice(1)).toEqual([
			expect.objectContaining({ code: "VALIDATION" }),
			expect.objectContaining({ code: "VALIDATION" }),
			expect.objectContaining({ code: "VALIDATION" }),
		]);
	});

	it("sends a public operation (security: []) without auth", async () => {
		await withClient(
			() => Response.json({}),
			(api) => api.call("status"),
		);

		expect(fetched).toEqual([
			{ url: "https://api.example.com/v1/status", method: "GET", headers: {} },
		]);
	});

	it.each([
		["no content", () => new Response(null, { status: 204 })],
		[
			"an empty JSON body",
			() => new Response("", { headers: { "content-type": "application/json" } }),
		],
		[
			"an empty body of another type",
			() => new Response("", { headers: { "content-length": "0" } }),
		],
	])("returns undefined for %s", async (_, response) => {
		const result = await withClient(response, async (api) => ({ value: await api.call("status") }));

		expect(result).toEqual({ value: undefined });
	});

	it("returns the unread Response for another media type", async () => {
		const result = await withClient(
			() => new Response("a,b\n", { headers: { "content-type": "text/csv" } }),
			async (api) => {
				const response = await api.call("status");
				return response instanceof Response ? [response.bodyUsed, await response.text()] : response;
			},
		);

		expect(result).toEqual([false, "a,b\n"]);
	});

	it("still returns the Response, sending no Accept, for an operation that declares no JSON", async () => {
		const result = await withClient(
			() => new Response("a,b\n", { headers: { "content-type": "text/csv" } }),
			async (api) => {
				const response = await api.call("export");
				return response instanceof Response ? await response.text() : response;
			},
		);

		expect(result).toBe("a,b\n");
		expect(fetched[0]?.headers).toEqual({ authorization: "Bearer secret" });
	});

	it.each([
		["getReport", "application/xml", "GET /reports/1: HTTP 200 answered application/xml, not JSON"],
		["getFeed", null, "GET /feed: HTTP 200 answered no Content-Type, not JSON"],
	])(
		"rejects a 2xx answer to %s that is not the JSON it declares, without its body",
		async (id, type, message) => {
			const error = await withClient(
				() =>
					// Bytes, so the Response adds no Content-Type of its own.
					new Response(new TextEncoder().encode("<secret>SECRET_SENTINEL</secret>"), {
						headers: type === null ? {} : { "content-type": type },
					}),
				(api) =>
					api
						.call(id, id === "getReport" ? { path: { id: "1" } } : undefined)
						.catch((caught: unknown) => caught),
			);

			expect(error).toBeInstanceOf(ApiResponseError);
			expect(error).toMatchObject({ status: 200, message });
			expect(fetched[0]?.headers.accept).toBe(
				id === "getReport" ? "application/json" : "application/vnd.feed+json, application/json",
			);
		},
	);

	it("returns the Response for a declared non-JSON status of an operation that also declares JSON", async () => {
		const result = await withClient(
			() => new Response("queued", { status: 202, headers: { "content-type": "text/plain" } }),
			async (api) => {
				const response = await api.call("getFeed");
				return response instanceof Response ? await response.text() : response;
			},
		);

		expect(result).toBe("queued");
	});

	it("rejects a non-2xx response with an ApiResponseError, leaving out the query", async () => {
		const error = await withClient(
			() => Response.json({ message: "not found" }, { status: 404, statusText: "Not Found" }),
			(api) =>
				api
					.call("getPost", { path: { id: "1", slug: "s" }, query: { tags: ["secret"] } })
					.catch((caught: unknown) => caught),
		);

		expect(error).toBeInstanceOf(ApiResponseError);
		expect(error).toMatchObject({
			status: 404,
			message: "GET /users/1/posts/s: HTTP 404 Not Found",
		});
	});

	it("rejects an invalid JSON body", async () => {
		const error = await withClient(
			() => new Response("{", { headers: { "content-type": "application/json" } }),
			(api) => api.call("status").catch((caught: unknown) => caught),
		);

		expect(error).toMatchObject({ message: "GET /status: the response is not valid JSON" });
		expect((error as Error).cause).toBeInstanceOf(SyntaxError);
	});

	it("rejects an unknown or shared operationId, naming it, before any request", async () => {
		const shared = {
			openapi: "3.1.0",
			paths: { "/a": { get: { operationId: "same" } }, "/b": { get: { operationId: "same" } } },
		};
		const errors = await withClient(
			() => Response.json({}),
			async (api) => [await api.call("nope").catch((caught: unknown) => caught)],
		);
		const acme = defineApi({ spec: shared, baseUrl: "https://api.example.com" });
		const outcome = await new Crust("tool")
			.extend(acme.extension)
			.add(
				defineCommand("call", {}, (command) =>
					command.use(acme.client).action(async ({ ctx }) => (await ctx.api).call("same")),
				),
			)
			.run(["call"]);

		expect(errors).toEqual([new Error('api: no operation "nope" in the OpenAPI document')]);
		expect(outcome).toMatchObject({
			status: "failed",
			error: new Error('api: the operationId "same" is ambiguous (GET /a, GET /b)'),
		});
		expect(fetched).toEqual([]);
	});
});
