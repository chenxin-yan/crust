import {
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { Crust } from "@crustjs/core";
import { captureExecute } from "@crustjs/testing";
import { which } from "@crustjs/utils/process";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vite-plus/test";

import { buildCommand } from "../src/commands/build.ts";
import { BUN_TARGETS, DENO_TARGETS } from "../src/utils/build-helpers.ts";
import type { DistributionManifest } from "../src/utils/distribute.ts";
import { reapBoundedProcesses, runBoundedProcess } from "./bounded-process.ts";
import { hostDenoTarget, hostTarget } from "./helpers.ts";

const tmpDir = mkdtempSync(join(tmpdir(), "crust-package-integration-"));
const stageDir = join(tmpDir, ".crust");
const originalCwd = process.cwd;

function readJson<T>(path: string): T {
	return JSON.parse(readFileSync(path, "utf-8")) as T;
}

async function runBuild(argv: string[]) {
	const app = new Crust("test").add(buildCommand);
	process.cwd = () => tmpDir;
	try {
		const result = await captureExecute(app, ["build", ...argv]);
		expect(result.exitCode, result.stderr).toBe(0);
		return result;
	} finally {
		process.cwd = originalCwd;
	}
}

beforeAll(() => {
	rmSync(tmpDir, { recursive: true, force: true });
	mkdirSync(join(tmpDir, "src"), { recursive: true });
	writeFileSync(join(tmpDir, "src", "cli.ts"), 'console.log("hello from packaged test");\n');
	writeFileSync(
		join(tmpDir, "package.json"),
		JSON.stringify(
			{
				name: "@scope/test-cli",
				version: "0.1.0",
				bin: {
					"test-cli": "src/cli.ts",
				},
				crust: { artifact: "binary" },
			},
			null,
			2,
		),
	);
});

afterEach(reapBoundedProcesses);

afterAll(() => {
	process.cwd = originalCwd;
	rmSync(tmpDir, { recursive: true, force: true });
});

describe("crust build integration", () => {
	it("stages root and platform packages in .crust with a JS launcher", async () => {
		await runBuild(["--target", "bun-linux-x64", "--target", "bun-darwin-arm64", "--no-validate"]);

		expect(existsSync(join(stageDir, "root", "bin", "test-cli.js"))).toBe(true);
		expect(existsSync(join(stageDir, "root", "bin", "test-cli"))).toBe(false);
		expect(existsSync(join(stageDir, "linux-x64", "bin"))).toBe(true);
		expect(existsSync(join(stageDir, "darwin-arm64", "bin"))).toBe(true);

		const rootPackageJson = readJson<{ bin: Record<string, string> }>(
			join(stageDir, "root", "package.json"),
		);
		expect(rootPackageJson.bin["test-cli"]).toBe("bin/test-cli.js");

		const manifest = readJson<{
			version: string;
			publishOrder: string[];
			packages: Array<{ target: string; dir: string }>;
		}>(join(stageDir, "manifest.json"));
		expect(manifest.version).toBe("0.1.0");
		expect(manifest.publishOrder).toEqual(["linux-x64", "darwin-arm64", "root"]);
		expect(manifest.packages.map((pkg) => pkg.target)).toEqual(["linux-x64", "darwin-arm64"]);
	}, 15_000);

	it("wipes .crust and stages only the selected target directories", async () => {
		mkdirSync(join(stageDir, "darwin-arm64"), { recursive: true });
		writeFileSync(join(stageDir, "stale.txt"), "from a previous build\n");
		await runBuild(["--target", "bun-linux-x64", "--no-validate"]);

		expect(existsSync(join(stageDir, "stale.txt"))).toBe(false);
		expect(existsSync(join(stageDir, "root"))).toBe(true);
		expect(existsSync(join(stageDir, "linux-x64"))).toBe(true);
		expect(existsSync(join(stageDir, "darwin-arm64"))).toBe(false);
	});

	it.skipIf(hostTarget() === null || !which("node"))(
		"runs the staged launcher in place and from an installed layout",
		async () => {
			const hostBunTarget = hostTarget();
			const nodePath = which("node");
			if (!hostBunTarget || !nodePath) return;
			const hostAlias = BUN_TARGETS.info[hostBunTarget].alias;

			await runBuild(["--target", hostBunTarget, "--no-validate"]);

			const launcherPath = join(stageDir, "root", "bin", "test-cli.js");
			const inPlace = await runBoundedProcess(nodePath, [launcherPath], {
				cwd: tmpDir,
				timeout: 4_000,
			});
			expect(inPlace.stderr.trim()).toBe("");
			expect(inPlace.exitCode).toBe(0);
			expect(inPlace.stdout.trim()).toBe("hello from packaged test");

			// Installed layout: the platform package under root/node_modules. Scoped
			// names split into @scope/name path segments, matching the launcher's
			// resolve(..., target.packageName, ...).
			const installedRoot = join(tmpDir, "installed");
			cpSync(join(stageDir, "root"), installedRoot, { recursive: true });
			cpSync(
				join(stageDir, hostAlias),
				join(installedRoot, "node_modules", "@scope", `test-cli-${hostAlias}`),
				{ recursive: true },
			);
			const installed = await runBoundedProcess(
				nodePath,
				[join(installedRoot, "bin", "test-cli.js")],
				{
					cwd: tmpDir,
					timeout: 4_000,
				},
			);
			expect(installed.stderr.trim()).toBe("");
			expect(installed.exitCode).toBe(0);
			expect(installed.stdout.trim()).toBe("hello from packaged test");
		},
	);

	it.skipIf(!which("node"))(
		"stages a root-only Node package whose bin is the runnable bundle",
		async () => {
			mkdirSync(join(tmpDir, "assets"), { recursive: true });
			writeFileSync(join(tmpDir, "assets", "greeting.txt"), "hi\n");
			const packageJsonPath = join(tmpDir, "package.json");
			const original = readFileSync(packageJsonPath, "utf8");
			writeFileSync(
				packageJsonPath,
				JSON.stringify({
					...JSON.parse(original),
					crust: { runtime: "node", artifact: "package", include: ["assets"] },
				}),
			);
			// The bundle must locate its include via the build-time marker; the
			// fixture has no node_modules, so core is imported from its built dist.
			const entryPath = join(tmpDir, "src", "cli.ts");
			const originalEntry = readFileSync(entryPath, "utf8");
			writeFileSync(
				entryPath,
				`import { resolveArtifactDir } from ${JSON.stringify(resolve(import.meta.dirname, "../../core/dist/index.js"))};\n` +
					'console.log("hello from packaged test");\n' +
					'if (process.argv.includes("assets")) console.log(resolveArtifactDir("assets"));\n' +
					'if (process.argv.includes("env")) console.log(process.env.PUBLIC_MESSAGE, process.env.SECRET_MESSAGE);\n',
			);
			const envFile = join(tmpDir, ".env.build");
			writeFileSync(envFile, "PUBLIC_MESSAGE=hello-from-build\nSECRET_MESSAGE=private\n");
			try {
				const { stdout } = await runBuild(["--no-validate", "--env-file", envFile]);
				expect(stdout).toContain("Runtime: node (from package.json)");
				expect(stdout).toContain("Artifact: package");
			} finally {
				writeFileSync(packageJsonPath, original);
				writeFileSync(entryPath, originalEntry);
			}

			expect(readJson<object>(join(stageDir, "manifest.json"))).toMatchObject({
				runtime: "node",
				artifact: "package",
				packages: [],
				publishOrder: ["root"],
			});
			expect(readFileSync(join(stageDir, "root", "assets", "greeting.txt"), "utf8")).toBe("hi\n");
			expect(existsSync(join(stageDir, "linux-x64"))).toBe(false);

			const bundlePath = join(stageDir, "root", "bin", "test-cli.js");
			const bundle = readFileSync(bundlePath, "utf8");
			expect(bundle.startsWith("#!/usr/bin/env node\n")).toBe(true);
			// The marker is inlined as a literal, not read from the environment.
			expect(bundle).not.toContain("process.env.CRUST_INTERNAL_BUILD");
			const { exitCode, stdout } = await runBoundedProcess(which("node")!, [bundlePath, "assets"], {
				cwd: tmpDir,
				timeout: 25_000,
			});
			expect(exitCode).toBe(0);
			expect(stdout.trim().split("\n")).toEqual([
				"hello from packaged test",
				join(stageDir, "root", "assets"),
			]);
			// The non-plugin Node build forwards --env-file and inlines only PUBLIC_* values.
			const env = await runBoundedProcess(which("node")!, [bundlePath, "env"], {
				cwd: tmpDir,
				env: {},
				timeout: 25_000,
			});
			expect(env.exitCode, env.stderr).toBe(0);
			expect(env.stdout.trim().split("\n").at(-1)).toBe("hello-from-build undefined");
		},
		30_000,
	);

	// One host target only: compiling all six Deno targets downloads six runtimes.
	it.skipIf(which("deno") === null || hostDenoTarget() === null || !which("node"))(
		"stages Deno platform packages and runs them through the Node launcher",
		async () => {
			const denoTarget = hostDenoTarget()!;
			const hostAlias = DENO_TARGETS.info[denoTarget].alias;
			const packageJsonPath = join(tmpDir, "package.json");
			const original = readFileSync(packageJsonPath, "utf8");
			writeFileSync(
				packageJsonPath,
				JSON.stringify({ ...JSON.parse(original), crust: { runtime: "deno", artifact: "binary" } }),
			);
			try {
				await runBuild(["--target", "host", "--no-validate"]);
			} finally {
				writeFileSync(packageJsonPath, original);
			}

			const denoVersion = /^deno (\S+)/.exec(
				(await runBoundedProcess(which("deno")!, ["--version"], { timeout: 10_000 })).stdout,
			)?.[1];
			expect(readJson<object>(join(stageDir, "manifest.json"))).toMatchObject({
				runtime: "deno",
				artifact: "binary",
				embeddedRuntimeVersion: denoVersion,
				publishOrder: [hostAlias, "root"],
			});
			expect(
				existsSync(
					join(
						stageDir,
						hostAlias,
						"bin",
						`test-cli-${denoTarget}${process.platform === "win32" ? ".exe" : ""}`,
					),
				),
			).toBe(true);

			const { exitCode, stdout, stderr } = await runBoundedProcess(
				which("node")!,
				[join(stageDir, "root", "bin", "test-cli.js")],
				{ cwd: tmpDir, timeout: 100_000 },
			);
			expect(stderr.trim()).toBe("");
			expect(exitCode).toBe(0);
			expect(stdout.trim()).toBe("hello from packaged test");
		},
		120_000,
	);
});

// Public build -> npm pack -> install -> execute for a Bun runtime package: the
// installed commands must run under the consumer's Bun, from an unrelated cwd,
// after the source project is gone.
describe.skipIf(!which("bun") || !which("npm"))("Bun runtime package", () => {
	const root = mkdtempSync(join(tmpdir(), "crust-bun-package-"));
	const project = join(root, "project");
	const coreDist = resolve(import.meta.dirname, "../../core/dist/index.js");
	const extensionsDist = resolve(import.meta.dirname, "../../extensions/dist/index.js");
	const bin = (dir: string, command: string) =>
		join(dir, "node_modules", ".bin", `${command}${process.platform === "win32" ? ".cmd" : ""}`);

	afterAll(async () => {
		await reapBoundedProcesses();
		rmSync(root, { recursive: true, force: true });
	});

	it("installs with npm and bun, runs every command under Bun, and ships assets", async () => {
		mkdirSync(join(project, "src"), { recursive: true });
		mkdirSync(join(project, "assets"), { recursive: true });
		writeFileSync(join(project, "assets", "greeting.txt"), "hello from assets\n");
		// Real Crust commands: core and extensions are bundled from their dist (a
		// bundled application dependency; the fixture has no node_modules), an Extension build hook
		// generates man/, and crust.include ships assets/.
		writeFileSync(
			join(project, "src", "greet.ts"),
			`import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Crust, defineExtension, defineExtensionId, resolveArtifactDir } from ${JSON.stringify(coreDist)};
import { help } from ${JSON.stringify(extensionsDist)};
const man = defineExtension(defineExtensionId("man")).build(() => [{ path: "man/bun-greet.1", content: ".Dd" }]);
await new Crust("bun-greet", { description: "Greets under Bun" })
	.extend(man, help())
	.args({ name: "name", type: "string", required: true })
	.flags({ name: "shout", type: "boolean" })
	.action(async ({ args, flags, stdout }) => {
		await new Promise((done) => setTimeout(done, 5));
		const greeting = \`hello \${args.name}\`;
		stdout(JSON.stringify({
			greeting: flags.shout ? greeting.toUpperCase() : greeting,
			bun: process.versions.bun ?? null,
			asset: readFileSync(join(resolveArtifactDir("assets"), "greeting.txt"), "utf8").trim(),
			man: readFileSync(join(resolveArtifactDir("man"), "bun-greet.1"), "utf8"),
		}));
	})
	.execute();
`,
		);
		writeFileSync(
			join(project, "src", "admin.ts"),
			`import { Crust } from ${JSON.stringify(coreDist)};
await new Crust("bun-admin").action(({ stdout }) => {
	stdout("admin under " + (process.versions.bun ? "bun" : "node"));
	process.exitCode = 3;
}).execute();
`,
		);
		writeFileSync(
			join(project, "package.json"),
			JSON.stringify({
				name: "@scope/bun-package",
				version: "0.1.0",
				bin: { "bun-greet": "src/greet.ts", "bun-admin": "src/admin.ts" },
				crust: { include: ["assets"] },
				engines: { bun: ">=1.0.0" },
			}),
		);

		const app = new Crust("test").add(buildCommand);
		process.cwd = () => project;
		try {
			const result = await captureExecute(app, ["build", "--artifact", "package"]);
			expect(result.exitCode, result.stderr).toBe(0);
			expect(result.stdout).toContain("Runtime: bun (default)");
			expect(result.stdout).toContain("Artifact: package");
		} finally {
			process.cwd = originalCwd;
		}
		const staged = join(project, ".crust");
		const manifest = readJson<DistributionManifest>(join(staged, "manifest.json"));
		expect(manifest).toMatchObject({
			runtime: "bun",
			artifact: "package",
			root: { name: "@scope/bun-package", bins: ["bun-greet", "bun-admin"] },
			packages: [],
			publishOrder: ["root"],
		});
		expect(manifest).not.toHaveProperty("embeddedRuntimeVersion");
		expect(readJson<object>(join(staged, "root", "package.json"))).toMatchObject({
			bin: { "bun-greet": "bin/bun-greet.js", "bun-admin": "bin/bun-admin.js" },
			files: ["bin", "man", "assets"],
			engines: { bun: ">=1.0.0" },
		});
		expect(existsSync(join(staged, "root", "node_modules"))).toBe(false);

		const packDir = join(root, "packs");
		mkdirSync(packDir);
		const packed = await runBoundedProcess("npm", ["pack", join(staged, "root")], {
			cwd: packDir,
			timeout: 25_000,
		});
		expect(packed.exitCode, packed.stderr).toBe(0);
		const tarball = join(packDir, packed.stdout.trim().split("\n").at(-1)!);

		const npmConsumer = join(root, "npm-consumer");
		const bunConsumer = join(root, "bun-consumer");
		for (const consumer of [npmConsumer, bunConsumer]) {
			mkdirSync(consumer);
			writeFileSync(
				join(consumer, "package.json"),
				JSON.stringify({
					name: "consumer",
					private: true,
					dependencies: { "@scope/bun-package": `file:${tarball}` },
				}),
			);
		}
		const npmInstall = await runBoundedProcess("npm", ["install", "--no-audit", "--no-fund"], {
			cwd: npmConsumer,
			timeout: 60_000,
		});
		expect(npmInstall.exitCode, npmInstall.stderr).toBe(0);
		const bunInstall = await runBoundedProcess(which("bun")!, ["install"], {
			cwd: bunConsumer,
			timeout: 60_000,
		});
		expect(bunInstall.exitCode, bunInstall.stderr).toBe(0);

		// Neither the source project nor its build output is needed any more.
		rmSync(project, { recursive: true, force: true });
		const elsewhere = join(root, "elsewhere");
		mkdirSync(elsewhere);
		const bunVersion = (
			await runBoundedProcess(which("bun")!, ["--version"], { timeout: 10_000 })
		).stdout.trim();

		for (const consumer of [npmConsumer, bunConsumer]) {
			const greet = await runBoundedProcess(bin(consumer, "bun-greet"), ["world", "--shout"], {
				cwd: elsewhere,
				timeout: 25_000,
			});
			expect(greet.exitCode, greet.stderr).toBe(0);
			expect(JSON.parse(greet.stdout.trim())).toEqual({
				greeting: "HELLO WORLD",
				bun: bunVersion,
				asset: "hello from assets",
				man: ".Dd",
			});

			const help = await runBoundedProcess(bin(consumer, "bun-greet"), ["--help"], {
				cwd: elsewhere,
				timeout: 25_000,
			});
			expect(help.exitCode, help.stderr).toBe(0);
			expect(help.stdout).toContain("Greets under Bun");

			const missing = await runBoundedProcess(bin(consumer, "bun-greet"), [], {
				cwd: elsewhere,
				timeout: 25_000,
			});
			expect(missing.exitCode).toBe(1);
			expect(missing.stderr).toContain('Missing required argument "<name>"');

			const admin = await runBoundedProcess(bin(consumer, "bun-admin"), [], {
				cwd: elsewhere,
				timeout: 25_000,
			});
			expect(admin.exitCode, admin.stderr).toBe(3);
			expect(admin.stdout.trim()).toBe("admin under bun");
		}

		// Build-only protocol variables cannot turn the finished bundle into a snapshot run.
		const snapshotPath = join(root, "snapshot.json");
		const protocol = await runBoundedProcess(bin(npmConsumer, "bun-greet"), ["protocol"], {
			cwd: elsewhere,
			env: {
				...process.env,
				CRUST_INTERNAL_SNAPSHOT_PATH: snapshotPath,
				CRUST_INTERNAL_BUILD_OUT_DIR: join(root, "hooks"),
			},
			timeout: 25_000,
		});
		expect(protocol.exitCode, protocol.stderr).toBe(0);
		expect(JSON.parse(protocol.stdout.trim())).toMatchObject({ greeting: "hello protocol" });
		expect(existsSync(snapshotPath)).toBe(false);
		expect(existsSync(join(root, "hooks"))).toBe(false);

		// Native Bun package execution resolves the installed bin, still under Bun.
		const bunRun = await runBoundedProcess(which("bun")!, ["run", "bun-greet", "bun"], {
			cwd: bunConsumer,
			timeout: 25_000,
		});
		expect(bunRun.exitCode, bunRun.stderr).toBe(0);
		expect(JSON.parse(bunRun.stdout.trim())).toMatchObject({
			greeting: "hello bun",
			bun: bunVersion,
		});

		// A runtime package needs the consumer's Bun: without bun on PATH it cannot start.
		if (process.platform !== "win32") {
			const withoutBun = await runBoundedProcess(bin(npmConsumer, "bun-greet"), ["world"], {
				cwd: elsewhere,
				env: { PATH: "/nonexistent" },
				timeout: 25_000,
			});
			expect(withoutBun.exitCode).not.toBe(0);
			expect(withoutBun.stdout).not.toContain("hello");
		}
	}, 120_000);
});
