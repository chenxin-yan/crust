import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Crust, parseArgs } from "@crustjs/core";
import {
	buildPlatformPackageJson,
	buildRootPackageJson,
	derivePlatformPackageName,
	generatePackageLauncher,
	inferCommandName,
	packageCommand,
} from "../../src/commands/package.ts";

function makePackageNode() {
	const app = new Crust("test").command("package", packageCommand);
	const node = (
		app as unknown as { _node: import("@crustjs/core").CommandNode }
	)._node;
	const packageNode = node.subCommands.package;
	if (!packageNode) throw new Error("package subcommand not found");
	return packageNode;
}

describe("packageCommand definition", () => {
	it("has correct meta", () => {
		const node = makePackageNode();
		expect(node.meta.name).toBe("package");
		expect(node.meta.description).toBe(
			"Stage platform-specific npm packages for optionalDependency distribution",
		);
	});

	it("has correct default flag values", () => {
		const node = makePackageNode();
		const result = parseArgs(node, []);
		expect(result.flags.entry).toBe("src/cli.ts");
		expect(result.flags.minify).toBe(true);
		expect(result.flags.validate).toBe(true);
		expect(result.flags["stage-dir"]).toBe("dist/npm");
		expect(result.flags.name).toBeUndefined();
		expect(result.flags.target).toBeUndefined();
	});

	it("supports --stage-dir", () => {
		const node = makePackageNode();
		const result = parseArgs(node, ["--stage-dir", ".crust/npm"]);
		expect(result.flags["stage-dir"]).toBe(".crust/npm");
	});

	it("supports repeatable --target", () => {
		const node = makePackageNode();
		const result = parseArgs(node, [
			"--target",
			"linux-x64",
			"--target",
			"darwin-arm64",
		]);
		expect(result.flags.target).toEqual(["linux-x64", "darwin-arm64"]);
	});
});

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

describe("package manifest JSON builders", () => {
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
				packageDir: "/tmp/darwin-arm64",
				binaryRelativePath: "bin/crust-bun-darwin-arm64",
				binaryFilename: "crust-bun-darwin-arm64",
				os: "darwin" as const,
				cpu: "arm64" as const,
			},
		];

		expect(buildRootPackageJson(metadata, targets)).toEqual({
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
			packageDir: "/tmp/windows-arm64",
			binaryRelativePath: "bin/crust-bun-windows-arm64.exe",
			binaryFilename: "crust-bun-windows-arm64.exe",
			os: "win32" as const,
			cpu: "arm64" as const,
		};

		expect(buildPlatformPackageJson(metadata, target)).toEqual({
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

describe("generatePackageLauncher", () => {
	it("references platform packages via package.json resolution", () => {
		const launcher = generatePackageLauncher("crust", [
			{
				target: "bun-linux-x64-baseline",
				platformKey: "linux-x64",
				targetAlias: "linux-x64",
				packageName: "@crustjs/crust-linux-x64",
				packageDir: "/tmp/linux-x64",
				binaryRelativePath: "bin/crust-bun-linux-x64-baseline",
				binaryFilename: "crust-bun-linux-x64-baseline",
				os: "linux",
				cpu: "x64",
			},
		]);

		expect(launcher).toContain("#!/usr/bin/env node");
		expect(launcher).toContain('"linux-x64"');
		expect(launcher).toContain("@crustjs/crust-linux-x64");
		expect(launcher).toContain("require.resolve(");
		expect(launcher).toContain("/package.json");
		expect(launcher).toContain("optional dependencies are enabled");
	});
});

describe("packageCommand validation", () => {
	const tmpDir = join(import.meta.dir, ".tmp-package-validation");
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

		const app = new Crust("test").command("package", packageCommand);
		await app.execute({
			argv: [
				"package",
				"--target",
				"darwin-arm64",
				"--stage-dir",
				".stage",
				"--no-validate",
			],
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
