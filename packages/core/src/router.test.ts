import { describe, expect, it } from "bun:test";
import { defineCommand } from "./command.ts";
import { resolveCommand } from "./router.ts";

// ────────────────────────────────────────────────────────────────────────────
// Test fixtures
// ────────────────────────────────────────────────────────────────────────────

function createLeafCommand(name: string, hasRun = true) {
	return defineCommand({
		meta: { name, description: `${name} command` },
		...(hasRun
			? {
					run() {
						/* noop */
					},
				}
			: {}),
	});
}

function createRootWithSubcommands(hasRun = false) {
	const buildCmd = defineCommand({
		meta: { name: "build", description: "Build the project" },
		flags: {
			entry: { type: String, description: "Entry file", default: "src/cli.ts" },
		},
		run() {
			/* noop */
		},
	});

	const devCmd = defineCommand({
		meta: { name: "dev", description: "Start dev server" },
		flags: {
			port: { type: Number, description: "Port number", default: 3000 },
		},
		run() {
			/* noop */
		},
	});

	return defineCommand({
		meta: { name: "crust", description: "Crust CLI" },
		subCommands: { build: buildCmd, dev: devCmd },
		...(hasRun
			? {
					run() {
						/* noop */
					},
				}
			: {}),
	});
}

// ────────────────────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────────────────────

describe("resolveCommand", () => {
	describe("basic resolution", () => {
		it("resolves to root command with empty argv", () => {
			const root = createRootWithSubcommands();
			const result = resolveCommand(root, []);

			expect(result.resolved).toBe(root);
			expect(result.argv).toEqual([]);
			expect(result.path).toEqual(["crust"]);
		});

		it("resolves single-level subcommand", () => {
			const root = createRootWithSubcommands();
			const result = resolveCommand(root, ["build"]);

			expect(result.resolved.meta.name).toBe("build");
			expect(result.argv).toEqual([]);
			expect(result.path).toEqual(["crust", "build"]);
		});

		it("resolves single-level subcommand with remaining flags", () => {
			const root = createRootWithSubcommands();
			const result = resolveCommand(root, ["build", "--entry", "src/index.ts"]);

			expect(result.resolved.meta.name).toBe("build");
			expect(result.argv).toEqual(["--entry", "src/index.ts"]);
			expect(result.path).toEqual(["crust", "build"]);
		});

		it("resolves single-level subcommand with remaining positionals and flags", () => {
			const root = createRootWithSubcommands();
			const result = resolveCommand(root, ["dev", "--port", "8080"]);

			expect(result.resolved.meta.name).toBe("dev");
			expect(result.argv).toEqual(["--port", "8080"]);
			expect(result.path).toEqual(["crust", "dev"]);
		});
	});

	describe("nested subcommand resolution", () => {
		it("resolves nested subcommand (2 levels)", () => {
			const templateCmd = createLeafCommand("template");
			const commandCmd = createLeafCommand("command");

			const generateCmd = defineCommand({
				meta: { name: "generate", description: "Generate files" },
				subCommands: { command: commandCmd, template: templateCmd },
			});

			const root = defineCommand({
				meta: { name: "crust", description: "Crust CLI" },
				subCommands: { generate: generateCmd },
			});

			const result = resolveCommand(root, ["generate", "command"]);

			expect(result.resolved.meta.name).toBe("command");
			expect(result.argv).toEqual([]);
			expect(result.path).toEqual(["crust", "generate", "command"]);
		});

		it("resolves deeply nested subcommand (3+ levels)", () => {
			const deepCmd = createLeafCommand("deep");

			const level2 = defineCommand({
				meta: { name: "level2", description: "Level 2" },
				subCommands: { deep: deepCmd },
			});

			const level1 = defineCommand({
				meta: { name: "level1", description: "Level 1" },
				subCommands: { level2 },
			});

			const root = defineCommand({
				meta: { name: "root", description: "Root" },
				subCommands: { level1 },
			});

			const result = resolveCommand(root, ["level1", "level2", "deep"]);

			expect(result.resolved.meta.name).toBe("deep");
			expect(result.argv).toEqual([]);
			expect(result.path).toEqual(["root", "level1", "level2", "deep"]);
		});

		it("resolves nested subcommand with remaining argv", () => {
			const commandCmd = defineCommand({
				meta: { name: "command", description: "Generate a command" },
				args: [{ name: "name", type: String, required: true }],
				run() {
					/* noop */
				},
			});

			const generateCmd = defineCommand({
				meta: { name: "generate", description: "Generate files" },
				subCommands: { command: commandCmd },
			});

			const root = defineCommand({
				meta: { name: "crust", description: "Crust CLI" },
				subCommands: { generate: generateCmd },
			});

			const result = resolveCommand(root, [
				"generate",
				"command",
				"my-cmd",
				"--verbose",
			]);

			expect(result.resolved.meta.name).toBe("command");
			expect(result.argv).toEqual(["my-cmd", "--verbose"]);
			expect(result.path).toEqual(["crust", "generate", "command"]);
		});
	});

	describe("fallback to parent", () => {
		it("falls back to parent when no subcmd matches and parent has run()", () => {
			const root = createRootWithSubcommands(true); // has run()
			const result = resolveCommand(root, ["unknown-positional"]);

			// When parent has run(), unknown candidates are treated as positionals
			expect(result.resolved).toBe(root);
			expect(result.argv).toEqual(["unknown-positional"]);
			expect(result.path).toEqual(["crust"]);
		});

		it("falls back to parent when argv starts with a flag", () => {
			const root = createRootWithSubcommands();
			const result = resolveCommand(root, ["--help"]);

			expect(result.resolved).toBe(root);
			expect(result.argv).toEqual(["--help"]);
			expect(result.path).toEqual(["crust"]);
		});

		it("falls back to parent when argv starts with short flag", () => {
			const root = createRootWithSubcommands();
			const result = resolveCommand(root, ["-h"]);

			expect(result.resolved).toBe(root);
			expect(result.argv).toEqual(["-h"]);
			expect(result.path).toEqual(["crust"]);
		});
	});

	describe("unknown subcommand errors", () => {
		it("throws error for unknown subcommand when parent has no run()", () => {
			const root = createRootWithSubcommands(); // no run()

			expect(() => resolveCommand(root, ["unknown"])).toThrow(
				'Unknown command "unknown"',
			);
		});

		it("includes 'Did you mean?' suggestion for close matches", () => {
			const root = createRootWithSubcommands(); // no run()

			try {
				resolveCommand(root, ["buld"]);
				expect(true).toBe(false); // Should not reach here
			} catch (error) {
				const message = (error as Error).message;
				expect(message).toContain('Unknown command "buld"');
				expect(message).toContain('Did you mean "build"?');
				expect(message).toContain("Available commands: build, dev");
			}
		});

		it("suggests based on prefix match", () => {
			const root = createRootWithSubcommands(); // no run()

			try {
				resolveCommand(root, ["bui"]);
				expect(true).toBe(false); // Should not reach here
			} catch (error) {
				const message = (error as Error).message;
				expect(message).toContain('Did you mean "build"?');
			}
		});

		it("lists available commands when no suggestion found", () => {
			const root = createRootWithSubcommands(); // no run()

			try {
				resolveCommand(root, ["zzzzz"]);
				expect(true).toBe(false); // Should not reach here
			} catch (error) {
				const message = (error as Error).message;
				expect(message).toContain('Unknown command "zzzzz"');
				expect(message).toContain("Available commands: build, dev");
			}
		});

		it("throws error for unknown nested subcommand", () => {
			const commandCmd = createLeafCommand("command");

			const generateCmd = defineCommand({
				meta: { name: "generate", description: "Generate files" },
				subCommands: { command: commandCmd },
			});

			const root = defineCommand({
				meta: { name: "crust", description: "Crust CLI" },
				subCommands: { generate: generateCmd },
			});

			try {
				resolveCommand(root, ["generate", "unknown"]);
				expect(true).toBe(false); // Should not reach here
			} catch (error) {
				const message = (error as Error).message;
				expect(message).toContain('Unknown command "unknown"');
				expect(message).toContain("Available commands: command");
			}
		});
	});

	describe("--help flag handling", () => {
		it("--help at root level passes through in argv", () => {
			const root = createRootWithSubcommands();
			const result = resolveCommand(root, ["--help"]);

			expect(result.resolved).toBe(root);
			expect(result.argv).toEqual(["--help"]);
			expect(result.path).toEqual(["crust"]);
		});

		it("--help at subcmd level passes through in argv", () => {
			const root = createRootWithSubcommands();
			const result = resolveCommand(root, ["build", "--help"]);

			expect(result.resolved.meta.name).toBe("build");
			expect(result.argv).toEqual(["--help"]);
			expect(result.path).toEqual(["crust", "build"]);
		});

		it("-h at subcmd level passes through in argv", () => {
			const root = createRootWithSubcommands();
			const result = resolveCommand(root, ["build", "-h"]);

			expect(result.resolved.meta.name).toBe("build");
			expect(result.argv).toEqual(["-h"]);
			expect(result.path).toEqual(["crust", "build"]);
		});

		it("--version at root level passes through in argv", () => {
			const root = createRootWithSubcommands();
			const result = resolveCommand(root, ["--version"]);

			expect(result.resolved).toBe(root);
			expect(result.argv).toEqual(["--version"]);
			expect(result.path).toEqual(["crust"]);
		});
	});

	describe("command with no subcommands", () => {
		it("resolves to root when command has no subcommands", () => {
			const cmd = createLeafCommand("serve");
			const result = resolveCommand(cmd, ["--port", "3000"]);

			expect(result.resolved).toBe(cmd);
			expect(result.argv).toEqual(["--port", "3000"]);
			expect(result.path).toEqual(["serve"]);
		});

		it("handles positional arguments correctly", () => {
			const cmd = defineCommand({
				meta: { name: "greet" },
				args: [{ name: "name", type: String, required: true }],
				run() {
					/* noop */
				},
			});
			const result = resolveCommand(cmd, ["world"]);

			expect(result.resolved).toBe(cmd);
			expect(result.argv).toEqual(["world"]);
			expect(result.path).toEqual(["greet"]);
		});
	});

	describe("edge cases", () => {
		it("handles empty subCommands record", () => {
			const cmd = defineCommand({
				meta: { name: "empty" },
				subCommands: {},
				run() {
					/* noop */
				},
			});

			const result = resolveCommand(cmd, ["something"]);
			expect(result.resolved).toBe(cmd);
			expect(result.argv).toEqual(["something"]);
			expect(result.path).toEqual(["empty"]);
		});

		it("stops at flag even if it looks like a subcommand name", () => {
			const root = createRootWithSubcommands();
			const result = resolveCommand(root, ["--build"]);

			// --build starts with -, so it's treated as a flag, not a subcommand
			expect(result.resolved).toBe(root);
			expect(result.argv).toEqual(["--build"]);
			expect(result.path).toEqual(["crust"]);
		});

		it("handles subcommand followed by -- separator", () => {
			const root = createRootWithSubcommands();
			const result = resolveCommand(root, ["build", "--", "extra"]);

			expect(result.resolved.meta.name).toBe("build");
			expect(result.argv).toEqual(["--", "extra"]);
			expect(result.path).toEqual(["crust", "build"]);
		});

		it("multiple subcommand candidates where first wins", () => {
			const root = createRootWithSubcommands(true); // has run()
			// "build" matches, then remaining args are left for the subcommand
			const result = resolveCommand(root, ["build", "dev"]);

			// "build" resolves, then "dev" is remaining argv (since build has no subcommands)
			expect(result.resolved.meta.name).toBe("build");
			expect(result.argv).toEqual(["dev"]);
			expect(result.path).toEqual(["crust", "build"]);
		});

		it("mid-level subcommand with no run and no matching child throws error", () => {
			const commandCmd = createLeafCommand("command");

			const generateCmd = defineCommand({
				meta: { name: "generate", description: "Generate files" },
				subCommands: { command: commandCmd },
				// no run()
			});

			const root = defineCommand({
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

			expect(result.resolved.meta.name).toBe("build");
			expect(result.argv).toEqual([
				"src/index.ts",
				"--entry",
				"main.ts",
				"--minify",
			]);
		});
	});

	describe("Levenshtein suggestions quality", () => {
		it("suggests exact prefix matches", () => {
			const fooCmd = createLeafCommand("foobar");
			const bazCmd = createLeafCommand("bazqux");

			const root = defineCommand({
				meta: { name: "root" },
				subCommands: { foobar: fooCmd, bazqux: bazCmd },
			});

			try {
				resolveCommand(root, ["foo"]);
				expect(true).toBe(false);
			} catch (error) {
				const message = (error as Error).message;
				expect(message).toContain('Did you mean "foobar"?');
			}
		});

		it("suggests based on small edit distance", () => {
			const installCmd = createLeafCommand("install");
			const initCmd = createLeafCommand("init");

			const root = defineCommand({
				meta: { name: "root" },
				subCommands: { install: installCmd, init: initCmd },
			});

			try {
				resolveCommand(root, ["instal"]);
				expect(true).toBe(false);
			} catch (error) {
				const message = (error as Error).message;
				expect(message).toContain('Did you mean "install"?');
			}
		});

		it("does not suggest when distance is too large", () => {
			const root = createRootWithSubcommands(); // has build, dev

			try {
				resolveCommand(root, ["completely-different"]);
				expect(true).toBe(false);
			} catch (error) {
				const message = (error as Error).message;
				expect(message).not.toContain("Did you mean");
				expect(message).toContain("Available commands: build, dev");
			}
		});
	});
});
