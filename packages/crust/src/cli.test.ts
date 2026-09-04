/**
 * Integration tests for the crust CLI entry point.
 *
 * Tests the root crust command with the build subcommand wired up,
 * verifying help output, version output, subcommand help, and error handling.
 *
 * Uses `captureExecute(app, argv)` to exercise and capture the terminal path.
 */

import { describe, expect, it } from "bun:test";

import { captureExecute } from "@crustjs/testing";

import pkg from "../package.json";
import { crustBase } from "./app.ts";
import { buildCommand } from "./commands/build.ts";
import { publishCommand } from "./commands/publish.ts";

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
			const { stdout: output } = await captureExecute(makeCrustApp(), ["--help"]);

			expect(output).toContain("crust");
			expect(output).toContain("CLI tooling for the Crust framework");
			expect(output).toContain("Usage:");
			expect(output).toContain("Commands:");
			expect(output).toContain("build");
			expect(output).toContain("publish");
			expect(output).toContain("Build your CLI for Bun, Deno, or Node");
			expect(output).toContain("Publish staged npm packages created by crust build --package");
		});

		it("should show --help and --version in options", async () => {
			const { stdout: output } = await captureExecute(makeCrustApp(), ["--help"]);

			expect(output).toContain("--help");
			expect(output).toContain("--version");
			expect(output).toContain("-h");
			expect(output).toContain("-v");
		});

		it("should show help with -h alias", async () => {
			const { stdout: output } = await captureExecute(makeCrustApp(), ["-h"]);

			expect(output).toContain("Usage:");
			expect(output).toContain("Commands:");
		});
	});

	describe("crust --version", () => {
		it("should show version from package.json", async () => {
			const { stdout: output } = await captureExecute(makeCrustApp(), ["--version"]);

			expect(output).toContain(`crust v${expectedVersion}`);
		});

		it("should show version with -v alias", async () => {
			const { stdout: output } = await captureExecute(makeCrustApp(), ["-v"]);

			expect(output).toContain(`crust v${expectedVersion}`);
		});
	});

	describe("crust (no args)", () => {
		it("should show help when invoked without a subcommand", async () => {
			const { stdout: output } = await captureExecute(makeCrustApp(), []);

			expect(output).toContain("Usage:");
			expect(output).toContain("Commands:");
			expect(output).toContain("build");
			expect(output).toContain("publish");
		});
	});

	describe("crust unknown", () => {
		it("shows root help for unknown input", async () => {
			const { stdout: output } = await captureExecute(makeCrustApp(), ["unknown"]);
			expect(output).toContain("Usage:");
			expect(output).toContain("build");
			expect(output).toContain("publish");
		});

		it("shows root help for partial command input", async () => {
			const { stdout: output } = await captureExecute(makeCrustApp(), ["buil"]);
			expect(output).toContain("Commands:");
		});
	});
});
