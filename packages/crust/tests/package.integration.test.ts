import { afterAll, beforeAll, describe, expect, it } from "bun:test";
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
import { runProcess } from "@crustjs/utils/process";

import { buildCommand } from "../src/commands/build.ts";
import { BUN_TARGETS, DENO_TARGETS } from "../src/utils/build-helpers.ts";
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
					"test-cli": "dist/cli",
				},
			},
			null,
			2,
		),
	);
});

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
		writeFileSync(join(stageDir, "stale.txt"), "from a previous build\n");
		await runBuild(["--target", "bun-linux-x64", "--no-validate"]);

		expect(existsSync(join(stageDir, "stale.txt"))).toBe(false);
		expect(existsSync(join(stageDir, "root"))).toBe(true);
		expect(existsSync(join(stageDir, "linux-x64"))).toBe(true);
		expect(existsSync(join(stageDir, "darwin-arm64"))).toBe(false);
	});

	it.skipIf(hostTarget() === null || !Bun.which("node"))(
		"runs the staged launcher in place and from an installed layout",
		async () => {
			const hostBunTarget = hostTarget();
			const nodePath = Bun.which("node");
			if (!hostBunTarget || !nodePath) return;
			const hostAlias = BUN_TARGETS.info[hostBunTarget].alias;

			await runBuild(["--target", hostBunTarget, "--no-validate"]);

			const launcherPath = join(stageDir, "root", "bin", "test-cli.js");
			const inPlace = await runProcess(nodePath, [launcherPath], { cwd: tmpDir });
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
			const installed = await runProcess(nodePath, [join(installedRoot, "bin", "test-cli.js")], {
				cwd: tmpDir,
			});
			expect(installed.stderr.trim()).toBe("");
			expect(installed.exitCode).toBe(0);
			expect(installed.stdout.trim()).toBe("hello from packaged test");
		},
	);

	it.skipIf(!Bun.which("node"))(
		"stages a root-only Node package whose bin is the runnable bundle",
		async () => {
			mkdirSync(join(tmpDir, "assets"), { recursive: true });
			writeFileSync(join(tmpDir, "assets", "greeting.txt"), "hi\n");
			const packageJsonPath = join(tmpDir, "package.json");
			const original = readFileSync(packageJsonPath, "utf8");
			writeFileSync(
				packageJsonPath,
				JSON.stringify({ ...JSON.parse(original), crust: { include: ["assets"] } }),
			);
			// The bundle must locate its include via the build-time marker; the
			// fixture has no node_modules, so core is imported from its built dist.
			const entryPath = join(tmpDir, "src", "cli.ts");
			const originalEntry = readFileSync(entryPath, "utf8");
			writeFileSync(
				entryPath,
				`import { resolveArtifactDir } from ${JSON.stringify(resolve(import.meta.dir, "../../core/dist/index.js"))};\n` +
					'console.log("hello from packaged test");\n' +
					'if (process.argv.includes("assets")) console.log(resolveArtifactDir("assets"));\n',
			);
			try {
				const { stdout } = await runBuild(["--runtime", "node", "--no-validate"]);
				expect(stdout).toContain("Runtime: node (from --runtime)");
			} finally {
				writeFileSync(packageJsonPath, original);
				writeFileSync(entryPath, originalEntry);
			}

			const rootPackageJson = readJson<{
				bin: Record<string, string>;
				files: string[];
				optionalDependencies?: Record<string, string>;
			}>(join(stageDir, "root", "package.json"));
			expect(rootPackageJson).toMatchObject({
				bin: { "test-cli": "bin/test-cli.js" },
				files: ["bin", "assets"],
			});
			expect(rootPackageJson).not.toHaveProperty("optionalDependencies");
			expect(readJson<object>(join(stageDir, "manifest.json"))).toMatchObject({
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
			const { exitCode, stdout } = await runProcess(Bun.which("node")!, [bundlePath, "assets"], {
				cwd: tmpDir,
			});
			expect(exitCode).toBe(0);
			expect(stdout.trim().split("\n")).toEqual([
				"hello from packaged test",
				join(stageDir, "root", "assets"),
			]);
		},
		30_000,
	);

	// One host target only: compiling all six Deno targets downloads six runtimes.
	it.skipIf(Bun.which("deno") === null || hostDenoTarget() === null || !Bun.which("node"))(
		"stages Deno platform packages and runs them through the Node launcher",
		async () => {
			const denoTarget = hostDenoTarget()!;
			const hostAlias = DENO_TARGETS.info[denoTarget].alias;

			await runBuild(["--runtime", "deno", "--target", denoTarget, "--no-validate"]);

			const manifest = readJson<{
				packages: Array<{ target: string; name: string; bin: string; libc?: string }>;
				publishOrder: string[];
			}>(join(stageDir, "manifest.json"));
			expect(manifest.publishOrder).toEqual([hostAlias, "root"]);
			expect(manifest.packages).toEqual([
				expect.objectContaining({
					target: hostAlias,
					name: `@scope/test-cli-${hostAlias}`,
					bin: `bin/test-cli-${denoTarget}${process.platform === "win32" ? ".exe" : ""}`,
				}),
			]);
			if (process.platform === "linux") expect(manifest.packages[0]!.libc).toBe("glibc");
			expect(
				readJson<{ optionalDependencies: Record<string, string> }>(
					join(stageDir, "root", "package.json"),
				).optionalDependencies,
			).toEqual({ [`@scope/test-cli-${hostAlias}`]: "0.1.0" });

			const { exitCode, stdout, stderr } = await runProcess(
				Bun.which("node")!,
				[join(stageDir, "root", "bin", "test-cli.js")],
				{ cwd: tmpDir },
			);
			expect(stderr.trim()).toBe("");
			expect(exitCode).toBe(0);
			expect(stdout.trim()).toBe("hello from packaged test");
		},
		120_000,
	);
});
