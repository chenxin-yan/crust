import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { JsonValue } from "@crustjs/utils/json";

import type { BunTarget } from "./build-helpers.ts";
import { runDistributeBuild } from "./distribute.ts";

const io = { stdout: () => {}, stderr: () => {} };

function createPlan(
	cwd: string,
	packageJson: JsonValue,
	overrides: Partial<{
		name: string;
		targets: BunTarget[];
		stageDir: string;
		validate: boolean;
		outDir: string;
	}> = {},
) {
	return {
		cwd,
		entryPath: join(cwd, "src", "cli.ts"),
		minify: true,
		targets: ["bun-darwin-arm64"] satisfies BunTarget[],
		stageDir: join(cwd, ".stage"),
		envFiles: [],
		validate: false,
		outDir: join(cwd, "dist"),
		userPackageJson: packageJson,
		...overrides,
	};
}

const fakeExecutor = async (
	_entryPath: string,
	outfilePath: string,
	_minify: boolean,
	_target: BunTarget,
	_envFiles: readonly string[],
	_cwd: string,
) => {
	writeFileSync(outfilePath, "fake binary\n");
};

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
		};
		const plan = createPlan(tmpDir, packageJson, {
			targets: ["bun-linux-x64-baseline", "bun-windows-arm64"],
		});
		const outputs: string[] = [];

		await runDistributeBuild(plan, {
			io,
			execute: async (...args) => {
				outputs.push(args[1]);
				await fakeExecutor(...args);
			},
		});

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
				bin: "bin/test-package-cli-bun-linux-x64-baseline",
			}),
			expect.objectContaining({
				target: "windows-arm64",
				name: "@scope/test-package-cli-windows-arm64",
				bin: "bin/test-package-cli-bun-windows-arm64.exe",
			}),
		]);
		expect(manifest.publishOrder).toEqual(["linux-x64", "windows-arm64", "root"]);

		const rootPackage = readJson<{
			files: string[];
			bin: Record<string, string>;
			optionalDependencies: Record<string, string>;
		}>(join(plan.stageDir, "root", "package.json"));
		expect(rootPackage.bin).toEqual({ "test-cli": "bin/test-cli.js" });
		expect(rootPackage.optionalDependencies).toEqual({
			"@scope/test-package-cli-linux-x64": "0.1.0",
			"@scope/test-package-cli-windows-arm64": "0.1.0",
		});
		expect(readFileSync(join(plan.stageDir, "root", "bin", "test-cli.js"), "utf8")).toContain(
			'"packagePathSegment": "test-package-cli-linux-x64"',
		);
		expect(readFileSync(join(plan.stageDir, "root", "LICENSE"), "utf8")).toBe("test license\n");
		expect(outputs).toEqual([
			join(plan.stageDir, "linux-x64", "bin", "test-package-cli-bun-linux-x64-baseline"),
			join(plan.stageDir, "windows-arm64", "bin", "test-package-cli-bun-windows-arm64.exe"),
		]);
	});

	it("uses string bin shorthand and copies common license variants", async () => {
		rmSync(join(tmpDir, "LICENSE"));
		writeFileSync(join(tmpDir, "LICENCE.md"), "variant license\n");
		const plan = createPlan(tmpDir, {
			name: "@scope/my-cli",
			version: "0.1.0",
			bin: "dist/cli",
		});

		await runDistributeBuild(plan, { io, execute: fakeExecutor });

		const rootPackage = readJson<{ bin: Record<string, string> }>(
			join(plan.stageDir, "root", "package.json"),
		);
		expect(rootPackage.bin).toEqual({ "my-cli": "bin/my-cli.js" });
		expect(readFileSync(join(plan.stageDir, "darwin-arm64", "LICENCE.md"), "utf8")).toBe(
			"variant license\n",
		);
	});

	it("rejects multiple bin entries through staged package planning", async () => {
		const plan = createPlan(tmpDir, {
			name: "my-cli",
			version: "0.1.0",
			bin: { one: "dist/one", two: "dist/two" },
		});
		await expect(runDistributeBuild(plan, { io, execute: fakeExecutor })).rejects.toThrow(
			/exactly one bin entry/,
		);
	});

	it("stages Extension artifact directories into root and platform packages", async () => {
		const outDir = join(tmpDir, "dist");
		mkdirSync(join(outDir, "man"), { recursive: true });
		mkdirSync(join(outDir, "skills", "x"), { recursive: true });
		writeFileSync(join(outDir, "man", "x.1"), ".Dd generated\n");
		writeFileSync(join(outDir, "skills", "x", "SKILL.md"), "skill\n");
		const plan = createPlan(
			tmpDir,
			{ name: "artifact-stage-cli", version: "0.1.0", bin: { cli: "dist/cli" } },
			{ validate: true, outDir },
		);

		await runDistributeBuild(plan, { io, execute: fakeExecutor });

		const rootPackage = readJson<{ files: string[]; man: string[] }>(
			join(plan.stageDir, "root", "package.json"),
		);
		expect(rootPackage.files).toEqual(["bin", "man", "skills"]);
		expect(rootPackage.man).toEqual(["./man/x.1"]);
		expect(
			readFileSync(join(plan.stageDir, "darwin-arm64", "bin", "skills", "x", "SKILL.md"), "utf8"),
		).toBe("skill\n");
	});

	it("rejects artifacts inside stage-dir and the reserved bin directory", async () => {
		const packageJson = { name: "artifact-stage-cli", version: "0.1.0" };
		const stageDir = join(tmpDir, ".stage");
		const nestedOutDir = join(stageDir, "artifacts");
		mkdirSync(join(nestedOutDir, "man"), { recursive: true });
		await expect(
			runDistributeBuild(
				createPlan(tmpDir, packageJson, { stageDir, validate: true, outDir: nestedOutDir }),
				{
					io,
					execute: fakeExecutor,
				},
			),
		).rejects.toThrow("--stage-dir cannot contain the artifact output directory");

		const outDir = join(tmpDir, "dist-bin");
		mkdirSync(join(outDir, "bin"), { recursive: true });
		await expect(
			runDistributeBuild(createPlan(tmpDir, packageJson, { validate: true, outDir }), {
				io,
				execute: fakeExecutor,
			}),
		).rejects.toThrow('Artifact directory "bin"');
	});
});
