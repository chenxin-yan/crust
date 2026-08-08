import { describe, expect, it } from "bun:test";

import { defineContext } from "../api/context.ts";
import { computeEffectiveFlags, createCommandNode } from "../command/node.ts";
import { validateCommandTree } from "./tree.ts";

describe("validateCommandTree", () => {
	it("passes commands with required args and flags", () => {
		const node = createCommandNode("build");
		node.args = [
			{ name: "entry", type: "string", required: true },
			{ name: "count", type: "number", required: true },
		];
		node.localFlags = {
			output: { type: "string", required: true },
			port: { type: "number", required: true },
			verbose: { type: "boolean", required: true },
		};
		node.effectiveFlags = { ...node.localFlags };

		expect(() => validateCommandTree(node)).not.toThrow();
	});

	it("throws with command path when parser-level validation fails", () => {
		const node = createCommandNode("root");
		node.localFlags = {
			verbose: { type: "boolean", short: "v" },
			version: { type: "boolean", short: "v" },
		};
		node.effectiveFlags = { ...node.localFlags };

		expect(() => validateCommandTree(node)).toThrow('Command "root" failed runtime validation');
	});

	it("validates nested subcommands", () => {
		const invalidLeaf = createCommandNode("leaf");
		invalidLeaf.localFlags = {
			out: { type: "string" },
			output: { type: "string", aliases: ["out"] },
		};
		invalidLeaf.effectiveFlags = { ...invalidLeaf.localFlags };

		const generate = createCommandNode("generate");
		generate.subCommands = { leaf: invalidLeaf };

		const root = createCommandNode("root");
		root.subCommands = { generate };

		expect(() => validateCommandTree(root)).toThrow(
			'Command "root generate leaf" failed runtime validation',
		);
	});

	it("throws when a Context dependency is missing from a node's path", () => {
		const config = defineContext("config", () => ({}));
		const client = defineContext("client", { requires: [config] }, () => ({}));

		const node = createCommandNode("root");
		node.contexts = [client()];

		expect(() => validateCommandTree(node)).toThrow(/Context "client" requires Context "config"/);
		expect(() => {
			node.contexts = [config(), client()];
			validateCommandTree(node);
		}).not.toThrow();
	});

	it("throws when Contexts on a node form a dependency cycle", () => {
		const a = defineContext("a", () => "a")();
		const b = defineContext("b", () => "b")();
		(a as { requiredCtx: readonly string[] }).requiredCtx = ["b"];
		(b as { requiredCtx: readonly string[] }).requiredCtx = ["a"];

		const node = createCommandNode("root");
		node.contexts = [a, b];

		expect(() => validateCommandTree(node)).toThrow(/dependency cycle/);
	});
});

// ────────────────────────────────────────────────────────────────────────────
// validateCommandTree — CommandNode tree
// ────────────────────────────────────────────────────────────────────────────

describe("validateCommandTree — CommandNode tree", () => {
	it("passes a valid CommandNode with no flags or args", () => {
		const node = createCommandNode("app");
		expect(() => validateCommandTree(node)).not.toThrow();
	});

	it("passes a valid CommandNode with local flags", () => {
		const node = createCommandNode("app");
		node.localFlags = {
			verbose: { type: "boolean", short: "v" },
			output: { type: "string", short: "o" },
		};
		node.effectiveFlags = { ...node.localFlags };

		expect(() => validateCommandTree(node)).not.toThrow();
	});

	it("passes a valid CommandNode with effective flags (ancestor-owned + local)", () => {
		const ancestorOwnedFlags = {
			verbose: { type: "boolean" as const, short: "v" },
			debug: { type: "boolean" as const },
		};
		const localFlags = {
			output: { type: "string" as const, short: "o" },
		};
		const node = createCommandNode("sub");
		node.localFlags = localFlags;
		node.effectiveFlags = computeEffectiveFlags(ancestorOwnedFlags, localFlags);

		expect(() => validateCommandTree(node)).not.toThrow();
	});

	it("passes a valid CommandNode with required effective flags", () => {
		const ancestorOwnedFlags = {
			token: {
				type: "string" as const,
				required: true as const,
			},
		};
		const localFlags = {
			output: { type: "string" as const },
		};
		const node = createCommandNode("sub");
		node.localFlags = localFlags;
		node.effectiveFlags = computeEffectiveFlags(ancestorOwnedFlags, localFlags);

		// Should pass because createValidationArgv generates --token sample
		expect(() => validateCommandTree(node)).not.toThrow();
	});

	it("passes a valid CommandNode with args", () => {
		const node = createCommandNode("app");
		node.args = [
			{ name: "file", type: "string", required: true },
			{ name: "count", type: "number" },
		];

		expect(() => validateCommandTree(node)).not.toThrow();
	});

	it("detects collisions involving Context-owned flags as a build-validation backstop", () => {
		const node = createCommandNode("sub");
		node.localFlags = { verbose: { type: "boolean", short: "v" } };
		node.ownedFlags = { version: { type: "boolean", short: "v" } };
		node.effectiveFlags = computeEffectiveFlags(node.ownedFlags, node.localFlags);

		expect(() => validateCommandTree(node)).toThrow('Command "sub" failed runtime validation');
		expect(() => validateCommandTree(node)).toThrow("Alias collision");
	});

	it("detects alias collision in effective flags (ancestor-owned alias collides with local)", () => {
		const ancestorOwnedFlags = {
			verbose: { type: "boolean" as const, short: "v" },
		};
		const localFlags = {
			version: { type: "boolean" as const, short: "v" },
		};
		const node = createCommandNode("sub");
		node.localFlags = localFlags;
		node.effectiveFlags = computeEffectiveFlags(ancestorOwnedFlags, localFlags);

		expect(() => validateCommandTree(node)).toThrow('Command "sub" failed runtime validation');
		expect(() => validateCommandTree(node)).toThrow("Alias collision");
	});

	it("detects alias collision between ancestor-owned flag name and local alias", () => {
		const ancestorOwnedFlags = {
			out: { type: "string" as const },
		};
		const localFlags = {
			output: { type: "string" as const, aliases: ["out"] },
		};
		const node = createCommandNode("sub");
		node.localFlags = localFlags;
		node.effectiveFlags = computeEffectiveFlags(ancestorOwnedFlags, localFlags);

		expect(() => validateCommandTree(node)).toThrow('Command "sub" failed runtime validation');
		expect(() => validateCommandTree(node)).toThrow("Alias collision");
	});

	it("detects no-prefix violation in effective flags from an ancestor-owned flag", () => {
		// Construct a node with an ancestor-owned flag that has no- prefix
		// (this wouldn't pass compile-time checks but tests runtime validation)
		const node = createCommandNode("sub");
		node.effectiveFlags = {
			"no-verbose": { type: "boolean" },
		};

		expect(() => validateCommandTree(node)).toThrow('Command "sub" failed runtime validation');
		expect(() => validateCommandTree(node)).toThrow("no-");
	});

	it("validates nested CommandNode subcommands", () => {
		const root = createCommandNode("root");
		const child = createCommandNode("child");
		const grandchild = createCommandNode("grandchild");

		// Grandchild has an alias collision in effective flags
		grandchild.effectiveFlags = {
			verbose: { type: "boolean", short: "v" },
			version: { type: "boolean", short: "v" },
		};

		child.subCommands = { grandchild };
		root.subCommands = { child };

		expect(() => validateCommandTree(root)).toThrow(
			'Command "root child grandchild" failed runtime validation',
		);
	});

	it("validates all levels of a deep CommandNode tree", () => {
		const root = createCommandNode("root");
		const level1 = createCommandNode("l1");
		const level2 = createCommandNode("l2");
		const level3 = createCommandNode("l3");

		// Only the deepest level has a problem
		level3.effectiveFlags = {
			out: { type: "string" },
			output: { type: "string", aliases: ["out"] },
		};

		level2.subCommands = { l3: level3 };
		level1.subCommands = { l2: level2 };
		root.subCommands = { l1: level1 };

		expect(() => validateCommandTree(root)).toThrow(
			'Command "root l1 l2 l3" failed runtime validation',
		);
	});

	it("required ancestor-owned flag included in validation argv", () => {
		// The ancestor-owned flags include a required string flag
		const ancestorOwnedFlags = {
			token: {
				type: "string" as const,
				required: true as const,
			},
		};
		const localFlags = {
			output: { type: "string" as const },
		};
		const node = createCommandNode("sub");
		node.localFlags = localFlags;
		node.effectiveFlags = computeEffectiveFlags(ancestorOwnedFlags, localFlags);

		// Should NOT throw — createValidationArgv includes --token sample
		expect(() => validateCommandTree(node)).not.toThrow();
	});

	it("ancestor-owned alias works during validation", () => {
		const ancestorOwnedFlags = {
			verbose: {
				type: "boolean" as const,
				short: "v",
			},
		};
		const localFlags = {
			output: { type: "string" as const, short: "o" },
		};
		const node = createCommandNode("sub");
		node.localFlags = localFlags;
		node.effectiveFlags = computeEffectiveFlags(ancestorOwnedFlags, localFlags);

		// Both ancestor-owned alias "v" and local alias "o" should be accepted
		expect(() => validateCommandTree(node)).not.toThrow();
	});

	it("CommandNode with local flags validates correctly", () => {
		const root = createCommandNode("root");
		root.localFlags = {
			verbose: { type: "boolean", short: "v" },
		};
		root.effectiveFlags = { ...root.localFlags };

		expect(() => validateCommandTree(root)).not.toThrow();
	});
});

// ──────────────────────────────────────────────────────────────────────────────
// validateCommandTree — alias collisions
//
// Catches plugin-installed subcommands that bypass `.add()` (where
// collision detection runs eagerly).
// ──────────────────────────────────────────────────────────────────────────────

describe("validateCommandTree — alias collisions", () => {
	function makeRunnable(name: string, aliases?: readonly string[]) {
		const node = createCommandNode(name);
		if (aliases) node.meta.aliases = aliases;
		node.run = () => {};
		return node;
	}

	it("accepts a tree with non-colliding aliases", () => {
		const root = createCommandNode("app");
		root.subCommands = {
			issue: makeRunnable("issue", ["issues", "i"]),
			version: makeRunnable("version", ["v"]),
		};
		expect(() => validateCommandTree(root)).not.toThrow();
	});

	it("detects an alias colliding with a sibling's canonical name", () => {
		const root = createCommandNode("app");
		// Simulate a plugin that installed both subcommands directly.
		root.subCommands = {
			build: makeRunnable("build"),
			compile: makeRunnable("compile", ["build"]),
		};
		expect(() => validateCommandTree(root)).toThrow(/collides with sibling canonical name "build"/);
	});

	it("detects an alias colliding with another sibling's alias", () => {
		const root = createCommandNode("app");
		root.subCommands = {
			issue: makeRunnable("issue", ["i"]),
			info: makeRunnable("info", ["i"]),
		};
		expect(() => validateCommandTree(root)).toThrow(/collides with alias of sibling "issue"/);
	});

	it("detects shape-invalid aliases (whitespace)", () => {
		const root = createCommandNode("app");
		root.subCommands = {
			issue: makeRunnable("issue", ["my issue"]),
		};
		expect(() => validateCommandTree(root)).toThrow(/must not contain whitespace/);
	});

	it("walks into nested subtrees", () => {
		const leafA = makeRunnable("create", ["new"]);
		const leafB = makeRunnable("clone", ["new"]);
		const issue = createCommandNode("issue");
		issue.subCommands = { create: leafA, clone: leafB };
		const root = createCommandNode("app");
		root.subCommands = { issue };

		expect(() => validateCommandTree(root)).toThrow(/collides with alias of sibling "create"/);
	});
});
