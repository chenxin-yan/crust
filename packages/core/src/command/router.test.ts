import { describe, expect, it } from "bun:test";

import { CrustError } from "../errors.ts";
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
	buildNode.run = () => {
		/* noop */
	};

	const devNode = createCommandNode("dev");
	devNode.meta.description = "Start dev server";
	devNode.localFlags = {
		port: { type: "number", description: "Port number", default: 3000 },
	};
	devNode.effectiveFlags = { ...devNode.localFlags };
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

		it("resolves single-level subcommand with remaining flags", () => {
			const root = createRootWithSubcommands();
			const result = resolveCommand(root, ["build", "--entry", "src/index.ts"]);

			expect(result.command.meta.name).toBe("build");
			expect(result.argv).toEqual(["--entry", "src/index.ts"]);
			expect(result.commandPath).toEqual(["crust", "build"]);
		});

		it("resolves single-level subcommand with remaining positionals and flags", () => {
			const root = createRootWithSubcommands();
			const result = resolveCommand(root, ["dev", "--port", "8080"]);

			expect(result.command.meta.name).toBe("dev");
			expect(result.argv).toEqual(["--port", "8080"]);
			expect(result.commandPath).toEqual(["crust", "dev"]);
		});
	});

	describe("nested subcommand resolution", () => {
		it("resolves nested subcommand (2 levels)", () => {
			const templateCmd = createLeafCommand("template");
			const commandCmd = createLeafCommand("command");

			const generateCmd = makeNode({
				meta: { name: "generate", description: "Generate files" },
				subCommands: { command: commandCmd, template: templateCmd },
			});

			const root = makeNode({
				meta: { name: "crust", description: "Crust CLI" },
				subCommands: { generate: generateCmd },
			});

			const result = resolveCommand(root, ["generate", "command"]);

			expect(result.command.meta.name).toBe("command");
			expect(result.argv).toEqual([]);
			expect(result.commandPath).toEqual(["crust", "generate", "command"]);
		});

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

		it("resolves nested subcommand with remaining argv", () => {
			const commandCmd = makeNode({
				meta: { name: "command", description: "Generate a command" },
				args: [{ name: "name", type: "string", required: true }],
				run() {
					/* noop */
				},
			});

			const generateCmd = makeNode({
				meta: { name: "generate", description: "Generate files" },
				subCommands: { command: commandCmd },
			});

			const root = makeNode({
				meta: { name: "crust", description: "Crust CLI" },
				subCommands: { generate: generateCmd },
			});

			const result = resolveCommand(root, ["generate", "command", "my-cmd", "--verbose"]);

			expect(result.command.meta.name).toBe("command");
			expect(result.argv).toEqual(["my-cmd", "--verbose"]);
			expect(result.commandPath).toEqual(["crust", "generate", "command"]);
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

		it("falls back to parent when argv starts with a flag", () => {
			const root = createRootWithSubcommands();
			const result = resolveCommand(root, ["--help"]);

			expect(result.command).toBe(root);
			expect(result.argv).toEqual(["--help"]);
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
		it("throws error for unknown subcommand when parent has no run()", () => {
			const root = createRootWithSubcommands(); // no run()

			expect(() => resolveCommand(root, ["unknown"])).toThrow('Unknown command "unknown"');
		});

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
		it("--help at root level passes through in argv", () => {
			const root = createRootWithSubcommands();
			const result = resolveCommand(root, ["--help"]);

			expect(result.command).toBe(root);
			expect(result.argv).toEqual(["--help"]);
			expect(result.commandPath).toEqual(["crust"]);
		});

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

		it("--version at root level passes through in argv", () => {
			const root = createRootWithSubcommands();
			const result = resolveCommand(root, ["--version"]);

			expect(result.command).toBe(root);
			expect(result.argv).toEqual(["--version"]);
			expect(result.commandPath).toEqual(["crust"]);
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

		it("handles positional arguments correctly", () => {
			const cmd = makeNode({
				meta: { name: "greet" },
				args: [{ name: "name", type: "string", required: true }],
				run() {
					/* noop */
				},
			});
			const result = resolveCommand(cmd, ["world"]);

			expect(result.command).toBe(cmd);
			expect(result.argv).toEqual(["world"]);
			expect(result.commandPath).toEqual(["greet"]);
		});
	});

	describe("edge cases", () => {
		it("handles empty subCommands record", () => {
			const cmd = makeNode({
				meta: { name: "empty" },
				subCommands: {},
				run() {
					/* noop */
				},
			});

			const result = resolveCommand(cmd, ["something"]);
			expect(result.command).toBe(cmd);
			expect(result.argv).toEqual(["something"]);
			expect(result.commandPath).toEqual(["empty"]);
		});

		it("stops at flag even if it looks like a subcommand name", () => {
			const root = createRootWithSubcommands();
			const result = resolveCommand(root, ["--build"]);

			// --build starts with -, so it's treated as a flag, not a subcommand
			expect(result.command).toBe(root);
			expect(result.argv).toEqual(["--build"]);
			expect(result.commandPath).toEqual(["crust"]);
		});

		it("handles subcommand followed by -- separator", () => {
			const root = createRootWithSubcommands();
			const result = resolveCommand(root, ["build", "--", "extra"]);

			expect(result.command.meta.name).toBe("build");
			expect(result.argv).toEqual(["--", "extra"]);
			expect(result.commandPath).toEqual(["crust", "build"]);
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

		it("mid-level subcommand with no run and no matching child throws error", () => {
			const commandCmd = createLeafCommand("command");

			const generateCmd = makeNode({
				meta: { name: "generate", description: "Generate files" },
				subCommands: { command: commandCmd },
				// no run()
			});

			const root = makeNode({
				meta: { name: "crust", description: "Crust CLI" },
				subCommands: { generate: generateCmd },
			});

			// "generate" resolves, then "foobar" is unknown in generate's subcommands
			expect(() => resolveCommand(root, ["generate", "foobar"])).toThrow(
				'Unknown command "foobar"',
			);
		});

		it("preserves order of remaining argv after subcommand resolution", () => {
			const root = createRootWithSubcommands();
			const argv = ["build", "src/index.ts", "--entry", "main.ts", "--minify"];
			const result = resolveCommand(root, argv);

			expect(result.command.meta.name).toBe("build");
			expect(result.argv).toEqual(["src/index.ts", "--entry", "main.ts", "--minify"]);
		});
	});

	describe("error shape", () => {
		it("captures available command names in details", () => {
			const root = createRootWithSubcommands();

			try {
				resolveCommand(root, ["completely-different"]);
				expect(true).toBe(false);
			} catch (error) {
				const crustError = error as CrustError;
				expect(crustError.code).toBe("COMMAND_NOT_FOUND");
				expect(crustError.details).toMatchObject({
					available: ["build", "dev"],
				});
			}
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

	it("resolves a single alias to the canonical node", () => {
		const issue = makeChild("issue", ["i"]);
		const root = createCommandNode("app");
		root.subCommands = { issue };

		const result = resolveCommand(root, ["i"]);
		expect(result.command).toBe(issue);
		expect(result.commandPath).toEqual(["app", "issue"]);
	});

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
		// for consumers (e.g. didYouMeanPlugin) that want alias-aware matching.
		expect(caught.details.available).toEqual(["issue", "pull-request", "version"]);
		expect(caught.details.parentCommand.subCommands.issue?.meta.aliases).toEqual(["issues", "i"]);
	});

	it("prefers a canonical name over an alias when both could match", () => {
		// Pathological: a sibling's alias happens to equal another sibling's canonical name.
		// Registration-time validation should already reject this in user code (Step 3),
		// but if a node is constructed directly bypassing the builder, the resolver MUST
		// pick the canonical sibling first to keep behavior deterministic.
		const foo = makeChild("foo");
		const bar = makeChild("bar", ["foo"]);
		const root = createCommandNode("app");
		root.subCommands = { foo, bar };

		const result = resolveCommand(root, ["foo"]);
		expect(result.command).toBe(foo);
		expect(result.commandPath).toEqual(["app", "foo"]);
	});

	it("does not match when the alias starts with a dash", () => {
		// Even if a sibling somehow registered an alias starting with '-' (which Step 3
		// will reject), the resolver short-circuits flag-shaped tokens before alias scan.
		const issue = makeChild("issue");
		const root = createCommandNode("app");
		root.run = () => {
			/* noop so unknown tokens fall through */
		};
		root.subCommands = { issue };

		const result = resolveCommand(root, ["--help"]);
		expect(result.command).toBe(root);
		expect(result.argv).toEqual(["--help"]);
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Known-flag skipping — inherited/root flags before a subcommand
// ────────────────────────────────────────────────────────────────────────────

describe("resolveCommand — known-flag skipping", () => {
	function makeRoot(): CommandNode {
		const translate = makeNode({
			meta: "translate",
			run() {
				/* noop */
			},
		});
		return makeNode({
			meta: "app",
			flags: {
				quiet: { type: "boolean", short: "q", description: "quiet" },
				verbose: { type: "boolean", noNegate: true, description: "verbose" },
				config: { type: "string", aliases: ["conf"], description: "config file" },
			},
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

	it("consumes the value token of a known value-taking flag", () => {
		const result = resolveCommand(makeRoot(), ["--config", "a.json", "translate"]);
		expect(result.commandPath).toEqual(["app", "translate"]);
		expect(result.argv).toEqual(["--config", "a.json"]);
	});

	it("consumes a value that shadows a subcommand name", () => {
		// "--config translate" means config=translate, not the subcommand
		const result = resolveCommand(makeRoot(), ["--config", "translate"]);
		expect(result.commandPath).toEqual(["app"]);
		expect(result.argv).toEqual(["--config", "translate"]);
	});

	it("does not consume a value for --flag=value form", () => {
		const result = resolveCommand(makeRoot(), ["--config=a.json", "translate"]);
		expect(result.commandPath).toEqual(["app", "translate"]);
		expect(result.argv).toEqual(["--config=a.json"]);
	});

	it("routes past a known long alias", () => {
		const result = resolveCommand(makeRoot(), ["--conf=a.json", "translate"]);
		expect(result.commandPath).toEqual(["app", "translate"]);
	});

	it("routes past bundled known short booleans", () => {
		const root = makeRoot();
		// add a second short boolean for bundling
		root.effectiveFlags = {
			...root.effectiveFlags,
			force: { type: "boolean", short: "f", description: "force" },
		};
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
		const leaf = makeNode({
			meta: "leaf",
			run() {
				/* noop */
			},
		});
		const mid = makeNode({
			meta: "mid",
			flags: { deep: { type: "boolean", description: "deep" } },
			subCommands: { leaf },
		});
		const root = makeNode({
			meta: "app",
			flags: { quiet: { type: "boolean", description: "quiet" } },
			subCommands: { mid },
		});
		const result = resolveCommand(root, ["--quiet", "mid", "--deep", "leaf", "rest"]);
		expect(result.commandPath).toEqual(["app", "mid", "leaf"]);
		expect(result.argv).toEqual(["--quiet", "--deep", "rest"]);
	});
});
