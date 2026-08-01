/**
 * Integration tests for the crust CLI entry point.
 *
 * Tests the root crust command with the build subcommand wired up,
 * verifying help output, version output, subcommand help, and error handling.
 *
 * Uses `Crust.execute({ argv })` instead of the removed `runCommand`.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { Crust } from "@crustjs/core";
import { prepareCommandSnapshot } from "@crustjs/core/tooling";
import { didYouMean, help, updateNotifier, version } from "@crustjs/extensions";

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

// ────────────────────────────────────────────────────────────────────────────
// Read expected version from package.json
// ────────────────────────────────────────────────────────────────────────────

const pkgPath = resolve(import.meta.dirname, "../package.json");
const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as {
	name: string;
	description: string;
	version: string;
};
const expectedVersion = pkg.version;

/**
 * Build a fresh Crust app for each test, with configurable plugins.
 * This mirrors the production `crustApp` in cli.ts but allows test-specific plugins.
 */
function makeCrustApp() {
	return new Crust(pkg.name)
		.meta({ description: pkg.description })
		.extend(
			version(expectedVersion),
			updateNotifier({
				currentVersion: expectedVersion,
				packageName: pkg.name,
			}),
			didYouMean({ mode: "help" }),
			help(),
		)
		.mount("build", buildCommand)
		.mount("publish", publishCommand);
}

// ────────────────────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────────────────────

describe("crust CLI entry point", () => {
	describe("root command", () => {
		it("should have correct meta", async () => {
			const app = makeCrustApp();
			const root = await prepareCommandSnapshot(app);
			expect(root.meta.name).toBe("@crustjs/crust");
			expect(root.meta.description).toBe("CLI tooling for the Crust framework");
		});

		it("should use extensions for root behavior", async () => {
			const app = makeCrustApp();
			const root = await prepareCommandSnapshot(app);
			expect(root.hasHandler).toBe(false);
		});

		it("should have build and publish as subcommands", async () => {
			const app = makeCrustApp();
			const root = await prepareCommandSnapshot(app);
			expect(root.subCommands).toBeDefined();
			expect(root.subCommands.build).toBeDefined();
			expect(root.subCommands.publish).toBeDefined();
			expect(root.subCommands.build?.meta.name).toBe("build");
			expect(root.subCommands.publish?.meta.name).toBe("publish");
		});
	});

	describe("crust --help", () => {
		it("should show help text with build and publish listed", async () => {
			await makeCrustApp().execute({ argv: ["--help"] });
			const output = getStdout();

			expect(output).toContain("crust");
			expect(output).toContain("CLI tooling for the Crust framework");
			expect(output).toContain("USAGE:");
			expect(output).toContain("COMMANDS:");
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

			expect(output).toContain("USAGE:");
			expect(output).toContain("COMMANDS:");
		});
	});

	describe("crust --version", () => {
		it("should show version from package.json", async () => {
			await makeCrustApp().execute({ argv: ["--version"] });
			const output = getStdout();

			expect(output).toContain(`@crustjs/crust v${expectedVersion}`);
		});

		it("should show version with -v alias", async () => {
			await makeCrustApp().execute({ argv: ["-v"] });
			const output = getStdout();

			expect(output).toContain(`@crustjs/crust v${expectedVersion}`);
		});
	});

	describe("crust (no args)", () => {
		it("should show help when invoked without a subcommand", async () => {
			await makeCrustApp().execute({ argv: [] });
			const output = getStdout();

			expect(output).toContain("USAGE:");
			expect(output).toContain("COMMANDS:");
			expect(output).toContain("build");
			expect(output).toContain("publish");
		});
	});

	describe("crust unknown", () => {
		it("shows root help for unknown input", async () => {
			await makeCrustApp().execute({ argv: ["unknown"] });
			const output = getStdout();
			expect(output).toContain("USAGE:");
			expect(output).toContain("build");
			expect(output).toContain("publish");
		});

		it("shows root help for partial command input", async () => {
			await makeCrustApp().execute({ argv: ["buil"] });
			const output = getStdout();
			expect(output).toContain("COMMANDS:");
		});
	});

	describe("self-hosting verification", () => {
		it("should use the cli builder from @crustjs/core (dogfooding)", async () => {
			const app = makeCrustApp();
			const root = await prepareCommandSnapshot(app);
			expect(root.meta).toBeDefined();
			expect(root.subCommands).toBeDefined();
		});

		it("should have version that matches package.json", () => {
			expect(typeof expectedVersion).toBe("string");
			expect(expectedVersion.length).toBeGreaterThan(0);
		});
	});

	describe("update notifier extension wiring", () => {
		it("should include updateNotifier without affecting help output", async () => {
			await makeCrustApp().execute({ argv: ["--help"] });
			const output = getStdout();

			// Help output should still render correctly with updateNotifier present
			expect(output).toContain("USAGE:");
			expect(output).toContain("COMMANDS:");
			expect(output).toContain("build");
		});

		it("should include updateNotifier without affecting version output", async () => {
			await makeCrustApp().execute({ argv: ["--version"] });
			const output = getStdout();

			expect(output).toContain(`@crustjs/crust v${expectedVersion}`);
		});

		it("should coexist with all other plugins during command execution", async () => {
			// Run without arguments — should show help (no crash)
			await makeCrustApp().execute({ argv: [] });
			const output = getStdout();

			expect(output).toContain("USAGE:");
		});
	});
});
