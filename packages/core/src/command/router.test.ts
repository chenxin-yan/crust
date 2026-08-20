import { describe, expect, it } from "bun:test";

import { CrustError } from "../errors.ts";
import { addFlagSpellingEntries } from "../parsing/spellings.ts";
import type { ArgsDef, CommandMeta, FlagsDef } from "../types.ts";
import type { CommandNode } from "./node.ts";
import { createCommandNode } from "./node.ts";
import { resolveCommand } from "./router.ts";
import type { CommandSnapshot } from "./snapshot.ts";

/**
 * Test helper: creates a CommandNode from a config object for test fixtures.
 */
function makeNode(config: {
	meta: string | CommandMeta;
	args?: ArgsDef;
	flags?: FlagsDef;
	subCommands?: Record<string, CommandNode>;
	run?: (ctx: unknown) => void | Promise<void>;
}): CommandNode {
	const meta = typeof config.meta === "string" ? { name: config.meta } : config.meta;
	const node = createCommandNode(meta.name);
	if (meta.description) node.meta.description = meta.description;
	if (meta.usage) node.meta.usage = meta.usage;
	if (config.flags) {
		node.localFlags = { ...config.flags };
		node.effectiveFlags = { ...config.flags };
		cacheFlagSpellings(node);
	}
	if (config.args) {
		node.args = [...config.args];
	}
	if (config.subCommands) {
		node.subCommands = { ...config.subCommands };
	}
	if (config.run) {
		node.run = config.run;
	}
	return node;
}

function cacheFlagSpellings(node: CommandNode): void {
	node.flagSpellings.clear();
	for (const [name, def] of Object.entries(node.effectiveFlags)) {
		addFlagSpellingEntries(node.flagSpellings, name, def);
	}
}

// ────────────────────────────────────────────────────────────────────────────
// Test fixtures
// ────────────────────────────────────────────────────────────────────────────

function createLeafCommand(name: string, hasRun = true): CommandNode {
	const node = createCommandNode(name);
	node.meta.description = `${name} command`;
	if (hasRun) {
		node.run = () => {
			/* noop */
		};
	}
	return node;
}

function createRootWithSubcommands(hasRun = false): CommandNode {
	const buildNode = createCommandNode("build");
	buildNode.meta.description = "Build the project";
	buildNode.localFlags = {
		entry: {
			type: "string",
			description: "Entry file",
			default: "src/cli.ts",
		},
	};
	buildNode.effectiveFlags = { ...buildNode.localFlags };
	cacheFlagSpellings(buildNode);
	buildNode.run = () => {
		/* noop */
	};

	const devNode = createCommandNode("dev");
	devNode.meta.description = "Start dev server";
	devNode.localFlags = {
		port: { type: "number", description: "Port number", default: 3000 },
	};
	devNode.effectiveFlags = { ...devNode.localFlags };
	cacheFlagSpellings(devNode);
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

		it("resolves single-level subcommand", () => {
			const root = createRootWithSubcommands();
			const result = resolveCommand(root, ["build"]);

			expect(result.command.meta.name).toBe("build");
			expect(result.argv).toEqual([]);
			expect(result.commandPath).toEqual(["crust", "build"]);
		});
	});

	describe("nested subcommand resolution", () => {
		it("resolves deeply nested subcommand (3+ levels)", () => {
			const deepCmd = createLeafCommand("deep");

			const level2 = makeNode({
				meta: { name: "level2", description: "Level 2" },
				subCommands: { deep: deepCmd },
			});

			const level1 = makeNode({
				meta: { name: "level1", description: "Level 1" },
				subCommands: { level2 },
			});

			const root = makeNode({
				meta: { name: "root", description: "Root" },
				subCommands: { level1 },
			});

			const result = resolveCommand(root, ["level1", "level2", "deep"]);

			expect(result.command.meta.name).toBe("deep");
			expect(result.argv).toEqual([]);
			expect(result.commandPath).toEqual(["root", "level1", "level2", "deep"]);
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

		it("falls back to parent when argv starts with short flag", () => {
			const root = createRootWithSubcommands();
			const result = resolveCommand(root, ["-h"]);

			expect(result.command).toBe(root);
			expect(result.argv).toEqual(["-h"]);
			expect(result.commandPath).toEqual(["crust"]);
		});
	});

	describe("unknown subcommand errors", () => {
		it("throws CrustError with structured details", () => {
			const root = createRootWithSubcommands(); // no run()

			try {
				resolveCommand(root, ["buld"]);
				expect(true).toBe(false); // Should not reach here
			} catch (error) {
				expect(error).toBeInstanceOf(CrustError);
				const crustError = error as CrustError;
				expect(crustError.code).toBe("COMMAND_NOT_FOUND");
				expect(crustError.message).toContain('Unknown command "buld"');
				expect(crustError.details).toMatchObject({
					input: "buld",
					available: ["build", "dev"],
					commandPath: ["crust"],
				});
				const parentCommand = (crustError.details as { parentCommand: CommandSnapshot })
					.parentCommand;
				expect(parentCommand.meta.name).toBe(root.meta.name);
				expect(Object.keys(parentCommand.subCommands)).toEqual(Object.keys(root.subCommands));
			}
		});

		it("throws error for unknown nested subcommand", () => {
			const commandCmd = createLeafCommand("command");

			const generateCmd = makeNode({
				meta: { name: "generate", description: "Generate files" },
				subCommands: { command: commandCmd },
			});

			const root = makeNode({
				meta: { name: "crust", description: "Crust CLI" },
				subCommands: { generate: generateCmd },
			});

			try {
				resolveCommand(root, ["generate", "unknown"]);
				expect(true).toBe(false); // Should not reach here
			} catch (error) {
				const crustError = error as CrustError;
				expect(crustError.message).toContain('Unknown command "unknown"');
				expect(crustError.code).toBe("COMMAND_NOT_FOUND");
				expect(crustError.details).toMatchObject({
					available: ["command"],
					commandPath: ["crust", "generate"],
				});
			}
		});
	});

	describe("--help flag handling", () => {
		it("--help at subcmd level passes through in argv", () => {
			const root = createRootWithSubcommands();
			const result = resolveCommand(root, ["build", "--help"]);

			expect(result.command.meta.name).toBe("build");
			expect(result.argv).toEqual(["--help"]);
			expect(result.commandPath).toEqual(["crust", "build"]);
		});

		it("-h at subcmd level passes through in argv", () => {
			const root = createRootWithSubcommands();
			const result = resolveCommand(root, ["build", "-h"]);

			expect(result.command.meta.name).toBe("build");
			expect(result.argv).toEqual(["-h"]);
			expect(result.commandPath).toEqual(["crust", "build"]);
		});
	});

	describe("command with no subcommands", () => {
		it("resolves to root when command has no subcommands", () => {
			const cmd = createLeafCommand("serve");
			const result = resolveCommand(cmd, ["--port", "3000"]);

			expect(result.command).toBe(cmd);
			expect(result.argv).toEqual(["--port", "3000"]);
			expect(result.commandPath).toEqual(["serve"]);
		});
	});

	describe("edge cases", () => {
		it("stops at flag even if it looks like a subcommand name", () => {
			const root = createRootWithSubcommands();
			const result = resolveCommand(root, ["--build"]);

			// --build starts with -, so it's treated as a flag, not a subcommand
			expect(result.command).toBe(root);
			expect(result.argv).toEqual(["--build"]);
			expect(result.commandPath).toEqual(["crust"]);
		});

		it("multiple subcommand candidates where first wins", () => {
			const root = createRootWithSubcommands(true); // has run()
			// "build" matches, then remaining args are left for the subcommand
			const result = resolveCommand(root, ["build", "dev"]);

			// "build" resolves, then "dev" is remaining argv (since build has no subcommands)
			expect(result.command.meta.name).toBe("build");
			expect(result.argv).toEqual(["dev"]);
			expect(result.commandPath).toEqual(["crust", "build"]);
		});

		it("preserves order of remaining argv after subcommand resolution", () => {
			const root = createRootWithSubcommands();
			const argv = ["build", "src/index.ts", "--entry", "main.ts", "--minify"];
			const result = resolveCommand(root, argv);

			expect(result.command.meta.name).toBe("build");
			expect(result.argv).toEqual(["src/index.ts", "--entry", "main.ts", "--minify"]);
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

	it("resolves multiple aliases on the same node", () => {
		const issue = makeChild("issue", ["issues", "i", "iss"]);
		const root = createCommandNode("app");
		root.subCommands = { issue };

		expect(resolveCommand(root, ["issue"]).command).toBe(issue);
		expect(resolveCommand(root, ["issues"]).command).toBe(issue);
		expect(resolveCommand(root, ["i"]).command).toBe(issue);
		expect(resolveCommand(root, ["iss"]).command).toBe(issue);
	});

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

	it("records the canonical name in commandPath even when an alias was typed", () => {
		const issue = makeChild("issue", ["i", "issues"]);
		const root = createCommandNode("app");
		root.subCommands = { issue };

		expect(resolveCommand(root, ["i"]).commandPath).toEqual(["app", "issue"]);
		expect(resolveCommand(root, ["issues"]).commandPath).toEqual(["app", "issue"]);
	});

	it("reports only canonical names in COMMAND_NOT_FOUND details.available", () => {
		const issue = makeChild("issue", ["issues", "i"]);
		const pull = makeChild("pull-request", ["pr"]);
		const version = makeChild("version");
		const root = createCommandNode("app");
		root.subCommands = { issue, "pull-request": pull, version };

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
		// `available` lists canonical sibling names in insertion order. Aliases
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
		["alias form", ["--token=secret", "deploy"]],
	] as const)("routes past a Context-owned flag in %s", (_label, argv) => {
		const result = resolveCommand(makeContextOwnedRoot(), [...argv]);
		expect(result.commandPath).toEqual(["app", "deploy"]);
		expect(result.argv).toEqual(argv.slice(0, -1));
	});

	it("routes a Context-owned flag through nested descendants", () => {
		const result = resolveCommand(makeContextOwnedRoot(), [
			"--api-key",
			"secret",
			"deploy",
			"service",
		]);
		expect(result.commandPath).toEqual(["app", "deploy", "service"]);
		expect(result.argv).toEqual(["--api-key", "secret"]);
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

	it("routes past a known short flag", () => {
		const result = resolveCommand(makeRoot(), ["-q", "translate"]);
		expect(result.commandPath).toEqual(["app", "translate"]);
		expect(result.argv).toEqual(["-q"]);
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
		root.effectiveFlags = { ...root.effectiveFlags, force };
		cacheFlagSpellings(root);
		const translate = root.subCommands.translate as CommandNode;
		translate.effectiveFlags = { ...translate.effectiveFlags, force };
		cacheFlagSpellings(translate);
		const result = resolveCommand(root, ["-qf", "translate"]);
		expect(result.commandPath).toEqual(["app", "translate"]);
		expect(result.argv).toEqual(["-qf"]);
	});

	it("still breaks on unknown flags", () => {
		const result = resolveCommand(makeRoot(), ["--bogus", "translate"]);
		expect(result.commandPath).toEqual(["app"]);
		expect(result.argv).toEqual(["--bogus", "translate"]);
	});

	it("still breaks on the -- terminator", () => {
		const result = resolveCommand(makeRoot(), ["--", "translate"]);
		expect(result.commandPath).toEqual(["app"]);
		expect(result.argv).toEqual(["--", "translate"]);
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
			'Flag "--quiet" cannot be used before subcommand "translate"',
		);
		try {
			resolveCommand(root, ["--quiet", "translate"]);
		} catch (error) {
			expect(error).toBeInstanceOf(CrustError);
			expect((error as CrustError).code).toBe("PARSE");
		}
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

	it("rejects a flag committed at one level when a deeper descend cannot parse it", () => {
		const quiet: FlagsDef[string] = { type: "boolean", description: "quiet" };
		const leaf = makeNode({ meta: "leaf", run() {} });
		const mid = makeNode({ meta: "mid", flags: { quiet }, subCommands: { leaf } });
		const root = makeNode({ meta: "app", flags: { quiet }, subCommands: { mid } });
		expect(() => resolveCommand(root, ["--quiet", "mid", "leaf"])).toThrow(
			'Flag "--quiet" cannot be used before subcommand "leaf"',
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
