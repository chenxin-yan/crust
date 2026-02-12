import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs, runCommand } from "@crust/core";
import { devCommand } from "../../src/commands/dev.ts";

// ────────────────────────────────────────────────────────────────────────────
// Unit tests for devCommand definition
// ────────────────────────────────────────────────────────────────────────────

describe("devCommand definition", () => {
	it("has correct meta", () => {
		expect(devCommand.meta.name).toBe("dev");
		expect(devCommand.meta.description).toBe(
			"Start your CLI in development mode with hot reload",
		);
	});

	it("has correct default flag values", () => {
		const result = parseArgs(devCommand, []);
		expect(result.flags.entry).toBe("src/cli.ts");
	});

	it("defines --entry/-e flag as string", () => {
		const result = parseArgs(devCommand, ["-e", "src/main.ts"]);
		expect(result.flags.entry).toBe("src/main.ts");
	});

	it("parses long --entry flag", () => {
		const result = parseArgs(devCommand, ["--entry", "src/app.ts"]);
		expect(result.flags.entry).toBe("src/app.ts");
	});

	it("is a frozen command object", () => {
		expect(Object.isFrozen(devCommand)).toBe(true);
	});

	it("has a run function", () => {
		expect(typeof devCommand.run).toBe("function");
	});

	it("captures rawArgs from -- separator", () => {
		const result = parseArgs(devCommand, [
			"--entry",
			"src/cli.ts",
			"--",
			"serve",
			"--port",
			"3000",
		]);
		expect(result.flags.entry).toBe("src/cli.ts");
		expect(result.rawArgs).toEqual(["serve", "--port", "3000"]);
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Error handling tests
// ────────────────────────────────────────────────────────────────────────────

describe("devCommand error handling", () => {
	it("throws descriptive error when entry file is missing", async () => {
		const originalCwd = process.cwd;
		const tmpDir = join(import.meta.dir, ".tmp-dev-missing-entry");
		mkdirSync(tmpDir, { recursive: true });

		process.cwd = () => tmpDir;

		const originalLog = console.log;
		const originalError = console.error;
		console.log = () => {};
		console.error = () => {};

		try {
			await expect(
				runCommand(devCommand, ["--entry", "nonexistent.ts"]),
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
		const tmpDir = join(import.meta.dir, ".tmp-dev-error-path");
		mkdirSync(tmpDir, { recursive: true });

		process.cwd = () => tmpDir;

		const originalLog = console.log;
		const originalError = console.error;
		console.log = () => {};
		console.error = () => {};

		try {
			await expect(
				runCommand(devCommand, ["--entry", "nonexistent.ts"]),
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
		const tmpDir = join(import.meta.dir, ".tmp-dev-suggest-entry");
		mkdirSync(tmpDir, { recursive: true });

		process.cwd = () => tmpDir;

		const originalLog = console.log;
		const originalError = console.error;
		console.log = () => {};
		console.error = () => {};

		try {
			await expect(
				runCommand(devCommand, ["--entry", "nonexistent.ts"]),
			).rejects.toThrow(/--entry/);
		} finally {
			process.cwd = originalCwd;
			console.log = originalLog;
			console.error = originalError;
			rmSync(tmpDir, { recursive: true, force: true });
		}
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Spawn args construction tests
// ────────────────────────────────────────────────────────────────────────────

describe("devCommand spawn args", () => {
	const tmpDir = join(import.meta.dir, ".tmp-dev-spawn");
	const originalCwd = process.cwd;

	beforeAll(() => {
		rmSync(tmpDir, { recursive: true, force: true });
		mkdirSync(join(tmpDir, "src"), { recursive: true });

		// Create a trivial entry file that exits immediately
		writeFileSync(
			join(tmpDir, "src", "cli.ts"),
			`#!/usr/bin/env bun
process.exit(0);
`,
		);
	});

	afterAll(() => {
		process.cwd = originalCwd;
		rmSync(tmpDir, { recursive: true, force: true });
	});

	it("spawns bun --hot with the resolved entry path", async () => {
		process.cwd = () => tmpDir;

		// Track spawned args by temporarily replacing Bun.spawn
		let spawnedArgs: string[] = [];
		const originalSpawn = Bun.spawn;

		// Create a mock that captures args and returns a fake process
		Bun.spawn = ((args: string[], _opts?: unknown) => {
			spawnedArgs = args as string[];
			// Return a minimal process-like object
			return {
				exited: Promise.resolve(0),
				kill: () => {},
				pid: 0,
				stdin: null,
				stdout: null,
				stderr: null,
			};
		}) as unknown as typeof Bun.spawn;

		const originalLog = console.log;
		console.log = () => {};

		try {
			await runCommand(devCommand, ["--entry", "src/cli.ts"]);

			expect(spawnedArgs[0]).toBe("bun");
			expect(spawnedArgs[1]).toBe("--hot");
			expect(spawnedArgs[2]).toBe(resolve(tmpDir, "src/cli.ts"));
		} finally {
			Bun.spawn = originalSpawn;
			console.log = originalLog;
		}
	});

	it("forwards rawArgs after -- to spawned process", async () => {
		process.cwd = () => tmpDir;

		let spawnedArgs: string[] = [];
		const originalSpawn = Bun.spawn;

		Bun.spawn = ((args: string[], _opts?: unknown) => {
			spawnedArgs = args as string[];
			return {
				exited: Promise.resolve(0),
				kill: () => {},
				pid: 0,
				stdin: null,
				stdout: null,
				stderr: null,
			};
		}) as unknown as typeof Bun.spawn;

		const originalLog = console.log;
		console.log = () => {};

		try {
			await runCommand(devCommand, [
				"--entry",
				"src/cli.ts",
				"--",
				"serve",
				"--port",
				"3000",
			]);

			expect(spawnedArgs[0]).toBe("bun");
			expect(spawnedArgs[1]).toBe("--hot");
			expect(spawnedArgs[2]).toBe(resolve(tmpDir, "src/cli.ts"));
			expect(spawnedArgs[3]).toBe("serve");
			expect(spawnedArgs[4]).toBe("--port");
			expect(spawnedArgs[5]).toBe("3000");
		} finally {
			Bun.spawn = originalSpawn;
			console.log = originalLog;
		}
	});

	it("uses default entry when no --entry flag provided", async () => {
		process.cwd = () => tmpDir;

		let spawnedArgs: string[] = [];
		const originalSpawn = Bun.spawn;

		Bun.spawn = ((args: string[], _opts?: unknown) => {
			spawnedArgs = args as string[];
			return {
				exited: Promise.resolve(0),
				kill: () => {},
				pid: 0,
				stdin: null,
				stdout: null,
				stderr: null,
			};
		}) as unknown as typeof Bun.spawn;

		const originalLog = console.log;
		console.log = () => {};

		try {
			await runCommand(devCommand, []);

			expect(spawnedArgs[0]).toBe("bun");
			expect(spawnedArgs[1]).toBe("--hot");
			expect(spawnedArgs[2]).toBe(resolve(tmpDir, "src/cli.ts"));
		} finally {
			Bun.spawn = originalSpawn;
			console.log = originalLog;
		}
	});

	it("prints startup message with entry path", async () => {
		process.cwd = () => tmpDir;

		const originalSpawn = Bun.spawn;
		Bun.spawn = ((_args: string[], _opts?: unknown) => {
			return {
				exited: Promise.resolve(0),
				kill: () => {},
				pid: 0,
				stdin: null,
				stdout: null,
				stderr: null,
			};
		}) as unknown as typeof Bun.spawn;

		const logs: string[] = [];
		const originalLog = console.log;
		console.log = (...args: unknown[]) => {
			logs.push(args.map(String).join(" "));
		};

		try {
			await runCommand(devCommand, ["--entry", "src/cli.ts"]);

			expect(
				logs.some((l) => l.includes("Starting dev server with hot reload")),
			).toBe(true);
			expect(logs.some((l) => l.includes(resolve(tmpDir, "src/cli.ts")))).toBe(
				true,
			);
		} finally {
			Bun.spawn = originalSpawn;
			console.log = originalLog;
		}
	});

	it("throws when child process exits with non-zero code", async () => {
		process.cwd = () => tmpDir;

		const originalSpawn = Bun.spawn;
		Bun.spawn = ((_args: string[], _opts?: unknown) => {
			return {
				exited: Promise.resolve(1),
				kill: () => {},
				pid: 0,
				stdin: null,
				stdout: null,
				stderr: null,
			};
		}) as unknown as typeof Bun.spawn;

		const originalLog = console.log;
		const originalError = console.error;
		console.log = () => {};
		console.error = () => {};

		try {
			await expect(
				runCommand(devCommand, ["--entry", "src/cli.ts"]),
			).rejects.toThrow(/Dev process exited with code 1/);
		} finally {
			Bun.spawn = originalSpawn;
			console.log = originalLog;
			console.error = originalError;
		}
	});

	it("uses inherited stdio for terminal sharing", async () => {
		process.cwd = () => tmpDir;

		let spawnOpts: Record<string, unknown> = {};
		const originalSpawn = Bun.spawn;

		Bun.spawn = ((_args: string[], opts?: Record<string, unknown>) => {
			spawnOpts = opts || {};
			return {
				exited: Promise.resolve(0),
				kill: () => {},
				pid: 0,
				stdin: null,
				stdout: null,
				stderr: null,
			};
		}) as unknown as typeof Bun.spawn;

		const originalLog = console.log;
		console.log = () => {};

		try {
			await runCommand(devCommand, ["--entry", "src/cli.ts"]);

			expect(spawnOpts.stdout).toBe("inherit");
			expect(spawnOpts.stderr).toBe("inherit");
			expect(spawnOpts.stdin).toBe("inherit");
		} finally {
			Bun.spawn = originalSpawn;
			console.log = originalLog;
		}
	});
});
