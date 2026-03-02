import { describe, expect, it } from "bun:test";
import { CrustError } from "./errors.ts";
import type { CommandNode } from "./node.ts";
import { createCommandNode } from "./node.ts";
import { resolveCommand } from "./router.ts";
import type { ArgsDef, CommandMeta, FlagsDef } from "./types.ts";

/**
 * Test helper: creates a CommandNode from a defineCommand-style config.
 */
function makeNode(config: {
	meta: string | CommandMeta;
	args?: ArgsDef;
	flags?: FlagsDef;
	subCommands?: Record<string, CommandNode>;
	run?: (ctx: unknown) => void | Promise<void>;
}): CommandNode {
	const node = createCommandNode(config.meta);
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
	const node = createCommandNode({ name, description: `${name} command` });
	if (hasRun) {
		node.run = () => {
			/* noop */
		};
	}
	return node;
}

function createRootWithSubcommands(hasRun = false): CommandNode {
	const buildNode = createCommandNode({
		name: "build",
		description: "Build the project",
	});
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

	const devNode = createCommandNode({
		name: "dev",
		description: "Start dev server",
	});
	devNode.localFlags = {
		port: { type: "number", description: "Port number", default: 3000 },
	};
	devNode.effectiveFlags = { ...devNode.localFlags };
	devNode.run = () => {
		/* noop */
	};

	const root = createCommandNode({
		name: "crust",
		description: "Crust CLI",
	});
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

			const result = resolveCommand(root, [
				"generate",
				"command",
				"my-cmd",
				"--verbose",
			]);

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

			expect(() => resolveCommand(root, ["unknown"])).toThrow(
				'Unknown command "unknown"',
			);
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
			expect(result.argv).toEqual([
				"src/index.ts",
				"--entry",
				"main.ts",
				"--minify",
			]);
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

// ────────────────────────────────────────────────────────────────────────────
// resolveCommand — CommandNode tree routing
// ────────────────────────────────────────────────────────────────────────────

describe("resolveCommand — CommandNode tree", () => {
	function createNodeLeaf(name: string, hasRun = true): CommandNode {
		const node = createCommandNode(name);
		if (hasRun) {
			node.run = () => {
				/* noop */
			};
		}
		return node;
	}

	function createNodeRootWithSubcommands(hasRun = false): CommandNode {
		const buildNode = createCommandNode({
			name: "build",
			description: "Build the project",
		});
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

		const devNode = createCommandNode({
			name: "dev",
			description: "Start dev server",
		});
		devNode.localFlags = {
			port: { type: "number", description: "Port number", default: 3000 },
		};
		devNode.effectiveFlags = { ...devNode.localFlags };
		devNode.run = () => {
			/* noop */
		};

		const root = createCommandNode({
			name: "crust",
			description: "Crust CLI",
		});
		root.subCommands = { build: buildNode, dev: devNode };
		if (hasRun) {
			root.run = () => {
				/* noop */
			};
		}
		return root;
	}

	describe("basic resolution", () => {
		it("resolves to root node with empty argv", () => {
			const root = createNodeRootWithSubcommands();
			const result = resolveCommand(root, []);

			expect(result.command).toBe(root);
			expect(result.argv).toEqual([]);
			expect(result.commandPath).toEqual(["crust"]);
		});

		it("resolves single-level subcommand node", () => {
			const root = createNodeRootWithSubcommands();
			const result = resolveCommand(root, ["build"]);

			expect(result.command.meta.name).toBe("build");
			expect(result.argv).toEqual([]);
			expect(result.commandPath).toEqual(["crust", "build"]);
		});

		it("resolves node subcommand with remaining flags", () => {
			const root = createNodeRootWithSubcommands();
			const result = resolveCommand(root, ["build", "--entry", "src/index.ts"]);

			expect(result.command.meta.name).toBe("build");
			expect(result.argv).toEqual(["--entry", "src/index.ts"]);
			expect(result.commandPath).toEqual(["crust", "build"]);
		});
	});

	describe("nested subcommand resolution", () => {
		it("resolves nested CommandNode (2 levels)", () => {
			const templateNode = createNodeLeaf("template");
			const commandNode = createNodeLeaf("command");

			const generateNode = createCommandNode({
				name: "generate",
				description: "Generate files",
			});
			generateNode.subCommands = {
				command: commandNode,
				template: templateNode,
			};

			const root = createCommandNode({
				name: "crust",
				description: "Crust CLI",
			});
			root.subCommands = { generate: generateNode };

			const result = resolveCommand(root, ["generate", "command"]);

			expect(result.command.meta.name).toBe("command");
			expect(result.argv).toEqual([]);
			expect(result.commandPath).toEqual(["crust", "generate", "command"]);
		});

		it("resolves deeply nested CommandNode (3 levels)", () => {
			const deepNode = createNodeLeaf("deep");

			const level2 = createCommandNode("level2");
			level2.subCommands = { deep: deepNode };

			const level1 = createCommandNode("level1");
			level1.subCommands = { level2 };

			const root = createCommandNode("root");
			root.subCommands = { level1 };

			const result = resolveCommand(root, ["level1", "level2", "deep"]);

			expect(result.command.meta.name).toBe("deep");
			expect(result.argv).toEqual([]);
			expect(result.commandPath).toEqual(["root", "level1", "level2", "deep"]);
		});

		it("resolves nested node with remaining argv", () => {
			const commandNode = createCommandNode({
				name: "command",
				description: "Generate a command",
			});
			commandNode.args = [{ name: "name", type: "string", required: true }];
			commandNode.run = () => {
				/* noop */
			};

			const generateNode = createCommandNode({
				name: "generate",
				description: "Generate files",
			});
			generateNode.subCommands = { command: commandNode };

			const root = createCommandNode({
				name: "crust",
				description: "Crust CLI",
			});
			root.subCommands = { generate: generateNode };

			const result = resolveCommand(root, [
				"generate",
				"command",
				"my-cmd",
				"--verbose",
			]);

			expect(result.command.meta.name).toBe("command");
			expect(result.argv).toEqual(["my-cmd", "--verbose"]);
			expect(result.commandPath).toEqual(["crust", "generate", "command"]);
		});
	});

	describe("fallback and errors", () => {
		it("falls back to parent node when no subcmd matches and parent has run()", () => {
			const root = createNodeRootWithSubcommands(true);
			const result = resolveCommand(root, ["unknown-positional"]);

			expect(result.command).toBe(root);
			expect(result.argv).toEqual(["unknown-positional"]);
			expect(result.commandPath).toEqual(["crust"]);
		});

		it("falls back to parent node when argv starts with a flag", () => {
			const root = createNodeRootWithSubcommands();
			const result = resolveCommand(root, ["--help"]);

			expect(result.command).toBe(root);
			expect(result.argv).toEqual(["--help"]);
			expect(result.commandPath).toEqual(["crust"]);
		});

		it("throws error for unknown subcommand when parent node has no run()", () => {
			const root = createNodeRootWithSubcommands();

			expect(() => resolveCommand(root, ["unknown"])).toThrow(
				'Unknown command "unknown"',
			);
		});

		it("throws CrustError with structured details for CommandNode", () => {
			const root = createNodeRootWithSubcommands();

			try {
				resolveCommand(root, ["buld"]);
				expect(true).toBe(false);
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
				// parentCommand should be the CommandNode
				expect(
					(crustError.details as { parentCommand: CommandNode }).parentCommand,
				).toBe(root);
			}
		});
	});

	describe("commandPath tracks node names correctly", () => {
		it("single level path", () => {
			const root = createNodeRootWithSubcommands();
			const result = resolveCommand(root, ["dev"]);
			expect(result.commandPath).toEqual(["crust", "dev"]);
		});

		it("multi-level path", () => {
			const leafNode = createNodeLeaf("leaf");

			const mid = createCommandNode("mid");
			mid.subCommands = { leaf: leafNode };

			const root = createCommandNode("app");
			root.subCommands = { mid };

			const result = resolveCommand(root, ["mid", "leaf"]);
			expect(result.commandPath).toEqual(["app", "mid", "leaf"]);
		});
	});

	describe("argv slicing after subcommand resolution", () => {
		it("correctly slices argv for resolved subcommand node", () => {
			const root = createNodeRootWithSubcommands();
			const argv = ["build", "src/index.ts", "--entry", "main.ts", "--minify"];
			const result = resolveCommand(root, argv);

			expect(result.command.meta.name).toBe("build");
			expect(result.argv).toEqual([
				"src/index.ts",
				"--entry",
				"main.ts",
				"--minify",
			]);
		});

		it("handles subcommand node followed by -- separator", () => {
			const root = createNodeRootWithSubcommands();
			const result = resolveCommand(root, ["build", "--", "extra"]);

			expect(result.command.meta.name).toBe("build");
			expect(result.argv).toEqual(["--", "extra"]);
			expect(result.commandPath).toEqual(["crust", "build"]);
		});
	});

	describe("command with no subcommands", () => {
		it("resolves to root node when node has no subcommands", () => {
			const node = createNodeLeaf("serve");
			const result = resolveCommand(node, ["--port", "3000"]);

			expect(result.command).toBe(node);
			expect(result.argv).toEqual(["--port", "3000"]);
			expect(result.commandPath).toEqual(["serve"]);
		});
	});
});
