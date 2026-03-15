import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	buildDistributionPlatformPackageJson,
	buildDistributionRootPackageJson,
	derivePlatformPackageName,
	generateDistributionJsResolver,
	getPackagePathSegment,
	inferCommandName,
	runDistributeBuild,
} from "../../src/commands/distribute.ts";

describe("derivePlatformPackageName", () => {
	it("suffixes unscoped package names", () => {
		expect(derivePlatformPackageName("my-cli", "darwin-arm64")).toBe(
			"my-cli-darwin-arm64",
		);
	});

	it("suffixes scoped package names", () => {
		expect(derivePlatformPackageName("@scope/my-cli", "linux-x64")).toBe(
			"@scope/my-cli-linux-x64",
		);
	});
});

describe("inferCommandName", () => {
	it("falls back to the resolved base name", () => {
		expect(inferCommandName("my-cli", undefined, "my-cli")).toBe("my-cli");
	});

	it("uses the single object bin key", () => {
		expect(inferCommandName("my-cli", { crusty: "dist/cli" }, "my-cli")).toBe(
			"crusty",
		);
	});

	it("uses the unscoped package name for string bin shorthand", () => {
		expect(inferCommandName("@scope/my-cli", "dist/cli", "ignored")).toBe(
			"my-cli",
		);
	});

	it("throws for multiple bin entries", () => {
		expect(() =>
			inferCommandName(
				"my-cli",
				{ one: "dist/one", two: "dist/two" },
				"my-cli",
			),
		).toThrow(/exactly one bin entry/);
	});
});

describe("distribution manifest JSON builders", () => {
	it("builds the root package optionalDependencies", () => {
		const metadata = {
			commandName: "crust",
			rootPackageName: "@crustjs/crust",
			version: "1.2.3",
			baseName: "crust",
			rootPackageJson: {
				name: "@crustjs/crust",
				version: "1.2.3",
				description: "CLI tooling",
			},
		};
		const targets = [
			{
				target: "bun-darwin-arm64" as const,
				platformKey: "darwin-arm64" as const,
				targetAlias: "darwin-arm64",
				packageName: "@crustjs/crust-darwin-arm64",
				packagePathSegment: "crust-darwin-arm64",
				packageDir: "/tmp/darwin-arm64",
				binaryRelativePath: "bin/crust-bun-darwin-arm64",
				binaryFilename: "crust-bun-darwin-arm64",
				os: "darwin" as const,
				cpu: "arm64" as const,
			},
		];

		expect(buildDistributionRootPackageJson(metadata, targets)).toEqual({
			name: "@crustjs/crust",
			version: "1.2.3",
			type: "module",
			description: "CLI tooling",
			files: ["bin"],
			bin: { crust: "bin/crust.js" },
			optionalDependencies: {
				"@crustjs/crust-darwin-arm64": "1.2.3",
			},
		});
	});

	it("builds platform package metadata with os/cpu/bin", () => {
		const metadata = {
			commandName: "crust",
			rootPackageName: "@crustjs/crust",
			version: "1.2.3",
			baseName: "crust",
			rootPackageJson: {
				name: "@crustjs/crust",
				version: "1.2.3",
				description: "CLI tooling",
			},
		};
		const target = {
			target: "bun-windows-arm64" as const,
			platformKey: "win32-arm64" as const,
			targetAlias: "windows-arm64",
			packageName: "@crustjs/crust-windows-arm64",
			packagePathSegment: "crust-windows-arm64",
			packageDir: "/tmp/windows-arm64",
			binaryRelativePath: "bin/crust-bun-windows-arm64.exe",
			binaryFilename: "crust-bun-windows-arm64.exe",
			os: "win32" as const,
			cpu: "arm64" as const,
		};

		expect(buildDistributionPlatformPackageJson(metadata, target)).toEqual({
			name: "@crustjs/crust-windows-arm64",
			version: "1.2.3",
			description: "CLI tooling",
			files: ["bin"],
			bin: { crust: "bin/crust-bun-windows-arm64.exe" },
			os: ["win32"],
			cpu: ["arm64"],
		});
	});
});

describe("getPackagePathSegment", () => {
	it("returns the unscoped name for scoped packages", () => {
		expect(getPackagePathSegment("@crustjs/crust-linux-x64")).toBe(
			"crust-linux-x64",
		);
	});
});

describe("generateDistributionJsResolver", () => {
	it("generates a JS resolver with fixed candidate probing", () => {
		const launcher = generateDistributionJsResolver("crust", [
			{
				target: "bun-linux-x64-baseline",
				platformKey: "linux-x64",
				targetAlias: "linux-x64",
				packageName: "@crustjs/crust-linux-x64",
				packagePathSegment: "crust-linux-x64",
				packageDir: "/tmp/linux-x64",
				binaryRelativePath: "bin/crust-bun-linux-x64-baseline",
				binaryFilename: "crust-bun-linux-x64-baseline",
				os: "linux",
				cpu: "x64",
			},
		]);

		expect(launcher).toContain("#!/usr/bin/env node");
		expect(launcher).toContain("process.platform");
		expect(launcher).toContain("process.arch");
		expect(launcher).toContain("const candidateOne = resolve(");
		expect(launcher).toContain("const candidateTwo = resolve(");
		expect(launcher).toContain('"packagePathSegment": "crust-linux-x64"');
		expect(launcher).toContain('"packageName": "@crustjs/crust-linux-x64"');
		expect(launcher).toContain(
			'"binaryFilename": "crust-bun-linux-x64-baseline"',
		);
		expect(launcher).not.toContain('"targetAlias"');
		expect(launcher).toContain("Missing platform package");
		expect(launcher).toContain("optional dependencies are enabled");
		expect(launcher).toContain("Supported platforms: linux-x64");
		expect(launcher).toContain("try {");
		expect(launcher).toContain("process.kill(process.pid, signal)");
		expect(launcher).toContain("process.exit(1)");
	});
});

describe("runDistributeBuild", () => {
	const tmpDir = join(import.meta.dir, ".tmp-distribute-validation");
	const originalCwd = process.cwd;

	beforeAll(() => {
		rmSync(tmpDir, { recursive: true, force: true });
		mkdirSync(join(tmpDir, "src"), { recursive: true });
		writeFileSync(join(tmpDir, "src", "cli.ts"), 'console.log("hello");\n');
	});

	afterAll(() => {
		process.cwd = originalCwd;
		rmSync(tmpDir, { recursive: true, force: true });
	});

	it("writes a manifest file for a staged package", async () => {
		writeFileSync(
			join(tmpDir, "package.json"),
			JSON.stringify({
				name: "test-package-cli",
				version: "0.1.0",
				bin: {
					"test-cli": "dist/cli",
				},
			}),
		);
		process.cwd = () => tmpDir;

		await runDistributeBuild({
			entry: "src/cli.ts",
			minify: true,
			target: ["darwin-arm64"],
			stageDir: ".stage",
			validate: false,
		});

		const manifest = JSON.parse(
			readFileSync(join(tmpDir, ".stage", "manifest.json"), "utf-8"),
		) as {
			root: { dir: string; bin: string };
			packages: Array<{ target: string; name: string }>;
			publishOrder: string[];
		};

		expect(manifest.root.dir).toBe("root");
		expect(manifest.root.bin).toBe("test-cli");
		expect(manifest.packages).toHaveLength(1);
		expect(manifest.packages[0]).toMatchObject({
			target: "darwin-arm64",
			name: "test-package-cli-darwin-arm64",
		});
		expect(manifest.publishOrder).toEqual(["darwin-arm64", "root"]);
	});
});
