import { type CommandSnapshot, Crust, defineCommand, defineContext } from "@crustjs/core";
import { commandInputSchema } from "@crustjs/core/tooling";
import { confirm, json } from "@crustjs/extensions";
import { captureExecute } from "@crustjs/testing";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { type DefineApiOptions, defineApi } from "./define-api.ts";
import { ApiResponseError } from "./request.ts";

const spec = {
	openapi: "3.1.0",
	tags: [{ name: "Users", description: "Manage users" }],
	paths: {
		"/users": {
			get: {
				operationId: "listUsers",
				tags: ["Users"],
				summary: "List users",
				parameters: [
					{
						name: "role",
						in: "query",
						schema: { type: "string", enum: ["admin", "member"] },
						description: "Only users with this role",
					},
					{ name: "limit", in: "query", schema: { type: "integer" } },
					{ name: "tag", in: "query", schema: { type: "array", items: { type: "string" } } },
					{ name: "X-Trace", in: "header", schema: { type: "string" } },
				],
				responses: {
					"200": {
						description: "Users",
						content: {
							"application/json": {
								schema: { type: "array", items: { $ref: "#/components/schemas/User" } },
							},
						},
					},
				},
			},
			post: {
				operationId: "createUser",
				tags: ["Users"],
				summary: "Create a user",
				requestBody: {
					required: true,
					content: {
						"application/json": { schema: { $ref: "#/components/schemas/NewUser" } },
					},
				},
				responses: {
					"201": {
						description: "Created",
						content: { "application/json": { schema: { $ref: "#/components/schemas/User" } } },
					},
				},
			},
		},
		"/users/{id}": {
			parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
			get: {
				operationId: "getUser",
				tags: ["Users"],
				summary: "Get a user",
				responses: {
					"200": {
						description: "The user",
						content: { "application/json": { schema: { $ref: "#/components/schemas/User" } } },
					},
				},
			},
			delete: {
				operationId: "deleteUser",
				tags: ["Users"],
				summary: "Delete a user",
				responses: { "204": { description: "Deleted" } },
			},
		},
		"/status": {
			get: {
				operationId: "getStatus",
				summary: "Service status",
				security: [],
				responses: { "200": { description: "OK", content: { "text/plain": {} } } },
			},
		},
		"/legacy": {
			get: {
				operationId: "legacyReport",
				summary: "Old report",
				deprecated: true,
				responses: { "200": { description: "OK" } },
			},
		},
		"/avatars": {
			post: {
				operationId: "uploadAvatar",
				tags: ["Users"],
				summary: "Upload an avatar",
				requestBody: {
					required: true,
					content: { "multipart/form-data": { schema: { type: "object" } } },
				},
				responses: { "201": { description: "Uploaded" } },
			},
		},
	},
	components: {
		schemas: {
			User: {
				type: "object",
				properties: {
					id: { type: "string" },
					name: { type: "string" },
					profile: { $ref: "#/components/schemas/Profile" },
				},
			},
			Profile: { type: "object", properties: { bio: { type: "string" } } },
			NewUser: {
				type: "object",
				required: ["name"],
				properties: {
					name: { type: "string", description: "Display name" },
					age: { type: "integer" },
					role: { type: "string", enum: ["admin", "member"] },
					profile: { $ref: "#/components/schemas/Profile" },
				},
			},
		},
	},
};

interface FetchCall {
	url: string;
	method: string;
	headers: Record<string, string>;
	body: string | undefined;
}

/** Stubs `fetch` with `respond`, recording each call. */
function stubFetch(
	respond: (call: FetchCall) => Response = () => Response.json({ id: "42", name: "Ada" }),
): FetchCall[] {
	const calls: FetchCall[] = [];
	vi.stubGlobal("fetch", async (url: URL, init: RequestInit) => {
		const call: FetchCall = {
			url: url.href,
			method: init.method ?? "GET",
			headers: Object.fromEntries(new Headers(init.headers)),
			body: init.body === undefined || init.body === null ? undefined : String(init.body),
		};
		calls.push(call);
		return respond(call);
	});
	return calls;
}

const auth = vi.fn(() => ({ authorization: "Bearer secret" }));

function buildApi(options: Partial<DefineApiOptions> = {}) {
	return defineApi({ spec, baseUrl: "https://api.example.com/v1/", auth, ...options });
}

/** The snapshot of the command at `path` below `root`. */
function at(root: CommandSnapshot, ...path: string[]): CommandSnapshot {
	return path.reduce((node, name) => node.subCommands[name]!, root);
}

/** The message of a failed outcome. */
function failure(outcome: { status: string; error?: unknown }): string | undefined {
	return outcome.error instanceof Error ? outcome.error.message : undefined;
}

afterEach(() => {
	vi.unstubAllGlobals();
	auth.mockClear();
});

describe("generated commands", () => {
	it("build one command per operation in its tag's group, leaving out deprecated and lint-error operations", async () => {
		const acme = buildApi();
		const app = new Crust("acme").extend(acme.extension).add(...acme.commands);
		const snapshot = await app.snapshot();
		const users = at(snapshot, "users");

		expect(Object.keys(snapshot.subCommands).sort()).toEqual(["api", "get-status", "users"]);
		expect(users.meta.description).toBe("Manage users");
		expect(
			Object.values(users.subCommands).map(({ meta }) => [meta.name, meta.description]),
		).toEqual([
			["list-users", "List users"],
			["create-user", "Create a user"],
			["get-user", "Get a user"],
			["delete-user", "Delete a user"],
		]);
		expect(acme.lint()).toContainEqual(
			expect.objectContaining({ code: "unsupported-body-type", operationId: "uploadAvatar" }),
		);
	});

	it("sends a path argument, typed query and header flags, prints the JSON for humans and returns it", async () => {
		const calls = stubFetch(({ url }) =>
			url.includes("/users/")
				? Response.json({ id: "42", name: "Ada" })
				: Response.json([{ id: "1" }]),
		);
		const acme = buildApi();
		const app = new Crust("acme").extend(acme.extension).add(...acme.commands);

		const listed = await captureExecute(app, [
			"users",
			"list-users",
			"--role",
			"admin",
			"--limit",
			"5",
			"--tag",
			"a",
			"--tag",
			"b",
			"--x-trace",
			"t1",
		]);
		const fetched = await captureExecute(app, ["users", "get-user", "4 2"]);

		expect(listed).toEqual({
			stdout: JSON.stringify([{ id: "1" }], null, 2),
			stderr: "",
			exitCode: 0,
		});
		expect(fetched.exitCode).toBe(0);
		expect(calls.map(({ method, url }) => `${method} ${url}`)).toEqual([
			"GET https://api.example.com/v1/users?role=admin&limit=5&tag=a&tag=b",
			"GET https://api.example.com/v1/users/4%202",
		]);
		expect(calls[0]?.headers).toMatchObject({
			authorization: "Bearer secret",
			"x-trace": "t1",
			accept: "application/json",
		});
		const outcome = await app.run(["users", "get-user"], { args: { id: "42" } });
		expect(outcome).toMatchObject({ status: "completed", result: { id: "42", name: "Ada" } });
	});

	it("prints only the JSON under --json", async () => {
		stubFetch();
		const acme = buildApi();
		const app = new Crust("acme").extend(json(), acme.extension).add(...acme.commands);

		expect(await captureExecute(app, ["users", "get-user", "42", "--json"])).toEqual({
			stdout: JSON.stringify({ id: "42", name: "Ada" }),
			stderr: "",
			exitCode: 0,
		});
	});

	it("merges body field flags over --body and checks the effective body's required fields", async () => {
		const calls = stubFetch();
		const acme = buildApi();
		const app = new Crust("acme").extend(acme.extension).add(...acme.commands);

		const created = await captureExecute(app, [
			"users",
			"create-user",
			"--body",
			'{"name":"Bob","profile":{"bio":"hi"}}',
			"--name",
			"Ada",
			"--age",
			"36",
		]);
		const fromBody = await captureExecute(app, ["users", "create-user", "--body", '{"name":"Bo"}']);
		const missing = await captureExecute(app, ["users", "create-user", "--age", "3"]);
		const notObject = await captureExecute(app, ["users", "create-user", "--body", "[1]"]);
		const wrongType = await captureExecute(app, [
			"users",
			"create-user",
			"--body",
			'{"name":"Ada","role":"owner"}',
		]);

		expect(created.exitCode).toBe(0);
		expect(calls[0]).toMatchObject({ method: "POST", url: "https://api.example.com/v1/users" });
		expect(JSON.parse(calls[0]!.body!)).toEqual({ name: "Ada", age: 36, profile: { bio: "hi" } });
		expect(calls[0]?.headers["content-type"]).toBe("application/json");
		expect(fromBody.exitCode).toBe(0);
		expect(JSON.parse(calls[1]!.body!)).toEqual({ name: "Bo" });
		expect(missing).toMatchObject({ exitCode: 1 });
		expect(missing.stderr).toContain('missing the body field "name" (--name)');
		expect(notObject.stderr).toContain("flags.body: must be a JSON object");
		expect(wrongType.stderr).toContain('the body field "role" must be one of admin, member');
		expect(calls).toHaveLength(2);
	});

	it("publishes the body as a self-contained JSON Schema and the response as the output schema", async () => {
		const acme = buildApi();
		const app = new Crust("acme").extend(acme.extension).add(...acme.commands);
		const snapshot = await app.snapshot();
		const create = at(snapshot, "users", "create-user");
		const get = at(snapshot, "users", "get-user");
		const remove = at(snapshot, "users", "delete-user");

		expect(create.flags.body?.inputSchema).toEqual({
			type: "object",
			properties: {
				name: { type: "string", description: "Display name" },
				age: { type: "integer" },
				role: { type: "string", enum: ["admin", "member"] },
				profile: { type: "object", properties: { bio: { type: "string" } } },
			},
		});
		expect(get.output).toBe(true);
		expect(get.outputSchema).toEqual({
			type: "object",
			properties: {
				id: { type: "string" },
				name: { type: "string" },
				profile: { type: "object", properties: { bio: { type: "string" } } },
			},
		});
		expect(remove.output).toBe(true);
		expect(remove.outputSchema).toBeUndefined();
	});

	it("gives schema() and MCP an input schema with the typed flags and the body, whose flagged fields are not required", async () => {
		const acme = buildApi();
		const app = new Crust("acme").extend(acme.extension).add(...acme.commands);
		const snapshot = await app.snapshot();

		expect(
			commandInputSchema(at(snapshot, "users", "create-user"), ["users", "create-user"]),
		).toMatchObject({
			properties: {
				body: { type: "object", properties: { profile: { type: "object" } } },
				name: { type: "string", description: "Display name" },
				age: { type: "number" },
				role: { type: "string", enum: ["admin", "member"] },
			},
		});
		expect(
			commandInputSchema(at(snapshot, "users", "list-users"), ["users", "list-users"]),
		).toMatchObject({
			properties: {
				role: {
					type: "string",
					enum: ["admin", "member"],
					description: "Only users with this role",
				},
				limit: { type: "number" },
				tag: { type: "array", items: { type: "string" } },
			},
		});
	});

	it("sends a public operation without calling auth, and returns a text body", async () => {
		const calls = stubFetch(
			() => new Response("all good\n", { headers: { "content-type": "text/plain" } }),
		);
		const acme = buildApi();
		const app = new Crust("acme").extend(acme.extension).add(...acme.commands);

		expect(await captureExecute(app, ["get-status"])).toEqual({
			stdout: "all good",
			stderr: "",
			exitCode: 0,
		});
		expect(auth).not.toHaveBeenCalled();
		expect(calls[0]?.headers.authorization).toBeUndefined();
	});

	it("fails with ApiResponseError for a non-2xx response", async () => {
		stubFetch(() => new Response("", { status: 404, statusText: "Not Found" }));
		const acme = buildApi();
		const app = new Crust("acme").extend(acme.extension).add(...acme.commands);

		const outcome = await app.run(["users", "get-user"], { args: { id: "9" } });
		const error = outcome.status === "failed" ? outcome.error : undefined;
		expect(error).toBeInstanceOf(ApiResponseError);
		expect(error).toMatchObject({ status: 404 });
	});

	it("fills a bound parameter from the app's Context and hides its input", async () => {
		const calls = stubFetch();
		const account = defineContext("account").setup(async () => ({ id: "me" }));
		const acme = buildApi()
			.use(account)
			.override({ getUser: { bind: { id: async (ctx) => (await ctx.account).id } } });
		const app = new Crust("acme")
			.extend(acme.extension)
			.provide(account())
			.add(...acme.commands);
		expect(at(await app.snapshot(), "users", "get-user").args).toEqual([]);
		expect((await captureExecute(app, ["users", "get-user"])).exitCode).toBe(0);
		expect(calls[0]?.url).toBe("https://api.example.com/v1/users/me");
	});

	it("asks the app's confirmation handler before a request, and leaves the operation out without one", async () => {
		const calls = stubFetch(() => new Response(null, { status: 204 }));
		const asked: string[] = [];
		const acme = buildApi()
			.use(confirm)
			.onConfirm(async (ctx, message) => {
				asked.push(message);
				await (
					await ctx.confirm
				)(message);
			})
			.override({ deleteUser: { confirm: "Delete the user?" } });
		const app = new Crust("acme").extend(confirm(), acme.extension).add(...acme.commands);

		const refused = await captureExecute(app, ["users", "delete-user", "42"]);
		const confirmed = await captureExecute(app, ["users", "delete-user", "42", "--yes"]);

		expect(refused.exitCode).toBe(1);
		expect(confirmed).toEqual({ stdout: "", stderr: "", exitCode: 0 });
		expect(asked).toEqual(["Delete the user?", "Delete the user?"]);
		expect(calls.map(({ method, url }) => `${method} ${url}`)).toEqual([
			"DELETE https://api.example.com/v1/users/42",
		]);

		const unhandled = buildApi().override({ deleteUser: { confirm: "Delete the user?" } });
		const app2 = new Crust("acme").extend(unhandled.extension).add(...unhandled.commands);
		expect(Object.keys(at(await app2.snapshot(), "users").subCommands)).not.toContain(
			"delete-user",
		);
		expect(unhandled.lint()).toContainEqual(
			expect.objectContaining({ code: "confirm-without-handler", operationId: "deleteUser" }),
		);
	});

	it("puts added commands in a generated group, and leaves out a generated command they clash with", async () => {
		const purge = defineCommand("purge", (command) => command.action(() => "purged"));
		const getUser = defineCommand("get-user", (command) => command.action(() => "mine"));
		const acme = buildApi().add("users", purge, getUser).add("admin tools", purge);
		const app = new Crust("acme").extend(acme.extension).add(...acme.commands);
		const snapshot = await app.snapshot();

		expect(Object.keys(at(snapshot, "users").subCommands)).toEqual([
			"list-users",
			"create-user",
			"delete-user",
			"purge",
			"get-user",
		]);
		expect(Object.keys(at(snapshot, "admin", "tools").subCommands)).toEqual(["purge"]);
		expect(await app.run(["users", "get-user"], {})).toMatchObject({ result: "mine" });
		expect(acme.lint()).toContainEqual(
			expect.objectContaining({ code: "command-collision", operationId: "getUser" }),
		);
	});

	it("leaves out an operation whose group would clash with the api command", async () => {
		const acme = defineApi({
			spec: {
				openapi: "3.1.0",
				paths: {
					"/keys": {
						get: {
							operationId: "listKeys",
							tags: ["API"],
							summary: "List keys",
							responses: { "200": { description: "OK" } },
						},
					},
				},
			},
			baseUrl: "https://api.example.com",
		});
		const app = new Crust("acme").extend(acme.extension).add(...acme.commands);

		expect(Object.keys((await app.snapshot()).subCommands)).toEqual(["api"]);
		expect(acme.lint()).toContainEqual(
			expect.objectContaining({ code: "command-collision", operationId: "listKeys" }),
		);
	});

	it("lists lint-error operations as unavailable in api --list", async () => {
		const acme = buildApi();
		const app = new Crust("acme").extend(json(), acme.extension);

		const { stdout } = await captureExecute(app, ["api", "--list"]);
		const listed = await captureExecute(app, ["api", "--list", "--json"]);

		expect(stdout).toContain(
			"POST /avatars uploadAvatar Upload an avatar [unavailable: unsupported-body-type]",
		);
		expect(JSON.parse(listed.stdout)).toContainEqual({
			method: "POST",
			path: "/avatars",
			operationId: "uploadAvatar",
			summary: "Upload an avatar",
			unavailable: "unsupported-body-type",
		});
	});
});

describe("generated --paginate", () => {
	const paginate = async (response: Response) => {
		const next = response.headers.get("x-next");
		return next === null ? undefined : { path: next };
	};

	it("joins every page's list into one result, with the api command's loop guard", async () => {
		const calls = stubFetch(({ url }) =>
			url.endsWith("page=2")
				? Response.json([{ id: "2" }])
				: Response.json([{ id: "1" }], { headers: { "x-next": "/users?page=2" } }),
		);
		const acme = buildApi({ paginate });
		const app = new Crust("acme").extend(acme.extension).add(...acme.commands);

		const outcome = await app.run(["users", "list-users"], { flags: { paginate: true } });

		expect(outcome).toMatchObject({ status: "completed", result: [{ id: "1" }, { id: "2" }] });
		expect(calls.map(({ url }) => url)).toEqual([
			"https://api.example.com/v1/users",
			"https://api.example.com/v1/users?page=2",
		]);

		stubFetch(() => Response.json([], { headers: { "x-next": "/users" } }));
		const looping = await app.run(["users", "list-users"], { flags: { paginate: true } });
		expect(failure(looping)).toContain("page 2 repeats the previous request");
	});

	it("is offered after an unwrap without an outputSchema, not for a known non-list result, and fails for a page that is not a list", async () => {
		stubFetch(() => Response.json({ result: { id: "1" } }));
		const acme = buildApi({ paginate }).each(() => ({
			unwrap: (body) => (body as { result: unknown }).result,
		}));
		const plain = buildApi({ paginate });
		const getUser = async (handle: typeof plain) =>
			at(
				await new Crust("acme")
					.extend(handle.extension)
					.add(...handle.commands)
					.snapshot(),
				"users",
				"get-user",
			);
		const unwrapped = await getUser(acme);
		const known = await getUser(plain);

		expect(Object.keys(unwrapped.flags)).toContain("paginate");
		expect(unwrapped.outputSchema).toBeUndefined();
		expect(Object.keys(known.flags)).not.toContain("paginate");
		const app = new Crust("acme").extend(acme.extension).add(...acme.commands);
		expect(await app.run(["users", "get-user"], { args: { id: "1" } })).toMatchObject({
			result: { id: "1" },
		});
		const outcome = await app.run(["users", "get-user"], {
			args: { id: "1" },
			flags: { paginate: true },
		});
		expect(failure(outcome)).toBe(
			"getUser: --paginate needs each page's result to be a list, and page 1's is not",
		);
	});

	it("never calls auth for a public operation's next pages", async () => {
		const pages = stubFetch(({ url }) =>
			url.endsWith("page=2")
				? new Response("b", { headers: { "content-type": "text/plain" } })
				: new Response("a", {
						headers: { "content-type": "text/plain", "x-next": "/status?page=2" },
					}),
		);
		const acme = buildApi({ paginate }).override({
			getStatus: { unwrap: (body) => [body] },
		});
		const app = new Crust("acme").extend(acme.extension).add(...acme.commands);

		const outcome = await app.run(["get-status"], { flags: { paginate: true } });

		expect(outcome).toMatchObject({ status: "completed", result: ["a", "b"] });
		expect(pages).toHaveLength(2);
		expect(auth).not.toHaveBeenCalled();
	});
});

describe("acme.manifest()", () => {
	it("lists the generated surface sorted by command, with the diagnostics of left-out operations", () => {
		const acme = buildApi({ paginate: () => undefined });

		expect(acme.manifest()).toEqual({
			commands: [
				{
					command: "get-status",
					operationId: "getStatus",
					method: "GET",
					path: "/status",
					args: [],
					flags: [],
					outputSchema: false,
				},
				{
					command: "users create-user",
					operationId: "createUser",
					method: "POST",
					path: "/users",
					args: [],
					flags: ["age", "body", "name", "role"],
					outputSchema: true,
				},
				{
					command: "users delete-user",
					operationId: "deleteUser",
					method: "DELETE",
					path: "/users/{id}",
					args: ["id"],
					flags: [],
					outputSchema: false,
				},
				{
					command: "users get-user",
					operationId: "getUser",
					method: "GET",
					path: "/users/{id}",
					args: ["id"],
					flags: [],
					outputSchema: true,
				},
				{
					command: "users list-users",
					operationId: "listUsers",
					method: "GET",
					path: "/users",
					args: [],
					flags: ["limit", "paginate", "role", "tag", "x-trace"],
					outputSchema: true,
				},
			],
			diagnostics: [
				expect.objectContaining({
					level: "error",
					code: "unsupported-body-type",
					operationId: "uploadAvatar",
				}),
			],
		});
	});
});
