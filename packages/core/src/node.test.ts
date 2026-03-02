import { describe, expect, it } from "bun:test";
import { computeEffectiveFlags, createCommandNode } from "./node.ts";
import type { CommandMeta, FlagsDef } from "./types.ts";

// ────────────────────────────────────────────────────────────────────────────
// createCommandNode
// ────────────────────────────────────────────────────────────────────────────

describe("createCommandNode", () => {
	it("creates a node from a string name", () => {
		const node = createCommandNode("serve");

		expect(node.meta).toEqual({ name: "serve" });
		expect(node.localFlags).toEqual({});
		expect(node.effectiveFlags).toEqual({});
		expect(node.args).toBeUndefined();
		expect(node.subCommands).toEqual({});
		expect(node.plugins).toEqual([]);
		expect(node.preRun).toBeUndefined();
		expect(node.run).toBeUndefined();
		expect(node.postRun).toBeUndefined();
	});

	it("creates a node from a CommandMeta object", () => {
		const meta: CommandMeta = {
			name: "deploy",
			description: "Deploy the application",
			usage: "deploy [options]",
		};
		const node = createCommandNode(meta);

		expect(node.meta).toEqual({
			name: "deploy",
			description: "Deploy the application",
			usage: "deploy [options]",
		});
		expect(node.localFlags).toEqual({});
		expect(node.effectiveFlags).toEqual({});
		expect(node.args).toBeUndefined();
		expect(node.subCommands).toEqual({});
		expect(node.plugins).toEqual([]);
	});

	it("copies CommandMeta so mutations don't affect the node", () => {
		const meta: CommandMeta = { name: "test", description: "original" };
		const node = createCommandNode(meta);

		meta.description = "mutated";
		expect(node.meta.description).toBe("original");
	});

	it("creates independent nodes with separate references", () => {
		const node1 = createCommandNode("a");
		const node2 = createCommandNode("b");

		node1.localFlags.verbose = { type: "boolean" };
		expect(node2.localFlags).toEqual({});
	});
});

// ────────────────────────────────────────────────────────────────────────────
// computeEffectiveFlags
// ────────────────────────────────────────────────────────────────────────────

describe("computeEffectiveFlags", () => {
	it("merges inherited (inherit: true) flags with local flags", () => {
		const inherited: FlagsDef = {
			verbose: { type: "boolean", inherit: true },
			port: { type: "number" },
		};
		const local: FlagsDef = {
			output: { type: "string" },
		};

		const result = computeEffectiveFlags(inherited, local);

		expect(result).toEqual({
			verbose: { type: "boolean", inherit: true },
			output: { type: "string" },
		});
	});

	it("filters out non-inherit flags from parent", () => {
		const inherited: FlagsDef = {
			verbose: { type: "boolean", inherit: true },
			port: { type: "number" },
			host: { type: "string" },
		};
		const local: FlagsDef = {};

		const result = computeEffectiveFlags(inherited, local);

		expect(result).toEqual({
			verbose: { type: "boolean", inherit: true },
		});
		expect(result).not.toHaveProperty("port");
		expect(result).not.toHaveProperty("host");
	});

	it("local flags override inherited flags with the same key", () => {
		const inherited: FlagsDef = {
			output: { type: "boolean", inherit: true },
		};
		const local: FlagsDef = {
			output: { type: "string", description: "Output path" },
		};

		const result = computeEffectiveFlags(inherited, local);

		expect(result).toEqual({
			output: { type: "string", description: "Output path" },
		});
	});

	it("returns empty object when both inherited and local are empty", () => {
		const result = computeEffectiveFlags({}, {});
		expect(result).toEqual({});
	});

	it("returns only local flags when inherited is empty", () => {
		const local: FlagsDef = {
			verbose: { type: "boolean" },
			port: { type: "number", default: 3000 },
		};

		const result = computeEffectiveFlags({}, local);

		expect(result).toEqual({
			verbose: { type: "boolean" },
			port: { type: "number", default: 3000 },
		});
	});

	it("returns only inheritable flags when local is empty", () => {
		const inherited: FlagsDef = {
			verbose: { type: "boolean", inherit: true },
			debug: { type: "boolean", inherit: true },
			port: { type: "number" },
		};

		const result = computeEffectiveFlags(inherited, {});

		expect(result).toEqual({
			verbose: { type: "boolean", inherit: true },
			debug: { type: "boolean", inherit: true },
		});
	});

	it("preserves all flag properties during merge", () => {
		const inherited: FlagsDef = {
			verbose: {
				type: "boolean",
				inherit: true,
				alias: "v",
				description: "Enable verbose logging",
			},
		};
		const local: FlagsDef = {
			output: {
				type: "string",
				alias: "o",
				required: true,
				description: "Output file",
			},
		};

		const result = computeEffectiveFlags(inherited, local);

		expect(result.verbose).toEqual({
			type: "boolean",
			inherit: true,
			alias: "v",
			description: "Enable verbose logging",
		});
		expect(result.output).toEqual({
			type: "string",
			alias: "o",
			required: true,
			description: "Output file",
		});
	});

	it("handles multiple-value inherited flags", () => {
		const inherited: FlagsDef = {
			tags: { type: "string", multiple: true, inherit: true },
		};
		const local: FlagsDef = {};

		const result = computeEffectiveFlags(inherited, local);

		expect(result).toEqual({
			tags: { type: "string", multiple: true, inherit: true },
		});
	});
});
