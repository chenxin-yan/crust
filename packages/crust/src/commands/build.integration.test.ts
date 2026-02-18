import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
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

	it("built binary is executable and produces correct output", async () => {
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
	});

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

// ────────────────────────────────────────────────────────────────────────────
// Integration test: default all-target build with resolver
// ────────────────────────────────────────────────────────────────────────────

describe("crust build integration — default all-target + resolver", () => {
	const tmpDir = join(import.meta.dir, ".tmp-build-all-integration");
	const originalCwd = process.cwd;

	beforeAll(() => {
		rmSync(tmpDir, { recursive: true, force: true });
		mkdirSync(join(tmpDir, "src"), { recursive: true });
		mkdirSync(join(tmpDir, "dist"), { recursive: true });

		writeFileSync(
			join(tmpDir, "src", "cli.ts"),
			`#!/usr/bin/env bun
console.log("hello from all-target build");
`,
		);

		writeFileSync(
			join(tmpDir, "package.json"),
			JSON.stringify({ name: "test-all-build", version: "1.0.0" }),
		);
	});

	afterAll(() => {
		process.cwd = originalCwd;
		rmSync(tmpDir, { recursive: true, force: true });
	});

	it("builds all targets and generates a JS resolver", async () => {
		process.cwd = () => tmpDir;

		const logs: string[] = [];
		const originalLog = console.log;
		console.log = (...args: unknown[]) => {
			logs.push(args.map(String).join(" "));
		};

		try {
			await runCommand(buildCommand, {
				argv: ["--entry", "src/cli.ts"],
			});
		} finally {
			console.log = originalLog;
		}

		// Verify all 5 binaries exist
		expect(
			existsSync(join(tmpDir, "dist", "test-all-build-bun-linux-x64-baseline")),
		).toBe(true);
		expect(
			existsSync(join(tmpDir, "dist", "test-all-build-bun-linux-arm64")),
		).toBe(true);
		expect(
			existsSync(join(tmpDir, "dist", "test-all-build-bun-darwin-x64")),
		).toBe(true);
		expect(
			existsSync(join(tmpDir, "dist", "test-all-build-bun-darwin-arm64")),
		).toBe(true);
		expect(
			existsSync(
				join(tmpDir, "dist", "test-all-build-bun-windows-x64-baseline.exe"),
			),
		).toBe(true);

		// Verify resolver was generated
		const resolverPath = join(tmpDir, "dist", "test-all-build.js");
		expect(existsSync(resolverPath)).toBe(true);

		// Verify resolver content
		const resolverContent = readFileSync(resolverPath, "utf-8");
		expect(resolverContent).toContain("#!/usr/bin/env node");
		expect(resolverContent).toContain("linux-x64");
		expect(resolverContent).toContain("darwin-arm64");
		expect(resolverContent).toContain("win32-x64");
		expect(resolverContent).toContain("test-all-build-bun-linux-x64-baseline");
		expect(resolverContent).toContain(
			"test-all-build-bun-windows-x64-baseline.exe",
		);
		expect(resolverContent).toContain("execFileSync");

		// Verify logs mention resolver
		expect(logs.some((l) => l.includes("Resolver:"))).toBe(true);
		expect(logs.some((l) => l.includes("test-all-build.js"))).toBe(true);
	});

	it("resolver can execute the host-platform binary", async () => {
		const resolverPath = join(tmpDir, "dist", "test-all-build.js");
		if (!existsSync(resolverPath)) {
			return;
		}

		// Run the resolver using node
		const proc = Bun.spawn(["node", resolverPath], {
			stdout: "pipe",
			stderr: "pipe",
		});

		const exitCode = await proc.exited;
		const stdout = await new Response(proc.stdout).text();

		expect(exitCode).toBe(0);
		expect(stdout.trim()).toBe("hello from all-target build");
	});
});
