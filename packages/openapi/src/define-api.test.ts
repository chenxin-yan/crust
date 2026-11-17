import { defineCommand, defineContext } from "@crustjs/core";
import { describe, expect, it, vi } from "vite-plus/test";

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

const commandPaths = (handle: { manifest(): { commands: readonly { command: string }[] } }) =>
	handle.manifest().commands.map(({ command }) => command);

describe("defineApi() chain", () => {
	it("returns a new frozen handle from every method, leaving the previous one unchanged", () => {
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
		expect(commandPaths(base)).toEqual(["users get-user"]);
	});

	it("replaces .each(), appends .override() per top-level field, and defaults exclude to deprecated", () => {
		const base = defineApi({ spec, baseUrl: "https://api.example.com" });
		const each = vi.fn(() => ({ name: "rule" }));

		const replaced = base.each(() => ({ group: "people" })).each(each);
		const overridden = replaced
			.override({ getUser: { name: "show", group: "accounts" } })
			.override({ getUser: { group: undefined }, deleteUser: { exclude: false } });

		expect(commandPaths(replaced)).toEqual(["users rule"]);
		// The second entry's `group: undefined` drops the first's, so the default applies again.
		expect(commandPaths(overridden)).toEqual(["users rule", "users show"]);
		expect(each).toHaveBeenCalled();
	});
});
