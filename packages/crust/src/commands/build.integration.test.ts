import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { Crust } from "@crustjs/core";
import { buildCommand } from "../../src/commands/build.ts";

function getHostTarget(): string | null {
	if (process.platform === "darwin" && process.arch === "arm64") {
		return "darwin-arm64";
	}

	if (process.platform === "darwin" && process.arch === "x64") {
		return "darwin-x64";
	}

	if (process.platform === "linux" && process.arch === "arm64") {
		return "linux-arm64";
	}

	if (process.platform === "linux" && process.arch === "x64") {
		return "linux-x64";
	}

	if (process.platform === "win32" && process.arch === "arm64") {
		return "windows-arm64";
	}

	if (process.platform === "win32" && process.arch === "x64") {
		return "windows-x64";
	}

	return null;
}

// ────────────────────────────────────────────────────────────────────────────
// Integration test: single-target build (--target flag)
// ────────────────────────────────────────────────────────────────────────────

describe("crust build integration — single target", () => {
	const tmpDir = join(import.meta.dir, ".tmp-build-integration");
	const crustCliPath = resolve(import.meta.dir, "..", "cli.ts");
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
			const app = new Crust("test").command(buildCommand);
			await app.execute({
				argv: [
					"build",
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
			const app = new Crust("test").command(buildCommand);
			await app.execute({
				argv: [
					"build",
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
			const app = new Crust("test").command(buildCommand);
			await app.execute({
				argv: ["build", "--entry", "src/cli.ts", "--target", "darwin-arm64"],
			});
		} finally {
			console.log = originalLog;
		}

		// Single target without --outfile: uses dist/<package-name>
		const expectedOut = resolve(tmpDir, "dist", "test-build-cli");
		expect(existsSync(expectedOut)).toBe(true);
		expect(logs.some((l) => l.includes(expectedOut))).toBe(true);
	});

	it.skipIf(getHostTarget() === null)(
		"applies --env-file to validation and embeds PUBLIC_ constants only",
		async () => {
			const hostTarget = getHostTarget();
			if (!hostTarget) return;

			const prevCwd = process.cwd;
			process.cwd = () => tmpDir;
			try {
				writeFileSync(
					join(tmpDir, "src", "env-cli.ts"),
					`#!/usr/bin/env bun
if (
  process.env.CRUST_INTERNAL_VALIDATE_ONLY === "1" &&
  !process.env.REQUIRED_BUILD_VAR
) {
  throw new Error("Missing REQUIRED_BUILD_VAR");
}
console.log(JSON.stringify({
  publicValue: process.env.PUBLIC_MESSAGE,
  secretValue: process.env.SECRET_TOKEN ?? null,
}));
`,
				);
				writeFileSync(
					join(tmpDir, ".env.build"),
					[
						"REQUIRED_BUILD_VAR=1",
						"PUBLIC_MESSAGE=hello-from-build",
						"SECRET_TOKEN=super-secret",
					].join("\n"),
				);

				const outPath = join(tmpDir, "dist", "env-cli");
				const app = new Crust("test").command(buildCommand);

				await app.execute({
					argv: [
						"build",
						"--entry",
						"src/env-cli.ts",
						"--outfile",
						outPath,
						"--target",
						hostTarget,
						"--env-file",
						".env.build",
					],
				});

				expect(existsSync(outPath)).toBe(true);

				const proc = Bun.spawn([outPath], {
					cwd: tmpDir,
					env: {},
					stdout: "pipe",
					stderr: "pipe",
				});
				const exitCode = await proc.exited;
				const stdout = await new Response(proc.stdout).text();

				expect(exitCode).toBe(0);
				expect(JSON.parse(stdout.trim())).toEqual({
					publicValue: "hello-from-build",
					secretValue: null,
				});
			} finally {
				process.cwd = prevCwd;
			}
		},
	);

	it.skipIf(getHostTarget() === null)(
		"uses Bun auto-loaded cwd env to embed PUBLIC_ constants when --env-file is omitted",
		async () => {
			const hostTarget = getHostTarget();
			if (!hostTarget) return;

			const autoloadDir = join(tmpDir, "autoload-workspace");
			mkdirSync(join(autoloadDir, "src"), { recursive: true });

			writeFileSync(
				join(autoloadDir, "src", "autoload-cli.ts"),
				`#!/usr/bin/env bun
if (
  process.env.CRUST_INTERNAL_VALIDATE_ONLY === "1" &&
  !process.env.REQUIRED_BUILD_VAR
) {
  throw new Error("Missing REQUIRED_BUILD_VAR");
}
console.log(JSON.stringify({
  publicValue: process.env.PUBLIC_MESSAGE,
  secretValue: process.env.SECRET_TOKEN ?? null,
}));
`,
			);
			writeFileSync(
				join(autoloadDir, ".env"),
				[
					"REQUIRED_BUILD_VAR=1",
					"PUBLIC_MESSAGE=hello-from-autoload",
					"SECRET_TOKEN=autoload-secret",
				].join("\n"),
			);

			const outPath = join(autoloadDir, "dist", "autoload-cli");
			const proc = Bun.spawn(
				[
					process.execPath,
					crustCliPath,
					"build",
					"--entry",
					"src/autoload-cli.ts",
					"--outfile",
					outPath,
					"--target",
					hostTarget,
				],
				{
					cwd: autoloadDir,
					env: {
						...process.env,
						BUN_BE_BUN: "1",
					},
					stdout: "pipe",
					stderr: "pipe",
				},
			);

			const [exitCode, _stderr] = await Promise.all([
				proc.exited,
				new Response(proc.stderr).text(),
			]);
			expect(exitCode).toBe(0);
			expect(existsSync(outPath)).toBe(true);

			const runtimeDir = join(autoloadDir, "runtime-no-env");
			mkdirSync(runtimeDir, { recursive: true });

			const built = Bun.spawn([outPath], {
				cwd: runtimeDir,
				env: {},
				stdout: "pipe",
				stderr: "pipe",
			});
			const [builtExitCode, stdout] = await Promise.all([
				built.exited,
				new Response(built.stdout).text(),
			]);

			expect(builtExitCode).toBe(0);
			expect(JSON.parse(stdout.trim())).toEqual({
				publicValue: "hello-from-autoload",
				secretValue: null,
			});
		},
	);
});
