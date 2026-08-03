import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { Crust } from "@crustjs/core";

import {
	buildPublishCommand,
	publishCommand,
	publishStagedPackages,
	readPublishManifest,
	validatePublishManifest,
} from "../../src/commands/publish.ts";
import type { DistributionManifest } from "../utils/distribute.ts";

/** Parse argv against the mounted publish command's grammar. */
async function parsePublishArgs(argv: string[]) {
	let captured: { flags: Record<string, unknown> } | undefined;
	const app = new Crust("test").mount(publishCommand);
	const node = app._node.subCommands.publish!;
	node.run = (ctx) => {
		captured = { flags: (ctx as { flags: Record<string, unknown> }).flags };
	};
	await app.run(["publish", ...argv]);
	if (!captured) throw new Error("publish handler did not run");
	return captured;
}

function writeStageFixture(tmpDir: string, manifest: DistributionManifest) {
	mkdirSync(join(tmpDir, "root", "bin"), { recursive: true });
	writeFileSync(
		join(tmpDir, "root", "package.json"),
		JSON.stringify(
			{
				name: manifest.root.name,
				version: manifest.version,
				bin: { [manifest.root.bin]: `bin/${manifest.root.bin}` },
				optionalDependencies: Object.fromEntries(
					manifest.packages.map((pkg) => [pkg.name, manifest.version]),
				),
			},
			null,
			2,
		),
	);

	for (const pkg of manifest.packages) {
		mkdirSync(join(tmpDir, pkg.dir, "bin"), { recursive: true });
		writeFileSync(
			join(tmpDir, pkg.dir, "package.json"),
			JSON.stringify(
				{
					name: pkg.name,
					version: manifest.version,
					bin: { [manifest.root.bin]: pkg.bin },
					os: [pkg.os],
					cpu: [pkg.cpu],
				},
				null,
				2,
			),
		);
	}

	writeFileSync(join(tmpDir, "manifest.json"), JSON.stringify(manifest, null, 2));
}

describe("publishCommand definition", () => {
	it("has correct defaults", async () => {
		const result = await parsePublishArgs([]);

		expect(result.flags["stage-dir"]).toBe("dist/npm");
		expect(result.flags.access).toBe("public");
		expect(result.flags["dry-run"]).toBe(false);
		expect(result.flags.verify).toBe(true);
	});
});

describe("publish manifest validation", () => {
	const tmpDir = join(import.meta.dir, ".tmp-publish");
	const manifest: DistributionManifest = {
		version: "1.2.3",
		root: { name: "@scope/demo", dir: "root", bin: "demo" },
		packages: [
			{
				target: "linux-x64",
				name: "@scope/demo-linux-x64",
				dir: "linux-x64",
				os: "linux",
				cpu: "x64",
				bin: "bin/demo-bun-linux-x64-baseline",
			},
			{
				target: "darwin-arm64",
				name: "@scope/demo-darwin-arm64",
				dir: "darwin-arm64",
				os: "darwin",
				cpu: "arm64",
				bin: "bin/demo-bun-darwin-arm64",
			},
		],
		publishOrder: ["linux-x64", "darwin-arm64", "root"],
	};

	beforeEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
		mkdirSync(tmpDir, { recursive: true });
		writeStageFixture(tmpDir, manifest);
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	it("reads and validates a staged manifest", () => {
		const loaded = readPublishManifest(tmpDir);
		expect(loaded.publishOrder).toEqual(["linux-x64", "darwin-arm64", "root"]);
		expect(() => validatePublishManifest(tmpDir, loaded)).not.toThrow();
	});

	it("rejects malformed publish order", () => {
		const invalid: DistributionManifest = {
			...manifest,
			publishOrder: ["root", "linux-x64", "darwin-arm64"],
		};

		expect(() => validatePublishManifest(tmpDir, invalid)).toThrow(/root package last/);
	});

	it("rejects missing staged directories", () => {
		rmSync(join(tmpDir, "linux-x64"), { recursive: true, force: true });
		expect(() => validatePublishManifest(tmpDir, manifest)).toThrow(
			/Missing staged package directory/,
		);
	});

	it("uses the current executable as bun with BUN_BE_BUN support", () => {
		expect(buildPublishCommand({ access: "public" })).toEqual([
			process.execPath,
			"publish",
			"--access",
			"public",
			"--no-git-checks",
		]);
	});

	it("supports dry-run without spawning bun publish", async () => {
		const spawnPublish = mock(async () => 0);
		await publishStagedPackages(manifest, {
			stageDir: tmpDir,
			access: "public",
			dryRun: true,
			spawnPublish,
		});
		expect(spawnPublish).not.toHaveBeenCalled();
	});

	it("stops on first failed publish", async () => {
		const calls: string[] = [];
		const spawnPublish = mock(async (dir: string) => {
			calls.push(dir);
			return calls.length === 1 ? 1 : 0;
		});

		await expect(
			publishStagedPackages(manifest, {
				stageDir: tmpDir,
				access: "public",
				spawnPublish,
			}),
		).rejects.toThrow(/linux-x64/);
		expect(calls).toHaveLength(1);
	});
});
