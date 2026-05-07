import { describe, expect, it } from "bun:test";
import { computeEffectiveFlags, createCommandNode } from "./node.ts";
import { validateCommandTree } from "./validation.ts";

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

		expect(() => validateCommandTree(node)).toThrow(
			'Command "root" failed runtime validation',
		);
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

	it("passes a valid CommandNode with effective flags (inherited + local)", () => {
		const parentFlags = {
			verbose: { type: "boolean" as const, short: "v", inherit: true as const },
			debug: { type: "boolean" as const, inherit: true as const },
		};
		const localFlags = {
			output: { type: "string" as const, short: "o" },
		};
		const node = createCommandNode("sub");
		node.localFlags = localFlags;
		node.effectiveFlags = computeEffectiveFlags(parentFlags, localFlags);

		expect(() => validateCommandTree(node)).not.toThrow();
	});

	it("passes a valid CommandNode with required effective flags", () => {
		const parentFlags = {
			token: {
				type: "string" as const,
				required: true as const,
				inherit: true as const,
			},
		};
		const localFlags = {
			output: { type: "string" as const },
		};
		const node = createCommandNode("sub");
		node.localFlags = localFlags;
		node.effectiveFlags = computeEffectiveFlags(parentFlags, localFlags);

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

	it("detects alias collision in effective flags (inherited alias collides with local)", () => {
		const parentFlags = {
			verbose: { type: "boolean" as const, short: "v", inherit: true as const },
		};
		const localFlags = {
			version: { type: "boolean" as const, short: "v" },
		};
		const node = createCommandNode("sub");
		node.localFlags = localFlags;
		node.effectiveFlags = computeEffectiveFlags(parentFlags, localFlags);

		expect(() => validateCommandTree(node)).toThrow(
			'Command "sub" failed runtime validation',
		);
		expect(() => validateCommandTree(node)).toThrow("Alias collision");
	});

	it("detects alias collision between inherited flag name and local alias", () => {
		const parentFlags = {
			out: { type: "string" as const, inherit: true as const },
		};
		const localFlags = {
			output: { type: "string" as const, aliases: ["out"] },
		};
		const node = createCommandNode("sub");
		node.localFlags = localFlags;
		node.effectiveFlags = computeEffectiveFlags(parentFlags, localFlags);

		expect(() => validateCommandTree(node)).toThrow(
			'Command "sub" failed runtime validation',
		);
		expect(() => validateCommandTree(node)).toThrow("Alias collision");
	});

	it("detects no-prefix violation in effective flags from inherited flag", () => {
		// Construct a node with an inherited flag that has no- prefix
		// (this wouldn't pass compile-time checks but tests runtime validation)
		const node = createCommandNode("sub");
		node.effectiveFlags = {
			"no-verbose": { type: "boolean" },
		};

		expect(() => validateCommandTree(node)).toThrow(
			'Command "sub" failed runtime validation',
		);
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

	it("overridden flag validated with local definition (no collision)", () => {
		// Parent has inherit:true flag "verbose" with short "v"
		// Child overrides "verbose" with a different short — no collision
		const parentFlags = {
			verbose: { type: "boolean" as const, short: "v", inherit: true as const },
		};
		const localFlags = {
			verbose: { type: "string" as const, short: "V" },
		};
		const node = createCommandNode("sub");
		node.localFlags = localFlags;
		node.effectiveFlags = computeEffectiveFlags(parentFlags, localFlags);

		// The local definition completely replaces the inherited one
		// "verbose" is now type string with alias "V" — no collision
		expect(() => validateCommandTree(node)).not.toThrow();
	});

	it("inherited required flag included in validation argv", () => {
		// Parent has a required inherited string flag
		const parentFlags = {
			token: {
				type: "string" as const,
				required: true as const,
				inherit: true as const,
			},
		};
		const localFlags = {
			output: { type: "string" as const },
		};
		const node = createCommandNode("sub");
		node.localFlags = localFlags;
		node.effectiveFlags = computeEffectiveFlags(parentFlags, localFlags);

		// Should NOT throw — createValidationArgv includes --token sample
		expect(() => validateCommandTree(node)).not.toThrow();
	});

	it("inherited alias works during validation", () => {
		const parentFlags = {
			verbose: {
				type: "boolean" as const,
				short: "v",
				inherit: true as const,
			},
		};
		const localFlags = {
			output: { type: "string" as const, short: "o" },
		};
		const node = createCommandNode("sub");
		node.localFlags = localFlags;
		node.effectiveFlags = computeEffectiveFlags(parentFlags, localFlags);

		// Both inherited alias "v" and local alias "o" should be accepted
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
// validateCommandTree — alias collisions (TP-016)
//
// Catches plugin-installed subcommands that bypass `.command()` (where
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
		expect(() => validateCommandTree(root)).toThrow(
			/collides with sibling canonical name "build"/,
		);
	});

	it("detects an alias colliding with another sibling's alias", () => {
		const root = createCommandNode("app");
		root.subCommands = {
			issue: makeRunnable("issue", ["i"]),
			info: makeRunnable("info", ["i"]),
		};
		expect(() => validateCommandTree(root)).toThrow(
			/collides with alias of sibling "issue"/,
		);
	});

	it("detects shape-invalid aliases (whitespace)", () => {
		const root = createCommandNode("app");
		root.subCommands = {
			issue: makeRunnable("issue", ["my issue"]),
		};
		expect(() => validateCommandTree(root)).toThrow(
			/must not contain whitespace/,
		);
	});

	it("walks into nested subtrees", () => {
		const leafA = makeRunnable("create", ["new"]);
		const leafB = makeRunnable("clone", ["new"]);
		const issue = createCommandNode("issue");
		issue.subCommands = { create: leafA, clone: leafB };
		const root = createCommandNode("app");
		root.subCommands = { issue };

		expect(() => validateCommandTree(root)).toThrow(
			/collides with alias of sibling "create"/,
		);
	});
});
