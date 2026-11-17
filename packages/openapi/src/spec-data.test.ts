import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

import { Crust, defineCommand } from "@crustjs/core";
import { didYouMean, help } from "@crustjs/extensions";
import { captureExecute } from "@crustjs/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { runBuildHooks } from "../../crust/tests/build-hooks.ts";
import type { GeneratedDefinition } from "./commands.ts";
import { type Api, type DefineApiOptions, defineApi } from "./define-api.ts";
import { operations } from "./operations.ts";

// A built CLI reads `<dir>/<id>/`: `built.dir` makes this process one, else it runs from source.
const built = vi.hoisted(() => ({ dir: undefined as string | undefined }));
vi.mock("@crustjs/utils/artifacts", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@crustjs/utils/artifacts")>();
	return {
		...actual,
		isSourceRun: () => built.dir === undefined && actual.isSourceRun(),
		resolveArtifactDir: (name: string) =>
			built.dir === undefined ? actual.resolveArtifactDir(name) : `${built.dir}/${name}`,
	};
});

const ok = (schema?: unknown) => ({
	"200": {
		description: "OK",
		content: { "application/json": schema === undefined ? {} : { schema } },
	},
});
const zoneParam = { name: "zone", in: "path", required: true, schema: { type: "string" } };
const spec = {
	openapi: "3.1.0",
	info: { title: "Acme", version: "1" },
	security: [{ token: [] }],
	tags: [
		{ name: "Users", description: "The users" },
		{ name: "dns", description: "DNS" },
	],
	paths: {
		"/users": {
			parameters: [{ $ref: "#/components/parameters/Page" }],
			get: {
				operationId: "listUsers",
				tags: ["Users"],
				summary: "List the users",
				responses: ok({ type: "array", items: { $ref: "#/components/schemas/User" } }),
			},
			post: {
				operationId: "createUser",
				tags: ["Users"],
				summary: "Create a user",
				requestBody: { $ref: "#/components/requestBodies/NewUser" },
				responses: { "201": { $ref: "#/components/responses/User" } },
			},
		},
		"/users/{id}": { $ref: "#/components/pathItems/UserById" },
		"/zones/{zone}/records": {
			get: {
				operationId: "listRecords",
				tags: ["dns"],
				summary: "List the records",
				parameters: [{ $ref: "#/paths/~1users/parameters/0" }, zoneParam],
				responses: ok({ $ref: "#/components/schemas/Zone%20Record" }),
			},
		},
		"/zones/{zone}": {
			get: {
				operationId: "getZone",
				tags: ["dns"],
				summary: "Get a zone",
				parameters: [zoneParam],
				responses: ok({ $ref: "#/components/schemas/Zone%20Record" }),
			},
		},
		"/status": {
			get: { operationId: "status", summary: "The status", security: [], responses: ok() },
		},
		// One operationId for two operations in two groups: both are left out.
		"/a": { get: { operationId: "same", tags: ["dns"], summary: "One", responses: ok() } },
		"/b": { get: { operationId: "same", tags: ["Users"], summary: "Two", responses: ok() } },
	},
	components: {
		parameters: {
			Page: { name: "page", in: "query", schema: { $ref: "#/components/schemas/Page" } },
		},
		schemas: {
			Page: { type: "integer" },
			Named: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
			User: {
				allOf: [
					{ $ref: "#/components/schemas/Named" },
					{ type: "object", properties: { id: { type: "string" } } },
				],
			},
			"Zone Record": { type: "object", properties: { ttl: { $ref: "#/components/schemas/Ttl" } } },
			Ttl: { $ref: "#/components/schemas/Page" },
			Unused: { type: "string", description: "Never reached" },
			// Only an override's output schema reaches it.
			Item: { type: "string" },
		},
		requestBodies: {
			NewUser: {
				required: true,
				content: { "application/json": { schema: { $ref: "#/components/schemas/Named" } } },
			},
		},
		responses: {
			User: {
				description: "The user",
				content: { "application/json": { schema: { $ref: "#/components/schemas/User" } } },
			},
		},
		pathItems: {
			UserById: {
				get: {
					operationId: "getUser",
					tags: ["Users"],
					summary: "Get a user",
					parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
					responses: { "200": { $ref: "#/components/responses/User" } },
				},
			},
		},
	},
};

let root = "";
let specUrl: URL;
beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "crust-openapi-data-"));
	specUrl = pathToFileURL(join(root, "acme.openapi.json"));
	writeFileSync(specUrl, JSON.stringify(spec));
	vi.stubGlobal("fetch", async () => Response.json([]));
});
afterEach(() => {
	built.dir = undefined;
	vi.unstubAllGlobals();
	rmSync(root, { recursive: true, force: true });
});

const hello = defineCommand("hello", { description: "Says hello" }, (command) =>
	command.action(() => "hello"),
);
const ping = defineCommand("ping", (command) => command.action(() => "pong"));

/** The API with a chain that moves, renames, hides, nests and adds commands, and clashes with one. */
function chained(options: Partial<DefineApiOptions> = {}) {
	return defineApi({ spec: specUrl, baseUrl: "https://api.acme.test", ...options })
		.each((op) => (op.id === "listRecords" ? { group: "dns records", name: "list" } : undefined))
		.override({
			getZone: { group: "users", name: "zone" },
			status: { name: "health", hidden: true },
		})
		.add(
			"users",
			hello,
			defineCommand("create-user", (command) => command.action(() => "mine")),
		)
		.add("extra", hello)
		.add("", ping);
}

function appOf(
	acme: Pick<Api, "extension"> & { readonly commands: readonly GeneratedDefinition[] },
) {
	return new Crust("acme").extend(help(), acme.extension).add(...acme.commands);
}

/** Writes the build hook's files to `built.dir`, which makes this process a built CLI. */
async function ship(app = appOf(chained())) {
	const { files, error } = await runBuildHooks(app);
	expect(error).toBeUndefined();
	built.dir = join(root, "built");
	for (const [path, content] of files) {
		mkdirSync(dirname(join(built.dir, path)), { recursive: true });
		writeFileSync(join(built.dir, path), content);
	}
	return files;
}

describe("spec data files", () => {
	it("are an index, root.json and a file per top-level group beside spec.json, the same every build", async () => {
		const files = await runBuildHooks(appOf(chained()));

		expect([...files.files.keys()].sort()).toEqual([
			"openapi/groups/g-dns.json",
			"openapi/groups/g-users.json",
			"openapi/index.json",
			"openapi/root.json",
			"openapi/spec.json",
		]);
		expect(JSON.parse(files.files.get("openapi/index.json")!)).toEqual({
			version: 1,
			commands: [
				{
					name: "health",
					meta: { description: "The status", hidden: true },
					operationId: "status",
					file: "root.json",
				},
			],
			groups: [
				{
					name: "users",
					meta: { description: "The users" },
					operationIds: ["listUsers", "getUser", "getZone"],
					file: "groups/g-users.json",
				},
				{
					name: "dns",
					meta: { description: "DNS" },
					operationIds: ["listRecords"],
					file: "groups/g-dns.json",
				},
				{ name: "extra", meta: {}, operationIds: [] },
			],
		});
		expect(await runBuildHooks(appOf(chained()))).toEqual(files);
	});

	it("give each group the operations it holds and every $ref target they reach, at the same pointer", async () => {
		const { files } = await runBuildHooks(appOf(chained()));
		const whole = operations(spec).operations;
		const slice = (file: string) => JSON.parse(files.get(`openapi/${file}`)!);

		for (const [file, ids] of [
			["groups/g-users.json", ["listUsers", "getUser", "getZone"]],
			["groups/g-dns.json", ["listRecords"]],
			["root.json", ["status"]],
		] as const) {
			const model = operations(slice(file));
			const kept = new Set<string>(ids);
			expect(model.diagnostics).toEqual([]);
			expect(model.operations.filter(({ id }) => kept.has(id))).toEqual(
				whole.filter(({ id }) => kept.has(id)),
			);
		}
		expect(slice("groups/g-dns.json").paths).not.toHaveProperty("/status");
		expect(slice("groups/g-users.json").components.schemas).not.toHaveProperty("Unused");
		expect(slice("root.json")).not.toHaveProperty("components");
	});

	it("give a built CLI the commands of the source run, `api --list` and the manifest", async () => {
		const source = chained();
		const sourceApp = appOf(source);
		const sourceList = await captureExecute(sourceApp, ["api", "--list"]);
		await ship();
		const builtApi = chained();
		const builtApp = appOf(builtApi);

		expect(await builtApp.snapshot()).toEqual(await sourceApp.snapshot());
		expect(await captureExecute(builtApp, ["api", "--list"])).toEqual(sourceList);
		expect(builtApi.manifest()).toEqual(source.manifest());
	});

	it("give a built CLI the operations path items with a $ref resolve to, also those their own methods override", async () => {
		const op = (operationId: string, tag: string) => ({
			operationId,
			tags: [tag],
			summary: operationId,
			responses: ok(),
		});
		const query = (name: string) => ({ name, in: "query", schema: { type: "string" } });
		writeFileSync(
			specUrl,
			JSON.stringify({
				openapi: "3.1.0",
				paths: {
					"/actual": { get: op("fetchItem", "g") },
					// Its own GET and parameters win over Base's; Base's POST shows through.
					"/shadow": {
						$ref: "#/components/pathItems/Base",
						parameters: [query("s")],
						get: op("otherItem", "other"),
					},
					// Two paths through one item, each overriding another method; `twice` shows
					// through both and `both` is also an operation of its own: all four are left out.
					"/x": { $ref: "#/components/pathItems/Shared", get: op("xGet", "g") },
					"/y": { $ref: "#/components/pathItems/Shared", post: op("yPost", "other") },
					"/direct": { put: op("both", "h") },
				},
				components: {
					pathItems: {
						Base: {
							parameters: [query("b")],
							get: op("fetchItem", "g"),
							post: op("createItem", "g"),
						},
						Shared: {
							parameters: [query("t")],
							get: op("sharedGet", "h"),
							post: op("sharedPost", "h"),
							delete: op("twice", "h"),
							put: op("both", "h"),
						},
					},
				},
			}),
		);
		const plain = () => defineApi({ spec: specUrl, baseUrl: "https://api.acme.test" });
		const sent = async () => {
			const calls: string[] = [];
			vi.stubGlobal("fetch", async (url: URL, init: RequestInit) => {
				calls.push(`${init.method} ${url.href}`);
				return Response.json([]);
			});
			const app = appOf(plain());
			for (const argv of [
				["g", "fetch-item"],
				["g", "create-item", "--s", "1"],
				["g", "x-get", "--t", "1"],
				["h", "shared-post", "--t", "1"],
				["h", "shared-get", "--t", "1"],
				["other", "item", "--s", "1"],
				["other", "y-post", "--t", "1"],
			]) {
				const result = await captureExecute(app, argv);
				expect({ argv, ...result }).toMatchObject({ argv, exitCode: 0 });
			}
			return { calls, snapshot: await app.snapshot(), manifest: plain().manifest() };
		};
		const source = await sent();
		await ship(appOf(plain()));

		expect(source.calls).toContain("GET https://api.acme.test/actual");
		expect(await sent()).toEqual(source);
	});

	it("give a built CLI the output schemas of the chain, also one that $refs what no operation does", async () => {
		const withSchemas = () =>
			defineApi({ spec: specUrl, baseUrl: "https://api.acme.test", paginate: () => undefined })
				.each((op) =>
					op.id === "status"
						? { outputSchema: { $ref: "#/components/schemas/Unused" } }
						: undefined,
				)
				.override({
					listRecords: {
						unwrap: (body) => body,
						outputSchema: { type: "array", items: { $ref: "#/components/schemas/Item" } },
					},
				});
		const source = await appOf(withSchemas()).snapshot();
		await ship(appOf(withSchemas()));
		const builtSnapshot = await appOf(withSchemas()).snapshot();

		expect(builtSnapshot).toEqual(source);
		expect(builtSnapshot.subCommands.dns!.subCommands["list-records"]).toMatchObject({
			outputSchema: { type: "array", items: { type: "string" } },
			flags: { paginate: expect.anything() },
		});
		expect(builtSnapshot.subCommands.status!.outputSchema).toEqual({
			type: "string",
			description: "Never reached",
		});
	});

	it("let a built CLI call a binding only for an operation with an input of its name, as the source run does", async () => {
		const run = async () => {
			const calls: string[] = [];
			vi.stubGlobal("fetch", async (url: URL, init: RequestInit) => {
				calls.push(`${init.method} ${url.href}`);
				return Response.json([]);
			});
			const id = vi.fn(async () => "u1");
			const acme = defineApi({ spec: specUrl, baseUrl: "https://api.acme.test" }).each(() => ({
				bind: { id },
			}));
			const app = appOf(acme);
			const status = await captureExecute(app, ["status"]);
			const called = id.mock.calls.length;
			const user = await captureExecute(app, ["users", "get-user"]);
			return { status, called, user, calledAfter: id.mock.calls.length, calls };
		};
		const source = await run();
		await ship(
			appOf(
				defineApi({ spec: specUrl, baseUrl: "https://api.acme.test" }).each(() => ({
					bind: { id: async () => "u1" },
				})),
			),
		);

		expect(source).toMatchObject({ called: 0, calledAfter: 1 });
		expect(source.calls).toEqual([
			"GET https://api.acme.test/status",
			"GET https://api.acme.test/users/u1",
		]);
		expect(await run()).toEqual(source);
	});

	it("are read in a built CLI as it needs them: the index at start, a group's file when it runs", async () => {
		await ship();
		for (const file of ["root.json", "groups/g-dns.json", "spec.json"]) {
			rmSync(join(built.dir!, "openapi", file));
		}
		const app = appOf(chained());

		expect(await captureExecute(app, ["--help"])).toMatchObject({ exitCode: 0 });
		expect(await captureExecute(app, ["users", "list-users"])).toEqual({
			stdout: "[]",
			stderr: "",
			exitCode: 0,
		});
		expect(await captureExecute(app, ["dns", "records", "list", "z1"])).toEqual({
			stdout: "",
			stderr: `Error: api: the OpenAPI data was not found at "${join(built.dir!, "openapi", "groups", "g-dns.json")}". Run \`crust build\` first, and ship its "openapi" directory with the CLI.`,
			exitCode: 1,
		});
	});

	it("fail a command whose file lacks its operation, as one from another build does", async () => {
		await ship();
		writeFileSync(
			join(built.dir!, "openapi", "groups", "g-dns.json"),
			JSON.stringify({ openapi: "3.1.0", paths: {} }),
		);

		expect(await captureExecute(appOf(chained()), ["dns", "records", "list", "z1"])).toEqual({
			stdout: "",
			stderr:
				'Error: api: the OpenAPI data "groups/g-dns.json" has no operation "listRecords": its "openapi" directory comes from another build. Ship the one `crust build` wrote with this CLI.',
			exitCode: 1,
		});
	});

	it("are one spec.json for every command when the slices would total more than twice the spec", async () => {
		// Every group reaches the one large schema.
		const shared = { $ref: "#/components/schemas/Big" };
		const dense = {
			openapi: "3.1.0",
			paths: Object.fromEntries(
				["a", "b", "c"].map((tag) => [
					`/${tag}`,
					{ get: { operationId: `get-${tag}`, tags: [tag], summary: tag, responses: ok(shared) } },
				]),
			),
			components: { schemas: { Big: { type: "object", description: "x".repeat(1000) } } },
		};
		writeFileSync(specUrl, JSON.stringify(dense));
		const plain = () => defineApi({ spec: specUrl, baseUrl: "https://api.acme.test" });
		const files = await ship(appOf(plain()));

		expect([...files.keys()].sort()).toEqual(["openapi/index.json", "openapi/spec.json"]);
		expect(JSON.parse(files.get("openapi/index.json")!).groups).toEqual(
			["a", "b", "c"].map((name) => expect.objectContaining({ name, file: "spec.json" })),
		);
		expect(await captureExecute(appOf(plain()), ["b", "get-b"])).toMatchObject({
			stdout: "[]",
			exitCode: 0,
		});
	});

	it("compare the bytes they write, not characters, against twice the spec", async () => {
		// Each slice holds the shared non-ASCII description: fewer than twice the spec's characters, more than twice its bytes.
		const wide = {
			openapi: "3.1.0",
			info: { title: "Acme", version: "1", description: "x".repeat(3500) },
			paths: Object.fromEntries(
				["a", "b", "c"].map((tag) => [
					`/${tag}`,
					{
						get: {
							operationId: `get-${tag}`,
							tags: [tag],
							summary: tag,
							responses: ok({ $ref: "#/components/schemas/Wide" }),
						},
					},
				]),
			),
			components: { schemas: { Wide: { type: "string", description: "漢".repeat(3000) } } },
		};
		writeFileSync(specUrl, JSON.stringify(wide));
		const { files } = await runBuildHooks(
			appOf(defineApi({ spec: specUrl, baseUrl: "https://api.acme.test" })),
		);

		expect([...files.keys()].sort()).toEqual(["openapi/index.json", "openapi/spec.json"]);
	});

	it("name a long group's file within file system limits", async () => {
		const long = "a".repeat(300);
		const named = () =>
			defineApi({ spec: specUrl, baseUrl: "https://api.acme.test" }).override({
				listUsers: { group: long },
				getUser: { group: `${long}b` },
			});
		const files = await ship(appOf(named()));
		const groupFiles = [...files.keys()].filter((path) => path.includes("/groups/"));

		expect(groupFiles.every((path) => path.split("/").at(-1)!.length <= 100)).toBe(true);
		expect(new Set(groupFiles).size).toBe(4);
		expect(await captureExecute(appOf(named()), [long, "list-users"])).toMatchObject({
			exitCode: 0,
		});
		expect(await captureExecute(appOf(named()), [`${long}b`, "get-user", "1"])).toMatchObject({
			exitCode: 0,
		});
	});

	it("name group files so no Windows device name or names that differ only in case collide", async () => {
		const named = () =>
			defineApi({ spec: specUrl, baseUrl: "https://api.acme.test" }).override({
				listUsers: { group: "users" },
				getUser: { group: "Users" },
				getZone: { group: "con" },
			});
		const files = await ship(appOf(named()));
		const app = appOf(named());

		expect([...files.keys()].filter((path) => path.includes("/groups/")).sort()).toEqual([
			"openapi/groups/g-con.json",
			"openapi/groups/g-dns.json",
			"openapi/groups/g-users.2.json",
			"openapi/groups/g-users.json",
		]);
		expect(JSON.parse(files.get("openapi/index.json")!).groups).toContainEqual(
			expect.objectContaining({ name: "Users", file: "groups/g-users.json" }),
		);
		expect(await captureExecute(app, ["users", "list-users"])).toMatchObject({ exitCode: 0 });
		expect(await captureExecute(app, ["Users", "get-user", "1"])).toMatchObject({ exitCode: 0 });
	});

	it("are written for the commands in the app, or only spec.json for an app without them", async () => {
		const acme = defineApi({ spec: specUrl, baseUrl: "https://api.acme.test" });
		const nested = new Crust("acme")
			.extend(acme.extension)
			.add(defineCommand("cloud", (command) => command.add(...acme.commands)));

		expect([
			...(await runBuildHooks(new Crust("acme").extend(acme.extension))).files.keys(),
		]).toEqual(["openapi/spec.json"]);
		expect((await runBuildHooks(nested)).files.has("openapi/index.json")).toBe(true);
	});

	it("fail the build when the app's generated commands are not the handle's", async () => {
		const acme = defineApi({ spec: specUrl, baseUrl: "https://api.acme.test" });
		const renamed = acme.override({ listUsers: { name: "all" } });

		expect(
			await runBuildHooks(new Crust("acme").extend(acme.extension).add(...renamed.commands)),
		).toEqual({
			files: new Map(),
			error:
				'Extension "crust:openapi" build failed: defineApi: the app\'s generated commands are not this handle\'s: missing or different "users list-users"; take `extension` and `commands` from the same handle, and add `commands` whole (`exclude` an operation to leave it out)',
		});
		// Only the root command `status`.
		expect(
			(await runBuildHooks(new Crust("acme").extend(acme.extension).add(acme.commands[0]!))).error,
		).toContain('missing or different "users list-users", "users create-user"');
		// The description and the hidden state are in the index too.
		const described = acme.override({ listUsers: { description: "Changed" } });
		expect(
			(await runBuildHooks(new Crust("acme").extend(acme.extension).add(...described.commands)))
				.error,
		).toContain('missing or different "users list-users";');
		const hidden = acme.override({ getUser: { hidden: true } });
		expect(
			(await runBuildHooks(new Crust("acme").extend(acme.extension).add(...hidden.commands))).error,
		).toContain('missing or different "users get-user";');
	});

	it("fail the build when the app holds another handle's commands and none of this one's", async () => {
		writeFileSync(
			specUrl,
			JSON.stringify({
				openapi: "3.1.0",
				paths: { "/x": { get: { operationId: "getX", summary: "X", responses: ok() } } },
			}),
		);
		const acme = defineApi({ spec: specUrl, baseUrl: "https://api.acme.test" });
		const renamed = acme.override({ getX: { name: "changed" } });

		expect(
			(await runBuildHooks(new Crust("acme").extend(acme.extension).add(...renamed.commands)))
				.error,
		).toBe(
			'Extension "crust:openapi" build failed: defineApi: the app\'s generated commands are those of another handle of this API; take `extension` and `commands` from the same handle, and add `commands` whole (`exclude` an operation to leave it out)',
		);
		// Its own app builds.
		expect(
			(await runBuildHooks(new Crust("acme").extend(renamed.extension).add(...renamed.commands)))
				.error,
		).toBeUndefined();
	});

	it("fail the build and a source run when the app holds another handle's commands and this one generates none", async () => {
		const acme = defineApi({ spec: specUrl, baseUrl: "https://api.acme.test" });
		const none = acme.each(() => ({ exclude: true }));
		const mixed = new Crust("acme").extend(none.extension).add(...acme.commands);

		expect((await runBuildHooks(mixed)).error).toBe(
			'Extension "crust:openapi" build failed: defineApi: the app\'s generated commands are those of another handle of this API; take `extension` and `commands` from the same handle, and add `commands` whole (`exclude` an operation to leave it out)',
		);
		expect(await captureExecute(mixed, ["users", "list-users"])).toMatchObject({ exitCode: 1 });
		// Its own app, without generated commands, builds.
		expect(
			(await runBuildHooks(new Crust("acme").extend(none.extension).add(...none.commands))).error,
		).toBeUndefined();
	});

	it("fail a source run whose app holds generated commands of another chain of the API", async () => {
		const acme = defineApi({ spec: specUrl, baseUrl: "https://api.acme.test" });
		const renamed = acme.override({ listUsers: { name: "all" } });
		const mixed = new Crust("acme").extend(acme.extension).add(...renamed.commands);

		expect(await captureExecute(mixed, ["users", "all"])).toEqual({
			stdout: "",
			stderr:
				"Error: defineApi: the app holds generated commands of another chain of this API; take `extension` and `commands` from the same handle, and add `commands` whole (`exclude` an operation to leave it out)",
			exitCode: 1,
		});
		// Two apps, each with one handle's Extension and commands, are fine.
		const first = new Crust("acme").extend(acme.extension).add(...acme.commands);
		const second = new Crust("acme").extend(renamed.extension).add(...renamed.commands);
		expect(await captureExecute(first, ["users", "list-users"])).toMatchObject({ exitCode: 0 });
		expect(await captureExecute(second, ["users", "all"])).toMatchObject({ exitCode: 0 });
	});

	it("let two handles that share added commands each run and build with its own", async () => {
		const a = defineApi({ spec: specUrl, baseUrl: "https://api.acme.test" }).add("", hello);
		const b = a.override({ listUsers: { name: "other" } });
		const first = new Crust("acme").extend(a.extension).add(...a.commands);
		const second = new Crust("acme").extend(b.extension).add(...b.commands);

		expect(await captureExecute(first, ["hello"])).toMatchObject({ exitCode: 0 });
		expect(await captureExecute(second, ["hello"])).toMatchObject({ exitCode: 0 });
		expect((await runBuildHooks(first)).error).toBeUndefined();
		expect((await runBuildHooks(second)).error).toBeUndefined();
		// Paired wrongly, the generated commands still give it away.
		const mixed = new Crust("acme").extend(a.extension).add(...b.commands);
		expect(await captureExecute(mixed, ["hello"])).toMatchObject({ exitCode: 1 });
	});

	it.each([
		["not an index", JSON.stringify({ commands: [] }), "is not an index"],
		[
			"an index of another layout",
			JSON.stringify({ version: 2, commands: [], groups: [] }),
			"is not an index",
		],
		[
			"a group without operations",
			JSON.stringify({ version: 1, commands: [], groups: [{ name: "x" }] }),
			"is not an index",
		],
		["not JSON", "{", "cannot read the OpenAPI document"],
	])(
		"fail every invocation of a built CLI whose index is %s, naming it",
		async (_, text, problem) => {
			built.dir = join(root, "corrupt");
			mkdirSync(join(built.dir, "openapi"), { recursive: true });
			writeFileSync(join(built.dir, "openapi", "index.json"), text);
			const acme = chained();
			const app = appOf(acme);

			for (const argv of [["--help"], ["users", "list-users"]]) {
				const { stdout, stderr, exitCode } = await captureExecute(app, argv);
				expect({ stdout, exitCode }).toEqual({ stdout: "", exitCode: 1 });
				expect(stderr).toContain(problem);
				expect(stderr).toContain(join(built.dir, "openapi", "index.json"));
			}
		},
	);

	it("fail every invocation of a built CLI without its index with why, and no stack", async () => {
		built.dir = join(root, "not-built");
		const missing = `Error: api: the OpenAPI data was not found at "${join(built.dir, "openapi", "index.json")}". Run \`crust build\` first, and ship its "openapi" directory with the CLI.`;
		const acme = chained();
		const app = new Crust("acme")
			.extend(help(), acme.extension, didYouMean())
			.add(...acme.commands);

		for (const argv of [["--help"], ["ping"], ["users", "list-users"], ["--nope"]]) {
			expect(await captureExecute(app, argv)).toEqual({ stdout: "", stderr: missing, exitCode: 1 });
		}
		// An Extension extended before claims a failure first: `didYouMean()` reports the unknown command.
		const late = chained();
		const suggested = await captureExecute(
			new Crust("acme").extend(didYouMean(), late.extension).add(...late.commands),
			["users", "list-users"],
		);
		expect(suggested.exitCode).toBe(1);
		expect(suggested.stderr).not.toContain("api:");
	});
});
