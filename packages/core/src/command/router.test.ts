import { describe, expect, it } from "vite-plus/test";

import { makeNode } from "../../tests/helpers.ts";
import { CrustError } from "../errors.ts";
import type { FlagsDef } from "../types.ts";
import type { CommandNode } from "./node.ts";
import { createCommandNode, registerFlag } from "./node.ts";
import { resolveCommand } from "./router.ts";

// ────────────────────────────────────────────────────────────────────────────
// Test fixtures
// ────────────────────────────────────────────────────────────────────────────

function createRootWithSubcommands(hasRun = false): CommandNode {
	const buildNode = createCommandNode("build");
	buildNode.meta.description = "Build the project";
	registerFlag(
		buildNode,
		"entry",
		{ type: "string", description: "Entry file", default: "src/cli.ts" },
		"local",
	);
	buildNode.run = () => {
		/* noop */
	};

	const devNode = createCommandNode("dev");
	devNode.meta.description = "Start dev server";
	registerFlag(
		devNode,
		"port",
		{ type: "number", description: "Port number", default: 3000 },
		"local",
	);
	devNode.run = () => {
		/* noop */
	};

	const root = createCommandNode("crust");
	root.meta.description = "Crust CLI";
	root.subCommands = { build: buildNode, dev: devNode };
	if (hasRun) {
		root.run = () => {
			/* noop */
		};
	}
	return root;
}

// ────────────────────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────────────────────

describe("resolveCommand", () => {
	describe("basic resolution", () => {
		it("resolves to root command with empty argv", () => {
			const root = createRootWithSubcommands();
			const result = resolveCommand(root, []);

			expect(result.command).toBe(root);
			expect(result.argv).toEqual([]);
			expect(result.commandPath).toEqual(["crust"]);
		});
	});

	describe("fallback to parent", () => {
		it("falls back to parent when no subcmd matches and parent has run()", () => {
			const root = createRootWithSubcommands(true); // has run()
			const result = resolveCommand(root, ["unknown-positional"]);

			// When parent has run(), unknown candidates are treated as positionals
			expect(result.command).toBe(root);
			expect(result.argv).toEqual(["unknown-positional"]);
			expect(result.commandPath).toEqual(["crust"]);
		});
	});

	describe("unknown subcommand errors", () => {
		it("throws CrustError with structured details", () => {
			const root = createRootWithSubcommands(); // no run()

			expect(() => resolveCommand(root, ["buld"])).toThrow(
				expect.objectContaining({
					code: "COMMAND_NOT_FOUND",
					message: expect.stringContaining('Unknown command "buld"'),
					details: expect.objectContaining({
						input: "buld",
						available: ["build", "dev"],
						commandPath: ["crust"],
						parentCommand: expect.objectContaining({
							meta: expect.objectContaining({ name: root.meta.name }),
							subCommands: expect.objectContaining({
								build: expect.anything(),
								dev: expect.anything(),
							}),
						}),
					}),
				}),
			);
		});
	});

	describe("edge cases", () => {
		it("multiple subcommand candidates where first wins", () => {
			const root = createRootWithSubcommands(true); // has run()
			// "build" matches, then remaining args are left for the subcommand
			const result = resolveCommand(root, ["build", "dev"]);

			// "build" resolves, then "dev" is remaining argv (since build has no subcommands)
			expect(result.command.meta.name).toBe("build");
			expect(result.argv).toEqual(["dev"]);
			expect(result.commandPath).toEqual(["crust", "build"]);
		});
	});
});

// ──────────────────────────────────────────────────────────────────────────────
// resolveCommand — alias resolution
// ──────────────────────────────────────────────────────────────────────────────

describe("resolveCommand — aliases", () => {
	function makeChild(name: string, aliases?: readonly string[]): CommandNode {
		const node = createCommandNode(name);
		if (aliases) node.meta.aliases = aliases;
		node.run = () => {
			/* noop */
		};
		return node;
	}

	it("resolves aliases at nested depths", () => {
		const leaf = makeChild("create", ["new", "add"]);
		const issue = makeChild("issue", ["i"]);
		issue.subCommands = { create: leaf };
		const root = createCommandNode("app");
		root.subCommands = { issue };

		const result = resolveCommand(root, ["i", "new"]);
		expect(result.command).toBe(leaf);
		expect(result.commandPath).toEqual(["app", "issue", "create"]);
	});

	it("reports only visible canonical names in COMMAND_NOT_FOUND details.available", () => {
		const issue = makeChild("issue", ["issues", "i"]);
		const pull = makeChild("pull-request", ["pr"]);
		const internal = makeChild("internal");
		internal.meta.hidden = true;
		const version = makeChild("version");
		const root = createCommandNode("app");
		root.subCommands = { issue, "pull-request": pull, internal, version };

		let caught: unknown;
		try {
			resolveCommand(root, ["isue"]);
		} catch (err) {
			caught = err;
		}
		expect(caught).toBeInstanceOf(CrustError);
		if (!(caught instanceof CrustError) || !caught.is("COMMAND_NOT_FOUND")) {
			throw new Error("expected COMMAND_NOT_FOUND");
		}
		// `available` lists visible canonical sibling names in insertion order. Aliases
		// stay reachable via `details.parentCommand.subCommands[name].meta.aliases`
		// for consumers (e.g. didYouMean) that want alias-aware matching.
		expect(caught.details.available).toEqual(["issue", "pull-request", "version"]);
		expect(caught.details.parentCommand.subCommands.issue?.meta.aliases).toEqual(["issues", "i"]);
	});

	it("reports COMMAND_NOT_FOUND for inherited Object.prototype keys in argv", () => {
		const issue = makeChild("issue", ["i"]);
		const root = createCommandNode("app");
		root.subCommands = { issue };

		for (const candidate of ["constructor", "toString", "__proto__", "hasOwnProperty"]) {
			let caught: unknown;
			try {
				resolveCommand(root, [candidate, "x"]);
			} catch (err) {
				caught = err;
			}
			// Untrusted argv: an inherited prototype member must not resolve as a
			// subcommand node (previously a TypeError crash mid-routing).
			expect(caught).toBeInstanceOf(CrustError);
			expect((caught as CrustError).is("COMMAND_NOT_FOUND")).toBe(true);
		}
	});

	it("prefers a canonical name over an alias when both could match", () => {
		// Pathological: a sibling's alias happens to equal another sibling's canonical name.
		// TypeScript rejects this in statically known definitions. The resolver still
		// picks the canonical sibling first to keep runtime behavior deterministic.
		const foo = makeChild("foo");
		const bar = makeChild("bar", ["foo"]);
		const root = createCommandNode("app");
		root.subCommands = { foo, bar };

		const result = resolveCommand(root, ["foo"]);
		expect(result.command).toBe(foo);
		expect(result.commandPath).toEqual(["app", "foo"]);
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Known-flag skipping — Context-owned flags before a subcommand
// ────────────────────────────────────────────────────────────────────────────

describe("resolveCommand — known-flag skipping", () => {
	function makeContextOwnedRoot(): CommandNode {
		// Context-owned flags propagate into every descendant's effectiveFlags;
		// the fixture mirrors that so routing's forwardability gate passes.
		const owned: FlagsDef = {
			"api-key": { type: "string", short: "k", aliases: ["token"] },
		};
		const service = makeNode({ meta: "service", flags: owned, run: () => {} });
		const deploy = makeNode({ meta: "deploy", flags: owned, subCommands: { service } });
		return makeNode({
			meta: "app",
			flags: owned,
			subCommands: { deploy },
		});
	}

	it.each([
		["separate value", ["--api-key", "secret", "deploy"]],
		["equals form", ["--api-key=secret", "deploy"]],
		["short form", ["-ksecret", "deploy"]],
	] as const)("routes past a Context-owned flag in %s", (_label, argv) => {
		const result = resolveCommand(makeContextOwnedRoot(), [...argv]);
		expect(result.commandPath).toEqual(["app", "deploy"]);
		expect(result.argv).toEqual(argv.slice(0, -1));
	});

	function makeRoot(): CommandNode {
		// Propagating flags exist on the child too — routing only forwards
		// flags the resolved command can actually parse.
		const shared: FlagsDef = {
			quiet: { type: "boolean", short: "q", description: "quiet" },
			verbose: { type: "boolean", noNegate: true, description: "verbose" },
			config: { type: "string", short: "c", aliases: ["conf"], description: "config file" },
		};
		const translate = makeNode({
			meta: "translate",
			flags: shared,
			run() {
				/* noop */
			},
		});
		return makeNode({
			meta: "app",
			flags: shared,
			subCommands: { translate },
		});
	}

	it("routes past a known boolean flag into the subcommand", () => {
		const result = resolveCommand(makeRoot(), ["--quiet", "translate"]);
		expect(result.commandPath).toEqual(["app", "translate"]);
		expect(result.argv).toEqual(["--quiet"]);
	});

	it("routes past a negated boolean flag", () => {
		const result = resolveCommand(makeRoot(), ["--no-quiet", "translate"]);
		expect(result.commandPath).toEqual(["app", "translate"]);
		expect(result.argv).toEqual(["--no-quiet"]);
	});

	it("does not treat --no-<flag> as known when the flag is noNegate", () => {
		const result = resolveCommand(makeRoot(), ["--no-verbose", "translate"]);
		expect(result.commandPath).toEqual(["app"]);
		expect(result.argv).toEqual(["--no-verbose", "translate"]);
	});

	it("consumes a value that shadows a subcommand name", () => {
		// "--config translate" means config=translate, not the subcommand
		const result = resolveCommand(makeRoot(), ["--config", "translate"]);
		expect(result.commandPath).toEqual(["app"]);
		expect(result.argv).toEqual(["--config", "translate"]);
	});

	it("routes past bundled known short booleans", () => {
		const root = makeRoot();
		// add a second short boolean for bundling (on both levels, like propagation)
		const force: FlagsDef[string] = { type: "boolean", short: "f", description: "force" };
		registerFlag(root, "force", force, "owned");
		const translate = root.subCommands.translate as CommandNode;
		registerFlag(translate, "force", force, "owned");
		const result = resolveCommand(root, ["-qf", "translate"]);
		expect(result.commandPath).toEqual(["app", "translate"]);
		expect(result.argv).toEqual(["-qf"]);
	});

	it("still breaks on unknown flags", () => {
		const result = resolveCommand(makeRoot(), ["--bogus", "translate"]);
		expect(result.commandPath).toEqual(["app"]);
		expect(result.argv).toEqual(["--bogus", "translate"]);
	});

	it("skips flags at multiple routing levels and preserves token order", () => {
		const quiet: FlagsDef[string] = { type: "boolean", description: "quiet" };
		const deep: FlagsDef[string] = { type: "boolean", description: "deep" };
		const leaf = makeNode({
			meta: "leaf",
			flags: { quiet, deep },
			run() {
				/* noop */
			},
		});
		const mid = makeNode({
			meta: "mid",
			flags: { quiet, deep },
			subCommands: { leaf },
		});
		const root = makeNode({
			meta: "app",
			flags: { quiet },
			subCommands: { mid },
		});
		const result = resolveCommand(root, ["--quiet", "mid", "--deep", "leaf", "rest"]);
		expect(result.commandPath).toEqual(["app", "mid", "leaf"]);
		expect(result.argv).toEqual(["--quiet", "--deep", "rest"]);
	});

	it("keeps a skipped flag ahead of the -- terminator", () => {
		const result = resolveCommand(makeRoot(), ["--quiet", "--", "translate"]);
		expect(result.commandPath).toEqual(["app"]);
		expect(result.argv).toEqual(["--quiet", "--", "translate"]);
	});

	it("rejects a parent-local flag before a subcommand that cannot parse it", () => {
		const translate = makeNode({ meta: "translate", run() {} });
		const root = makeNode({
			meta: "app",
			flags: { quiet: { type: "boolean", description: "quiet" } },
			subCommands: { translate },
		});
		expect(() => resolveCommand(root, ["--quiet", "translate"])).toThrow(
			expect.objectContaining({
				code: "PARSE",
				message: expect.stringContaining(
					'Flag "--quiet" cannot be used before subcommand "translate"',
				),
			}),
		);
	});

	it("rejects a forwarded flag whose child spelling has a different token shape", () => {
		// Parent: --config <value>; child: --config as boolean. The value token
		// was already consumed under the parent's shape, so forwarding would
		// misparse — routing must reject instead.
		const translate = makeNode({
			meta: "translate",
			flags: { config: { type: "boolean", description: "config toggle" } },
			run() {},
		});
		const root = makeNode({
			meta: "app",
			flags: { config: { type: "string", description: "config file" } },
			subCommands: { translate },
		});
		expect(() => resolveCommand(root, ["--config", "a.json", "translate"])).toThrow(
			'Flag "--config" cannot be used before subcommand "translate"',
		);
	});

	it("validates forwarded flags when descending through an alias", () => {
		const translate = makeNode({ meta: "translate", run() {} });
		translate.meta.aliases = ["tr"];
		const root = makeNode({
			meta: "app",
			flags: { quiet: { type: "boolean", description: "quiet" } },
			subCommands: { translate },
		});
		expect(() => resolveCommand(root, ["--quiet", "tr"])).toThrow(
			'Flag "--quiet" cannot be used before subcommand "tr"',
		);
	});
});
