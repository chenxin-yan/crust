import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Crust } from "@crustjs/core";
import { captureExecute } from "@crustjs/testing";
import { runProcess } from "@crustjs/utils/process";

import { buildCommand } from "../src/commands/build.ts";
import { BUN_TARGETS, DENO_TARGETS } from "../src/utils/build-helpers.ts";
import { hostTarget } from "./helpers.ts";

function getHostBunTarget() {
	return hostTarget();
}

function getHostDenoTarget(): string | null {
	const target = hostTarget();
	const alias = target && BUN_TARGETS.info[target].alias;
	return (
		DENO_TARGETS.targets.find((candidate) => DENO_TARGETS.info[candidate].alias === alias) ?? null
	);
}

// ────────────────────────────────────────────────────────────────────────────
// Integration test: single-target build (--target flag)
// ────────────────────────────────────────────────────────────────────────────

describe("crust build integration — single target", () => {
	const tmpDir = mkdtempSync(join(tmpdir(), "crust-build-integration-"));
	const crustCliPath = resolve(import.meta.dir, "..", "src", "cli.ts");
	const corePath = fileURLToPath(import.meta.resolve("@crustjs/core"));
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

	afterEach(() => {
		process.cwd = originalCwd;
	});

	afterAll(() => {
		process.cwd = originalCwd;
		rmSync(tmpDir, { recursive: true, force: true });
	});

	it("builds a standalone executable for a single target", async () => {
		process.cwd = () => tmpDir;

		const { stdout, exitCode } = await captureExecute(new Crust("test").add(buildCommand), [
			"build",
			"--entry",
			"src/cli.ts",
			"--no-validate",
			"--outfile",
			join(tmpDir, "dist", "test-cli"),
			"--target",
			"bun-darwin-arm64",
		]);

		expect(exitCode).toBe(0);

		// Verify the output binary exists
		const outPath = join(tmpDir, "dist", "test-cli");
		expect(existsSync(outPath)).toBe(true);

		// Verify build progress messages were printed
		expect(stdout).toContain("Building");
		expect(stdout).toContain("Built successfully");
	});

	it("builds without --minify when --no-minify is passed", async () => {
		process.cwd = () => tmpDir;

		const outPath = join(tmpDir, "dist", "test-cli-no-minify");
		const { stdout, exitCode } = await captureExecute(new Crust("test").add(buildCommand), [
			"build",
			"--entry",
			"src/cli.ts",
			"--outfile",
			outPath,
			"--no-validate",
			"--no-minify",
			"--target",
			"bun-darwin-arm64",
		]);

		expect(exitCode).toBe(0);
		expect(existsSync(outPath)).toBe(true);
		expect(stdout).toContain("Built successfully");
	});

	it("uses package.json name for output when no --outfile or --name", async () => {
		process.cwd = () => tmpDir;
		mkdirSync(join(tmpDir, "dist"), { recursive: true });

		const { stdout, exitCode } = await captureExecute(new Crust("test").add(buildCommand), [
			"build",
			"--entry",
			"src/cli.ts",
			"--no-validate",
			"--target",
			"bun-darwin-arm64",
		]);

		expect(exitCode).toBe(0);

		// Single target without --outfile: uses dist/<package-name>
		const expectedOut = resolve(tmpDir, "dist", "test-build-cli");
		expect(existsSync(expectedOut)).toBe(true);
		expect(stdout).toContain(expectedOut);
	});

	it.skipIf(getHostBunTarget() === null)(
		"applies --env-file to validation and embeds PUBLIC_ constants only",
		async () => {
			const hostTarget = getHostBunTarget();
			if (!hostTarget) return;

			const prevCwd = process.cwd;
			process.cwd = () => tmpDir;
			try {
				writeFileSync(
					join(tmpDir, "src", "env-cli.ts"),
					`#!/usr/bin/env bun
import { Crust } from ${JSON.stringify(corePath)};
if (process.env.CRUST_INTERNAL_SNAPSHOT_PATH && !process.env.REQUIRED_BUILD_VAR) {
  throw new Error("Missing REQUIRED_BUILD_VAR");
}
const app = new Crust("env-cli").action(() => console.log(JSON.stringify({
  publicValue: process.env.PUBLIC_MESSAGE,
  secretValue: process.env.SECRET_TOKEN ?? null,
})));
await app.execute();
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
				const app = new Crust("test").add(buildCommand);

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

				const { exitCode, stdout } = await runProcess(outPath, [], { cwd: tmpDir, env: {} });

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

	it.skipIf(Bun.which("node") === null)(
		"builds an executable Node artifact from package.json runtime config",
		async () => {
			process.cwd = () => tmpDir;
			writeFileSync(
				join(tmpDir, "package.json"),
				JSON.stringify({ name: "test-build-cli", version: "0.1.0", crust: { runtime: "node" } }),
			);
			// Bundle @crustjs/core into the artifact — the portability claim is "a
			// Crust CLI runs under node", not "a console.log runs under node".
			writeFileSync(
				join(tmpDir, "src", "node-core-cli.ts"),
				`import { Crust } from ${JSON.stringify(corePath)};
const app = new Crust("node-core-cli", { version: "1.0.0" }).action(() => console.log("core under node"));
await app.execute();
`,
			);
			const outPath = join(tmpDir, "dist", "node-cli.js");
			try {
				await new Crust("test").add(buildCommand).execute({
					argv: ["build", "--entry", "src/node-core-cli.ts", "--outfile", outPath, "--no-validate"],
				});
				expect(readFileSync(outPath, "utf8").startsWith("#!/usr/bin/env node\n")).toBe(true);
				if (process.platform !== "win32") expect(statSync(outPath).mode & 0o111).not.toBe(0);

				const action = await runProcess(Bun.which("node")!, [outPath]);
				expect(action.exitCode).toBe(0);
				expect(action.stdout.trim()).toBe("core under node");

				// Unknown flag exercises core's dispatch/error path in the bundle.
				const bad = await runProcess(Bun.which("node")!, [outPath, "--definitely-not-a-flag"]);
				expect(bad.exitCode).toBe(1);
				expect(bad.stderr).toContain("Unknown flag");
			} finally {
				writeFileSync(
					join(tmpDir, "package.json"),
					JSON.stringify({ name: "test-build-cli", version: "0.1.0" }),
				);
			}
		},
		30_000,
	);

	// ponytail: entry is dependency-free — `deno compile` type-checks raw
	// workspace TS (unlike published dist), so bundling @crustjs/core here fails
	// for monorepo reasons real users never hit. The dist-layer "core runs under
	// Deno" claim is covered by the CI smoke matrix; a faithful compile-with-deps
	// test needs a pack+install harness.
	it.skipIf(Bun.which("deno") === null || getHostDenoTarget() === null)(
		"builds and runs a Deno standalone executable for the host target",
		async () => {
			const hostTarget = getHostDenoTarget();
			if (!hostTarget) return;
			process.cwd = () => tmpDir;
			const outPath = join(tmpDir, "dist", "deno-cli");
			await new Crust("test").add(buildCommand).execute({
				argv: [
					"build",
					"--runtime",
					"deno",
					"--entry",
					"src/cli.ts",
					"--target",
					hostTarget,
					"--outfile",
					outPath,
					"--no-validate",
				],
			});
			const { exitCode, stdout } = await runProcess(outPath);
			expect(exitCode).toBe(0);
			expect(stdout.trim()).toBe("hello from crust build test");
		},
		60_000,
	);

	it.skipIf(getHostBunTarget() === null)(
		"uses Bun auto-loaded cwd env to embed PUBLIC_ constants when --env-file is omitted",
		async () => {
			const hostTarget = getHostBunTarget();
			if (!hostTarget) return;

			const autoloadDir = join(tmpDir, "autoload-workspace");
			mkdirSync(join(autoloadDir, "src"), { recursive: true });

			writeFileSync(
				join(autoloadDir, "src", "autoload-cli.ts"),
				`#!/usr/bin/env bun
import { Crust } from ${JSON.stringify(corePath)};
if (process.env.CRUST_INTERNAL_SNAPSHOT_PATH && !process.env.REQUIRED_BUILD_VAR) {
  throw new Error("Missing REQUIRED_BUILD_VAR");
}
const app = new Crust("autoload-cli").action(() => console.log(JSON.stringify({
  publicValue: process.env.PUBLIC_MESSAGE,
  secretValue: process.env.SECRET_TOKEN ?? null,
})));
await app.execute();
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
			const { exitCode } = await runProcess(
				process.execPath,
				[
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
					env: { ...process.env, BUN_BE_BUN: "1" },
				},
			);
			expect(exitCode).toBe(0);
			expect(existsSync(outPath)).toBe(true);

			const runtimeDir = join(autoloadDir, "runtime-no-env");
			mkdirSync(runtimeDir, { recursive: true });

			const { exitCode: builtExitCode, stdout } = await runProcess(outPath, [], {
				cwd: runtimeDir,
				env: {},
			});

			expect(builtExitCode).toBe(0);
			expect(JSON.parse(stdout.trim())).toEqual({
				publicValue: "hello-from-autoload",
				secretValue: null,
			});
		},
	);
});

// ────────────────────────────────────────────────────────────────────────────
// Integration test: compiled executables ignore the cwd bunfig.toml but keep .env
// ────────────────────────────────────────────────────────────────────────────

describe.skipIf(getHostBunTarget() === null)(
	"crust build integration — compiled executables and cwd autoloading",
	() => {
		const tmpDir = mkdtempSync(join(tmpdir(), "crust-build-autoload-"));
		const crustPackageDir = resolve(import.meta.dir, "..");
		const corePath = fileURLToPath(import.meta.resolve("@crustjs/core"));
		const originalCwd = process.cwd;
		// A cwd whose bunfig preload cannot resolve: Bun standalones that autoload
		// bunfig.toml die here with `preload not found` before any user code runs.
		const preloadCwd = join(tmpDir, "unresolvable-preload");
		const crustBinary = join(tmpDir, "crust-host");

		beforeAll(async () => {
			mkdirSync(preloadCwd, { recursive: true });
			writeFileSync(join(preloadCwd, "bunfig.toml"), 'preload = ["@opentui/solid/preload"]\n');
			writeFileSync(join(preloadCwd, ".env"), "PUBLIC_MESSAGE=from-cwd-env\n");

			process.cwd = () => crustPackageDir;
			try {
				const { exitCode, stderr } = await captureExecute(new Crust("test").add(buildCommand), [
					"build",
					"--entry",
					"src/cli.ts",
					"--outfile",
					crustBinary,
					"--target",
					getHostBunTarget()!,
					"--no-validate",
				]);
				if (exitCode !== 0) throw new Error(stderr);
			} finally {
				process.cwd = originalCwd;
			}
		});

		afterAll(() => {
			process.cwd = originalCwd;
			rmSync(tmpDir, { recursive: true, force: true });
		});

		it("starts crust's own executable from a cwd with an unresolvable bunfig preload", async () => {
			const { exitCode, stdout, stderr } = await runProcess(crustBinary, ["--version"], {
				cwd: preloadCwd,
			});
			expect(stderr).not.toContain("preload not found");
			expect(exitCode).toBe(0);
			expect(stdout).toContain("crust v");
		});

		it("keeps .env autoloading in compiled executables while ignoring the cwd bunfig", async () => {
			const projectDir = join(tmpDir, "env-project");
			mkdirSync(join(projectDir, "src"), { recursive: true });
			writeFileSync(
				join(projectDir, "src", "cli.ts"),
				`console.log(process.env.PUBLIC_MESSAGE ?? "unset");\n`,
			);
			const outPath = join(projectDir, "dist", "env-cli");
			process.cwd = () => projectDir;
			const { exitCode, stderr } = await captureExecute(new Crust("test").add(buildCommand), [
				"build",
				"--outfile",
				outPath,
				"--target",
				getHostBunTarget()!,
				"--no-validate",
			]);
			process.cwd = originalCwd;
			if (exitCode !== 0) throw new Error(stderr);

			const run = await runProcess(outPath, [], { cwd: preloadCwd, env: {} });
			expect(run.stderr).not.toContain("preload not found");
			expect(run.exitCode).toBe(0);
			expect(run.stdout.trim()).toBe("from-cwd-env");
		});

		it("still runs a resolvable project preload in the snapshot subprocess", async () => {
			const projectDir = join(tmpDir, "preload-project");
			mkdirSync(join(projectDir, "src"), { recursive: true });
			writeFileSync(join(projectDir, "bunfig.toml"), 'preload = ["./preload.ts"]\n');
			writeFileSync(join(projectDir, "preload.ts"), "globalThis.__crustPreloaded = true;\n");
			writeFileSync(
				join(projectDir, "src", "cli.ts"),
				`import { Crust } from ${JSON.stringify(corePath)};
if (globalThis.__crustPreloaded !== true) throw new Error("preload did not run");
await new Crust("preload-cli").action(() => {}).execute();
`,
			);

			const { exitCode, stderr } = await runProcess(
				crustBinary,
				["build", "--outfile", join(projectDir, "dist", "cli"), "--target", getHostBunTarget()!],
				{ cwd: projectDir },
			);
			expect(stderr).toBe("");
			expect(exitCode).toBe(0);
			expect(existsSync(join(projectDir, "dist", "cli"))).toBe(true);
		});
	},
);
