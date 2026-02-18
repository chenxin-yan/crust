import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs, runCommand } from "@crustjs/core";
import { buildCommand, resolveOutfile } from "../../src/commands/build.ts";

// ────────────────────────────────────────────────────────────────────────────
// Unit tests for buildCommand definition
// ────────────────────────────────────────────────────────────────────────────

describe("buildCommand definition", () => {
	it("has correct meta", () => {
		expect(buildCommand.meta.name).toBe("build");
		expect(buildCommand.meta.description).toBe(
			"Compile your CLI to a standalone executable",
		);
	});

	it("has correct default flag values", () => {
		const result = parseArgs(buildCommand, []);
		expect(result.flags.entry).toBe("src/cli.ts");
		expect(result.flags.minify).toBe(true);
		expect(result.flags.outfile).toBeUndefined();
		expect(result.flags.name).toBeUndefined();
	});

	it("defines --entry/-e flag as string", () => {
		const result = parseArgs(buildCommand, ["-e", "src/main.ts"]);
		expect(result.flags.entry).toBe("src/main.ts");
	});

	it("defines --outfile/-o flag as string", () => {
		const result = parseArgs(buildCommand, ["-o", "./my-cli"]);
		expect(result.flags.outfile).toBe("./my-cli");
	});

	it("defines --name/-n flag as string", () => {
		const result = parseArgs(buildCommand, ["-n", "my-tool"]);
		expect(result.flags.name).toBe("my-tool");
	});

	it("defines --minify flag as boolean with default true", () => {
		const result = parseArgs(buildCommand, []);
		expect(result.flags.minify).toBe(true);
	});

	it("supports --no-minify to disable minification", () => {
		const result = parseArgs(buildCommand, ["--no-minify"]);
		expect(result.flags.minify).toBe(false);
	});

	it("is a frozen command object", () => {
		expect(Object.isFrozen(buildCommand)).toBe(true);
	});

	it("has a run function", () => {
		expect(typeof buildCommand.run).toBe("function");
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Unit tests for resolveOutfile
// ────────────────────────────────────────────────────────────────────────────

describe("resolveOutfile", () => {
	const cwd = "/test/project";
	const entry = "/test/project/src/cli.ts";

	it("uses --outfile when provided", () => {
		const result = resolveOutfile("./my-cli", undefined, entry, cwd);
		expect(result).toBe(resolve(cwd, "./my-cli"));
	});

	it("resolves --outfile relative to cwd", () => {
		const result = resolveOutfile("dist/output", undefined, entry, cwd);
		expect(result).toBe(resolve(cwd, "dist/output"));
	});

	it("uses --name as dist/<name> when --outfile not provided", () => {
		const result = resolveOutfile(undefined, "my-tool", entry, cwd);
		expect(result).toBe(resolve(cwd, "dist", "my-tool"));
	});

	it("prefers --outfile over --name", () => {
		const result = resolveOutfile("./custom", "my-tool", entry, cwd);
		expect(result).toBe(resolve(cwd, "./custom"));
	});

	describe("with package.json", () => {
		const tmpDir = join(import.meta.dir, ".tmp-resolve-test");

		beforeAll(() => {
			mkdirSync(tmpDir, { recursive: true });
		});

		afterAll(() => {
			rmSync(tmpDir, { recursive: true, force: true });
		});

		it("falls back to package.json name when no --outfile or --name", () => {
			writeFileSync(
				join(tmpDir, "package.json"),
				JSON.stringify({ name: "my-cli-app" }),
			);
			const result = resolveOutfile(
				undefined,
				undefined,
				join(tmpDir, "src/cli.ts"),
				tmpDir,
			);
			expect(result).toBe(resolve(tmpDir, "dist", "my-cli-app"));
		});

		it("strips scope prefix from package.json name", () => {
			writeFileSync(
				join(tmpDir, "package.json"),
				JSON.stringify({ name: "@scope/my-cli" }),
			);
			const result = resolveOutfile(
				undefined,
				undefined,
				join(tmpDir, "src/cli.ts"),
				tmpDir,
			);
			expect(result).toBe(resolve(tmpDir, "dist", "my-cli"));
		});
	});

	it("falls back to entry filename when no --outfile, --name, or package.json", () => {
		// Use a path that won't have a package.json
		const noPackageCwd = "/nonexistent/path/for/test";
		const testEntry = "/nonexistent/path/for/test/src/main.ts";
		const result = resolveOutfile(
			undefined,
			undefined,
			testEntry,
			noPackageCwd,
		);
		expect(result).toBe(resolve(noPackageCwd, "dist", "main"));
	});

	it("strips file extension from entry filename", () => {
		const noPackageCwd = "/nonexistent/path/for/test";
		const testEntry = "/nonexistent/path/for/test/src/app.cli.ts";
		const result = resolveOutfile(
			undefined,
			undefined,
			testEntry,
			noPackageCwd,
		);
		expect(result).toBe(resolve(noPackageCwd, "dist", "app.cli"));
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Error handling tests
// ────────────────────────────────────────────────────────────────────────────

describe("buildCommand error handling", () => {
	it("throws descriptive error when entry file is missing", async () => {
		const originalCwd = process.cwd;
		const tmpDir = join(import.meta.dir, ".tmp-missing-entry");
		mkdirSync(tmpDir, { recursive: true });

		// Mock process.cwd to return our tmp dir
		process.cwd = () => tmpDir;

		const originalLog = console.log;
		const originalError = console.error;
		console.log = () => {};
		console.error = () => {};

		try {
			await expect(
				runCommand(buildCommand, { argv: ["--entry", "nonexistent.ts"] }),
			).rejects.toThrow(/Entry file not found/);
		} finally {
			process.cwd = originalCwd;
			console.log = originalLog;
			console.error = originalError;
			rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	it("error message includes the resolved path", async () => {
		const originalCwd = process.cwd;
		const tmpDir = join(import.meta.dir, ".tmp-error-path");
		mkdirSync(tmpDir, { recursive: true });

		process.cwd = () => tmpDir;

		const originalLog = console.log;
		const originalError = console.error;
		console.log = () => {};
		console.error = () => {};

		try {
			await expect(
				runCommand(buildCommand, { argv: ["--entry", "nonexistent.ts"] }),
			).rejects.toThrow(resolve(tmpDir, "nonexistent.ts"));
		} finally {
			process.cwd = originalCwd;
			console.log = originalLog;
			console.error = originalError;
			rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	it("error message suggests --entry flag", async () => {
		const originalCwd = process.cwd;
		const tmpDir = join(import.meta.dir, ".tmp-suggest-entry");
		mkdirSync(tmpDir, { recursive: true });

		process.cwd = () => tmpDir;

		const originalLog = console.log;
		const originalError = console.error;
		console.log = () => {};
		console.error = () => {};

		try {
			await expect(
				runCommand(buildCommand, { argv: ["--entry", "nonexistent.ts"] }),
			).rejects.toThrow(/--entry/);
		} finally {
			process.cwd = originalCwd;
			console.log = originalLog;
			console.error = originalError;
			rmSync(tmpDir, { recursive: true, force: true });
		}
	});
});
