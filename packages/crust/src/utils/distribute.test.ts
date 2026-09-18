import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readlinkSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { type BuildReport, defineExtensionId } from "@crustjs/core";
import type { JsonValue } from "@crustjs/utils/json";

import { BUN_TARGETS, type BunTarget, DENO_TARGETS, type DenoTarget } from "./build-helpers.ts";
import {
	type ArtifactOwner,
	type DistributeBuildPlan,
	type Distribution,
	type DistributionManifest,
	mergeEntryArtifacts,
	runDistributeBuild,
} from "./distribute.ts";

const io = { stdout: () => {}, stderr: () => {} };

function createPlan(
	cwd: string,
	packageJson: JsonValue,
	overrides: Partial<DistributeBuildPlan> = {},
): DistributeBuildPlan {
	return {
		cwd,
		entries: [{ command: "test-cli", entryPath: join(cwd, "src", "cli.ts") }],
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
			$schema: "./node_modules/@crustjs/crust/schema/package.json",
			name: "@scope/test-package-cli",
			version: "0.1.0",
			description: "CLI tooling",
			crust: { runtime: "bun" },
			bin: { "test-cli": "src/cli.ts" },
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

		const manifest = readJson<DistributionManifest>(join(plan.stageDir, "manifest.json"));
		expect(manifest.root).toEqual({
			name: "@scope/test-package-cli",
			dir: "root",
			bins: ["test-cli"],
		});
		// Binaries are named after the command, not the package.
		expect(manifest.packages).toEqual([
			expect.objectContaining({
				target: "linux-x64",
				name: "@scope/test-package-cli-linux-x64",
				bins: { "test-cli": "bin/test-cli-bun-linux-x64" },
			}),
			expect.objectContaining({
				target: "linux-x64-musl",
				name: "@scope/test-package-cli-linux-x64-musl",
				bins: { "test-cli": "bin/test-cli-bun-linux-x64-musl" },
			}),
			expect.objectContaining({
				target: "windows-arm64",
				name: "@scope/test-package-cli-windows-arm64",
				bins: { "test-cli": "bin/test-cli-bun-windows-arm64.exe" },
			}),
		]);
		expect(manifest.publishOrder).toEqual(["linux-x64", "linux-x64-musl", "windows-arm64", "root"]);

		// glibc and musl packages share os/cpu; `libc` is what lets npm skip the wrong one.
		const platformPackage = (dir: string) =>
			readJson<{
				os: string[];
				cpu: string[];
				libc?: string[];
				bin: Record<string, string>;
				publishConfig?: Record<string, string>;
			}>(join(plan.stageDir, dir, "package.json"));
		expect(platformPackage("linux-x64")).toMatchObject({
			os: ["linux"],
			cpu: ["x64"],
			libc: ["glibc"],
			bin: { "test-cli": "bin/test-cli-bun-linux-x64" },
		});
		expect(platformPackage("linux-x64-musl")).toMatchObject({
			os: ["linux"],
			cpu: ["x64"],
			libc: ["musl"],
		});
		expect(platformPackage("windows-arm64")).not.toHaveProperty("libc");
		// npm reads publishConfig.access from each staged package.json.
		expect(platformPackage("linux-x64").publishConfig).toEqual({ access: "public" });
		// Editor-only `$schema` (create-crust templates set it) and the `crust` build
		// config are project-side; neither belongs in a published package.
		expect(platformPackage("linux-x64")).not.toHaveProperty("$schema");
		expect(platformPackage("linux-x64")).not.toHaveProperty("crust");

		const rootPackage = readJson<{
			files: string[];
			bin: Record<string, string>;
			optionalDependencies: Record<string, string>;
			publishConfig?: Record<string, string>;
		}>(join(plan.stageDir, "root", "package.json"));
		expect(rootPackage.publishConfig).toEqual({ access: "public" });
		expect(rootPackage).not.toHaveProperty("$schema");
		expect(rootPackage).not.toHaveProperty("crust");
		expect(rootPackage.bin).toEqual({ "test-cli": "bin/test-cli.js" });
		expect(rootPackage.optionalDependencies).toEqual({
			"@scope/test-package-cli-linux-x64": "0.1.0",
			"@scope/test-package-cli-linux-x64-musl": "0.1.0",
			"@scope/test-package-cli-windows-arm64": "0.1.0",
		});
		const resolver = readFileSync(join(plan.stageDir, "root", "bin", "test-cli.js"), "utf8");
		expect(resolver).toContain('const NAME = "test-cli";');
		expect(resolver).toContain('"packagePathSegment": "test-package-cli-linux-x64"');
		expect(resolver).toContain('"binaryFilename": "test-cli-bun-linux-x64"');
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
			join(plan.stageDir, "linux-x64", "bin", "test-cli-bun-linux-x64"),
			join(plan.stageDir, "linux-x64-musl", "bin", "test-cli-bun-linux-x64-musl"),
			join(plan.stageDir, "windows-arm64", "bin", "test-cli-bun-windows-arm64.exe"),
		]);
	});

	it("stages one launcher and one binary per command in every package", async () => {
		writeFileSync(join(tmpDir, "src", "admin.ts"), "export {};\n");
		const plan = createPlan(
			tmpDir,
			{ name: "@scope/suite", version: "1.0.0" },
			{
				entries: [
					{ command: "greet", entryPath: join(tmpDir, "src", "cli.ts") },
					{ command: "admin", entryPath: join(tmpDir, "src", "admin.ts") },
				],
			},
		);
		const calls: Array<[string, string, BunTarget]> = [];

		await runDistributeBuild(
			plan,
			bunDistribution(
				["bun-linux-x64", "bun-windows-x64"],
				async (entryPath, outfilePath, target) => {
					calls.push([entryPath, outfilePath, target]);
					await fakeExecutor(entryPath, outfilePath);
				},
			),
			io,
		);

		// Each entry compiles from its own source, grouped by target.
		expect(calls).toEqual([
			[
				join(tmpDir, "src", "cli.ts"),
				join(plan.stageDir, "linux-x64", "bin", "greet-bun-linux-x64"),
				"bun-linux-x64",
			],
			[
				join(tmpDir, "src", "admin.ts"),
				join(plan.stageDir, "linux-x64", "bin", "admin-bun-linux-x64"),
				"bun-linux-x64",
			],
			[
				join(tmpDir, "src", "cli.ts"),
				join(plan.stageDir, "windows-x64", "bin", "greet-bun-windows-x64.exe"),
				"bun-windows-x64",
			],
			[
				join(tmpDir, "src", "admin.ts"),
				join(plan.stageDir, "windows-x64", "bin", "admin-bun-windows-x64.exe"),
				"bun-windows-x64",
			],
		]);
		expect(
			readJson<{ bin: Record<string, string>; optionalDependencies: Record<string, string> }>(
				join(plan.stageDir, "root", "package.json"),
			),
		).toMatchObject({
			bin: { greet: "bin/greet.js", admin: "bin/admin.js" },
			// One platform package per target, never per command.
			optionalDependencies: {
				"@scope/suite-linux-x64": "1.0.0",
				"@scope/suite-windows-x64": "1.0.0",
			},
		});
		expect(
			readJson<{ bin: Record<string, string> }>(join(plan.stageDir, "windows-x64", "package.json"))
				.bin,
		).toEqual({ greet: "bin/greet-bun-windows-x64.exe", admin: "bin/admin-bun-windows-x64.exe" });
		expect(readFileSync(join(plan.stageDir, "root", "bin", "admin.js"), "utf8")).toContain(
			'"binaryFilename": "admin-bun-linux-x64"',
		);
		expect(readJson<DistributionManifest>(join(plan.stageDir, "manifest.json"))).toMatchObject({
			root: { bins: ["greet", "admin"] },
			packages: [
				expect.objectContaining({
					dir: "linux-x64",
					bins: { greet: "bin/greet-bun-linux-x64", admin: "bin/admin-bun-linux-x64" },
				}),
				expect.objectContaining({
					dir: "windows-x64",
					bins: { greet: "bin/greet-bun-windows-x64.exe", admin: "bin/admin-bun-windows-x64.exe" },
				}),
			],
		});

		// Root-only packages get one bundle per command.
		const nodePlan = { ...plan, stageDir: join(tmpDir, ".node-stage") };
		await runDistributeBuild(nodePlan, rootOnlyDistribution, io);
		expect(readFileSync(join(nodePlan.stageDir, "root", "bin", "greet.js"), "utf8")).toBe(
			"fake binary\n",
		);
		expect(readFileSync(join(nodePlan.stageDir, "root", "bin", "admin.js"), "utf8")).toBe(
			"fake binary\n",
		);
		expect(readJson<DistributionManifest>(join(nodePlan.stageDir, "manifest.json"))).toMatchObject({
			root: { bins: ["greet", "admin"] },
			packages: [],
		});
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

		const manifest = readJson<DistributionManifest>(join(plan.stageDir, "manifest.json"));
		expect(manifest.packages).toEqual([
			expect.objectContaining({
				target: "linux-x64",
				name: "@scope/deno-cli-linux-x64",
				libc: "glibc",
				bins: { "test-cli": "bin/test-cli-x86_64-unknown-linux-gnu" },
			}),
			expect.objectContaining({
				target: "windows-arm64",
				name: "@scope/deno-cli-windows-arm64",
				bins: { "test-cli": "bin/test-cli-aarch64-pc-windows-msvc.exe" },
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
		expect(outputs).toEqual([
			join(plan.stageDir, "linux-x64", "bin", "test-cli-x86_64-unknown-linux-gnu"),
			join(plan.stageDir, "windows-arm64", "bin", "test-cli-aarch64-pc-windows-msvc.exe"),
		]);
	});

	it("stages a root-only package whose bin is the executor output", async () => {
		const plan = createPlan(
			tmpDir,
			{
				name: "@scope/node-cli",
				version: "0.3.0",
				dependencies: { "@crustjs/core": "^1.0.0" },
				bin: { "node-cli": "src/cli.ts" },
			},
			{ entries: [{ command: "node-cli", entryPath: join(tmpDir, "src", "cli.ts") }] },
		);
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

	it("copies common license variants into every package", async () => {
		rmSync(join(tmpDir, "LICENSE"));
		writeFileSync(join(tmpDir, "LICENCE.md"), "variant license\n");
		const plan = createPlan(tmpDir, { name: "@scope/my-cli", version: "0.1.0" });

		await runDistributeBuild(plan, bunDistribution(), io);

		expect(readFileSync(join(plan.stageDir, "root", "LICENCE.md"), "utf8")).toBe(
			"variant license\n",
		);
		expect(readFileSync(join(plan.stageDir, "darwin-arm64", "LICENCE.md"), "utf8")).toBe(
			"variant license\n",
		);
	});

	it("writes manifest.json only after every command of every target compiles", async () => {
		writeFileSync(join(tmpDir, "src", "admin.ts"), "export {};\n");
		const plan = createPlan(
			tmpDir,
			{ name: "my-cli", version: "0.1.0" },
			{
				entries: [
					{ command: "cli", entryPath: join(tmpDir, "src", "cli.ts") },
					{ command: "admin", entryPath: join(tmpDir, "src", "admin.ts") },
				],
			},
		);
		const failAdminLinux = async (entryPath: string, outfilePath: string, target: BunTarget) => {
			if (target === "bun-linux-x64" && entryPath.endsWith("admin.ts")) {
				throw new Error("compile failed");
			}
			await fakeExecutor(entryPath, outfilePath);
		};
		await expect(
			runDistributeBuild(
				plan,
				bunDistribution(["bun-darwin-arm64", "bun-linux-x64"], failAdminLinux),
				io,
			),
		).rejects.toThrow(/compile failed/);
		expect(existsSync(join(plan.stageDir, "darwin-arm64", "bin", "admin-bun-darwin-arm64"))).toBe(
			true,
		);
		expect(existsSync(join(plan.stageDir, "linux-x64", "bin", "cli-bun-linux-x64"))).toBe(true);
		expect(existsSync(join(plan.stageDir, "manifest.json"))).toBe(false);
	});

	it("records each bin's Build Report in the manifest, and omits the field when hooks did not run", async () => {
		const plan = createPlan(tmpDir, { name: "my-cli", version: "0.1.0" });
		const build = {
			"test-cli": {
				extensions: [{ id: defineExtensionId("crust:man"), files: ["man/test-cli.1"] }],
			},
		} satisfies Record<string, BuildReport>;

		await runDistributeBuild({ ...plan, validate: true }, bunDistribution(), io, build);
		expect(readJson<DistributionManifest>(join(plan.stageDir, "manifest.json")).build).toEqual(
			build,
		);

		// --no-validate: hooks skipped, so the manifest must not claim they ran.
		await runDistributeBuild(plan, bunDistribution(), io, undefined);
		expect(readJson<DistributionManifest>(join(plan.stageDir, "manifest.json"))).not.toHaveProperty(
			"build",
		);
	});

	it("stages Extension artifact directories into root and platform packages without wiping them", async () => {
		const plan = createPlan(
			tmpDir,
			{ name: "artifact-stage-cli", version: "0.1.0" },
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
			{ name: "artifact-stage-cli", version: "0.1.0" },
			{ validate: true },
		);
		mkdirSync(join(plan.outDir, "skills"), { recursive: true });
		// Artifact trees are not containment-checked, so a link to an external file
		// must not have its contents copied into the staged packages.
		symlinkSync(join(tmpDir, "LICENSE"), join(plan.outDir, "skills", "leak"), "file");
		// A relative link must stay relative so it still resolves after install,
		// when .crust/artifacts no longer exists.
		writeFileSync(join(plan.outDir, "skills", "SKILL.md"), "skill\n");
		symlinkSync("SKILL.md", join(plan.outDir, "skills", "alias.md"), "file");

		await runDistributeBuild(plan, bunDistribution(), io);

		for (const skills of [
			join(plan.stageDir, "root", "skills"),
			join(plan.stageDir, "darwin-arm64", "bin", "skills"),
		]) {
			expect(readlinkSync(join(skills, "leak"))).toBe(join(tmpDir, "LICENSE"));
			expect(readlinkSync(join(skills, "alias.md"))).toBe("SKILL.md");
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

describe("mergeEntryArtifacts", () => {
	const tmpDir = mkdtempSync(join(tmpdir(), "crust-merge-artifacts-"));
	const artifactDir = join(tmpDir, "artifacts");
	const write = (path: string, content = "x\n") => {
		mkdirSync(join(tmpDir, path, ".."), { recursive: true });
		writeFileSync(join(tmpDir, path), content);
	};

	beforeEach(() => rmSync(tmpDir, { recursive: true, force: true }));
	afterAll(() => rmSync(tmpDir, { recursive: true, force: true }));

	it("merges distinct paths from every entry", () => {
		write("greet/man/greet.1", "greet man\n");
		write("greet/skills/greet/SKILL.md", "greet skill\n");
		write("admin/man/admin.1", "admin man\n");
		write("admin/skills/admin/SKILL.md", "admin skill\n");
		const owners = new Map<string, ArtifactOwner>();

		mergeEntryArtifacts(join(tmpDir, "greet"), artifactDir, "greet", owners);
		mergeEntryArtifacts(join(tmpDir, "admin"), artifactDir, "admin", owners);

		expect(readFileSync(join(artifactDir, "man", "greet.1"), "utf8")).toBe("greet man\n");
		expect(readFileSync(join(artifactDir, "man", "admin.1"), "utf8")).toBe("admin man\n");
		expect(readFileSync(join(artifactDir, "skills", "greet", "SKILL.md"), "utf8")).toBe(
			"greet skill\n",
		);
		expect(readFileSync(join(artifactDir, "skills", "admin", "SKILL.md"), "utf8")).toBe(
			"admin skill\n",
		);
		expect(owners.get("man")).toEqual({ command: "greet", directory: true });
		expect(owners.get("man/admin.1")).toEqual({ command: "admin", directory: false });
	});

	it("rejects a file two entries both write, naming both commands", () => {
		write("greet/completions/_shared");
		write("greet/man/greet.1");
		write("admin/man/greet.1", "overwrite attempt\n");
		const owners = new Map<string, ArtifactOwner>();
		mergeEntryArtifacts(join(tmpDir, "greet"), artifactDir, "greet", owners);

		expect(() => mergeEntryArtifacts(join(tmpDir, "admin"), artifactDir, "admin", owners)).toThrow(
			'Build artifact "man/greet.1" is written by both bin "greet" and "admin".',
		);
		expect(readFileSync(join(artifactDir, "man", "greet.1"), "utf8")).toBe("x\n");
	});

	it("rejects a directory in one entry that is a file in another", () => {
		write("greet/skills/tool");
		write("admin/skills/tool/SKILL.md");
		write("third/skills/tool");
		const owners = new Map<string, ArtifactOwner>();
		mergeEntryArtifacts(join(tmpDir, "greet"), artifactDir, "greet", owners);

		expect(() => mergeEntryArtifacts(join(tmpDir, "admin"), artifactDir, "admin", owners)).toThrow(
			'Build artifact "skills/tool" is written by both bin "greet" and "admin".',
		);
		rmSync(join(artifactDir, "skills", "tool"));
		owners.delete("skills/tool");
		mergeEntryArtifacts(join(tmpDir, "admin"), artifactDir, "admin", owners);
		expect(() => mergeEntryArtifacts(join(tmpDir, "third"), artifactDir, "third", owners)).toThrow(
			'Build artifact "skills/tool" is written by both bin "admin" and "third".',
		);
	});

	it.each(["file", "directory", "dangling"])(
		"rejects unexpected %s links without copying outside contents",
		(kind) => {
			write("outside/sentinel", "outside bytes");
			mkdirSync(join(tmpDir, "entry", "assets"), { recursive: true });
			const target =
				kind === "file" ? "outside/sentinel" : kind === "directory" ? "outside" : "missing";
			symlinkSync(
				join(tmpDir, target),
				join(tmpDir, "entry", "assets", "link"),
				kind === "directory" ? "dir" : "file",
			);
			expect(() =>
				mergeEntryArtifacts(join(tmpDir, "entry"), artifactDir, "legacy", new Map()),
			).toThrow(/regular files|symlink/);
			expect(existsSync(join(artifactDir, "assets", "link"))).toBe(false);
			expect(readFileSync(join(tmpDir, "outside", "sentinel"), "utf8")).toBe("outside bytes");
		},
	);

	it("rejects a replaced entry root without reading linked files", () => {
		write("outside/sentinel", "outside bytes");
		symlinkSync(join(tmpDir, "outside"), join(tmpDir, "entry"), "dir");
		expect(() =>
			mergeEntryArtifacts(join(tmpDir, "entry"), artifactDir, "legacy", new Map()),
		).toThrow(/symlink/);
		expect(existsSync(join(artifactDir, "sentinel"))).toBe(false);
		expect(readFileSync(join(tmpDir, "outside/sentinel"), "utf8")).toBe("outside bytes");
	});

	it.skipIf(process.platform === "win32")(
		"rejects nonregular socket entries without copying them",
		async () => {
			mkdirSync(join(tmpDir, "entry"), { recursive: true });
			const server = createServer();
			try {
				await new Promise<void>((resolve, reject) => {
					server.once("error", reject);
					server.listen(join(tmpDir, "entry/socket"), resolve);
				});
				expect(() =>
					mergeEntryArtifacts(join(tmpDir, "entry"), artifactDir, "legacy", new Map()),
				).toThrow(/regular files/);
				expect(existsSync(join(artifactDir, "socket"))).toBe(false);
			} finally {
				await new Promise<void>((resolve) => server.close(() => resolve()));
			}
		},
	);

	it.each([
		["shared/Config.json", "shared/config.json"],
		["shared/Config", "shared/config/child"],
		["shared/Config/child", "shared/config"],
		["Shared/Config.json", "shared/config.json"],
	])("rejects portable cross-entry collision %s / %s", (first, second) => {
		write(`greet/${first}`);
		write(`admin/${second}`);
		const owners = new Map<string, ArtifactOwner>();
		mergeEntryArtifacts(join(tmpDir, "greet"), artifactDir, "greet", owners);
		expect(() => mergeEntryArtifacts(join(tmpDir, "admin"), artifactDir, "admin", owners)).toThrow(
			/both bin "greet" and "admin"/,
		);
		expect(readFileSync(join(artifactDir, first), "utf8")).toBe("x\n");
	});

	it("preserves bytes in shared directories with different casing", () => {
		write("greet/Shared/first");
		write("admin/shared/second");
		const bytes = new Uint8Array([0, 255, 128, 10]);
		writeFileSync(join(tmpDir, "admin/shared/second"), bytes);
		const owners = new Map<string, ArtifactOwner>();
		mergeEntryArtifacts(join(tmpDir, "greet"), artifactDir, "greet", owners);
		mergeEntryArtifacts(join(tmpDir, "admin"), artifactDir, "admin", owners);
		expect(new Uint8Array(readFileSync(join(artifactDir, "shared/second")))).toEqual(bytes);
	});

	it("tolerates an entry whose hooks wrote nothing", () => {
		mergeEntryArtifacts(join(tmpDir, "missing"), artifactDir, "greet", new Map());
		expect(existsSync(artifactDir)).toBe(false);
	});
});
