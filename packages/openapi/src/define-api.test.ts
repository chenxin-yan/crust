import { type CommandSnapshot, Crust, defineCommand, defineContext } from "@crustjs/core";
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

	it("fails for a document no command can come from", async () => {
		const acme = defineApi({
			spec: { swagger: "2.0", paths: {} },
			baseUrl: "https://api.example.com",
		});

		expect((await build(acme)).error).toContain(
			"Only OpenAPI 3.0 and 3.1 documents are supported; this one is",
		);
	});
});
