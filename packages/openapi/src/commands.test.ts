import {
	type AnyCrust,
	type CommandSnapshot,
	Crust,
	defineCommand,
	defineContext,
} from "@crustjs/core";
import { commandInputSchema } from "@crustjs/core/tooling";
import { confirmation, json, jsonInput } from "@crustjs/extensions";
import { captureExecute } from "@crustjs/testing";
import { runInteractive } from "@crustjs/testing/interactive";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { runBuildHooks } from "../../crust/tests/build-hooks.ts";
import type { ApiAuth } from "./client.ts";
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

function buildApi({
	auth: replaced = auth,
	...options
}: Partial<DefineApiOptions> & { readonly auth?: ApiAuth } = {}) {
	return defineApi({ spec, baseUrl: "https://api.example.com/v1/", ...options }).auth(replaced);
}

/** The snapshot of the command at `path` below `root`. */
function at(root: CommandSnapshot, ...path: string[]): CommandSnapshot {
	return path.reduce((node, name) => node.subCommands[name]!, root);
}

/** Each generated command of a snapshot: its path, arguments, flags, and whether it advertises an output schema. */
function surface(root: CommandSnapshot): string[] {
	const lines: string[] = [];
	const walk = (node: CommandSnapshot, prefix: string) => {
		for (const [name, child] of Object.entries(node.subCommands)) {
			if (child.extension !== undefined) continue;
			const path = prefix === "" ? name : `${prefix} ${name}`;
			if (child.hasAction) {
				const args = child.args.map((arg) => arg.name).join(",");
				const flags = Object.keys(child.flags).sort().join(",");
				lines.push(`${path} [${args}] [${flags}]${child.outputSchema ? " output" : ""}`);
			}
			walk(child, path);
		}
	};
	walk(root, "");
	return lines.sort();
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
	it("build one command per operation in its tag's group, leaving out deprecated operations and those it cannot generate", async () => {
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
		// uploadAvatar's multipart body cannot be generated, so it is skipped without failing the build.
		expect(await runBuildHooks(app)).toEqual({ files: new Map() });
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
			stdout: `${JSON.stringify([{ id: "1" }], null, 2)}\n`,
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
			stdout: `${JSON.stringify({ id: "42", name: "Ada" })}\n`,
			stderr: "",
			exitCode: 0,
		});
	});

	it("merges body field flags over --request-body and checks the effective body's required fields", async () => {
		const calls = stubFetch();
		const acme = buildApi();
		const app = new Crust("acme").extend(acme.extension).add(...acme.commands);

		const created = await captureExecute(app, [
			"users",
			"create-user",
			"--request-body",
			'{"name":"Bob","profile":{"bio":"hi"}}',
			"--name",
			"Ada",
			"--age",
			"36",
		]);
		const fromBody = await captureExecute(app, [
			"users",
			"create-user",
			"--request-body",
			'{"name":"Bo"}',
		]);
		const missing = await captureExecute(app, ["users", "create-user", "--age", "3"]);
		const notObject = await captureExecute(app, ["users", "create-user", "--request-body", "[1]"]);
		const wrongType = await captureExecute(app, [
			"users",
			"create-user",
			"--request-body",
			'{"name":"Ada","role":"owner"}',
		]);

		expect(created.exitCode).toBe(0);
		expect(calls[0]).toMatchObject({ method: "POST", url: "https://api.example.com/v1/users" });
		expect(JSON.parse(calls[0]!.body!)).toEqual({ name: "Ada", age: 36, profile: { bio: "hi" } });
		expect(calls[0]?.headers["content-type"]).toBe("application/json");
		expect(fromBody.exitCode).toBe(0);
		expect(JSON.parse(calls[1]!.body!)).toEqual({ name: "Bo" });
		expect(missing).toMatchObject({ exitCode: 2 });
		expect(missing.stderr).toContain('missing the body field "name" (--name)');
		expect(notObject.stderr).toContain("flags.request-body: must be a JSON object");
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

		expect(create.flags["request-body"]?.inputSchema).toEqual({
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
				"request-body": { type: "object", properties: { profile: { type: "object" } } },
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
			stdout: "all good\n",
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
			.use(confirmation)
			.onConfirm(async (ctx, message) => {
				asked.push(message);
				await (
					await ctx.confirm
				)(message);
			})
			.override({ deleteUser: { confirm: "Delete the user?" } });
		const app = new Crust("acme").extend(confirmation(), acme.extension).add(...acme.commands);

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
		expect((await runBuildHooks(app2)).error).toContain(
			"DELETE /users/{id}: the override sets `confirm`, but the handle has no `.onConfirm()` handler",
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
		expect((await runBuildHooks(app)).error).toContain(
			'GET /users/{id}: the command "users get-user" is also a command added to the group "users"',
		);
	});

	it("marks an operation without an operationId unavailable in api --list", async () => {
		const { app } = appFor({ "/anonymous": { get: {} } });

		expect((await captureExecute(app, ["api", "--list"])).stdout).toBe(
			"GET /anonymous Probe [unavailable: missing-operation-id]\n",
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
		expect((await runBuildHooks(app)).error).toContain(
			'GET /keys: the command "api list-keys" is in the group "api"',
		);
	});

	it("lists skipped operations as unavailable in api --list of an app that has the generated commands", async () => {
		const acme = buildApi();
		const app = new Crust("acme").extend(json(), acme.extension).add(...acme.commands);

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

	it("marks nothing in api --list of an app that never takes the generated commands", async () => {
		const app = new Crust("acme").extend(json(), buildApi().extension);

		const { stdout } = await captureExecute(app, ["api", "--list"]);
		const listed = await captureExecute(app, ["api", "--list", "--json"]);

		expect(stdout.split("\n")).toContain("POST /avatars uploadAvatar Upload an avatar");
		expect(stdout).not.toContain("unavailable");
		expect(JSON.parse(listed.stdout)).toContainEqual({
			method: "POST",
			path: "/avatars",
			operationId: "uploadAvatar",
			summary: "Upload an avatar",
		});
		expect(listed.stdout).not.toContain("unavailable");
	});
});

describe("a missing required value", () => {
	it("fails with VALIDATION on a terminal too, and nothing asks for it", async () => {
		const calls = stubFetch();
		const acme = buildApi();
		const app = new Crust("acme").extend(acme.extension).add(...acme.commands);

		const run = runInteractive(app, ["users", "get-user"]);

		expect(await run.done).toEqual({
			stdout: "",
			stderr: 'Error: Missing required argument "<id>"\n',
			exitCode: 2,
		});
		expect(run.screen()).toBe('Error: Missing required argument "<id>"');
		expect(calls).toEqual([]);
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

	it("uses an operation's own async paginate over the global one, printing the one list or returning it under --json", async () => {
		const calls = stubFetch(({ url }) =>
			url.endsWith("page=2")
				? Response.json([{ id: "2" }])
				: Response.json([{ id: "1" }], { headers: { "x-next": "/users?page=2" } }),
		);
		const acme = buildApi({ paginate: () => undefined }).override({ listUsers: { paginate } });
		const app = new Crust("acme").extend(json(), acme.extension).add(...acme.commands);

		const human = await captureExecute(app, ["users", "list-users", "--paginate"]);
		const data = await captureExecute(app, ["users", "list-users", "--paginate", "--json"]);

		expect(human).toEqual({
			stdout: `${JSON.stringify([{ id: "1" }, { id: "2" }], null, 2)}\n`,
			stderr: "",
			exitCode: 0,
		});
		expect(JSON.parse(data.stdout)).toEqual([{ id: "1" }, { id: "2" }]);
		expect(calls).toHaveLength(4);
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

describe("api preview", () => {
	/** An app whose generated commands fail the test if they authenticate, confirm, bind or send. */
	function guardedApp() {
		const sent = stubFetch(() => {
			throw new Error("fetch called");
		});
		const credentials = vi.fn(async () => ({ id: "me" }));
		const account = defineContext("account").setup(credentials);
		const onConfirm = vi.fn();
		const bind = vi.fn(async () => "acc_1");
		const acme = buildApi({
			auth: () => {
				throw new Error("auth called");
			},
		})
			.use(account)
			.onConfirm(onConfirm)
			.override({
				deleteUser: { confirm: "Delete the user?" },
				createUser: { bind: { role: bind } },
			});
		const app = new Crust("acme")
			.extend(json(), acme.extension)
			.provide(account())
			.add(...acme.commands);
		return { app, sent, untouched: [credentials, onConfirm, bind] };
	}

	it("prints the request a generated command would send, and touches nothing", async () => {
		const { app, sent, untouched } = guardedApp();

		const remove = await captureExecute(app, [
			"api",
			"preview",
			"users",
			"delete-user",
			"--",
			"u 1",
		]);
		const create = await app.run(["api", "preview"], {
			args: { target: ["users", "create-user"], argv: ["--name", "Ada", "--age", "3"] },
		});

		expect(JSON.parse(remove.stdout)).toEqual({
			method: "DELETE",
			url: "https://api.example.com/v1/users/u%201",
			headers: {},
			bodyKind: "none",
			body: null,
		});
		expect(create).toMatchObject({
			status: "completed",
			result: {
				method: "POST",
				url: "https://api.example.com/v1/users",
				headers: { accept: "application/json", "content-type": "application/json" },
				bodyKind: "json",
				// The bound field is its placeholder, never the binding's value.
				body: { name: "Ada", age: 3, role: "{role}" },
				bound: ["role"],
			},
		});
		expect(sent).toEqual([]);
		for (const spy of untouched) expect(spy).not.toHaveBeenCalled();
	});

	it("keeps a bound path parameter as its placeholder in the URL", async () => {
		const bind = vi.fn(async () => "me");
		const acme = buildApi().override({ getUser: { bind: { id: bind } } });
		const app = new Crust("acme").extend(acme.extension).add(...acme.commands);

		expect(
			await app.run(["api", "preview"], { args: { target: ["users", "get-user"] } }),
		).toMatchObject({
			result: { method: "GET", url: "https://api.example.com/v1/users/{id}", bound: ["id"] },
		});
		expect(bind).not.toHaveBeenCalled();
	});

	it("lists a rule's binding as bound only where the operation has an input of its name", async () => {
		const bind = vi.fn(async () => "me");
		const acme = buildApi().each(() => ({ bind: { id: bind } }));
		const app = new Crust("acme").extend(acme.extension).add(...acme.commands);
		const preview = async (...target: [string, ...string[]]) =>
			(await app.run(["api", "preview"], { args: { target } })) as {
				result?: unknown;
				error?: unknown;
			};

		const list = await preview("users", "list-users");
		expect(list.error).toBeUndefined();
		expect(list.result).not.toHaveProperty("bound");
		expect((await preview("users", "get-user")).result).toMatchObject({
			url: "https://api.example.com/v1/users/{id}",
			bound: ["id"],
		});
		expect(bind).not.toHaveBeenCalled();
	});

	it("fails as the command would, and for a target that is not a generated command", async () => {
		const { app } = guardedApp();
		const preview = (...argv: string[]) => captureExecute(app, ["api", "preview", ...argv]);

		expect((await preview("users", "get-user")).stderr).toBe(
			'Error: Missing required argument "<id>"\n',
		);
		expect((await preview("users", "create-user")).stderr).toBe(
			'Error: createUser: missing the body field "name" (--name)\n',
		);
		expect((await preview("users", "nope")).stderr).toContain('Unknown command "nope"');
		expect((await preview("api")).stderr).toBe(
			'Error: api preview: "api" is not a command generated from the OpenAPI spec\n',
		);
		expect((await preview("users", "get-user", "-X", "PUT", "--", "1")).stderr).toBe(
			"Error: api preview: --method is for a request path; put the command's own flags after --\n",
		);
	});

	it("previews a command at every place the app adds it, but not an app command at a generated path", async () => {
		const acme = buildApi();
		const app = new Crust("acme")
			.extend(acme.extension)
			.add(...acme.commands)
			.command("other", (command) => command.add(...acme.commands))
			.command("mine", (command) =>
				command.command("users", (users) =>
					users.command("get-user", (own) =>
						own.args({ name: "id", type: "string", required: true }).action(() => {}),
					),
				),
			);
		const preview = (...target: [string, ...string[]]) =>
			app.run(["api", "preview"], { args: { target, argv: ["1"] } });

		const targets: [string, ...string[]][] = [
			["users", "get-user"],
			["other", "users", "get-user"],
		];
		for (const target of targets) {
			expect(await preview(...target)).toMatchObject({
				status: "completed",
				result: { url: "https://api.example.com/v1/users/1" },
			});
		}
		expect(await preview("mine", "users", "get-user")).toMatchObject({
			status: "failed",
			error: {
				message:
					'api preview: "mine users get-user" is not a command generated from the OpenAPI spec',
			},
		});
	});

	it("previews a command below an aliased parent, and refuses --paginate before --", async () => {
		const acme = buildApi({ paginate: () => undefined });
		const app = new Crust("acme")
			.extend(acme.extension)
			.add(defineCommand("nested", { aliases: ["n"] }, (command) => command.add(...acme.commands)));

		expect(
			await app.run(["api", "preview"], {
				args: { target: ["n", "users", "get-user"], argv: ["1"] },
			}),
		).toMatchObject({ result: { url: "https://api.example.com/v1/users/1" } });
		expect(
			(await captureExecute(app, ["api", "preview", "n", "users", "list-users", "--paginate"]))
				.stderr,
		).toBe(
			"Error: api preview: --paginate is for a request path; put the command's own flags after --\n",
		);
	});

	it("runs no set-up, so a value jsonInput()'s --input would bind is not applied", async () => {
		const acme = buildApi();
		const app = new Crust("acme").extend(jsonInput(), acme.extension).add(...acme.commands);

		const { stderr } = await captureExecute(app, [
			"api",
			"preview",
			"users",
			"create-user",
			"--",
			"--input",
			'{"name":"Ada"}',
		]);

		expect(stderr).toBe('Error: createUser: missing the body field "name" (--name)\n');
	});

	it("gives generated commands no --dry-run flag", async () => {
		const acme = buildApi();
		const snapshot = await new Crust("acme")
			.extend(acme.extension)
			.add(...acme.commands)
			.snapshot();

		expect(Object.keys(at(snapshot, "users", "create-user").flags)).not.toContain("dry-run");
		expect(at(snapshot, "api", "preview").outputSchema).toMatchObject({
			required: ["method", "url", "headers", "bodyKind", "body"],
		});
	});
});

describe("generated commands of the same shape at several mounts", () => {
	// Two operations whose commands have one shape: `users list` and `other users list`.
	const query = (name: string, description: string) => ({
		name,
		in: "query",
		required: true,
		schema: { type: "string" },
		description,
	});
	const twins = {
		openapi: "3.1.0",
		paths: Object.fromEntries(
			["users", "admins"].map((path) => [
				`/${path}`,
				{
					get: {
						operationId: path,
						summary: "List",
						parameters: [query("q", `Search the ${path}`), query("page", "The page")],
						responses: { "200": { description: "OK" } },
					},
				},
			]),
		),
	};

	function twinsApp(mounts: "root" | "other" | "both") {
		const sent = stubFetch(() => Response.json({}));
		const acme = defineApi({ spec: twins, baseUrl: "https://api.example.com/v1/" }).override({
			users: { group: "users", name: "list" },
			admins: { group: "other users", name: "list" },
		});
		const under = (name: string) => defineCommand(name, (command) => command.add(...acme.commands));
		const api = new Crust("acme").extend(acme.extension);
		const app: AnyCrust =
			mounts === "root"
				? api.add(...acme.commands)
				: mounts === "other"
					? api.add(under("other"))
					: api.add(...acme.commands).add(under("more"));
		/** The URL `api preview` shows for a path, and the one the command requests. */
		const urls = async (...path: [string, ...string[]]) => {
			const outcome = await app.run(["api", "preview"], {
				args: { target: path, argv: ["--q", "a", "--page", "1"] },
			});
			const preview =
				outcome.status === "failed"
					? (outcome.error as Error).message
					: (outcome as { result: { url: string } }).result.url;
			sent.length = 0;
			await captureExecute(app, [...path, "--q", "a", "--page", "1"]);
			return { preview, sent: sent[0]?.url };
		};
		return { urls };
	}
	const users = "https://api.example.com/v1/users?q=a&page=1";
	const admins = "https://api.example.com/v1/admins?q=a&page=1";

	it("decides a single mount by where the app adds the commands", async () => {
		const { urls } = twinsApp("other");

		expect(await urls("other", "users", "list")).toEqual({ preview: users, sent: users });
		expect(await urls("other", "other", "users", "list")).toEqual({
			preview: admins,
			sent: admins,
		});
	});

	it("decides the root mount by where the app adds the commands", async () => {
		const { urls } = twinsApp("root");

		expect(await urls("users", "list")).toEqual({ preview: users, sent: users });
		expect(await urls("other", "users", "list")).toEqual({ preview: admins, sent: admins });
	});

	it("never guesses at a further mount where two operations fit", async () => {
		const { urls } = twinsApp("both");

		expect(await urls("more", "users", "list")).toEqual({ preview: users, sent: users });
		expect(await urls("more", "other", "users", "list")).toEqual({
			preview:
				'api preview: "more other users list" fits several generated commands, as the app adds them more than once: preview "other users list" (admins) or "users list" (users) instead',
			sent: admins,
		});
	});
});

describe("the app's snapshot", () => {
	it("shows every generated command with its arguments, flags and output schema", async () => {
		const acme = buildApi({ paginate: () => undefined });
		const app = new Crust("acme").extend(acme.extension).add(...acme.commands);

		expect(surface(await app.snapshot())).toEqual([
			"get-status [] []",
			"users create-user [] [age,name,request-body,role] output",
			"users delete-user [id] []",
			"users get-user [id] [] output",
			"users list-users [] [limit,paginate,role,tag,x-trace] output",
		]);
	});
});

const ok = {
	"200": { description: "OK", content: { "application/json": { schema: { type: "object" } } } },
};

/** A handle and an app for `paths`, with the operations' common fields filled in. */
function appFor(
	paths: Record<string, Record<string, Record<string, unknown>>>,
	options: Partial<DefineApiOptions> & { openapi?: string } = {},
) {
	const { openapi = "3.1.0", ...rest } = options;
	const filled = Object.fromEntries(
		Object.entries(paths).map(([path, item]) => [
			path,
			Object.fromEntries(
				Object.entries(item).map(([method, op]) => [
					method,
					method === "parameters" ? op : { summary: "Probe", responses: ok, ...op },
				]),
			),
		]),
	);
	const acme = buildApi({ spec: { openapi, paths: filled }, ...rest });
	return { acme, app: new Crust("acme").extend(acme.extension).add(...acme.commands) };
}

const pathParam = (name: string) => ({
	name,
	in: "path",
	required: true,
	schema: { type: "string" },
});
const jsonBody = (schema: unknown) => ({
	requestBody: { required: true, content: { "application/json": { schema } } },
});

describe("generated command inputs", () => {
	it("orders arguments by the path template, or by the override's positional list", async () => {
		const calls = stubFetch(() => Response.json({}));
		const paths = {
			"/{a}/{b}/x": { get: { operationId: "probe", parameters: [pathParam("b"), pathParam("a")] } },
		};
		const { app } = appFor(paths);
		const reordered = appFor(paths).acme.override({ probe: { positional: ["b", "a"] } });

		await captureExecute(app, ["probe", "A", "B"]);
		await captureExecute(new Crust("acme").extend(reordered.extension).add(...reordered.commands), [
			"probe",
			"B",
			"A",
		]);

		expect(calls.map(({ url }) => url)).toEqual([
			"https://api.example.com/v1/A/B/x",
			"https://api.example.com/v1/A/B/x",
		]);
	});

	it("reads an argument from the arguments, not from an inherited flag of the same name", async () => {
		const calls = stubFetch(() => Response.json({}));
		const { acme } = appFor({
			"/{json}": { get: { operationId: "probe", parameters: [pathParam("json")] } },
		});
		const app = new Crust("acme").extend(json(), acme.extension).add(...acme.commands);

		expect((await captureExecute(app, ["probe", "42"])).exitCode).toBe(0);
		expect(calls[0]?.url).toBe("https://api.example.com/v1/42");
	});

	it("sends parameters, body fields and bindings named like Object.prototype members", async () => {
		const calls = stubFetch(() => Response.json({}));
		const { app } = appFor({
			"/{__proto__}": { get: { operationId: "probe", parameters: [pathParam("__proto__")] } },
			"/body": {
				post: {
					operationId: "post-body",
					// Computed: a literal `__proto__` key would set the prototype.
					...jsonBody({ type: "object", properties: { ["__proto__"]: { type: "string" } } }),
				},
			},
			"/required": {
				post: {
					operationId: "post-required",
					...jsonBody({
						type: "object",
						required: ["toString"],
						properties: { toString: { type: "object" } },
					}),
				},
			},
		});
		const bound = appFor({
			"/{__proto__}": { get: { operationId: "probe", parameters: [pathParam("__proto__")] } },
		}).acme.override({ probe: { bind: Object.fromEntries([["__proto__", () => "bound"]]) } });

		expect((await captureExecute(app, ["probe", "abc"])).exitCode).toBe(0);
		expect((await captureExecute(app, ["post-body", "--proto", "abc"])).exitCode).toBe(0);
		expect(await captureExecute(app, ["post-required", "--request-body", "{}"])).toMatchObject({
			exitCode: 2,
			stderr: expect.stringContaining('missing the body field "toString"'),
		});
		await captureExecute(new Crust("acme").extend(bound.extension).add(...bound.commands), [
			"probe",
		]);

		expect(calls.map(({ url, body }) => [url, body])).toEqual([
			["https://api.example.com/v1/abc", undefined],
			["https://api.example.com/v1/body", '{"__proto__":"abc"}'],
			["https://api.example.com/v1/bound", undefined],
		]);
	});

	it("checks a list field given in --request-body as a list, and accepts null where the schema does", async () => {
		const calls = stubFetch(() => Response.json({}));
		const fields = {
			tags: { type: "array", items: { type: "string" } },
			name: { type: ["string", "null"] },
		};
		const { app } = appFor({
			"/p": { post: { operationId: "probe", ...jsonBody({ type: "object", properties: fields }) } },
		});
		const v30 = appFor(
			{
				"/p": {
					post: {
						operationId: "probe",
						...jsonBody({
							type: "object",
							properties: { name: { type: "string", nullable: true } },
						}),
					},
				},
			},
			{ openapi: "3.0.3" },
		);

		expect(await captureExecute(app, ["probe", "--request-body", '{"tags":"x"}'])).toMatchObject({
			exitCode: 2,
			stderr: expect.stringContaining('the body field "tags" must be a list of string'),
		});
		expect(
			(await captureExecute(app, ["probe", "--request-body", '{"tags":[],"name":null}'])).exitCode,
		).toBe(0);
		expect(
			(await captureExecute(v30.app, ["probe", "--request-body", '{"name":null}'])).exitCode,
		).toBe(0);
		expect(calls).toHaveLength(2);
	});

	it("publishes no required body field a flag or a binding fills, also inside allOf", async () => {
		const schema = {
			allOf: [
				{
					type: "object",
					required: ["name", "region", "nested"],
					properties: {
						name: { type: "string" },
						region: { type: "string" },
						nested: {
							type: "object",
							required: ["name"],
							properties: { name: { type: "string" } },
						},
					},
				},
			],
		};
		const { acme } = appFor({ "/p": { post: { operationId: "probe", ...jsonBody(schema) } } });
		const bound = acme.override({ probe: { bind: { region: () => "eu" } } });
		const app = new Crust("acme").extend(bound.extension).add(...bound.commands);
		const body = at(await app.snapshot(), "probe").flags["request-body"]?.inputSchema;

		expect(body).toEqual({
			allOf: [
				{
					type: "object",
					required: ["nested"],
					properties: {
						name: { type: "string" },
						region: { type: "string" },
						nested: {
							type: "object",
							required: ["name"],
							properties: { name: { type: "string" } },
						},
					},
				},
			],
		});
	});

	it("leaves out an operation whose command, group or argument name core rejects, and fails the build", async () => {
		const { app } = appFor({
			"/a": { get: { operationId: "日本" } },
			"/b": { get: { operationId: "___" } },
			"/c/{___}": { get: { operationId: "probe", parameters: [pathParam("___")] } },
		});

		expect(Object.keys((await app.snapshot()).subCommands)).toEqual(["api"]);
		const { error } = await runBuildHooks(app);
		expect(error).toContain('GET /a: the command name "" is empty');
		expect(error).toContain('GET /b: the command name "" is empty');
		expect(error).toContain('GET /c/{___}: the argument name "" is empty');
	});

	it("binds from a `.use()`d Context that owns a flag, which the generated command takes", async () => {
		const calls = stubFetch(() => Response.json({}));
		const region = defineContext("region")
			.flags({ region: { type: "string", default: "eu" } })
			.setup(({ flags }) => flags.region);
		const acme = appFor({
			"/{id}": { get: { operationId: "probe", parameters: [pathParam("id")] } },
		})
			.acme.use(region)
			.override({ probe: { bind: { id: async (ctx) => await ctx.region } } });
		const app = new Crust("acme")
			.extend(acme.extension)
			.provide(region())
			.add(...acme.commands);

		expect((await captureExecute(app, ["probe", "--region", "us"])).exitCode).toBe(0);
		expect(calls[0]?.url).toBe("https://api.example.com/v1/us");
	});

	it("enters --paginate only when the command offers it, not for a spec parameter named paginate", async () => {
		const calls = stubFetch(() => Response.json({ id: "1" }));
		const { app } = appFor(
			{
				"/p": {
					get: {
						operationId: "probe",
						parameters: [{ name: "paginate", in: "query", schema: { type: "boolean" } }],
					},
				},
			},
			{ paginate: () => ({ path: "/next" }) },
		);

		expect(await app.run(["probe"], { flags: { paginate: true } })).toMatchObject({
			status: "completed",
			result: { id: "1" },
		});
		expect(calls.map(({ url }) => url)).toEqual(["https://api.example.com/v1/p?paginate=true"]);
	});

	it("sends false for a boolean parameter through --no-<name>", async () => {
		const calls = stubFetch(() => Response.json({ id: "1" }));
		const { app } = appFor({
			"/p": {
				get: {
					operationId: "probe",
					parameters: [{ name: "draft", in: "query", schema: { type: "boolean" } }],
				},
			},
		});

		expect((await captureExecute(app, ["probe", "--no-draft"])).exitCode).toBe(0);
		expect(calls.map(({ url }) => url)).toEqual(["https://api.example.com/v1/p?draft=false"]);
	});
});

describe("generated output schemas", () => {
	const responses = (extra: Record<string, unknown>) => ({ ...ok, ...extra });

	it("advertises the response schema only when every 2xx response is that JSON", async () => {
		const { app } = appFor({
			"/text": {
				get: {
					operationId: "text",
					responses: responses({ "201": { description: "x", content: { "text/plain": {} } } }),
				},
			},
			"/empty": {
				get: { operationId: "empty", responses: responses({ "204": { description: "x" } }) },
			},
			"/same": { get: { operationId: "same", responses: responses({ "201": ok["200"] }) } },
		});
		const snapshot = await app.snapshot();

		expect(at(snapshot, "text").outputSchema).toBeUndefined();
		expect(at(snapshot, "empty").outputSchema).toBeUndefined();
		expect(at(snapshot, "same").outputSchema).toEqual({ type: "object" });
	});

	it("advertises a joined --paginate result without the page's own list limits, and offers no joining for a tuple", async () => {
		const list = (schema: unknown) => ({
			"200": { description: "OK", content: { "application/json": { schema } } },
		});
		const { app } = appFor(
			{
				"/bounded": {
					get: {
						operationId: "bounded",
						responses: list({
							type: "array",
							maxItems: 1,
							uniqueItems: true,
							items: { type: "number", maximum: 9 },
						}),
					},
				},
				"/tuple": {
					get: {
						operationId: "tuple",
						responses: list({ type: "array", prefixItems: [{ type: "number" }] }),
					},
				},
			},
			{ paginate: () => undefined },
		);
		const snapshot = await app.snapshot();

		expect(at(snapshot, "bounded").outputSchema).toEqual({
			type: "array",
			items: { type: "number", maximum: 9 },
		});
		expect(Object.keys(at(snapshot, "tuple").flags)).not.toContain("paginate");
	});

	it("drops the list limits and finds a tuple through an allOf reference", async () => {
		const ref = (name: string) => ({
			"200": {
				description: "OK",
				content: {
					"application/json": { schema: { allOf: [{ $ref: `#/components/schemas/${name}` }] } },
				},
			},
		});
		const acme = buildApi({
			paginate: () => undefined,
			spec: {
				openapi: "3.1.0",
				paths: {
					"/page": { get: { operationId: "page", summary: "Page", responses: ref("Page") } },
					"/tuple": { get: { operationId: "tuple", summary: "Tuple", responses: ref("Tuple") } },
				},
				components: {
					schemas: {
						Page: { type: "array", maxItems: 1, items: { type: "number", maximum: 9 } },
						Tuple: { type: "array", prefixItems: [{ type: "number" }], items: false },
					},
				},
			},
		});
		const snapshot = await new Crust("acme")
			.extend(acme.extension)
			.add(...acme.commands)
			.snapshot();

		expect(at(snapshot, "page").outputSchema).toEqual({
			allOf: [{ type: "array", items: { type: "number", maximum: 9 } }],
		});
		expect(Object.keys(at(snapshot, "tuple").flags)).not.toContain("paginate");
	});
});

describe("generated command bindings, positionals and confirmation", () => {
	const shared = ["path", "query", "header"].map((location) => ({
		name: "id",
		in: location,
		required: true,
		schema: { type: "string" },
	}));

	it("fills every parameter a binding names, once", async () => {
		const calls = stubFetch(() => Response.json({}));
		const bind = vi.fn(async () => "42");
		const acme = appFor({
			"/{id}": { get: { operationId: "probe", parameters: shared } },
		}).acme.override({
			probe: { bind: { id: bind } },
		});
		const app = new Crust("acme").extend(acme.extension).add(...acme.commands);

		expect((await captureExecute(app, ["probe"])).exitCode).toBe(0);
		expect(calls[0]).toMatchObject({
			url: "https://api.example.com/v1/42?id=42",
			headers: { id: "42" },
		});
		expect(bind).toHaveBeenCalledTimes(1);
	});

	it("runs an `.each()` binding only for an operation with an input of its name", async () => {
		const calls = stubFetch(() => Response.json({}));
		const accountId = vi.fn(async () => "a1");
		const { acme } = appFor({
			"/status": { get: { operationId: "status" } },
			"/accounts/{accountId}": {
				get: {
					operationId: "account",
					parameters: [
						pathParam("accountId"),
						{ name: "accountId", in: "query", required: true, schema: { type: "string" } },
					],
				},
			},
		});
		const shared = acme.each(() => ({ bind: { accountId } }));
		const app = new Crust("acme").extend(shared.extension).add(...shared.commands);

		expect((await captureExecute(app, ["status"])).exitCode).toBe(0);
		expect(accountId).not.toHaveBeenCalled();
		expect((await captureExecute(app, ["account"])).exitCode).toBe(0);
		expect(accountId).toHaveBeenCalledTimes(1);
		expect(calls.map(({ url }) => url)).toEqual([
			"https://api.example.com/v1/status",
			"https://api.example.com/v1/accounts/a1?accountId=a1",
		]);
	});

	it("maps a parameter by default when its bind or flagName entry is undefined", async () => {
		const { acme } = appFor({
			"/{id}": {
				get: {
					operationId: "probe",
					parameters: [pathParam("id"), { name: "q", in: "query", schema: { type: "string" } }],
				},
			},
		});
		const handle = acme.override({
			probe: { bind: { id: undefined }, flagName: { id: undefined, q: undefined } },
		});

		const app = new Crust("acme").extend(handle.extension).add(...handle.commands);
		expect(surface(await app.snapshot())).toEqual(["probe [id] [q] output"]);
	});

	it("fails the build for positionals that put an optional one or a list before another", async () => {
		const { acme } = appFor({
			"/{id}": {
				get: {
					operationId: "probe",
					parameters: [
						pathParam("id"),
						{ name: "q", in: "query", schema: { type: "string" } },
						{
							name: "tag",
							in: "query",
							required: true,
							schema: { type: "array", items: { type: "string" } },
						},
					],
				},
			},
		});
		const error = async (positional: string[]) => {
			const handle = acme.override({ probe: { positional } });
			return (
				await runBuildHooks(new Crust("acme").extend(handle.extension).add(...handle.commands))
			).error;
		};

		expect(await error(["q", "id"])).toContain('the positional query parameter "q" is optional');
		expect(await error(["tag", "id"])).toContain('the positional query parameter "tag" is a list');
		expect(await error(["id", "q"])).toBeUndefined();
		expect(await error(["id", "tag"])).toBeUndefined();
	});

	it("takes a list parameter as the last positional, variadic", async () => {
		const calls = stubFetch(() => Response.json({}));
		const acme = appFor({
			"/{id}": {
				get: {
					operationId: "probe",
					parameters: [
						pathParam("id"),
						{
							name: "tag",
							in: "query",
							required: true,
							schema: { type: "array", items: { type: "string" } },
						},
					],
				},
			},
		}).acme.override({ probe: { positional: ["id", "tag"] } });
		const app = new Crust("acme").extend(acme.extension).add(...acme.commands);

		expect(
			at(await app.snapshot(), "probe").args.map(({ name, variadic }) => [name, variadic]),
		).toEqual([
			["id", undefined],
			["tag", true],
		]);
		expect((await captureExecute(app, ["probe", "1", "a", "b"])).exitCode).toBe(0);
		expect(calls[0]?.url).toBe("https://api.example.com/v1/1?tag=a&tag=b");
	});

	it.each([
		["resolves to nothing", () => undefined, true],
		["resolves to true", () => true, true],
		["resolves to false", () => false, false],
		[
			"throws",
			() => {
				throw new Error("Declined");
			},
			false,
		],
	])("sends the request when the confirmation handler %s: %s", async (outcome, handler, sent) => {
		const calls = stubFetch(() => new Response(null, { status: 204 }));
		const acme = appFor({
			"/{id}": { delete: { operationId: "probe", parameters: [pathParam("id")] } },
		})
			.acme.onConfirm(handler)
			.override({ probe: { confirm: "Delete it?" } });
		const app = new Crust("acme").extend(acme.extension).add(...acme.commands);

		const result = await captureExecute(app, ["probe", "1"]);

		expect(calls).toHaveLength(sent ? 1 : 0);
		expect(result.exitCode).toBe(sent ? 0 : 1);
		if (outcome === "resolves to false") {
			expect(result.stderr).toBe("Error: probe: not confirmed: Delete it? Nothing was sent.\n");
		}
	});

	it("checks the whole request before asking to confirm it", async () => {
		const calls = stubFetch(() => Response.json({}));
		const asked = vi.fn();
		const acme = appFor({
			"/{id}": { delete: { operationId: "probe", parameters: [pathParam("id")] } },
		})
			.acme.onConfirm(asked)
			.override({ probe: { confirm: "Send?" } });
		const app = new Crust("acme").extend(acme.extension).add(...acme.commands);

		expect(await captureExecute(app, ["probe", ".."])).toMatchObject({ exitCode: 2 });
		expect(asked).not.toHaveBeenCalled();
		expect(calls).toEqual([]);
	});

	it("checks nullable list items and an enum that does not allow null", async () => {
		const calls = stubFetch(() => Response.json({}));
		const fields = {
			tags: { type: "array", items: { type: ["string", "null"] } },
			name: { type: ["string", "null"], enum: ["a"] },
		};
		const { app } = appFor({
			"/p": { post: { operationId: "probe", ...jsonBody({ type: "object", properties: fields }) } },
		});
		const v30 = appFor(
			{
				"/p": {
					post: {
						operationId: "probe",
						...jsonBody({
							type: "object",
							properties: { tags: { type: "array", items: { type: "string", nullable: true } } },
						}),
					},
				},
			},
			{ openapi: "3.0.3" },
		);

		expect(
			(await captureExecute(app, ["probe", "--request-body", '{"tags":[null,"x"]}'])).exitCode,
		).toBe(0);
		expect(
			(await captureExecute(v30.app, ["probe", "--request-body", '{"tags":[null,"x"]}'])).exitCode,
		).toBe(0);
		expect(await captureExecute(app, ["probe", "--request-body", '{"name":null}'])).toMatchObject({
			exitCode: 2,
			stderr: expect.stringContaining('the body field "name"'),
		});
		expect(calls).toHaveLength(2);
	});
});
