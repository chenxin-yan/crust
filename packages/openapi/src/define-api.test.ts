import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { type CommandSnapshot, Crust, defineCommand, defineContext } from "@crustjs/core";
import { captureExecute } from "@crustjs/testing";
import { describe, expect, it, vi } from "vite-plus/test";

import { runBuildHooks } from "../../crust/tests/build-hooks.ts";
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
			"POST /upload upload Upload [unavailable: unsupported-body-type]",
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

	it("fails for a document no command can come from", async () => {
		const acme = defineApi({ spec: swagger, baseUrl: "https://api.example.com" });

		expect((await build(acme)).error).toContain(
			"Only OpenAPI 3.0 and 3.1 documents are supported; this one is",
		);
	});
});
