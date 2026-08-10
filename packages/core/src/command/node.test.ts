import { describe, expect, it } from "bun:test";

import { createCommandNode } from "./node.ts";

// ────────────────────────────────────────────────────────────────────────────
// createCommandNode
// ────────────────────────────────────────────────────────────────────────────

describe("createCommandNode", () => {
	it("creates a node from a string name", () => {
		const node = createCommandNode("serve");

		expect(node.meta).toEqual({ name: "serve" });
		expect(node.localFlags).toEqual({});
		expect(node.ownedFlags).toEqual({});
		expect(node.effectiveFlags).toEqual({});
		expect(node.args).toBeUndefined();
		expect(node.subCommands).toEqual({});
		expect(node.extensions).toEqual([]);
		expect(node.run).toBeUndefined();
	});

	it("creates a node with only the name set", () => {
		const node = createCommandNode("deploy");

		expect(node.meta).toEqual({ name: "deploy" });
		expect(node.meta.description).toBeUndefined();
		expect(node.meta.usage).toBeUndefined();
		expect(node.localFlags).toEqual({});
		expect(node.effectiveFlags).toEqual({});
		expect(node.args).toBeUndefined();
		expect(node.subCommands).toEqual({});
		expect(node.extensions).toEqual([]);
	});

	it("creates independent nodes with separate references", () => {
		const node1 = createCommandNode("a");
		const node2 = createCommandNode("b");

		node1.localFlags.verbose = { type: "boolean" };
		expect(node2.localFlags).toEqual({});
	});
});
