import { describe, expect, it } from "bun:test";

import { defineContext } from "../api/context.ts";
import { defineFlag } from "../api/flags.ts";
import { Crust, defineCommand, prepareCommandSnapshot } from "./crust.ts";
import { createCommandNode } from "./node.ts";
import { snapshotCommand } from "./snapshot.ts";

function buildTree() {
	const root = createCommandNode("cli");
	root.meta.description = "root cli";
	root.args = [
		{ name: "file", type: "string", required: true, parse: (s: string) => s.toUpperCase() },
	];
	root.effectiveFlags = {
		verbose: { type: "boolean", short: "v", description: "Verbose output" },
		endpoint: { type: "url", default: new URL("https://example.com/") },
		mirrors: {
			type: "url",
			multiple: true,
			default: [new URL("https://a.example/"), new URL("https://b.example/")],
		},
	};
	root.run = () => {};

	const sub = createCommandNode("build");
	sub.meta.aliases = ["b"];
	sub.meta.hidden = true;
	root.subCommands = { build: sub };
	return root;
}

describe("snapshotCommand", () => {
	it("projects meta, args, flags, and subcommands recursively", () => {
		const snapshot = snapshotCommand(buildTree());

		expect(snapshot.meta.name).toBe("cli");
		expect(snapshot.meta.description).toBe("root cli");
		expect(snapshot.hasHandler).toBe(true);
		expect(snapshot.args).toEqual([{ name: "file", type: "string", required: true }]);
		expect(snapshot.flags.verbose).toEqual({
			type: "boolean",
			short: "v",
			description: "Verbose output",
		});
		expect(snapshot.subCommands.build?.meta.aliases).toEqual(["b"]);
		expect(snapshot.subCommands.build?.meta.hidden).toBe(true);
		expect(snapshot.subCommands.build?.hasHandler).toBe(false);
	});

	it("is serializable: no functions, URL defaults become strings", () => {
		const snapshot = snapshotCommand(buildTree());

		expect(snapshot.flags.endpoint?.default).toBe("https://example.com/");
		expect(snapshot.flags.mirrors?.default).toEqual(["https://a.example/", "https://b.example/"]);
		expect(Object.isFrozen(snapshot.flags.mirrors?.default)).toBe(true);
		// Round-trips through structuredClone (throws on functions)
		const clone = structuredClone(snapshot);
		expect(clone.args[0]?.name).toBe("file");
		expect("parse" in (clone.args[0] as object)).toBe(false);
	});

	it("projects Context-owned flags at the provider and later descendants", async () => {
		const apiKey = defineFlag("api-key", { type: "string", short: "k" });
		const auth = defineContext("auth", { ownFlags: [apiKey] }, () => ({}));
		const app = new Crust("cli")
			.provide(auth())
			.mount(defineCommand("deploy", (command) => command.handle(() => {})));

		const snapshot = await prepareCommandSnapshot(app);
		expect(snapshot.flags["api-key"]).toEqual({
			type: "string",
			short: "k",
			inherit: true,
		});
		expect(snapshot.subCommands.deploy?.flags["api-key"]).toEqual(snapshot.flags["api-key"]);
		expect(Object.isFrozen(snapshot.subCommands.deploy?.flags["api-key"])).toBe(true);
		expect(() => structuredClone(snapshot)).not.toThrow();
	});

	it("is deeply frozen", () => {
		const snapshot = snapshotCommand(buildTree());

		expect(Object.isFrozen(snapshot)).toBe(true);
		expect(Object.isFrozen(snapshot.meta)).toBe(true);
		expect(Object.isFrozen(snapshot.args)).toBe(true);
		expect(Object.isFrozen(snapshot.flags)).toBe(true);
		expect(Object.isFrozen(snapshot.flags.verbose)).toBe(true);
		expect(Object.isFrozen(snapshot.subCommands)).toBe(true);
		expect(Object.isFrozen(snapshot.subCommands.build)).toBe(true);
	});
});
