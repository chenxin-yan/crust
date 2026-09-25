import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
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
import type { JsonValue } from "@crustjs/utils/json";
import { which } from "@crustjs/utils/process";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vite-plus/test";

import { buildCommand } from "../src/commands/build.ts";
import { BUN_TARGETS, type BunTarget, DENO_TARGETS } from "../src/utils/build-helpers.ts";
import { reapBoundedProcesses, runBoundedProcess } from "./bounded-process.ts";
import { hostDenoTarget, hostTarget } from "./helpers.ts";

function getHostBunTarget() {
	return hostTarget();
}

function readJson<T>(path: string): T {
	return JSON.parse(readFileSync(path, "utf8")) as T;
}

/** Staged platform binary for a Bun target: `.crust/<alias>/bin/<command>-<target>`. */
function stagedBunBinary(projectDir: string, command: string, target: BunTarget): string {
	const info = BUN_TARGETS.info[target];
	return join(
		projectDir,
		".crust",
		info.alias,
		"bin",
		`${command}-${target}${info.os === "win32" ? ".exe" : ""}`,
	);
}

function writePackageJson(projectDir: string, pkg: JsonValue): void {
	writeFileSync(join(projectDir, "package.json"), JSON.stringify(pkg));
}

// ────────────────────────────────────────────────────────────────────────────
// Integration test: staged builds (--target flag)
// ────────────────────────────────────────────────────────────────────────────

// Runs after each describe's own afterEach and before its afterAll fixture removal.
afterEach(reapBoundedProcesses);

describe("crust build integration — staged targets", () => {
	const tmpDir = mkdtempSync(join(tmpdir(), "crust-build-integration-"));
	const crustCliPath = resolve(import.meta.dirname, "..", "src", "cli.ts");
	const corePath = fileURLToPath(import.meta.resolve("@crustjs/core"));
	const originalCwd = process.cwd;
	const basePackageJson = { name: "test-build-cli", version: "0.1.0" };

	beforeAll(() => {
		rmSync(tmpDir, { recursive: true, force: true });
		mkdirSync(join(tmpDir, "src"), { recursive: true });

		// Create a trivial CLI entry file
		writeFileSync(
			join(tmpDir, "src", "cli.ts"),
			`#!/usr/bin/env bun
console.log("hello from crust build test");
`,
		);
		writePackageJson(tmpDir, basePackageJson);
	});

	afterEach(async () => {
		await reapBoundedProcesses();
		process.cwd = originalCwd;
		writePackageJson(tmpDir, basePackageJson);
	});

	afterAll(() => {
		process.cwd = originalCwd;
		rmSync(tmpDir, { recursive: true, force: true });
	});

	it("stages a standalone executable for a single explicit target", async () => {
		process.cwd = () => tmpDir;

		const { stdout, exitCode } = await captureExecute(new Crust("test").add(buildCommand), [
			"build",
			"--no-validate",
			"--target",
			"bun-darwin-arm64",
		]);

		expect(exitCode).toBe(0);
		expect(existsSync(stagedBunBinary(tmpDir, "test-build-cli", "bun-darwin-arm64"))).toBe(true);
		expect(readdirSync(join(tmpDir, ".crust")).sort()).toEqual([
			"darwin-arm64",
			"manifest.json",
			"root",
		]);
		expect(stdout).toContain("Staging");
		expect(stdout).toContain("Staged");
	});

	it("builds without --minify when --no-minify is passed", async () => {
		process.cwd = () => tmpDir;
		const processSpy = vi.spyOn(await import("@crustjs/utils/process"), "runProcess");
		try {
			const { stdout, exitCode } = await captureExecute(new Crust("test").add(buildCommand), [
				"build",
				"--no-validate",
				"--no-minify",
				"--target",
				"bun-darwin-arm64",
			]);

			expect(exitCode).toBe(0);
			expect(existsSync(stagedBunBinary(tmpDir, "test-build-cli", "bun-darwin-arm64"))).toBe(true);
			expect(stdout).toContain("Staged");
			const compile = processSpy.mock.calls.find(([, args]) => args?.includes("--compile"));
			expect(compile?.[1]).toContain("--compile");
			expect(compile?.[1]).not.toContain("--minify");
		} finally {
			processSpy.mockRestore();
		}
	});

	it.skipIf(getHostBunTarget() === null)(
		"stages only this machine's platform package with --target host",
		async () => {
			const host = getHostBunTarget()!;
			process.cwd = () => tmpDir;

			const { exitCode, stderr } = await captureExecute(new Crust("test").add(buildCommand), [
				"build",
				"--no-validate",
				"--target",
				"host",
			]);

			expect(exitCode, stderr).toBe(0);
			expect(readdirSync(join(tmpDir, ".crust")).sort()).toEqual([
				BUN_TARGETS.info[host].alias,
				"manifest.json",
				"root",
			]);
			const outPath = stagedBunBinary(tmpDir, "test-build-cli", host);
			const { exitCode: runExitCode, stdout: runStdout } = await runBoundedProcess(outPath, [], {
				cwd: tmpDir,
				timeout: 4_000,
			});
			expect(runExitCode).toBe(0);
			expect(runStdout.trim()).toBe("hello from crust build test");
		},
	);

	it.skipIf(getHostBunTarget() === null || which("node") === null)(
		"builds two bin entries into their own launchers and binaries with merged artifacts",
		async () => {
			const host = getHostBunTarget()!;
			const projectDir = join(tmpDir, "two-entries");
			mkdirSync(join(projectDir, "src"), { recursive: true });
			// Names differ from the package name and the source filenames. Each entry's
			// `skills/` and `man/` directories merge into the shared artifact tree.
			const entry = (name: string) =>
				`import { Crust, defineExtension, defineExtensionId } from ${JSON.stringify(corePath)};
const hook = defineExtension(defineExtensionId("hook"), { build: () => [
  { path: "skills/${name}/SKILL.md", content: "${name}" },
  { path: "man/${name}.1", content: "${name}" },
] });
await new Crust("${name}").extend(hook).action(({ stdout }) => stdout("running ${name}")).execute();
`;
			writeFileSync(join(projectDir, "src", "first.ts"), entry("greet"));
			writeFileSync(join(projectDir, "src", "second.ts"), entry("admin-tool"));
			writePackageJson(projectDir, {
				name: "@scope/suite",
				version: "0.1.0",
				bin: { greet: "src/first.ts", "admin-tool": "./src/second.ts" },
			});
			process.cwd = () => projectDir;

			const { exitCode, stderr, stdout } = await captureExecute(
				new Crust("test").add(buildCommand),
				["build", "--target", "host"],
			);
			expect(exitCode, stderr).toBe(0);
			expect(stdout).toContain("Preparing Command Snapshot for greet...");
			expect(stdout).toContain("Preparing Command Snapshot for admin-tool...");

			const alias = BUN_TARGETS.info[host].alias;
			expect(readdirSync(join(projectDir, ".crust", "root", "bin")).sort()).toEqual([
				"admin-tool.js",
				"greet.js",
			]);
			expect(readdirSync(join(projectDir, ".crust", "artifacts", "skills")).sort()).toEqual([
				"admin-tool",
				"greet",
			]);
			expect(readdirSync(join(projectDir, ".crust", "artifacts", "man")).sort()).toEqual([
				"admin-tool.1",
				"greet.1",
			]);
			expect(
				readJson<{ bin: Record<string, string>; files: string[]; man: string[] }>(
					join(projectDir, ".crust", "root", "package.json"),
				),
			).toMatchObject({
				bin: { greet: "bin/greet.js", "admin-tool": "bin/admin-tool.js" },
				files: ["bin", "man", "skills"],
				man: ["./man/admin-tool.1", "./man/greet.1"],
			});
			expect(
				readJson<{ bin: Record<string, string> }>(join(projectDir, ".crust", alias, "package.json"))
					.bin,
			).toEqual({
				greet: `bin/greet-${host}${host.includes("windows") ? ".exe" : ""}`,
				"admin-tool": `bin/admin-tool-${host}${host.includes("windows") ? ".exe" : ""}`,
			});
			expect(
				readJson<{ root: { bins: string[] } }>(join(projectDir, ".crust", "manifest.json")).root
					.bins,
			).toEqual(["greet", "admin-tool"]);

			for (const command of ["greet", "admin-tool"]) {
				const binary = await runBoundedProcess(stagedBunBinary(projectDir, command, host), [], {
					cwd: projectDir,
					timeout: 50_000,
				});
				expect(binary.exitCode, binary.stderr).toBe(0);
				expect(binary.stdout.trim()).toBe(`running ${command}`);
				const launcher = await runBoundedProcess(
					which("node")!,
					[join(projectDir, ".crust", "root", "bin", `${command}.js`)],
					{ cwd: projectDir, timeout: 50_000 },
				);
				expect(launcher.exitCode, launcher.stderr).toBe(0);
				expect(launcher.stdout.trim()).toBe(`running ${command}`);
				expect(existsSync(join(projectDir, ".crust", alias, "bin", "skills", command))).toBe(true);
			}
		},
		60_000,
	);

	it.skipIf(getHostBunTarget() === null)(
		"applies --env-file to validation and embeds PUBLIC_ constants only",
		async () => {
			const host = getHostBunTarget()!;
			process.cwd = () => tmpDir;
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
			writePackageJson(tmpDir, { ...basePackageJson, bin: { "env-cli": "src/env-cli.ts" } });

			await new Crust("test").add(buildCommand).execute({
				argv: ["build", "--target", "host", "--env-file", ".env.build"],
			});

			const outPath = stagedBunBinary(tmpDir, "env-cli", host);
			expect(existsSync(outPath)).toBe(true);

			const { exitCode, stdout } = await runBoundedProcess(outPath, [], {
				cwd: tmpDir,
				env: {},
				timeout: 4_000,
			});

			expect(exitCode).toBe(0);
			expect(JSON.parse(stdout.trim())).toEqual({
				publicValue: "hello-from-build",
				secretValue: null,
			});
		},
	);

	it.skipIf(which("node") === null)(
		"builds an executable Node artifact from package.json runtime config",
		async () => {
			process.cwd = () => tmpDir;
			writePackageJson(tmpDir, {
				...basePackageJson,
				crust: { runtime: "node" },
				bin: { "node-core-cli": "src/node-core-cli.ts" },
			});
			// Bundle @crustjs/core into the artifact — the portability claim is "a
			// Crust CLI runs under node", not "a console.log runs under node".
			writeFileSync(
				join(tmpDir, "src", "node-core-cli.ts"),
				`import { Crust } from ${JSON.stringify(corePath)};
const app = new Crust("node-core-cli", { version: "1.0.0" }).action(() => console.log("core under node"));
await app.execute();
`,
			);
			await new Crust("test").add(buildCommand).execute({ argv: ["build", "--no-validate"] });
			const outPath = join(tmpDir, ".crust", "root", "bin", "node-core-cli.js");
			expect(readFileSync(outPath, "utf8").startsWith("#!/usr/bin/env node\n")).toBe(true);
			if (process.platform !== "win32") expect(statSync(outPath).mode & 0o111).not.toBe(0);

			const action = await runBoundedProcess(which("node")!, [outPath], { timeout: 25_000 });
			expect(action.exitCode).toBe(0);
			expect(action.stdout.trim()).toBe("core under node");

			// Unknown flag exercises core's dispatch/error path in the bundle.
			const bad = await runBoundedProcess(which("node")!, [outPath, "--definitely-not-a-flag"], {
				timeout: 25_000,
			});
			expect(bad.exitCode).toBe(1);
			expect(bad.stderr).toContain("Unknown flag");
		},
		30_000,
	);

	// ponytail: entry is dependency-free — `deno compile` type-checks raw
	// workspace TS (unlike published dist), so bundling @crustjs/core here fails
	// for monorepo reasons real users never hit. The dist-layer "core runs under
	// Deno" claim is covered by the CI smoke matrix; a faithful compile-with-deps
	// test needs a pack+install harness.
	it.skipIf(which("deno") === null || hostDenoTarget() === null)(
		"builds and runs a Deno standalone executable for the host target",
		async () => {
			const denoTarget = hostDenoTarget()!;
			process.cwd = () => tmpDir;
			writePackageJson(tmpDir, { ...basePackageJson, crust: { runtime: "deno" } });
			await new Crust("test").add(buildCommand).execute({
				argv: ["build", "--target", "host", "--no-validate"],
			});
			const info = DENO_TARGETS.info[denoTarget];
			const outPath = join(
				tmpDir,
				".crust",
				info.alias,
				"bin",
				`test-build-cli-${denoTarget}${info.os === "win32" ? ".exe" : ""}`,
			);
			const { exitCode, stdout } = await runBoundedProcess(outPath, [], { timeout: 50_000 });
			expect(exitCode).toBe(0);
			expect(stdout.trim()).toBe("hello from crust build test");
		},
		60_000,
	);

	it.skipIf(getHostBunTarget() === null)(
		"uses Bun auto-loaded cwd env to embed PUBLIC_ constants when --env-file is omitted",
		async () => {
			const host = getHostBunTarget()!;
			const autoloadDir = join(tmpDir, "autoload-workspace");
			mkdirSync(join(autoloadDir, "src"), { recursive: true });

			writeFileSync(
				join(autoloadDir, "src", "cli.ts"),
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
			writePackageJson(autoloadDir, { name: "autoload-cli", version: "0.1.0" });

			const { exitCode, stderr } = await runBoundedProcess(
				which("bun")!,
				[crustCliPath, "build", "--target", "host"],
				{ cwd: autoloadDir, env: { ...process.env, BUN_BE_BUN: "1" }, timeout: 4_000 },
			);
			expect(exitCode, stderr).toBe(0);
			const outPath = stagedBunBinary(autoloadDir, "autoload-cli", host);
			expect(existsSync(outPath)).toBe(true);

			const runtimeDir = join(autoloadDir, "runtime-no-env");
			mkdirSync(runtimeDir, { recursive: true });

			const { exitCode: builtExitCode, stdout } = await runBoundedProcess(outPath, [], {
				cwd: runtimeDir,
				env: {},
				timeout: 4_000,
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
// Integration test: crust.bunPlugins runs project Bun bundler plugins
// ────────────────────────────────────────────────────────────────────────────

describe.skipIf(getHostBunTarget() === null)("crust build integration — crust.bunPlugins", () => {
	const tmpDir = mkdtempSync(join(tmpdir(), "crust-build-plugin-"));
	const corePath = fileURLToPath(import.meta.resolve("@crustjs/core"));
	const originalCwd = process.cwd;
	const packageJson = {
		name: "marker-cli",
		version: "0.1.0",
		bin: "src/marker-cli.ts",
		crust: { bunPlugins: ["./plugins/marker.ts"] },
	};

	beforeAll(() => {
		mkdirSync(join(tmpDir, "src"), { recursive: true });
		mkdirSync(join(tmpDir, "plugins"), { recursive: true });
		writeFileSync(
			join(tmpDir, "plugins", "marker.ts"),
			`import type { BunPlugin } from "bun";
const marker: BunPlugin = {
  name: "marker",
  setup(build) {
    build.onLoad({ filter: /marker-cli\\.ts$/ }, async (args) => ({
      contents: (await Bun.file(args.path).text()).replace("__MARKER__", "transformed-by-plugin"),
      loader: "ts",
    }));
  },
};
export default marker;
`,
		);
		writeFileSync(
			join(tmpDir, "src", "marker-cli.ts"),
			`import { Crust } from ${JSON.stringify(corePath)};
await new Crust("marker-cli").action(() => console.log(JSON.stringify({
  marker: "__MARKER__",
  publicValue: process.env.PUBLIC_MESSAGE,
  secretValue: process.env.SECRET_TOKEN ?? null,
  crustBuild: process.env.CRUST_INTERNAL_BUILD,
}))).execute();
`,
		);
		writeFileSync(
			join(tmpDir, ".env.build"),
			"PUBLIC_MESSAGE=hello-from-build\nSECRET_TOKEN=super-secret\n",
		);
		writePackageJson(tmpDir, packageJson);
		process.cwd = () => tmpDir;
	});

	afterAll(() => {
		process.cwd = originalCwd;
		rmSync(tmpDir, { recursive: true, force: true });
	});

	it("compiles through the plugin with the same env-file and PUBLIC_ semantics", async () => {
		writePackageJson(tmpDir, packageJson);
		const { exitCode, stderr, stdout } = await captureExecute(new Crust("test").add(buildCommand), [
			"build",
			"--target",
			"host",
			"--env-file",
			".env.build",
		]);
		if (exitCode !== 0) throw new Error(stderr);
		expect(stdout).toContain("Staged");
		expect(existsSync(join(tmpDir, ".env.build"))).toBe(true);
		expect(readdirSync(tmpDir).filter((name) => name.startsWith(".crust-build-"))).toEqual([]);

		const outPath = stagedBunBinary(tmpDir, "marker-cli", getHostBunTarget()!);
		const run = await runBoundedProcess(outPath, [], {
			cwd: join(tmpDir, ".crust"),
			env: {},
			timeout: 25_000,
		});
		expect(run.exitCode).toBe(0);
		expect(JSON.parse(run.stdout.trim())).toEqual({
			marker: "transformed-by-plugin",
			publicValue: "hello-from-build",
			secretValue: null,
			// Inlined by the driver's `define`, not read from the (empty) environment.
			crustBuild: "1",
		});
	}, 30_000);

	it.skipIf(which("node") === null)(
		"bundles Node artifacts through the plugin and keeps the shebang",
		async () => {
			writePackageJson(tmpDir, {
				...packageJson,
				crust: { ...packageJson.crust, runtime: "node" },
			});
			const { exitCode, stderr } = await captureExecute(new Crust("test").add(buildCommand), [
				"build",
				"--no-validate",
			]);
			if (exitCode !== 0) throw new Error(stderr);
			const outPath = join(tmpDir, ".crust", "root", "bin", "marker-cli.js");
			expect(readFileSync(outPath, "utf8").startsWith("#!/usr/bin/env node\n")).toBe(true);
			if (process.platform !== "win32") expect(statSync(outPath).mode & 0o111).not.toBe(0);

			const run = await runBoundedProcess(which("node")!, [outPath], { env: {}, timeout: 25_000 });
			expect(run.exitCode).toBe(0);
			expect(JSON.parse(run.stdout.trim())).toMatchObject({
				marker: "transformed-by-plugin",
				crustBuild: "1",
			});
		},
		30_000,
	);
});

// ────────────────────────────────────────────────────────────────────────────
// Integration test: compiled executables ignore the cwd bunfig.toml but keep .env
// ────────────────────────────────────────────────────────────────────────────

describe.skipIf(getHostBunTarget() === null)(
	"crust build integration — compiled executables and cwd autoloading",
	() => {
		const tmpDir = mkdtempSync(join(tmpdir(), "crust-build-autoload-"));
		const crustPackageDir = resolve(import.meta.dirname, "..");
		const corePath = fileURLToPath(import.meta.resolve("@crustjs/core"));
		const originalCwd = process.cwd;
		// A cwd whose bunfig preload cannot resolve: Bun standalones that autoload
		// bunfig.toml die here with `preload not found` before any user code runs.
		const preloadCwd = join(tmpDir, "unresolvable-preload");
		// Crust's own staged host binary; staging happens in the crust package's
		// .crust/, which `bun run build` also owns.
		const crustBinary = stagedBunBinary(crustPackageDir, "crust", getHostBunTarget()!);

		beforeAll(async () => {
			mkdirSync(preloadCwd, { recursive: true });
			writeFileSync(join(preloadCwd, "bunfig.toml"), 'preload = ["@opentui/solid/preload"]\n');
			writeFileSync(join(preloadCwd, ".env"), "PUBLIC_MESSAGE=from-cwd-env\n");

			process.cwd = () => crustPackageDir;
			try {
				const { exitCode, stderr } = await captureExecute(new Crust("test").add(buildCommand), [
					"build",
					"--target",
					"host",
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
			const { exitCode, stdout, stderr } = await runBoundedProcess(crustBinary, ["--version"], {
				cwd: preloadCwd,
				timeout: 4_000,
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
			writePackageJson(projectDir, { name: "env-cli", version: "0.1.0" });
			process.cwd = () => projectDir;
			const { exitCode, stderr } = await captureExecute(new Crust("test").add(buildCommand), [
				"build",
				"--target",
				"host",
				"--no-validate",
			]);
			process.cwd = originalCwd;
			if (exitCode !== 0) throw new Error(stderr);

			const outPath = stagedBunBinary(projectDir, "env-cli", getHostBunTarget()!);
			const run = await runBoundedProcess(outPath, [], {
				cwd: preloadCwd,
				env: {},
				timeout: 4_000,
			});
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
			writePackageJson(projectDir, { name: "preload-cli", version: "0.1.0" });

			const { exitCode, stderr } = await runBoundedProcess(
				crustBinary,
				["build", "--target", "host"],
				{
					cwd: projectDir,
					timeout: 4_000,
				},
			);
			expect(stderr).toBe("");
			expect(exitCode).toBe(0);
			expect(existsSync(stagedBunBinary(projectDir, "preload-cli", getHostBunTarget()!))).toBe(
				true,
			);
		});
	},
);
