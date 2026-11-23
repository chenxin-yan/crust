import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { type CommandSnapshot, Crust, defineCommand, defineContext } from "@crustjs/core";
import { confirm } from "@crustjs/extensions";
import { captureExecute } from "@crustjs/testing";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { runBuildHooks } from "../../crust/tests/build-hooks.ts";
import { bearerAuth } from "./bearer-auth.ts";
import { defineApi } from "./define-api.ts";

const spec = {
	openapi: "3.1.0",
	paths: {
		"/users/{id}": {
			parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
			get: {
				operationId: "getUser",
				tags: ["Users"],
				summary: "Get a user",
				responses: { "200": { description: "OK" } },
			},
			delete: {
				operationId: "deleteUser",
				tags: ["Users"],
				summary: "Delete a user",
				deprecated: true,
				responses: { "204": { description: "Deleted" } },
			},
		},
	},
};

/** The paths of the generated commands, sorted, from the app's snapshot. */
async function commandPaths(handle: Pick<ReturnType<typeof defineApi>, "extension" | "commands">) {
	const app = new Crust("acme").extend(handle.extension).add(...handle.commands);
	const paths: string[] = [];
	const walk = (node: CommandSnapshot, prefix: string) => {
		for (const [name, child] of Object.entries(node.subCommands)) {
			if (child.extension !== undefined) continue;
			const path = prefix === "" ? name : `${prefix} ${name}`;
			if (child.hasAction) paths.push(path);
			walk(child, path);
		}
	};
	walk(await app.snapshot(), "");
	return paths.sort();
}

describe("defineApi() chain", () => {
	it("returns a new frozen handle from every method, leaving the previous one unchanged", async () => {
		const base = defineApi({ spec, baseUrl: "https://api.example.com" });
		const account = defineContext("account").setup(() => "acc");
		const next = [
			base.use(account),
			base.auth(() => undefined),
			base.onConfirm(() => {}),
			base.each(() => undefined),
			base.override({}),
			base.add(
				"users",
				defineCommand("purge", (command) => command.action(() => {})),
			),
		];

		for (const handle of [base, ...next]) expect(Object.isFrozen(handle)).toBe(true);
		expect(new Set([base, ...next]).size).toBe(next.length + 1);
		expect(await commandPaths(base)).toEqual(["users get-user"]);
	});

	it("replaces .each(), appends .override() per top-level field, and defaults exclude to deprecated", async () => {
		const base = defineApi({ spec, baseUrl: "https://api.example.com" });
		const each = vi.fn(() => ({ name: "rule" }));

		const replaced = base.each(() => ({ group: "people" })).each(each);
		const overridden = replaced
			.override({ getUser: { name: "show", group: "accounts" } })
			.override({ getUser: { group: undefined }, deleteUser: { exclude: false } });

		expect(await commandPaths(replaced)).toEqual(["users rule"]);
		// The second entry's `group: undefined` drops the first's, so the default applies again.
		expect(await commandPaths(overridden)).toEqual(["users rule", "users show"]);
		expect(each).toHaveBeenCalled();
	});
});

describe("defineApi() options", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it.each(["api.example.com/v1", "localhost:8080", "ftp://example.com"])(
		"rejects the baseUrl %j, which is not http(s), naming the option and the value",
		(baseUrl) => {
			expect(() => defineApi({ spec, baseUrl })).toThrow(
				`defineApi: \`baseUrl\` must be an http: or https: URL, such as "https://api.example.com/v1"; got ${JSON.stringify(baseUrl)}`,
			);
		},
	);

	it("sends every request, a redirect's and a 401's replay too, through its own fetch", async () => {
		vi.stubGlobal("fetch", () => {
			throw new Error("the global fetch was called");
		});
		const sent: string[] = [];
		const fetch = async (url: URL, init: RequestInit) => {
			const authorization = new Headers(init.headers).get("authorization");
			sent.push(`${url.pathname} ${authorization} ${init.redirect}`);
			if (url.pathname === "/old/1") {
				return new Response(null, { status: 301, headers: { location: "/users/1" } });
			}
			return authorization === "Bearer new"
				? Response.json({ id: "1" })
				: new Response(null, { status: 401 });
		};
		const acme = defineApi({ spec, baseUrl: "https://api.example.com", fetch }).auth(() => ({
			headers: { authorization: "Bearer old" },
			retry: async () => ({ headers: { authorization: "Bearer new" } }),
		}));

		const { stdout, exitCode } = await captureExecute(new Crust("acme").extend(acme.extension), [
			"api",
			"/old/1",
		]);

		expect({ stdout, exitCode }).toEqual({ stdout: '{"id":"1"}', exitCode: 0 });
		expect(sent).toEqual([
			"/old/1 Bearer old manual",
			"/users/1 Bearer old manual",
			"/users/1 Bearer new manual",
		]);
	});
});

describe("crust build checks the handle", () => {
	const build = (handle: Pick<ReturnType<typeof defineApi>, "extension" | "commands">) =>
		runBuildHooks(new Crust("acme").extend(handle.extension).add(...handle.commands));
	const clash = {
		openapi: "3.1.0",
		paths: {
			"/a": {
				get: {
					operationId: "listUsers",
					tags: ["users"],
					summary: "A",
					responses: { "200": { description: "OK" } },
				},
			},
			"/b": {
				get: {
					operationId: "users-list-users",
					tags: ["users"],
					summary: "B",
					responses: { "200": { description: "OK" } },
				},
			},
			"/upload": {
				post: {
					operationId: "upload",
					summary: "Upload",
					requestBody: {
						required: true,
						content: { "multipart/form-data": { schema: { type: "object" } } },
					},
					responses: { "201": { description: "Created" } },
				},
			},
		},
	};

	it("fails for a problem configuration must settle, naming it with its fix", async () => {
		const acme = defineApi({ spec: clash, baseUrl: "https://api.example.com" });

		expect((await build(acme)).error).toBe(
			[
				'Extension "crust:openapi" build failed: defineApi: 1 problem needs a decision before this CLI can be built.',
				"",
				'  GET /b: the command "users list-users" is also the command of GET /a (listUsers)',
				"    fix: Set `group` or `name` in the override of one of them",
			].join("\n"),
		);
	});

	it("passes once an override settles it, and for an operation it skips", async () => {
		const settled = defineApi({ spec: clash, baseUrl: "https://api.example.com" }).override({
			"users-list-users": { name: "list-b" },
		});

		expect(await build(settled)).toEqual({ files: new Map() });
	});

	it("checks nothing for an app that never takes the commands, also with its own command at a generated path", async () => {
		const spec = {
			openapi: "3.1.0",
			paths: {
				"/health": {
					get: {
						operationId: "health",
						summary: "Health",
						responses: { "200": { description: "OK" } },
					},
				},
				"/delete": {
					delete: {
						operationId: "deleteAccount",
						summary: "Delete",
						responses: { "204": { description: "Deleted" } },
					},
				},
			},
		};
		const acme = defineApi({ spec, baseUrl: "https://api.example.com" }).override({
			deleteAccount: { confirm: "Delete?" },
		});
		const health = defineCommand("health", (command) => command.action(() => {}));

		expect(await runBuildHooks(new Crust("acme").extend(acme.extension).add(health))).toEqual({
			files: new Map(),
		});
		// Below a parent of the app's, the commands are checked.
		const nested = new Crust("acme")
			.extend(acme.extension)
			.add(health)
			.add(defineCommand("remote", (command) => command.add(...acme.commands)));
		expect((await runBuildHooks(nested)).error).toContain(
			"DELETE /delete: the override sets `confirm`, but the handle has no `.onConfirm()` handler",
		);
	});

	it("lets nothing of a skipped operation fail the build, not even its input names", async () => {
		const names = ["notificationUrl", "notification_url"].map((name) => ({
			name,
			in: "query",
			schema: { type: "string" },
		}));
		const upload = (extra: Record<string, unknown> = {}) => ({
			openapi: "3.1.0",
			paths: {
				"/upload": {
					post: {
						operationId: "upload",
						summary: "Upload",
						parameters: names,
						requestBody: {
							required: true,
							content: { "multipart/form-data": { schema: { type: "object" } } },
						},
						responses: { "200": { description: "OK" } },
					},
				},
				...extra,
			},
		});
		const skipped = defineApi({ spec: upload(), baseUrl: "https://api.example.com" }).override({
			upload: { confirm: "Sure?", expect: { method: "PUT", path: "/upload" } },
		});
		const app = new Crust("acme").extend(skipped.extension).add(...skipped.commands);
		const generatable = defineApi({
			spec: upload({
				"/notify": {
					get: {
						operationId: "notify",
						summary: "Notify",
						parameters: names,
						responses: { "200": { description: "OK" } },
					},
				},
			}),
			baseUrl: "https://api.example.com",
		});

		expect(await runBuildHooks(app)).toEqual({ files: new Map() });
		expect(Object.keys((await app.snapshot()).subCommands)).toEqual(["api"]);
		expect((await captureExecute(app, ["api", "--list"])).stdout).toBe(
			"POST /upload upload Upload [unavailable: unsupported-body-type]\n",
		);
		expect((await build(generatable)).error).toBe(
			[
				'Extension "crust:openapi" build failed: defineApi: 1 problem needs a decision before this CLI can be built.',
				"",
				'  GET /notify: query parameter "notificationUrl" and query parameter "notification_url" share the input name "notification-url"',
				"    fix: Set `flagName` for one of them in the operation's override",
			].join("\n"),
		);
	});

	const swagger = { swagger: "2.0", paths: { "/users": { get: { operationId: "listUsers" } } } };

	it("checks nothing for an app that holds none of the handle's generated commands, as for `api` alone", async () => {
		const file = join(mkdtempSync(join(tmpdir(), "crust-openapi-api-only-")), "acme.openapi.json");
		writeFileSync(file, JSON.stringify(clash));
		const apiOnly = (handle: Pick<ReturnType<typeof defineApi>, "extension">) =>
			runBuildHooks(new Crust("acme").extend(handle.extension));
		const unhandled = defineApi({ spec: clash, baseUrl: "https://api.example.com" }).override({
			"users-list-users": { name: "list-b" },
			listUsers: { confirm: "Sure?" },
		});

		expect(
			await apiOnly(defineApi({ spec: pathToFileURL(file), baseUrl: "https://api.example.com" })),
		).toEqual({ files: new Map([["openapi/spec.json", JSON.stringify(clash)]]) });
		expect(await apiOnly(defineApi({ spec: swagger, baseUrl: "https://api.example.com" }))).toEqual(
			{ files: new Map() },
		);
		expect(await apiOnly(unhandled)).toEqual({ files: new Map() });
		// The same handles fail once the app holds their commands.
		expect((await build(unhandled)).error).toContain("GET /a: the override sets `confirm`");
	});

	it("fails for an override's paginate on a result that is not a list", async () => {
		const acme = defineApi({ spec: clash, baseUrl: "https://api.example.com" }).override({
			"users-list-users": { name: "list-b" },
			listUsers: { paginate: () => undefined },
		});

		expect((await build(acme)).error).toContain(
			"GET /a: the override sets `paginate`, but its result after `unwrap` is not a list",
		);
	});

	it("fails for a document no command can come from", async () => {
		const acme = defineApi({ spec: swagger, baseUrl: "https://api.example.com" });

		expect((await build(acme)).error).toContain(
			"Only OpenAPI 3.0 and 3.1 documents are supported; this one is",
		);
	});
});

describe(".auth() reads the Contexts .use()d before it", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	const authSpec = {
		openapi: "3.1.0",
		paths: {
			"/zones": {
				get: {
					operationId: "listZones",
					tags: ["Zones"],
					responses: { "200": { description: "OK" } },
				},
				delete: {
					operationId: "deleteZones",
					tags: ["Zones"],
					responses: { "204": { description: "Deleted" } },
				},
			},
			"/status": {
				get: {
					operationId: "getStatus",
					security: [],
					responses: { "200": { description: "OK" } },
				},
			},
		},
	};
	const baseUrl = "https://api.example.com";

	/** The `authorization` header of each request sent. */
	function stubFetch() {
		const sent: (string | null)[] = [];
		vi.stubGlobal("fetch", async (_url: URL, init: RequestInit) => {
			sent.push(new Headers(init.headers).get("authorization"));
			return init.method === "DELETE" ? new Response(null, { status: 204 }) : Response.json({});
		});
		return sent;
	}

	/** The `--profile` flag's Context, which `auth` reads; `setup` counts its set-ups. */
	function profileContext() {
		const setup = vi.fn(({ flags }: { flags: { profile?: string } }) => flags.profile);
		const profile = defineContext("profile")
			.flags({ profile: { type: "string", description: "Account to use" } })
			.setup(setup);
		return { profile, setup };
	}

	/**
	 * The documented app: `auth` reads `--profile`; `confirm` comes after `.auth()`, for
	 * `.onConfirm()` only; an app command that uses the client is added to a generated group, and
	 * another uses it at the root.
	 */
	function profileApp() {
		const sent = stubFetch();
		const { profile, setup } = profileContext();
		const resolve = vi.fn(async ({ ctx }: { ctx: { profile: Promise<string | undefined> } }) => ({
			value: `token-${(await ctx.profile) ?? "default"}`,
		}));
		const api = defineApi({ spec: authSpec, baseUrl }).use(profile).auth(bearerAuth(resolve));
		const whoami = defineCommand("whoami", (command) =>
			command.use(api.client).action(async ({ ctx }) => {
				const client = await ctx.api;
				await client.call("listZones");
				await client.fetch("/zones");
			}),
		);
		const acme = api
			.use(confirm)
			.onConfirm(async (ctx, message) => (await ctx.confirm)(message))
			.override({ deleteZones: { confirm: "Delete every zone?" } })
			.add("zones", whoami);
		const app = new Crust("acme")
			.provide(profile())
			.extend(confirm(), acme.extension)
			.add(...acme.commands)
			.add(
				defineCommand("me", (command) =>
					command.use(acme.client).action(async ({ ctx }) => void (await ctx.api).fetch("/me")),
				),
				defineCommand("base", (command) =>
					command.use(acme.client).action(async ({ ctx }) => void (await ctx.api).baseUrl),
				),
				defineCommand("hello", (command) => command.action(() => {})),
			);
		return { app, sent, setup, resolve };
	}

	it("reaches auth from --profile for api <path>, a generated command and the client of app commands, once per invocation", async () => {
		const { app, sent, resolve } = profileApp();

		for (const argv of [
			["api", "/zones", "--profile", "work"],
			["zones", "list-zones", "--profile", "home"],
			["zones", "whoami", "--profile", "ci"],
			["me", "--profile", "dev"],
			["zones", "list-zones"],
		]) {
			expect((await captureExecute(app, argv)).exitCode, argv.join(" ")).toBe(0);
		}

		expect(sent).toEqual([
			"Bearer token-work",
			"Bearer token-home",
			"Bearer token-ci",
			"Bearer token-ci",
			"Bearer token-dev",
			"Bearer token-default",
		]);
		expect(resolve).toHaveBeenCalledTimes(5);
	});

	it("never calls auth, nor sets up its Contexts, for a public operation, api preview, or a command that only reads the client", async () => {
		const { app, sent, setup, resolve } = profileApp();

		expect((await captureExecute(app, ["get-status", "--profile", "work"])).exitCode).toBe(0);
		const preview = await captureExecute(app, [
			"api",
			"preview",
			"zones",
			"list-zones",
			"--",
			"--profile",
			"work",
		]);
		expect(preview.exitCode).toBe(0);
		expect(JSON.parse(preview.stdout)).toMatchObject({ method: "GET", url: `${baseUrl}/zones` });
		expect((await captureExecute(app, ["base", "--profile", "work"])).exitCode).toBe(0);

		expect(sent).toEqual([null]);
		expect(resolve).not.toHaveBeenCalled();
		expect(setup).not.toHaveBeenCalled();
	});

	it("previews each invocation's own request, also when runs share the caller's signal", async () => {
		const { app } = profileApp();
		const { signal } = new AbortController();
		const preview = async (target: [string, ...string[]]) => {
			const outcome = await app.run(["api", "preview"], { args: { target } }, { signal });
			return outcome.status === "completed" && outcome.result.url;
		};

		expect(await preview(["zones", "list-zones"])).toBe(`${baseUrl}/zones`);
		expect(await preview(["/status"])).toBe(`${baseUrl}/status`);
		expect(await Promise.all([preview(["zones", "list-zones"]), preview(["get-status"])])).toEqual([
			`${baseUrl}/zones`,
			`${baseUrl}/status`,
		]);
	});

	it("puts the flags of the Contexts auth reads on the commands that use the client, and those .use()d after it on the generated commands only", async () => {
		const { app } = profileApp();
		const flagsOf = async (...path: string[]) =>
			Object.keys(path.reduce((node, name) => node.subCommands[name]!, await app.snapshot()).flags);

		expect(await flagsOf("zones", "delete-zones")).toEqual(
			expect.arrayContaining(["profile", "yes"]),
		);
		expect(await flagsOf("api")).toContain("profile");
		expect(await flagsOf("zones", "whoami")).toContain("profile");
		expect(await flagsOf("me")).toContain("profile");
		for (const path of [["api"], ["zones", "whoami"], ["me"]]) {
			expect(await flagsOf(...path), path.join(" ")).not.toContain("yes");
		}
		for (const path of [["hello"], ["api", "preview"]]) {
			expect(await flagsOf(...path), path.join(" ")).not.toContain("profile");
		}
		expect((await captureExecute(app, ["hello", "--profile", "work"])).stderr).toContain(
			'Unknown flag "--profile"',
		);
	});

	it("replaces a previous .auth(), and sends no credentials without one", async () => {
		const sent = stubFetch();
		const plain = defineApi({ spec: authSpec, baseUrl });
		const first = vi.fn(() => ({ authorization: "first" }));
		const replaced = plain.auth(first).auth(() => ({ authorization: "second" }));
		for (const handle of [plain, replaced]) {
			const app = new Crust("acme").extend(handle.extension).add(...handle.commands);
			expect((await captureExecute(app, ["zones", "list-zones"])).exitCode).toBe(0);
		}

		expect(sent).toEqual([null, "second"]);
		expect(first).not.toHaveBeenCalled();
	});

	it("fails to run a command that uses the client of a handle before .auth() in an app that extends one after it", async () => {
		stubFetch();
		const { profile } = profileContext();
		const api = defineApi({ spec: authSpec, baseUrl });
		const me = defineCommand("me", (command) =>
			command.use(api.client).action(async ({ ctx }) => void (await ctx.api).fetch("/me")),
		);
		const acme = api
			.use(profile)
			.auth(async ({ ctx }) => ({ authorization: `${await ctx.profile}` }))
			.add("zones", me);
		const app = new Crust("acme")
			.provide(profile())
			.extend(acme.extension)
			// @ts-expect-error -- FIX_DEPENDENCY_TYPE: `me`'s client is not the extended handle's; this checks the run-time check behind it.
			.add(...acme.commands);

		const outcome = await app.run(["zones", "me"]);
		expect(outcome.status === "failed" && outcome.error).toMatchObject({
			code: "DEFINITION",
			message: expect.stringContaining(
				'Context "profile", used by a replacement provider on command "me", owns flag "profile"',
			),
		});
	});

	it("fails to run an app that does not provide a Context auth reads", async () => {
		const profile = defineContext("profile").setup(() => "work");
		const acme = defineApi({ spec: authSpec, baseUrl })
			.use(profile)
			.auth(async ({ ctx }) => ({ authorization: `Bearer ${await ctx.profile}` }));
		const app = new Crust("acme")
			// @ts-expect-error -- FIX_MISSING_DEPENDENCY: `profile`; this checks the run-time check behind it.
			.extend(acme.extension)
			// @ts-expect-error -- FIX_MISSING_DEPENDENCY: `profile`, for the generated commands too.
			.add(...acme.commands);

		const outcome = await app.run(["zones", "list-zones"]);
		expect(outcome.status === "failed" && outcome.error).toMatchObject({
			message: 'No provider for Context "profile"',
		});
	});
});
