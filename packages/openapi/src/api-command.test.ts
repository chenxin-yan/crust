import { spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, writeFileSync } from "node:fs";
import { type RequestListener, createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { Crust, defineCommand } from "@crustjs/core";
import { captureExecute } from "@crustjs/testing";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { type ApiCommandOptions, apiCommand } from "./api-command.ts";
import { apiClient } from "./client.ts";

const spec = {
	openapi: "3.1.0",
	paths: {
		"/users": {
			get: { operationId: "listUsers", summary: "List users" },
			post: {
				operationId: "createUser",
				requestBody: {
					content: { "application/json": { schema: { $ref: "#/components/schemas/User" } } },
				},
			},
		},
		"/users/{id}": {
			parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
			get: { operationId: "getUser" },
			delete: {},
		},
		"/teams": { $ref: "#/components/pathItems/Teams" },
	},
	components: {
		pathItems: {
			Teams: { get: { operationId: "listTeams", summary: "List teams" } },
		},
		schemas: {
			User: {
				type: "object",
				properties: {
					name: { $ref: "#/components/schemas/Name", description: "Display name" },
					friends: { type: "array", items: { $ref: "#/components/schemas/User" } },
					nick: { $ref: "#%2Fcomponents%2Fschemas%2FName" },
					tag: { $ref: "#Tag" },
				},
			},
			Name: { type: "string", minLength: 1 },
		},
	},
};

interface FetchCall {
	url: string;
	method: string;
	headers: Record<string, string>;
	body: string | undefined;
	signal: AbortSignal | undefined;
}

/** Stubs `fetch` with `respond`, recording each call. */
function stubFetch(respond: (call: FetchCall) => Response = () => new Response("{}")): FetchCall[] {
	const calls: FetchCall[] = [];
	vi.stubGlobal("fetch", async (url: URL, init: RequestInit) => {
		const call: FetchCall = {
			url: url.href,
			method: init.method ?? "GET",
			headers: Object.fromEntries(new Headers(init.headers)),
			body: init.body === undefined ? undefined : String(init.body),
			signal: init.signal ?? undefined,
		};
		calls.push(call);
		return respond(call);
	});
	return calls;
}

function buildApp(options: Partial<ApiCommandOptions> = {}) {
	return new Crust("tool").extend(
		apiCommand({
			spec,
			baseUrl: "https://api.example.com/v1/",
			auth: () => ({ authorization: "Bearer secret" }),
			...options,
		}),
	);
}

/** A real HTTP server on a free local port, so `fetch()` follows redirects for real. */
async function listen(handler: RequestListener) {
	const server = createServer(handler).listen(0, "127.0.0.1");
	await once(server, "listening");
	const { port } = server.address() as AddressInfo;
	return {
		url: `http://127.0.0.1:${port}`,
		close: () => {
			server.closeAllConnections();
			server.close();
		},
	};
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("api --list and --spec", () => {
	it("lists one line per operation without network access", async () => {
		const calls = stubFetch();
		const { stdout, exitCode } = await captureExecute(buildApp(), ["api", "--list"]);

		expect(exitCode).toBe(0);
		expect(stdout.split("\n")).toEqual([
			"GET /users listUsers List users",
			"POST /users createUser",
			"GET /users/{id} getUser",
			"DELETE /users/{id}",
			"GET /teams listTeams List teams",
		]);
		expect(calls).toEqual([]);
	});

	it("prints an operation by operationId with $refs resolved (URI-encoded too), cycles and non-pointer fragments kept", async () => {
		const { stdout, exitCode } = await captureExecute(buildApp(), ["api", "--spec", "createUser"]);

		expect(exitCode).toBe(0);
		expect(JSON.parse(stdout)).toEqual({
			operationId: "createUser",
			requestBody: {
				content: {
					"application/json": {
						schema: {
							type: "object",
							properties: {
								name: { type: "string", minLength: 1, description: "Display name" },
								friends: { type: "array", items: { $ref: "#/components/schemas/User" } },
								nick: { type: "string", minLength: 1 },
								tag: { $ref: "#Tag" },
							},
						},
					},
				},
			},
		});
	});

	it("finds an operation through a referenced Path Item", async () => {
		const { stdout, exitCode } = await captureExecute(buildApp(), ["api", "--spec", "listTeams"]);

		expect(exitCode).toBe(0);
		expect(JSON.parse(stdout)).toEqual({ operationId: "listTeams", summary: "List teams" });
	});

	it("prints a path item by path, including its shared parameters", async () => {
		const { stdout } = await captureExecute(buildApp(), ["api", "--spec", "/users/{id}"]);

		expect(JSON.parse(stdout)).toEqual(spec.paths["/users/{id}"]);
	});

	it("skips x-* extensions of the Paths Object, whatever their value", async () => {
		const app = buildApp({
			spec: {
				paths: {
					"/users": { get: { operationId: "users" } },
					"x-note": null,
					"x-meta": { get: { operationId: "fake" } },
				},
			},
		});

		expect((await captureExecute(app, ["api", "--list"])).stdout).toBe("GET /users users");
		expect((await captureExecute(app, ["api", "--spec", "users"])).stdout).toBe(
			'{"operationId":"users"}',
		);
		for (const target of ["fake", "x-meta"]) {
			expect(await captureExecute(app, ["api", "--spec", target])).toMatchObject({
				stderr: `Error: No operation or path "${target}" in the OpenAPI spec`,
				exitCode: 1,
			});
		}
	});

	it("fails for an unknown operationId or path", async () => {
		const { stderr, exitCode } = await captureExecute(buildApp(), ["api", "--spec", "constructor"]);

		expect(exitCode).toBe(1);
		expect(stderr).toBe('Error: No operation or path "constructor" in the OpenAPI spec');
	});
});

describe("spec loader", () => {
	it("is called once per --list or --spec invocation with its signal, never for requests or app commands", async () => {
		stubFetch();
		const loader = vi.fn(async (_input: { signal: AbortSignal }) => spec);
		const app = buildApp({ spec: loader }).add(
			defineCommand("me", {}, (command) =>
				command.use(apiClient).action(async ({ ctx }) => {
					await (await ctx.api).fetch("/me");
				}),
			),
		);

		expect((await captureExecute(app, ["api", "/users"])).exitCode).toBe(0);
		expect((await captureExecute(app, ["me"])).exitCode).toBe(0);
		expect(loader).not.toHaveBeenCalled();

		expect((await captureExecute(app, ["api", "--list"])).stdout).toContain("GET /users listUsers");
		expect(loader).toHaveBeenCalledTimes(1);
		expect(loader.mock.calls[0]?.[0]).toEqual({ signal: expect.any(AbortSignal) });

		const controller = new AbortController();
		const outcome = await app.run(
			["api"],
			{ flags: { spec: "getUser" } },
			{ signal: controller.signal },
		);
		expect(outcome).toMatchObject({ status: "completed", stdout: '{"operationId":"getUser"}' });
		expect(loader).toHaveBeenCalledTimes(2);
		controller.abort();
		expect(loader.mock.calls[1]?.[0].signal.aborted).toBe(true);
	});

	it("accepts a synchronous loader", async () => {
		const { stdout } = await captureExecute(buildApp({ spec: () => spec }), [
			"api",
			"--spec",
			"getUser",
		]);

		expect(stdout).toBe('{"operationId":"getUser"}');
	});

	it.each([
		["rejects", () => Promise.reject(new Error("ENOENT openapi.json"))],
		[
			"throws",
			() => {
				throw new Error("ENOENT openapi.json");
			},
		],
	])("fails with the loader's reason and cause when it %s", async (_, loader) => {
		const outcome = await buildApp({ spec: loader }).run(["api"], { flags: { list: true } });

		expect(outcome.status).toBe("failed");
		const error = outcome.status === "failed" ? outcome.error : undefined;
		expect(error).toBeInstanceOf(Error);
		expect(error).not.toHaveProperty("code");
		expect(error).toMatchObject({
			message: "api: cannot load the OpenAPI document (ENOENT openapi.json)",
			cause: new Error("ENOENT openapi.json"),
		});
		expect(await captureExecute(buildApp({ spec: loader }), ["api", "--list"])).toEqual({
			stdout: "",
			stderr: "Error: api: cannot load the OpenAPI document (ENOENT openapi.json)",
			exitCode: 1,
		});
	});

	it.each([
		["null", null],
		["array", []],
		["string", "{}"],
		// Like a module namespace: null prototype, `Module` tag.
		[
			"module",
			Object.assign(Object.create(null), { default: spec, [Symbol.toStringTag]: "Module" }),
		],
		[
			"class instance",
			new (class Spec {
				paths = spec.paths;
			})(),
		],
	])("fails when the loader resolves to %s instead of a plain object", async (kind, value) => {
		const app = buildApp({ spec: async () => value as never });

		expect(await captureExecute(app, ["api", "--spec", "getUser"])).toEqual({
			stdout: "",
			stderr: `Error: api: cannot load the OpenAPI document (expected a plain object, got ${kind})`,
			exitCode: 1,
		});
	});

	it("accepts a plain object without a prototype", async () => {
		const app = buildApp({ spec: async () => Object.assign(Object.create(null), spec) });

		expect((await captureExecute(app, ["api", "--spec", "getUser"])).stdout).toBe(
			'{"operationId":"getUser"}',
		);
	});

	it.each([
		["the signal's reason", (signal: AbortSignal) => signal.reason],
		["an AbortError", () => new DOMException("This operation was aborted", "AbortError")],
	])("passes cancellation through unchanged as %s", async (_, reason) => {
		const controller = new AbortController();
		let thrown: unknown;
		const app = buildApp({
			spec: ({ signal }) =>
				new Promise((_, reject) => {
					signal.addEventListener("abort", () => reject((thrown = reason(signal))));
					controller.abort();
				}),
		});
		const outcome = await app.run(
			["api"],
			{ flags: { list: true } },
			{ signal: controller.signal },
		);

		expect(outcome.status === "failed" && outcome.error).toBe(thrown);
	});

	it("passes an AbortError through unchanged even when the signal is not aborted", async () => {
		const abort = new DOMException("This operation was aborted", "AbortError");
		const outcome = await buildApp({ spec: () => Promise.reject(abort) }).run(["api"], {
			flags: { list: true },
		});

		expect(outcome.status === "failed" && outcome.error).toBe(abort);
	});

	it("wraps a thrown non-Error named AbortError as a load failure", async () => {
		const thrown = { name: "AbortError" };
		const outcome = await buildApp({ spec: () => Promise.reject(thrown) }).run(["api"], {
			flags: { list: true },
		});

		const error = outcome.status === "failed" ? outcome.error : undefined;
		expect(error).toBeInstanceOf(Error);
		expect(error).toMatchObject({
			message: "api: cannot load the OpenAPI document ([object Object])",
		});
		expect((error as Error).cause).toBe(thrown);
	});
});

describe("api <path>", () => {
	it("GETs the path below the base URL with auth and prints the body", async () => {
		const calls = stubFetch(() => new Response('[{"name":"ada"}]\n'));
		const { stdout, stderr, exitCode } = await captureExecute(buildApp(), ["api", "/users"]);

		expect({ stdout, stderr, exitCode }).toEqual({
			stdout: '[{"name":"ada"}]',
			stderr: "",
			exitCode: 0,
		});
		expect(calls).toEqual([
			{
				url: "https://api.example.com/v1/users",
				method: "GET",
				headers: { authorization: "Bearer secret" },
				body: undefined,
				signal: expect.any(AbortSignal),
			},
		]);
	});

	it("POSTs -F fields as a JSON object, typing true, false, null, and numbers", async () => {
		const calls = stubFetch();
		const fields = ["a=true", "b=false", "c=null", "n=42", "f=-1.5e2", "zip=007", "s=x=y"];
		await captureExecute(buildApp(), ["api", "users", ...fields.flatMap((f) => ["-F", f])]);

		expect(calls[0]?.method).toBe("POST");
		expect(calls[0]?.headers["content-type"]).toBe("application/json");
		expect(JSON.parse(calls[0]?.body ?? "")).toEqual({
			a: true,
			b: false,
			c: null,
			n: 42,
			f: -150,
			zip: "007",
			s: "x=y",
		});
	});

	it("sends fields as query parameters for -X GET", async () => {
		const calls = stubFetch();
		await captureExecute(buildApp(), ["api", "/users?sort=name", "-X", "get", "-F", "page=2"]);

		expect(calls[0]).toMatchObject({
			url: "https://api.example.com/v1/users?sort=name&page=2",
			method: "GET",
			body: undefined,
		});
	});

	it("puts -X GET fields before the URL's fragment", async () => {
		const calls = stubFetch();
		await captureExecute(buildApp(), ["api", "/users#section", "-X", "GET", "-F", "page=2"]);

		expect(calls[0]?.url).toBe("https://api.example.com/v1/users?page=2#section");
	});

	it("keeps the path's own query as written when adding -X GET fields", async () => {
		const calls = stubFetch();
		await captureExecute(buildApp(), [
			"api",
			"/users?q=a%20b,c&flag#s",
			"-X",
			"GET",
			"-F",
			"page=2",
		]);

		expect(calls[0]?.url).toBe("https://api.example.com/v1/users?q=a%20b,c&flag&page=2#s");
	});

	it("sends --body as the request body and lets -H override auth", async () => {
		const calls = stubFetch();
		await captureExecute(buildApp(), [
			"api",
			"/users",
			"--body",
			'{"name":"ada"}',
			"-H",
			"Authorization: Bearer other",
			"-H",
			"X-Trace: 1",
		]);

		expect(calls[0]).toMatchObject({
			method: "POST",
			body: '{"name":"ada"}',
			headers: {
				authorization: "Bearer other",
				"content-type": "application/json",
				"x-trace": "1",
			},
		});
	});

	it("reads --body @file", async () => {
		const file = join(mkdtempSync(join(tmpdir(), "crust-openapi-")), "body.json");
		writeFileSync(file, '{"name":"grace"}');
		const calls = stubFetch();
		await captureExecute(buildApp(), ["api", "/users", "-X", "PUT", "--body", `@${file}`]);

		expect(calls[0]).toMatchObject({ method: "PUT", body: '{"name":"grace"}' });
	});

	it("prints a non-2xx body to stdout and a summary to stderr with exit code 1", async () => {
		stubFetch(
			() => new Response('{"message":"not found"}', { status: 404, statusText: "Not Found" }),
		);
		const { stdout, stderr, exitCode } = await captureExecute(buildApp(), ["api", "/users/9"]);

		expect({ stdout, stderr, exitCode }).toEqual({
			stdout: '{"message":"not found"}',
			stderr: "Error: GET /users/9: HTTP 404 Not Found",
			exitCode: 1,
		});
	});

	it("follows --paginate pages as NDJSON, reusing the request without a new init", async () => {
		const calls = stubFetch(({ url }) =>
			url.endsWith("page=2")
				? new Response('{\n  "items": [2]\n}')
				: new Response('{"items":[1],"next":"/users?page=2"}'),
		);
		const app = buildApp({
			paginate: async (response) => {
				const { next } = (await response.json()) as { next?: string };
				return next === undefined ? undefined : { path: next };
			},
		});
		const { stdout, exitCode } = await captureExecute(app, ["api", "/users", "--paginate"]);

		expect(exitCode).toBe(0);
		expect(stdout.split("\n")).toEqual(['{"items":[1],"next":"/users?page=2"}', '{"items":[2]}']);
		expect(calls.map(({ url, headers }) => [url, headers.authorization])).toEqual([
			["https://api.example.com/v1/users", "Bearer secret"],
			["https://api.example.com/v1/users?page=2", "Bearer secret"],
		]);
	});

	it("compacts --paginate pages without changing numbers or strings", async () => {
		stubFetch(
			() =>
				new Response('{ "id": 9007199254740993, "large": 1e309,\n "text": "a \\" b", "n": -0.10 }'),
		);
		const app = buildApp({ paginate: () => undefined });
		const { stdout, exitCode } = await captureExecute(app, ["api", "/ids", "--paginate"]);

		expect(exitCode).toBe(0);
		expect(stdout).toBe('{"id":9007199254740993,"large":1e309,"text":"a \\" b","n":-0.10}');
	});

	it("sends a --paginate page on another origin without auth or credential headers the request set", async () => {
		const calls = stubFetch(
			({ url }) =>
				new Response(url.startsWith("https://api.example.com/") ? '{"page":1}' : '{"page":2}'),
		);
		const app = buildApp({
			auth: () => ({ "X-Api-Key": "auth-key" }),
			paginate: async (response) =>
				((await response.json()) as { page: number }).page === 1
					? { path: "https://evil.example.com/page2" }
					: undefined,
		});
		const { stdout, exitCode } = await captureExecute(app, [
			"api",
			"/users",
			"--paginate",
			"-H",
			"X-Api-Key: secret",
			"-H",
			"Authorization: Bearer mine",
			"-H",
			"X-Trace: 1",
		]);

		expect({ stdout, exitCode }).toEqual({ stdout: '{"page":1}\n{"page":2}', exitCode: 0 });
		expect(calls.map(({ url, headers }) => [url, headers])).toEqual([
			[
				"https://api.example.com/v1/users",
				{ authorization: "Bearer mine", "x-api-key": "secret", "x-trace": "1" },
			],
			["https://evil.example.com/page2", { "x-trace": "1" }],
		]);
	});

	it("rejects a --paginate page that is not http(s) before any request for it", async () => {
		const calls = stubFetch();
		let pagesSeen = 0;
		const app = buildApp({
			paginate: () => (pagesSeen++ === 0 ? { path: "data:text/plain,x" } : undefined),
		});
		const { stderr, exitCode } = await captureExecute(app, ["api", "/users", "--paginate"]);

		expect(exitCode).toBe(1);
		expect(stderr).toBe("Error: Cannot request data:text/plain,x: only http: and https: URLs");
		expect(calls).toHaveLength(1);
	});

	it("prints non-JSON --paginate pages, even empty ones, as JSON strings", async () => {
		const pages = ["first\nsecond", ""];
		stubFetch(({ url }) => new Response(pages[Number(new URL(url).searchParams.get("page"))]));
		let pagesSeen = 0;
		const app = buildApp({
			paginate: () => (pagesSeen++ === 0 ? { path: "/notes?page=1" } : undefined),
		});
		const { stdout, exitCode } = await captureExecute(app, ["api", "/notes?page=0", "--paginate"]);

		expect(exitCode).toBe(0);
		expect(stdout.split("\n").map((line) => JSON.parse(line))).toEqual(["first\nsecond", ""]);
	});

	it("rejects --paginate when the CLI configures no paginate()", async () => {
		const calls = stubFetch();
		const { stderr, exitCode } = await captureExecute(buildApp(), ["api", "/users", "--paginate"]);

		expect(exitCode).toBe(1);
		expect(stderr).toBe("Error: --paginate: this CLI does not configure pagination");
		expect(calls).toEqual([]);
	});

	it.each([
		[["api"], 'Error: Missing required argument "<path>" (or pass --list or --spec)'],
		[["api", "/users", "-F", "novalue"], 'Error: --field: expected key=value, got "novalue"'],
		[["api", "/users", "-H", "NoColon"], 'Error: --header: expected "Key: Value", got "NoColon"'],
		[
			["api", "/users", "-F", "amount=1e309"],
			'Error: --field: "amount=1e309" is out of range for a number',
		],
	])("fails before any request for %j", async (argv, message) => {
		const calls = stubFetch();
		const { stderr, exitCode } = await captureExecute(buildApp(), argv);

		expect({ stderr, exitCode }).toEqual({ stderr: message, exitCode: 1 });
		expect(calls).toEqual([]);
	});

	it("rejects a header the platform refuses as a PARSE error before any request", async () => {
		const calls = stubFetch();
		const { stderr, exitCode } = await captureExecute(buildApp(), [
			"api",
			"/users",
			"-H",
			"Bad Header: value",
		]);

		expect(exitCode).toBe(1);
		expect(stderr).toMatch(/^Error: --header: invalid header "Bad Header: value" \(.+\)$/);
		expect(calls).toEqual([]);
	});

	it.each([
		["https://evil.example/x", "https://evil.example/x"],
		["https:\\\\evil.example/x", "https://evil.example/x"],
		["https://api.example.com@evil.example/x", "https://api.example.com@evil.example/x"],
		["http://api.example.com/v1/users", "http://api.example.com/v1/users"],
		["https://api.example.com:8443/v1/users", "https://api.example.com:8443/v1/users"],
	])(
		"rejects %s off the base URL's origin as a PARSE error before any request",
		async (path, href) => {
			const calls = stubFetch();
			const message = `Cannot request ${href}: only URLs on https://api.example.com are allowed`;
			for (const app of [buildApp(), buildApp({ auth: undefined })]) {
				const outcome = await app.run(["api"], {
					args: { path },
					flags: { header: ["Authorization: Bearer secret", "X-Api-Key: secret"] },
				});

				expect(outcome.status).toBe("failed");
				expect(outcome.status === "failed" && outcome.error).toMatchObject({
					code: "PARSE",
					message,
				});
				expect(await captureExecute(app, ["api", path, "-H", "Authorization: x"])).toEqual({
					stdout: "",
					stderr: `Error: ${message}`,
					exitCode: 1,
				});
			}
			expect(calls).toEqual([]);
		},
	);

	it.each([
		["//evil.example/x", "https://api.example.com/v1/evil.example/x"],
		["\\\\evil.example/x", "https://api.example.com/v1///evil.example/x"],
		["https://api.example.com/other", "https://api.example.com/other"],
		["HTTPS://API.EXAMPLE.COM:443/v1/users", "https://api.example.com/v1/users"],
	])("keeps %s on the base URL's origin", async (path, url) => {
		const calls = stubFetch();
		const { exitCode } = await captureExecute(buildApp(), ["api", path, "-H", "X-Api-Key: k"]);

		expect(exitCode).toBe(0);
		expect(calls).toMatchObject([
			{ url, headers: { authorization: "Bearer secret", "x-api-key": "k" } },
		]);
	});

	// Tests run on Node; spawn each runtime so stdin is a real pipe.
	it.each([
		["node", process.execPath, ["--input-type=module"]],
		["bun", "bun", []],
	])("reads --body - from stdin on %s", (_runtime, command, options) => {
		const script = `
			import { Crust } from "@crustjs/core";
			import { apiCommand } from ${JSON.stringify(pathToFileURL(join(import.meta.dirname, "api-command.ts")).href)};
			globalThis.fetch = async (url, init) => new Response(init.method + " " + init.body);
			const app = new Crust("tool").extend(apiCommand({ spec: {}, baseUrl: "https://api.example.com" }));
			process.exitCode = await app.execute({ argv: ["api", "/echo", "--body", "-"] });
		`;
		const run = spawnSync(command, [...options, "-e", script], {
			cwd: join(import.meta.dirname, ".."),
			input: '{"name":"ada"}',
			encoding: "utf8",
			timeout: 10_000,
		});

		expect(run.stderr).toBe("");
		expect(run.stdout.trim()).toBe('POST {"name":"ada"}');
		expect(run.status).toBe(0);
	});

	// An earlier consumer, such as input() for `--input -`, read stdin to EOF.
	it.each([
		["node", process.execPath, ["--input-type=module"]],
		["bun", "bun", []],
	])(
		"reads --body - from stdin that already ended as empty on %s",
		(_runtime, command, options) => {
			const script = `
			import { Crust } from "@crustjs/core";
			import { apiCommand } from ${JSON.stringify(pathToFileURL(join(import.meta.dirname, "api-command.ts")).href)};
			globalThis.fetch = async (url, init) => new Response(init.method + " [" + init.body + "]");
			for await (const _ of process.stdin);
			const app = new Crust("tool").extend(apiCommand({ spec: {}, baseUrl: "https://api.example.com" }));
			process.exitCode = await app.execute({ argv: ["api", "/echo", "--body", "-"] });
		`;
			const run = spawnSync(command, [...options, "-e", script], {
				cwd: join(import.meta.dirname, ".."),
				input: '{"name":"ada"}',
				encoding: "utf8",
				timeout: 10_000,
			});

			expect(run.stderr).toBe("");
			expect(run.stdout.trim()).toBe("POST []");
			expect(run.status).toBe(0);
		},
	);
});

describe("apiClient", () => {
	it("is shared with app commands that declare it", async () => {
		const calls = stubFetch(() => new Response('{"id":"u1"}'));
		const app = buildApp().add(
			defineCommand("whoami", {}, (command) =>
				command.use(apiClient).action(async ({ ctx, stdout }) => {
					const api = await ctx.api;
					const response = await api.fetch("/me", { headers: { accept: "application/json" } });
					stdout(`${api.baseUrl} ${await response.text()}`);
				}),
			),
		);
		const { stdout, exitCode } = await captureExecute(app, ["whoami"]);

		expect({ stdout, exitCode }).toEqual({
			stdout: 'https://api.example.com/v1/ {"id":"u1"}',
			exitCode: 0,
		});
		expect(calls[0]).toMatchObject({
			url: "https://api.example.com/v1/me",
			headers: { accept: "application/json", authorization: "Bearer secret" },
		});
	});

	it("allows absolute URLs on the base URL's origin and calls auth once per invocation", async () => {
		const auth = vi.fn(() => ({ authorization: "Bearer secret" }));
		const calls = stubFetch();
		const app = buildApp({ auth }).add(
			defineCommand("sync", {}, (command) =>
				command.use(apiClient).action(async ({ ctx }) => {
					const api = await ctx.api;
					await api.fetch("https://api.example.com/v1/a");
					await api.fetch("/b");
				}),
			),
		);
		await captureExecute(app, ["sync"]);

		expect(calls.map(({ url, headers }) => [url, headers.authorization])).toEqual([
			["https://api.example.com/v1/a", "Bearer secret"],
			["https://api.example.com/v1/b", "Bearer secret"],
		]);
		expect(auth).toHaveBeenCalledTimes(1);
	});

	it.each([undefined, () => ({ "X-Api-Key": "secret" })])(
		"rejects a URL off the base URL's origin with a TypeError before any request (auth: %s)",
		async (auth) => {
			const calls = stubFetch();
			const errors: unknown[] = [];
			const app = buildApp({ auth }).add(
				defineCommand("leak", {}, (command) =>
					command.use(apiClient).action(async ({ ctx }) => {
						const api = await ctx.api;
						const headers = { authorization: "Bearer secret", "x-api-key": "secret" };
						for (const path of [
							"https://elsewhere.example.com/b",
							"https://api.example.com@elsewhere.example.com/b",
						]) {
							errors.push(await api.fetch(path, { headers }).catch((error: unknown) => error));
						}
					}),
				),
			);
			await captureExecute(app, ["leak"]);

			expect(errors).toEqual([
				new TypeError(
					"Cannot request https://elsewhere.example.com/b: only URLs on https://api.example.com are allowed",
				),
				new TypeError(
					"Cannot request https://api.example.com@elsewhere.example.com/b: only URLs on https://api.example.com are allowed",
				),
			]);
			expect(errors.every((error) => error instanceof TypeError)).toBe(true);
			expect(calls).toEqual([]);
		},
	);

	it.each([
		[20, { stdout: "done", stderr: "", exitCode: 0 }],
		[
			21,
			{
				stdout: "",
				stderr: "Error: fetch https://other.example.com/r/20: too many redirects",
				exitCode: 1,
			},
		],
	])("counts %i redirects as one chain across origins, allowing 20", async (total, expected) => {
		// /r/0 through /r/9 on the base origin, the rest on another one.
		const calls = stubFetch(({ url }) => {
			const hop = Number(url.split("/").pop());
			if (hop === total) return new Response("done");
			const origin = hop + 1 < 10 ? "https://api.example.com/v1" : "https://other.example.com";
			return new Response(null, { status: 302, headers: { location: `${origin}/r/${hop + 1}` } });
		});
		const result = await captureExecute(buildApp(), ["api", "/r/0"]);

		expect(result).toEqual(expected);
		expect(calls).toHaveLength(Math.min(total, 20) + 1);
	});

	it("rejects a redirect to a URL that is not http(s)", async () => {
		const calls = stubFetch(
			() => new Response(null, { status: 302, headers: { location: "data:text/plain,x" } }),
		);
		const { stderr, exitCode } = await captureExecute(buildApp(), ["api", "/users"]);

		expect({ stderr, exitCode }).toEqual({
			stderr: "Error: Cannot request data:text/plain,x: only http: and https: URLs",
			exitCode: 1,
		});
		expect(calls).toHaveLength(1);
	});

	it("reports a followed redirect as Response.redirected, on clones and to paginate() too", async () => {
		stubFetch(({ url }) =>
			url.endsWith("/old")
				? new Response(null, { status: 301, headers: { location: "/v1/new" } })
				: new Response("{}"),
		);
		const seen: boolean[] = [];
		const app = buildApp({
			paginate: (response) => void seen.push(response.redirected),
		}).add(
			defineCommand("probe", {}, (command) =>
				command.use(apiClient).action(async ({ ctx }) => {
					const api = await ctx.api;
					const moved = await api.fetch("/old");
					const direct = await api.fetch("/new");
					seen.push(moved.redirected, moved.clone().redirected, direct.redirected);
				}),
			),
		);
		await captureExecute(app, ["probe"]);
		await captureExecute(app, ["api", "/old", "--paginate"]);

		expect(seen).toEqual([true, true, false, true]);
	});

	it("follows redirects itself so auth headers never reach another origin", async () => {
		const seen: Record<
			string,
			{ method?: string; key?: unknown; type?: unknown; cookie?: unknown }
		> = {};
		const record: RequestListener = (request, response) => {
			seen[`${request.headers.host} ${request.url}`] = {
				method: request.method,
				key: request.headers["x-api-key"],
				type: request.headers["content-type"],
				cookie: request.headers.cookie,
			};
			response.end("ok");
		};
		const other = await listen(record);
		const api = await listen((request, response) => {
			const location = {
				"/v1/moved": "/v1/here",
				"/v1/away": `${other.url}/landing`,
				"/v1/away-overridden": `${other.url}/landing-overridden`,
				"/v1/away-cookie": `${other.url}/landing-cookie`,
				"/v1/created": "/v1/result",
			}[request.url ?? ""];
			if (location === undefined) return record(request, response);
			response.writeHead(request.url === "/v1/created" ? 303 : 302, { location }).end();
		});
		const app = new Crust("tool")
			.extend(
				apiCommand({ spec, baseUrl: `${api.url}/v1`, auth: () => ({ "X-Api-Key": "secret" }) }),
			)
			.add(
				defineCommand("probe", {}, (command) =>
					command.use(apiClient).action(async ({ ctx, stdout }) => {
						const client = await ctx.api;
						for (const response of [
							await client.fetch("/moved"),
							await client.fetch("/away"),
							await client.fetch("/away-overridden", { headers: { "X-Api-Key": "override" } }),
							await client.fetch("/away-cookie", { headers: { Cookie: "session=secret" } }),
							await client.fetch("/created", {
								method: "POST",
								body: "{}",
								headers: { "content-type": "application/json" },
							}),
						]) {
							stdout(`${response.status} ${await response.text()}`);
						}
					}),
				),
			);
		try {
			const { stdout, stderr } = await captureExecute(app, ["probe"]);

			expect({ stdout, stderr }).toEqual({
				stdout: "200 ok\n200 ok\n200 ok\n200 ok\n200 ok",
				stderr: "",
			});
		} finally {
			api.close();
			other.close();
		}
		const apiHost = new URL(api.url).host;
		expect(seen).toEqual({
			[`${apiHost} /v1/here`]: { method: "GET", key: "secret" },
			[`${new URL(other.url).host} /landing`]: { method: "GET" },
			[`${new URL(other.url).host} /landing-overridden`]: { method: "GET" },
			[`${new URL(other.url).host} /landing-cookie`]: { method: "GET" },
			[`${apiHost} /v1/result`]: { method: "GET", key: "secret" },
		});
	});
});
