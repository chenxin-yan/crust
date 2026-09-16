import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import {
	existsSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { JsonValue } from "@crustjs/utils/json";

import { BUN_TARGETS, type BunTarget, DENO_TARGETS, type DenoTarget } from "./build-helpers.ts";
import { type DistributeBuildPlan, type Distribution, runDistributeBuild } from "./distribute.ts";

const io = { stdout: () => {}, stderr: () => {} };

function createPlan(
	cwd: string,
	packageJson: JsonValue,
	overrides: Partial<DistributeBuildPlan> = {},
): DistributeBuildPlan {
	return {
		cwd,
		entryPath: join(cwd, "src", "cli.ts"),
		stageDir: join(cwd, ".crust"),
		validate: false,
		outDir: join(cwd, ".crust", "artifacts"),
		userPackageJson: packageJson,
		include: [],
		...overrides,
	};
}

const fakeExecutor = async (_entryPath: string, outfilePath: string) => {
	writeFileSync(outfilePath, "fake binary\n");
};

function bunDistribution(
	targets: BunTarget[] = ["bun-darwin-arm64"],
	execute: (
		entryPath: string,
		outfilePath: string,
		target: BunTarget,
	) => Promise<void> = fakeExecutor,
): Distribution<BunTarget> {
	return { table: BUN_TARGETS, targets, execute };
}

const rootOnlyDistribution: Distribution<never> = { execute: fakeExecutor };

function readJson<T>(path: string): T {
	return JSON.parse(readFileSync(path, "utf8")) as T;
}

describe("runDistributeBuild", () => {
	const tmpDir = mkdtempSync(join(tmpdir(), "crust-distribute-"));

	beforeEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
		mkdirSync(join(tmpDir, "src"), { recursive: true });
		writeFileSync(join(tmpDir, "src", "cli.ts"), "export {};\n");
		writeFileSync(join(tmpDir, "LICENSE"), "test license\n");
	});

	afterAll(() => rmSync(tmpDir, { recursive: true, force: true }));

	it("stages manifests, package metadata, resolver, licenses, and fake binary outputs", async () => {
		const packageJson = {
			name: "@scope/test-package-cli",
			version: "0.1.0",
			description: "CLI tooling",
			bin: { "test-cli": "dist/cli" },
			publishConfig: { access: "public" },
		};
		const plan = createPlan(tmpDir, packageJson);
		const outputs: string[] = [];

		await runDistributeBuild(
			plan,
			bunDistribution(
				["bun-linux-x64", "bun-linux-x64-musl", "bun-windows-arm64"],
				async (entryPath: string, outfilePath: string) => {
					outputs.push(outfilePath);
					await fakeExecutor(entryPath, outfilePath);
				},
			),
			io,
		);

		const manifest = readJson<{
			root: { name: string; dir: string; bin: string };
			packages: Array<{ target: string; name: string; bin: string }>;
			publishOrder: string[];
		}>(join(plan.stageDir, "manifest.json"));
		expect(manifest.root).toEqual({
			name: "@scope/test-package-cli",
			dir: "root",
			bin: "test-cli",
		});
		expect(manifest.packages).toEqual([
			expect.objectContaining({
				target: "linux-x64",
				name: "@scope/test-package-cli-linux-x64",
				bin: "bin/test-package-cli-bun-linux-x64",
			}),
			expect.objectContaining({
				target: "linux-x64-musl",
				name: "@scope/test-package-cli-linux-x64-musl",
				bin: "bin/test-package-cli-bun-linux-x64-musl",
			}),
			expect.objectContaining({
				target: "windows-arm64",
				name: "@scope/test-package-cli-windows-arm64",
				bin: "bin/test-package-cli-bun-windows-arm64.exe",
			}),
		]);
		expect(manifest.publishOrder).toEqual(["linux-x64", "linux-x64-musl", "windows-arm64", "root"]);

		// glibc and musl packages share os/cpu; `libc` is what lets npm skip the wrong one.
		const platformPackage = (dir: string) =>
			readJson<{
				os: string[];
				cpu: string[];
				libc?: string[];
				publishConfig?: Record<string, string>;
			}>(join(plan.stageDir, dir, "package.json"));
		expect(platformPackage("linux-x64")).toMatchObject({
			os: ["linux"],
			cpu: ["x64"],
			libc: ["glibc"],
		});
		expect(platformPackage("linux-x64-musl")).toMatchObject({
			os: ["linux"],
			cpu: ["x64"],
			libc: ["musl"],
		});
		expect(platformPackage("windows-arm64")).not.toHaveProperty("libc");
		// `crust publish` passes no --access; npm reads publishConfig.access from every staged package.
		expect(platformPackage("linux-x64").publishConfig).toEqual({ access: "public" });

		const rootPackage = readJson<{
			files: string[];
			bin: Record<string, string>;
			optionalDependencies: Record<string, string>;
			publishConfig?: Record<string, string>;
		}>(join(plan.stageDir, "root", "package.json"));
		expect(rootPackage.publishConfig).toEqual({ access: "public" });
		expect(rootPackage.bin).toEqual({ "test-cli": "bin/test-cli.js" });
		expect(rootPackage.optionalDependencies).toEqual({
			"@scope/test-package-cli-linux-x64": "0.1.0",
			"@scope/test-package-cli-linux-x64-musl": "0.1.0",
			"@scope/test-package-cli-windows-arm64": "0.1.0",
		});
		const resolver = readFileSync(join(plan.stageDir, "root", "bin", "test-cli.js"), "utf8");
		expect(resolver).toContain('"packagePathSegment": "test-package-cli-linux-x64"');
		expect(resolver).toContain('"targetAlias": "linux-x64"');
		expect(resolver).toContain("Unsupported platform:");
		expect(resolver).toContain('"linux-x64-musl": {');
		expect(resolver).toContain("glibcVersionRuntime");
		expect(resolver).toContain("Supported platforms: linux-x64, linux-x64-musl, windows-arm64");
		expect(resolver).toContain("Missing platform package");
		expect(resolver).toContain("optional dependencies are enabled");
		expect(resolver).toContain('child.on("error"');
		expect(resolver).toContain("process.kill(process.pid, signal)");
		expect(resolver).toContain("process.exit(code ?? 0)");
		expect(readFileSync(join(plan.stageDir, "root", "LICENSE"), "utf8")).toBe("test license\n");
		expect(outputs).toEqual([
			join(plan.stageDir, "linux-x64", "bin", "test-package-cli-bun-linux-x64"),
			join(plan.stageDir, "linux-x64-musl", "bin", "test-package-cli-bun-linux-x64-musl"),
			join(plan.stageDir, "windows-arm64", "bin", "test-package-cli-bun-windows-arm64.exe"),
		]);
	});

	it("runs the executor once per target with the canonical target name", async () => {
		const plan = createPlan(tmpDir, { name: "target-cli", version: "0.1.0" });
		const calls: BunTarget[] = [];

		await runDistributeBuild(
			plan,
			bunDistribution(
				["bun-linux-x64", "bun-darwin-arm64"],
				async (entryPath, outfilePath, target) => {
					calls.push(target);
					await fakeExecutor(entryPath, outfilePath);
				},
			),
			io,
		);

		expect(calls).toEqual(["bun-linux-x64", "bun-darwin-arm64"]);
	});

	it("stages Deno platform packages with the same npm names and glibc-only Linux metadata", async () => {
		const plan = createPlan(tmpDir, { name: "@scope/deno-cli", version: "2.0.0" });
		const outputs: string[] = [];
		const targets: DenoTarget[] = ["x86_64-unknown-linux-gnu", "aarch64-pc-windows-msvc"];

		await runDistributeBuild(
			plan,
			{
				table: DENO_TARGETS,
				targets,
				execute: async (entryPath: string, outfilePath: string) => {
					outputs.push(outfilePath);
					await fakeExecutor(entryPath, outfilePath);
				},
			},
			io,
		);

		const manifest = readJson<{
			packages: Array<{ target: string; name: string; bin: string; libc?: string }>;
			publishOrder: string[];
		}>(join(plan.stageDir, "manifest.json"));
		expect(manifest.packages).toEqual([
			expect.objectContaining({
				target: "linux-x64",
				name: "@scope/deno-cli-linux-x64",
				libc: "glibc",
				bin: "bin/deno-cli-x86_64-unknown-linux-gnu",
			}),
			expect.objectContaining({
				target: "windows-arm64",
				name: "@scope/deno-cli-windows-arm64",
				bin: "bin/deno-cli-aarch64-pc-windows-msvc.exe",
			}),
		]);
		expect(manifest.publishOrder).toEqual(["linux-x64", "windows-arm64", "root"]);
		expect(
			readJson<{ libc?: string[] }>(join(plan.stageDir, "linux-x64", "package.json")).libc,
		).toEqual(["glibc"]);
		expect(
			readJson<{ optionalDependencies: Record<string, string> }>(
				join(plan.stageDir, "root", "package.json"),
			).optionalDependencies,
		).toEqual({
			"@scope/deno-cli-linux-x64": "2.0.0",
			"@scope/deno-cli-windows-arm64": "2.0.0",
		});
		expect(readFileSync(join(plan.stageDir, "root", "bin", "deno-cli.js"), "utf8")).toContain(
			'"binaryFilename": "deno-cli-x86_64-unknown-linux-gnu"',
		);
		expect(outputs).toEqual([
			join(plan.stageDir, "linux-x64", "bin", "deno-cli-x86_64-unknown-linux-gnu"),
			join(plan.stageDir, "windows-arm64", "bin", "deno-cli-aarch64-pc-windows-msvc.exe"),
		]);
	});

	it("stages a root-only package whose bin is the executor output", async () => {
		const plan = createPlan(tmpDir, {
			name: "@scope/node-cli",
			version: "0.3.0",
			dependencies: { "@crustjs/core": "^1.0.0" },
			bin: { "node-cli": "dist/cli.js" },
		});
		const outputs: string[] = [];

		await runDistributeBuild(
			plan,
			{
				execute: async (entryPath: string, outfilePath: string) => {
					outputs.push(outfilePath);
					await fakeExecutor(entryPath, outfilePath);
				},
			},
			io,
		);

		const rootBin = join(plan.stageDir, "root", "bin", "node-cli.js");
		expect(outputs).toEqual([rootBin]);
		expect(readFileSync(rootBin, "utf8")).toBe("fake binary\n");
		const rootPackage = readJson<{
			name: string;
			files: string[];
			bin: Record<string, string>;
			optionalDependencies?: Record<string, string>;
			dependencies?: Record<string, string>;
		}>(join(plan.stageDir, "root", "package.json"));
		expect(rootPackage).toMatchObject({
			name: "@scope/node-cli",
			version: "0.3.0",
			type: "module",
			files: ["bin"],
			bin: { "node-cli": "bin/node-cli.js" },
		});
		expect(rootPackage).not.toHaveProperty("optionalDependencies");
		expect(rootPackage).not.toHaveProperty("dependencies");
		expect(
			readJson<{ packages: unknown[]; publishOrder: string[] }>(
				join(plan.stageDir, "manifest.json"),
			),
		).toMatchObject({ packages: [], publishOrder: ["root"] });
		expect(readFileSync(join(plan.stageDir, "root", "LICENSE"), "utf8")).toBe("test license\n");
	});

	it("uses string bin shorthand and copies common license variants", async () => {
		rmSync(join(tmpDir, "LICENSE"));
		writeFileSync(join(tmpDir, "LICENCE.md"), "variant license\n");
		const plan = createPlan(tmpDir, {
			name: "@scope/my-cli",
			version: "0.1.0",
			bin: "dist/cli",
		});

		await runDistributeBuild(plan, bunDistribution(), io);

		const rootPackage = readJson<{ bin: Record<string, string> }>(
			join(plan.stageDir, "root", "package.json"),
		);
		expect(rootPackage.bin).toEqual({ "my-cli": "bin/my-cli.js" });
		expect(readFileSync(join(plan.stageDir, "darwin-arm64", "LICENCE.md"), "utf8")).toBe(
			"variant license\n",
		);
	});

	it("writes manifest.json only after every target compiles", async () => {
		const plan = createPlan(tmpDir, { name: "my-cli", version: "0.1.0", bin: { cli: "dist/cli" } });
		const failSecond = async (entryPath: string, outfilePath: string, target: BunTarget) => {
			if (target === "bun-linux-x64") throw new Error("compile failed");
			await fakeExecutor(entryPath, outfilePath);
		};
		await expect(
			runDistributeBuild(
				plan,
				bunDistribution(["bun-darwin-arm64", "bun-linux-x64"], failSecond),
				io,
			),
		).rejects.toThrow(/compile failed/);
		expect(existsSync(join(plan.stageDir, "darwin-arm64", "bin", "my-cli-bun-darwin-arm64"))).toBe(
			true,
		);
		expect(existsSync(join(plan.stageDir, "manifest.json"))).toBe(false);
	});

	it("rejects multiple bin entries through staged package planning", async () => {
		const plan = createPlan(tmpDir, {
			name: "my-cli",
			version: "0.1.0",
			bin: { one: "dist/one", two: "dist/two" },
		});
		await expect(runDistributeBuild(plan, bunDistribution(), io)).rejects.toThrow(
			/exactly one bin entry/,
		);
	});

	it("stages Extension artifact directories into root and platform packages without wiping them", async () => {
		const plan = createPlan(
			tmpDir,
			{ name: "artifact-stage-cli", version: "0.1.0", bin: { cli: "dist/cli" } },
			{ validate: true },
		);
		mkdirSync(join(plan.outDir, "man"), { recursive: true });
		mkdirSync(join(plan.outDir, "skills", "x"), { recursive: true });
		writeFileSync(join(plan.outDir, "man", "x.1"), ".Dd generated\n");
		writeFileSync(join(plan.outDir, "skills", "x", "SKILL.md"), "skill\n");

		await runDistributeBuild(plan, bunDistribution(), io);

		const rootPackage = readJson<{ files: string[]; man: string[] }>(
			join(plan.stageDir, "root", "package.json"),
		);
		expect(rootPackage.files).toEqual(["bin", "man", "skills"]);
		expect(rootPackage.man).toEqual(["./man/x.1"]);
		expect(readFileSync(join(plan.stageDir, "root", "man", "x.1"), "utf8")).toBe(".Dd generated\n");
		expect(
			readFileSync(join(plan.stageDir, "darwin-arm64", "bin", "skills", "x", "SKILL.md"), "utf8"),
		).toBe("skill\n");
		expect(readFileSync(join(plan.outDir, "man", "x.1"), "utf8")).toBe(".Dd generated\n");
	});

	it("copies artifact symlinks as links instead of following them out of the project", async () => {
		const plan = createPlan(
			tmpDir,
			{ name: "artifact-stage-cli", version: "0.1.0", bin: { cli: "dist/cli" } },
			{ validate: true },
		);
		mkdirSync(join(plan.outDir, "skills"), { recursive: true });
		// Artifact trees are not containment-checked, so a link to an external file
		// must not have its contents copied into the staged packages.
		symlinkSync(join(tmpDir, "LICENSE"), join(plan.outDir, "skills", "leak"), "file");

		await runDistributeBuild(plan, bunDistribution(), io);

		for (const staged of [
			join(plan.stageDir, "root", "skills", "leak"),
			join(plan.stageDir, "darwin-arm64", "bin", "skills", "leak"),
		]) {
			expect(lstatSync(staged).isSymbolicLink()).toBe(true);
		}
	});

	it("rejects the reserved bin artifact directory", async () => {
		const plan = createPlan(
			tmpDir,
			{ name: "artifact-stage-cli", version: "0.1.0" },
			{ validate: true },
		);
		mkdirSync(join(plan.outDir, "bin"), { recursive: true });
		await expect(runDistributeBuild(plan, bunDistribution(), io)).rejects.toThrow(
			'Artifact directory "bin"',
		);
	});

	it("stages crust.include directories beside Extension artifacts", async () => {
		const outDir = join(tmpDir, ".crust", "artifacts");
		mkdirSync(join(outDir, "skills"), { recursive: true });
		mkdirSync(join(tmpDir, "templates", "base"), { recursive: true });
		mkdirSync(join(tmpDir, "assets"), { recursive: true });
		writeFileSync(join(tmpDir, "templates", "base", "README.md"), "template\n");
		writeFileSync(join(tmpDir, "assets", "logo.txt"), "logo\n");
		const packageJson = { name: "include-cli", version: "0.1.0" };
		const include = ["templates", "./assets"];

		const bunPlan = createPlan(tmpDir, packageJson, { validate: true, include });
		await runDistributeBuild(bunPlan, bunDistribution(), io);
		expect(
			readJson<{ files: string[] }>(join(bunPlan.stageDir, "root", "package.json")).files,
		).toEqual(["bin", "skills", "templates", "assets"]);
		expect(
			readFileSync(join(bunPlan.stageDir, "root", "templates", "base", "README.md"), "utf8"),
		).toBe("template\n");
		expect(
			readFileSync(join(bunPlan.stageDir, "darwin-arm64", "bin", "assets", "logo.txt"), "utf8"),
		).toBe("logo\n");

		// Root-only packages have no platform bin to copy into; the root copy is the only one.
		const nodePlan = createPlan(tmpDir, packageJson, {
			stageDir: join(tmpDir, ".node-stage"),
			include,
		});
		await runDistributeBuild(nodePlan, rootOnlyDistribution, io);
		expect(
			readJson<{ files: string[] }>(join(nodePlan.stageDir, "root", "package.json")).files,
		).toEqual(["bin", "templates", "assets"]);
		expect(existsSync(join(nodePlan.stageDir, "root", "assets", "logo.txt"))).toBe(true);
		expect(existsSync(join(nodePlan.stageDir, "darwin-arm64"))).toBe(false);
	});

	it("rejects crust.include entries that escape cwd, are missing, or collide", async () => {
		mkdirSync(join(tmpDir, ".crust", "artifacts", "skills"), { recursive: true });
		mkdirSync(join(tmpDir, "skills"), { recursive: true });
		mkdirSync(join(tmpDir, "bin"), { recursive: true });
		mkdirSync(join(tmpDir, ".crust", "nested"), { recursive: true });
		mkdirSync(join(tmpDir, "skills", "sub"), { recursive: true });
		mkdirSync(join(tmpDir, "assets"), { recursive: true });
		symlinkSync(tmpdir(), join(tmpDir, "escape"), "dir");
		// Nested escapes: a symlinked file directly inside the include dir, and one
		// only reachable through an in-project symlinked directory.
		mkdirSync(join(tmpDir, "templates", "deep"), { recursive: true });
		symlinkSync(join(tmpDir, "LICENSE"), join(tmpDir, "templates", "ok.txt"), "file");
		symlinkSync(tmpdir(), join(tmpDir, "templates", "deep", "leak"), "dir");
		mkdirSync(join(tmpDir, "hop", "real"), { recursive: true });
		symlinkSync(join(tmpDir, "templates", "deep"), join(tmpDir, "hop", "real", "via"), "dir");
		mkdirSync(join(tmpDir, "hopper"));
		symlinkSync(join(tmpDir, "hop", "real"), join(tmpDir, "hopper", "link"), "dir");
		const stage = (include: string[], validate = false, stageDir = join(tmpDir, ".crust")) =>
			runDistributeBuild(
				createPlan(
					tmpDir,
					{ name: "include-cli", version: "0.1.0" },
					{ validate, stageDir, include },
				),
				bunDistribution(),
				io,
			);

		await expect(stage(["../outside"])).rejects.toThrow("inside the project root");
		await expect(stage([join(tmpDir, "src")])).rejects.toThrow("inside the project root");
		await expect(stage(["."])).rejects.toThrow("inside the project root");
		await expect(stage(["missing"])).rejects.toThrow("is not a directory");
		await expect(stage(["src/cli.ts"])).rejects.toThrow("is not a directory");
		await expect(stage([".crust/nested"])).rejects.toThrow("overlaps the build output directory");
		await expect(stage(["assets"], false, join(tmpDir, "assets", "npm"))).rejects.toThrow(
			"overlaps the build output directory",
		);
		await expect(stage(["escape"])).rejects.toThrow("resolves outside the project root");
		await expect(stage(["templates"])).rejects.toThrow(
			`resolves outside the project root: ${join("templates", "deep", "leak")}`,
		);
		await expect(stage(["hopper"])).rejects.toThrow(
			`resolves outside the project root: ${join("hopper", "link", "via", "leak")}`,
		);
		await expect(stage(["bin"])).rejects.toThrow("generated npm bin directory");
		await expect(stage(["src", "src"])).rejects.toThrow("already staged");
		await expect(stage(["skills"], true)).rejects.toThrow("Extension artifact directory");
		await expect(stage(["skills/sub"], true)).rejects.toThrow('overlaps "skills"');
	});
});
