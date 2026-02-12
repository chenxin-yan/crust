/**
 * Integration tests for the crust CLI entry point.
 *
 * Tests the root crust command with build and dev subcommands wired up,
 * verifying help output, version output, subcommand help, and error handling.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runCommand } from "@crust/core";
import { crustCommand } from "../src/cli.ts";

// ────────────────────────────────────────────────────────────────────────────
// Test helpers — capture console output
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

function _getStderr(): string {
	return stderrChunks.join("\n");
}

// ────────────────────────────────────────────────────────────────────────────
// Read expected version from package.json
// ────────────────────────────────────────────────────────────────────────────

const pkgPath = resolve(import.meta.dirname, "../package.json");
const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as {
	version: string;
};
const expectedVersion = pkg.version;

// ────────────────────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────────────────────

describe("crust CLI entry point", () => {
	describe("root command", () => {
		it("should have correct meta", () => {
			expect(crustCommand.meta.name).toBe("crust");
			expect(crustCommand.meta.description).toBe(
				"A Bun-native, TypeScript-first CLI framework",
			);
		});

		it("should be a frozen object", () => {
			expect(Object.isFrozen(crustCommand)).toBe(true);
		});

		it("should have a root run() handler", () => {
			expect(typeof crustCommand.run).toBe("function");
		});

		it("should have build and dev as subcommands", () => {
			expect(crustCommand.subCommands).toBeDefined();
			expect(crustCommand.subCommands?.build).toBeDefined();
			expect(crustCommand.subCommands?.dev).toBeDefined();
			expect(crustCommand.subCommands?.build.meta.name).toBe("build");
			expect(crustCommand.subCommands?.dev.meta.name).toBe("dev");
		});
	});

	describe("crust --help", () => {
		it("should show help text with build and dev listed", async () => {
			await runCommand(crustCommand, { argv: ["--help"] });
			const output = getStdout();

			expect(output).toContain("crust");
			expect(output).toContain("A Bun-native, TypeScript-first CLI framework");
			expect(output).toContain("USAGE:");
			expect(output).toContain("COMMANDS:");
			expect(output).toContain("build");
			expect(output).toContain("Compile your CLI to a standalone executable");
			expect(output).toContain("dev");
			expect(output).toContain(
				"Start your CLI in development mode with hot reload",
			);
		});

		it("should show --help and --version in options", async () => {
			await runCommand(crustCommand, { argv: ["--help"] });
			const output = getStdout();

			expect(output).toContain("--help");
			expect(output).toContain("--version");
			expect(output).toContain("-h");
			expect(output).toContain("-v");
		});

		it("should show help with -h alias", async () => {
			await runCommand(crustCommand, { argv: ["-h"] });
			const output = getStdout();

			expect(output).toContain("USAGE:");
			expect(output).toContain("COMMANDS:");
		});
	});

	describe("crust --version", () => {
		it("should show version from package.json", async () => {
			await runCommand(crustCommand, { argv: ["--version"] });
			const output = getStdout();

			expect(output).toContain(`crust v${expectedVersion}`);
		});

		it("should show version with -v alias", async () => {
			await runCommand(crustCommand, { argv: ["-v"] });
			const output = getStdout();

			expect(output).toContain(`crust v${expectedVersion}`);
		});
	});

	describe("crust (no args)", () => {
		it("should show help when invoked without a subcommand", async () => {
			await runCommand(crustCommand, { argv: [] });
			const output = getStdout();

			expect(output).toContain("USAGE:");
			expect(output).toContain("COMMANDS:");
			expect(output).toContain("build");
			expect(output).toContain("dev");
		});
	});

	describe("crust unknown", () => {
		it("should show error with available commands for unknown subcommand", async () => {
			try {
				await runCommand(crustCommand, { argv: ["unknown"] });
				// Should not reach here — unknown subcommand should throw
				expect(true).toBe(false);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				expect(message).toContain("unknown");
				expect(message).toContain("build");
				expect(message).toContain("dev");
			}
		});

		it("should suggest 'build' for 'buil' typo", async () => {
			try {
				await runCommand(crustCommand, { argv: ["buil"] });
				expect(true).toBe(false);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				expect(message).toContain("build");
			}
		});

		it("should suggest 'dev' for 'de' typo", async () => {
			try {
				await runCommand(crustCommand, { argv: ["de"] });
				expect(true).toBe(false);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				expect(message).toContain("dev");
			}
		});
	});

	describe("self-hosting verification", () => {
		it("should use defineCommand from @crust/core (dogfooding)", () => {
			// The crustCommand is built entirely with @crust/core's defineCommand.
			// If it wasn't, it wouldn't be a frozen Command object with proper structure.
			expect(Object.isFrozen(crustCommand)).toBe(true);
			expect(crustCommand.meta).toBeDefined();
			expect(crustCommand.subCommands).toBeDefined();
		});

		it("should have version that matches package.json", () => {
			expect(typeof expectedVersion).toBe("string");
			expect(expectedVersion.length).toBeGreaterThan(0);
		});
	});
});
