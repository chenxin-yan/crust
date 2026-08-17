/**
 * Integration tests for the crust CLI entry point.
 *
 * Tests the root crust command with the build subcommand wired up,
 * verifying help output, version output, subcommand help, and error handling.
 *
 * Uses `Crust.execute({ argv })` instead of the removed `runCommand`.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import pkg from "../package.json";
import { crustBase } from "./app.ts";
import { buildCommand } from "./commands/build.ts";
import { publishCommand } from "./commands/publish.ts";

// ────────────────────────────────────────────────────────────────────────────
// Test helpers — capture console output
// ────────────────────────────────────────────────────────────────────────────

let stdoutChunks: string[];
let stderrChunks: string[];
let originalLog: typeof console.log;
let originalError: typeof console.error;
let originalWarn: typeof console.warn;
let originalExitCode: typeof process.exitCode;

beforeEach(() => {
	stdoutChunks = [];
	stderrChunks = [];
	originalLog = console.log;
	originalError = console.error;
	originalWarn = console.warn;
	originalExitCode = process.exitCode;

	console.log = (...args: unknown[]) => {
		stdoutChunks.push(args.map((a) => (typeof a === "string" ? a : String(a))).join(" "));
	};
	console.error = (...args: unknown[]) => {
		stderrChunks.push(args.map((a) => (typeof a === "string" ? a : String(a))).join(" "));
	};
	console.warn = (...args: unknown[]) => {
		stderrChunks.push(args.map((a) => (typeof a === "string" ? a : String(a))).join(" "));
	};
});

afterEach(() => {
	console.log = originalLog;
	console.error = originalError;
	console.warn = originalWarn;
	process.exitCode = originalExitCode;
});

function getStdout(): string {
	return stdoutChunks.join("\n");
}

function _getStderr(): string {
	return stderrChunks.join("\n");
}

const expectedVersion = pkg.version;

/** Build a fresh app from the production root builder for each test. */
function makeCrustApp() {
	return crustBase.add(buildCommand, publishCommand);
}

// ────────────────────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────────────────────

describe("crust CLI entry point", () => {
	describe("crust --help", () => {
		it("should show help text with build and publish listed", async () => {
			await makeCrustApp().execute({ argv: ["--help"] });
			const output = getStdout();

			expect(output).toContain("crust");
			expect(output).toContain("CLI tooling for the Crust framework");
			expect(output).toContain("Usage:");
			expect(output).toContain("Commands:");
			expect(output).toContain("build");
			expect(output).toContain("publish");
			expect(output).toContain("Compile your CLI to a standalone executable");
			expect(output).toContain("Publish staged npm packages created by crust build --package");
		});

		it("should show --help and --version in options", async () => {
			await makeCrustApp().execute({ argv: ["--help"] });
			const output = getStdout();

			expect(output).toContain("--help");
			expect(output).toContain("--version");
			expect(output).toContain("-h");
			expect(output).toContain("-v");
		});

		it("should show help with -h alias", async () => {
			await makeCrustApp().execute({ argv: ["-h"] });
			const output = getStdout();

			expect(output).toContain("Usage:");
			expect(output).toContain("Commands:");
		});
	});

	describe("crust --version", () => {
		it("should show version from package.json", async () => {
			await makeCrustApp().execute({ argv: ["--version"] });
			const output = getStdout();

			expect(output).toContain(`crust v${expectedVersion}`);
		});

		it("should show version with -v alias", async () => {
			await makeCrustApp().execute({ argv: ["-v"] });
			const output = getStdout();

			expect(output).toContain(`crust v${expectedVersion}`);
		});
	});

	describe("crust (no args)", () => {
		it("should show help when invoked without a subcommand", async () => {
			await makeCrustApp().execute({ argv: [] });
			const output = getStdout();

			expect(output).toContain("Usage:");
			expect(output).toContain("Commands:");
			expect(output).toContain("build");
			expect(output).toContain("publish");
		});
	});

	describe("crust unknown", () => {
		it("shows root help for unknown input", async () => {
			await makeCrustApp().execute({ argv: ["unknown"] });
			const output = getStdout();
			expect(output).toContain("Usage:");
			expect(output).toContain("build");
			expect(output).toContain("publish");
		});

		it("shows root help for partial command input", async () => {
			await makeCrustApp().execute({ argv: ["buil"] });
			const output = getStdout();
			expect(output).toContain("Commands:");
		});
	});
});
