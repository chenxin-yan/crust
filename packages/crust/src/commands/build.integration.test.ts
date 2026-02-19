import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { runCommand } from "@crustjs/core";
import { buildCommand } from "../../src/commands/build.ts";

// ────────────────────────────────────────────────────────────────────────────
// Integration test: single-target build (--target flag)
// ────────────────────────────────────────────────────────────────────────────

describe("crust build integration — single target", () => {
	const tmpDir = join(import.meta.dir, ".tmp-build-integration");
	const originalCwd = process.cwd;

	beforeAll(() => {
		rmSync(tmpDir, { recursive: true, force: true });
		mkdirSync(join(tmpDir, "src"), { recursive: true });
		mkdirSync(join(tmpDir, "dist"), { recursive: true });

		// Create a trivial CLI entry file
		writeFileSync(
			join(tmpDir, "src", "cli.ts"),
			`#!/usr/bin/env bun
console.log("hello from crust build test");
`,
		);

		// Create a package.json
		writeFileSync(
			join(tmpDir, "package.json"),
			JSON.stringify({ name: "test-build-cli", version: "0.1.0" }),
		);
	});

	afterAll(() => {
		process.cwd = originalCwd;
		rmSync(tmpDir, { recursive: true, force: true });
	});

	it("builds a standalone executable for a single target", async () => {
		process.cwd = () => tmpDir;

		const logs: string[] = [];
		const originalLog = console.log;
		console.log = (...args: unknown[]) => {
			logs.push(args.map(String).join(" "));
		};

		try {
			await runCommand(buildCommand, {
				argv: [
					"--entry",
					"src/cli.ts",
					"--outfile",
					join(tmpDir, "dist", "test-cli"),
					"--target",
					"darwin-arm64",
				],
			});
		} finally {
			console.log = originalLog;
		}

		// Verify the output binary exists
		const outPath = join(tmpDir, "dist", "test-cli");
		expect(existsSync(outPath)).toBe(true);

		// Verify build progress messages were printed
		expect(logs.some((l) => l.includes("Building"))).toBe(true);
		expect(logs.some((l) => l.includes("Built successfully"))).toBe(true);
	});

	// This test can only run when the host matches the build target (darwin-arm64).
	// On CI (Linux), the cross-compiled binary exists but cannot be executed.
	it.skipIf(process.platform !== "darwin" || process.arch !== "arm64")(
		"built binary is executable and produces correct output",
		async () => {
			const outPath = join(tmpDir, "dist", "test-cli");
			if (!existsSync(outPath)) {
				// Skip if previous test didn't produce the binary
				return;
			}

			const proc = Bun.spawn([outPath], {
				stdout: "pipe",
				stderr: "pipe",
			});

			const exitCode = await proc.exited;
			const stdout = await new Response(proc.stdout).text();

			expect(exitCode).toBe(0);
			expect(stdout.trim()).toBe("hello from crust build test");
		},
	);

	it("builds without --minify when --no-minify is passed", async () => {
		process.cwd = () => tmpDir;

		const logs: string[] = [];
		const originalLog = console.log;
		console.log = (...args: unknown[]) => {
			logs.push(args.map(String).join(" "));
		};

		const outPath = join(tmpDir, "dist", "test-cli-no-minify");

		try {
			await runCommand(buildCommand, {
				argv: [
					"--entry",
					"src/cli.ts",
					"--outfile",
					outPath,
					"--no-minify",
					"--target",
					"darwin-arm64",
				],
			});
		} finally {
			console.log = originalLog;
		}

		expect(existsSync(outPath)).toBe(true);
		expect(logs.some((l) => l.includes("Built successfully"))).toBe(true);
	});

	it("uses package.json name for output when no --outfile or --name", async () => {
		process.cwd = () => tmpDir;
		mkdirSync(join(tmpDir, "dist"), { recursive: true });

		const logs: string[] = [];
		const originalLog = console.log;
		console.log = (...args: unknown[]) => {
			logs.push(args.map(String).join(" "));
		};

		try {
			await runCommand(buildCommand, {
				argv: ["--entry", "src/cli.ts", "--target", "darwin-arm64"],
			});
		} finally {
			console.log = originalLog;
		}

		// Single target without --outfile: uses dist/<package-name>
		const expectedOut = resolve(tmpDir, "dist", "test-build-cli");
		expect(existsSync(expectedOut)).toBe(true);
		expect(logs.some((l) => l.includes(expectedOut))).toBe(true);
	});
});
