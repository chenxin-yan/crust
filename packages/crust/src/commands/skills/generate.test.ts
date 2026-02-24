/**
 * Tests for the `crust skills generate` command.
 *
 * Covers:
 * - Command definition structure (meta, args, flags, defaults)
 * - loadCommandModule: dynamic import, export resolution, error handling
 * - CLI integration: successful generation flow, error cases
 */

import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
} from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { runCommand } from "@crustjs/core";
import { helpPlugin } from "@crustjs/plugins";
import { generateCommand, loadCommandModule } from "./generate.ts";
import { skillsCommand } from "./index.ts";

// ────────────────────────────────────────────────────────────────────────────
// Test helpers
// ────────────────────────────────────────────────────────────────────────────

let stdoutChunks: string[];
let stderrChunks: string[];
let originalLog: typeof console.log;
let originalError: typeof console.error;
let originalWarn: typeof console.warn;

beforeEach(() => {
	stdoutChunks = [];
	stderrChunks = [];
	originalLog = console.log;
	originalError = console.error;
	originalWarn = console.warn;

	console.log = (...args: unknown[]) => {
		stdoutChunks.push(
			args.map((a) => (typeof a === "string" ? a : String(a))).join(" "),
		);
	};
	console.error = (...args: unknown[]) => {
		stderrChunks.push(
			args.map((a) => (typeof a === "string" ? a : String(a))).join(" "),
		);
	};
	console.warn = (...args: unknown[]) => {
		stderrChunks.push(
			args.map((a) => (typeof a === "string" ? a : String(a))).join(" "),
		);
	};
});

afterEach(() => {
	console.log = originalLog;
	console.error = originalError;
	console.warn = originalWarn;
});

function getStdout(): string {
	return stdoutChunks.join("\n");
}

// ────────────────────────────────────────────────────────────────────────────
// Test fixture setup — create temporary command modules
// ────────────────────────────────────────────────────────────────────────────

const FIXTURES_DIR = resolve(import.meta.dirname, "__test_fixtures__");

beforeAll(() => {
	// Clean up any previous test fixtures
	if (existsSync(FIXTURES_DIR)) {
		rmSync(FIXTURES_DIR, { recursive: true });
	}
	mkdirSync(FIXTURES_DIR, { recursive: true });

	// Fixture: default export command module
	writeFileSync(
		join(FIXTURES_DIR, "default-export.ts"),
		[
			'import { defineCommand } from "@crustjs/core";',
			"",
			"const cmd = defineCommand({",
			'\tmeta: { name: "test-cli", description: "A test CLI" },',
			"\trun() {},",
			"});",
			"export default cmd;",
			"",
		].join("\n"),
	);

	// Fixture: named export command module
	writeFileSync(
		join(FIXTURES_DIR, "named-export.ts"),
		[
			'import { defineCommand } from "@crustjs/core";',
			"",
			"export const myCommand = defineCommand({",
			'\tmeta: { name: "named-cli", description: "A named export CLI" },',
			"\trun() {},",
			"});",
			"",
		].join("\n"),
	);

	// Fixture: first-command fallback (no default, has an AnyCommand)
	writeFileSync(
		join(FIXTURES_DIR, "first-command.ts"),
		[
			'import { defineCommand } from "@crustjs/core";',
			"",
			'export const notACommand = "hello";',
			"export const rootCommand = defineCommand({",
			'\tmeta: { name: "fallback-cli", description: "Fallback CLI" },',
			"\trun() {},",
			"});",
			"",
		].join("\n"),
	);

	// Fixture: no valid exports
	writeFileSync(
		join(FIXTURES_DIR, "no-command.ts"),
		['export const foo = "bar";', "export const baz = 42;", ""].join("\n"),
	);

	// Fixture: complex command with subcommands
	writeFileSync(
		join(FIXTURES_DIR, "complex-command.ts"),
		[
			'import { defineCommand } from "@crustjs/core";',
			"",
			"export default defineCommand({",
			'\tmeta: { name: "complex", description: "Complex CLI" },',
			"\tsubCommands: {",
			"\t\tsub: defineCommand({",
			'\t\t\tmeta: { name: "sub", description: "Subcommand" },',
			"\t\t\tflags: {",
			'\t\t\t\tverbose: { type: "boolean", description: "Verbose output", alias: "v" },',
			"\t\t\t},",
			"\t\t\trun() {},",
			"\t\t}),",
			"\t},",
			"});",
			"",
		].join("\n"),
	);

	// Fixture: module with side-effect guard (import.meta.main pattern)
	writeFileSync(
		join(FIXTURES_DIR, "guarded-module.ts"),
		[
			'import { defineCommand } from "@crustjs/core";',
			"",
			"export const cliCommand = defineCommand({",
			'\tmeta: { name: "guarded", description: "Guarded CLI" },',
			"\trun() {},",
			"});",
			"if (import.meta.main) {",
			'\tconsole.log("This should not run during import");',
			"}",
			"",
		].join("\n"),
	);
});

afterEach(() => {
	// Clean up generated skills directories after each test
	const skillsDir = join(FIXTURES_DIR, "skills");
	if (existsSync(skillsDir)) {
		rmSync(skillsDir, { recursive: true });
	}
});

afterAll(() => {
	// Clean up entire fixtures directory after all tests complete
	if (existsSync(FIXTURES_DIR)) {
		rmSync(FIXTURES_DIR, { recursive: true });
	}
});

// ────────────────────────────────────────────────────────────────────────────
// Command definition tests
// ────────────────────────────────────────────────────────────────────────────

describe("generate command definition", () => {
	it("should have correct meta", () => {
		expect(generateCommand.meta.name).toBe("generate");
		expect(generateCommand.meta.description).toContain(
			"Generate a distributable agent skill bundle",
		);
	});

	it("should be a frozen object", () => {
		expect(Object.isFrozen(generateCommand)).toBe(true);
	});

	it("should have a run handler", () => {
		expect(typeof generateCommand.run).toBe("function");
	});

	it("should require module as a positional arg", () => {
		expect(generateCommand.args).toBeDefined();
		const moduleArg = generateCommand.args?.[0];
		expect(moduleArg).toBeDefined();
		expect(moduleArg?.name).toBe("module");
		expect(moduleArg?.type).toBe("string");
		expect(moduleArg?.required).toBe(true);
	});

	it("should have --name as a required flag", () => {
		const nameFlag = generateCommand.flags?.name;
		expect(nameFlag).toBeDefined();
		expect(nameFlag?.type).toBe("string");
		expect(nameFlag?.required).toBe(true);
	});

	it("should have --description as a required flag", () => {
		const descFlag = generateCommand.flags?.description;
		expect(descFlag).toBeDefined();
		expect(descFlag?.type).toBe("string");
		expect(descFlag?.required).toBe(true);
	});

	it("should have --version as an optional flag", () => {
		const versionFlag = generateCommand.flags?.version;
		expect(versionFlag).toBeDefined();
		expect(versionFlag?.type).toBe("string");
		// No `required` property means optional
		expect("required" in (versionFlag ?? {})).toBe(false);
	});

	it("should have --out-dir with default '.'", () => {
		const outDirFlag = generateCommand.flags?.["out-dir"];
		expect(outDirFlag).toBeDefined();
		expect(outDirFlag?.type).toBe("string");
		expect(outDirFlag?.default).toBe(".");
	});

	it("should have --clean with default true", () => {
		const cleanFlag = generateCommand.flags?.clean;
		expect(cleanFlag).toBeDefined();
		expect(cleanFlag?.type).toBe("boolean");
		expect(cleanFlag?.default).toBe(true);
	});

	it("should have --export with default 'default'", () => {
		const exportFlag = generateCommand.flags?.export;
		expect(exportFlag).toBeDefined();
		expect(exportFlag?.type).toBe("string");
		expect(exportFlag?.default).toBe("default");
	});

	it("should have correct flag aliases", () => {
		expect(generateCommand.flags?.name?.alias).toBe("n");
		expect(generateCommand.flags?.description?.alias).toBe("d");
		expect(generateCommand.flags?.version?.alias).toBe("V");
		expect(generateCommand.flags?.["out-dir"]?.alias).toBe("o");
		expect(generateCommand.flags?.export?.alias).toBe("e");
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Skills group command tests
// ────────────────────────────────────────────────────────────────────────────

describe("skills group command", () => {
	it("should have correct meta", () => {
		expect(skillsCommand.meta.name).toBe("skills");
		expect(skillsCommand.meta.description).toContain("skill generation");
	});

	it("should be a frozen object", () => {
		expect(Object.isFrozen(skillsCommand)).toBe(true);
	});

	it("should have generate as a subcommand", () => {
		expect(skillsCommand.subCommands).toBeDefined();
		expect(skillsCommand.subCommands?.generate).toBeDefined();
		expect(skillsCommand.subCommands?.generate?.meta.name).toBe("generate");
	});

	it("should not have a run handler (group only)", () => {
		expect(skillsCommand.run).toBeUndefined();
	});
});

// ────────────────────────────────────────────────────────────────────────────
// loadCommandModule tests
// ────────────────────────────────────────────────────────────────────────────

describe("loadCommandModule", () => {
	it("should load a default export", async () => {
		const cmd = await loadCommandModule(
			join(FIXTURES_DIR, "default-export.ts"),
		);
		expect(cmd.meta.name).toBe("test-cli");
		expect(cmd.meta.description).toBe("A test CLI");
	});

	it("should load a named export with --export flag", async () => {
		const cmd = await loadCommandModule(
			join(FIXTURES_DIR, "named-export.ts"),
			"myCommand",
		);
		expect(cmd.meta.name).toBe("named-cli");
	});

	it("should fall back to first AnyCommand export when no default", async () => {
		const cmd = await loadCommandModule(join(FIXTURES_DIR, "first-command.ts"));
		expect(cmd.meta.name).toBe("fallback-cli");
	});

	it("should load complex commands with subcommands", async () => {
		const cmd = await loadCommandModule(
			join(FIXTURES_DIR, "complex-command.ts"),
		);
		expect(cmd.meta.name).toBe("complex");
		expect(cmd.subCommands?.sub).toBeDefined();
	});

	it("should handle modules with import.meta.main guards", async () => {
		const cmd = await loadCommandModule(
			join(FIXTURES_DIR, "guarded-module.ts"),
			"cliCommand",
		);
		expect(cmd.meta.name).toBe("guarded");
	});

	it("should throw for non-existent module", async () => {
		await expect(
			loadCommandModule(join(FIXTURES_DIR, "nonexistent.ts")),
		).rejects.toThrow("Failed to import command module");
	});

	it("should throw when no valid command export found", async () => {
		await expect(
			loadCommandModule(join(FIXTURES_DIR, "no-command.ts")),
		).rejects.toThrow("No valid command export found");
	});

	it("should throw when specific named export is not a command", async () => {
		await expect(
			loadCommandModule(join(FIXTURES_DIR, "no-command.ts"), "foo"),
		).rejects.toThrow("No valid command export found");
	});

	it("should include available exports in error message", async () => {
		try {
			await loadCommandModule(join(FIXTURES_DIR, "no-command.ts"));
		} catch (error) {
			expect((error as Error).message).toContain("foo");
			expect((error as Error).message).toContain("baz");
		}
	});
});

// ────────────────────────────────────────────────────────────────────────────
// CLI integration tests — successful generation
// ────────────────────────────────────────────────────────────────────────────

describe("crust skills generate (integration)", () => {
	it("should generate a skill bundle from a command module", async () => {
		const modulePath = join(FIXTURES_DIR, "default-export.ts");

		await runCommand(skillsCommand, {
			argv: [
				"generate",
				modulePath,
				"--name",
				"test-skill",
				"--description",
				"Test skill bundle",
				"--out-dir",
				FIXTURES_DIR,
			],
		});

		const output = getStdout();
		expect(output).toContain('Generated skill "test-skill"');
		expect(output).toContain("files");

		// Verify output directory was created
		const skillDir = join(FIXTURES_DIR, "skills", "test-skill");
		expect(existsSync(skillDir)).toBe(true);
		expect(existsSync(join(skillDir, "SKILL.md"))).toBe(true);
		expect(existsSync(join(skillDir, "command-index.md"))).toBe(true);
		expect(existsSync(join(skillDir, "manifest.json"))).toBe(true);
		expect(existsSync(join(skillDir, "README.md"))).toBe(true);
	});

	it("should generate with optional --version flag", async () => {
		const modulePath = join(FIXTURES_DIR, "default-export.ts");

		await runCommand(skillsCommand, {
			argv: [
				"generate",
				modulePath,
				"--name",
				"versioned-skill",
				"--description",
				"A versioned skill",
				"--version",
				"2.0.0",
				"--out-dir",
				FIXTURES_DIR,
			],
		});

		const output = getStdout();
		expect(output).toContain('Generated skill "versioned-skill"');

		// Verify manifest.json contains version
		const manifestPath = join(
			FIXTURES_DIR,
			"skills",
			"versioned-skill",
			"manifest.json",
		);
		const manifest = JSON.parse(
			require("node:fs").readFileSync(manifestPath, "utf-8"),
		);
		expect(manifest.version).toBe("2.0.0");
	});

	it("should generate with a named export using --export", async () => {
		const modulePath = join(FIXTURES_DIR, "named-export.ts");

		await runCommand(skillsCommand, {
			argv: [
				"generate",
				modulePath,
				"--name",
				"named-skill",
				"--description",
				"Named export skill",
				"--export",
				"myCommand",
				"--out-dir",
				FIXTURES_DIR,
			],
		});

		const output = getStdout();
		expect(output).toContain('Generated skill "named-skill"');

		const skillDir = join(FIXTURES_DIR, "skills", "named-skill");
		expect(existsSync(skillDir)).toBe(true);
	});

	it("should generate from complex commands with subcommands", async () => {
		const modulePath = join(FIXTURES_DIR, "complex-command.ts");

		await runCommand(skillsCommand, {
			argv: [
				"generate",
				modulePath,
				"--name",
				"complex-skill",
				"--description",
				"Complex CLI skill",
				"--out-dir",
				FIXTURES_DIR,
			],
		});

		const output = getStdout();
		expect(output).toContain('Generated skill "complex-skill"');

		// Should have subcommand docs
		const skillDir = join(FIXTURES_DIR, "skills", "complex-skill");
		expect(existsSync(join(skillDir, "commands"))).toBe(true);
	});

	it("should support --no-clean to keep existing files", async () => {
		const modulePath = join(FIXTURES_DIR, "default-export.ts");
		const skillDir = join(FIXTURES_DIR, "skills", "no-clean-skill");

		// First generation
		await runCommand(skillsCommand, {
			argv: [
				"generate",
				modulePath,
				"--name",
				"no-clean-skill",
				"--description",
				"Test",
				"--out-dir",
				FIXTURES_DIR,
			],
		});

		// Add a custom file
		writeFileSync(join(skillDir, "custom.txt"), "custom content");

		// Second generation with --no-clean
		await runCommand(skillsCommand, {
			argv: [
				"generate",
				modulePath,
				"--name",
				"no-clean-skill",
				"--description",
				"Test",
				"--out-dir",
				FIXTURES_DIR,
				"--no-clean",
			],
		});

		// Custom file should still exist
		expect(existsSync(join(skillDir, "custom.txt"))).toBe(true);
	});

	it("should support flag aliases", async () => {
		const modulePath = join(FIXTURES_DIR, "default-export.ts");

		await runCommand(skillsCommand, {
			argv: [
				"generate",
				modulePath,
				"-n",
				"alias-skill",
				"-d",
				"Alias test",
				"-o",
				FIXTURES_DIR,
			],
		});

		const output = getStdout();
		expect(output).toContain('Generated skill "alias-skill"');
	});

	it("should show help for skills with --help", async () => {
		await runCommand(skillsCommand, {
			argv: ["--help"],
			plugins: [helpPlugin()],
		});

		const output = getStdout();
		expect(output).toContain("skills");
		expect(output).toContain("generate");
	});
});

// ────────────────────────────────────────────────────────────────────────────
// CLI integration tests — error cases
// ────────────────────────────────────────────────────────────────────────────

describe("crust skills generate (error cases)", () => {
	it("should error when module path does not exist", async () => {
		await expect(
			runCommand(skillsCommand, {
				argv: [
					"generate",
					"./nonexistent.ts",
					"--name",
					"fail",
					"--description",
					"test",
				],
			}),
		).rejects.toThrow("Failed to import command module");
	});

	it("should error when module has no valid command export", async () => {
		await expect(
			runCommand(skillsCommand, {
				argv: [
					"generate",
					join(FIXTURES_DIR, "no-command.ts"),
					"--name",
					"fail",
					"--description",
					"test",
				],
			}),
		).rejects.toThrow("No valid command export found");
	});
});
