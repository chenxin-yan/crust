import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	buildPublishCommand,
	publishStagedPackages,
	readPublishManifest,
	validatePublishManifest,
} from "../../src/commands/publish.ts";
import type { DistributionManifest } from "../utils/distribute.ts";

const io = { stdout: () => {}, stderr: () => {} };

function writeStageFixture(tmpDir: string, manifest: DistributionManifest) {
	mkdirSync(join(tmpDir, "root", "bin"), { recursive: true });
	writeFileSync(
		join(tmpDir, "root", "package.json"),
		JSON.stringify(
			{
				name: manifest.root.name,
				version: manifest.version,
				bin: { [manifest.root.bin]: `bin/${manifest.root.bin}.js` },
				// Mirrors distribute.ts: a root-only package has no optionalDependencies field at all.
				...(manifest.packages.length > 0
					? {
							optionalDependencies: Object.fromEntries(
								manifest.packages.map((pkg) => [pkg.name, manifest.version]),
							),
						}
					: {}),
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
					...(pkg.libc ? { libc: [pkg.libc] } : {}),
				},
				null,
				2,
			),
		);
	}

	writeFileSync(join(tmpDir, "manifest.json"), JSON.stringify(manifest, null, 2));
}

describe("publish manifest validation", () => {
	const tmpDir = mkdtempSync(join(tmpdir(), "crust-publish-"));
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
				libc: "glibc",
				bin: "bin/demo-bun-linux-x64",
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

	it("validates a root-only Node manifest and publishes just the root", async () => {
		const nodeDir = join(tmpDir, "node");
		const nodeManifest: DistributionManifest = {
			version: "1.2.3",
			root: { name: "@scope/node-demo", dir: "root", bin: "node-demo" },
			packages: [],
			publishOrder: ["root"],
		};
		writeStageFixture(nodeDir, nodeManifest);
		expect(
			JSON.parse(readFileSync(join(nodeDir, "root", "package.json"), "utf8")),
		).not.toHaveProperty("optionalDependencies");

		const loaded = readPublishManifest(nodeDir);
		expect(loaded).toMatchObject({ packages: [], publishOrder: ["root"] });
		expect(() => validatePublishManifest(nodeDir, loaded)).not.toThrow();

		const published: string[] = [];
		await publishStagedPackages(
			loaded,
			{
				stageDir: nodeDir,
				spawnPublish: async (dir) => {
					published.push(dir);
					return 0;
				},
			},
			io,
		);
		expect(published).toEqual([join(nodeDir, "root")]);
	});

	it("rejects malformed publish order", async () => {
		const invalid: DistributionManifest = {
			...manifest,
			publishOrder: ["root", "linux-x64", "darwin-arm64"],
		};

		expect(() => validatePublishManifest(tmpDir, invalid)).toThrow(/root package last/);
		// Validation always runs before any npm publish is spawned.
		const spawnPublish = mock(async () => 0);
		await expect(
			publishStagedPackages(invalid, { stageDir: tmpDir, spawnPublish }, io),
		).rejects.toThrow(/root package last/);
		expect(spawnPublish).not.toHaveBeenCalled();
	});

	it("rejects staged libc metadata that disagrees with the manifest", () => {
		const stagedPath = join(tmpDir, "linux-x64", "package.json");
		const staged = JSON.parse(readFileSync(stagedPath, "utf8"));
		writeFileSync(stagedPath, JSON.stringify({ ...staged, libc: ["musl"] }));
		expect(() => validatePublishManifest(tmpDir, manifest)).toThrow(/libc metadata/);

		const { libc: _dropped, ...withoutLibc } = staged;
		writeFileSync(stagedPath, JSON.stringify(withoutLibc));
		expect(() => validatePublishManifest(tmpDir, manifest)).toThrow(/libc metadata/);
	});

	it("rejects missing staged directories", () => {
		rmSync(join(tmpDir, "linux-x64"), { recursive: true, force: true });
		expect(() => validatePublishManifest(tmpDir, manifest)).toThrow(
			/Missing staged package directory/,
		);
	});

	it("publishes with npm so trusted publishing works, leaving access to publishConfig", () => {
		expect(buildPublishCommand({})).toEqual(["npm", "publish"]);
		expect(buildPublishCommand({ tag: "next", registry: "https://r.example" })).toEqual([
			"npm",
			"publish",
			"--tag",
			"next",
			"--registry",
			"https://r.example",
		]);
	});

	it("supports dry-run without spawning npm publish", async () => {
		const spawnPublish = mock(async () => 0);
		await publishStagedPackages(
			manifest,
			{
				stageDir: tmpDir,
				dryRun: true,
				spawnPublish,
			},
			io,
		);
		expect(spawnPublish).not.toHaveBeenCalled();
	});

	it("passes invocation IO to the publisher executor", async () => {
		const stdout: string[] = [];
		const stderr: string[] = [];
		const invocationIO = {
			stdout: (text: string) => stdout.push(text),
			stderr: (text: string) => stderr.push(text),
		};

		await publishStagedPackages(
			manifest,
			{
				stageDir: tmpDir,
				spawnPublish: async (_dir, _command, executorIO) => {
					executorIO.stdout("registry stdout");
					executorIO.stderr("registry stderr");
					return 0;
				},
			},
			invocationIO,
		);

		expect(stdout).toContain("registry stdout");
		expect(stderr).toEqual(["registry stderr", "registry stderr", "registry stderr"]);
	});

	it("stops on first failed publish", async () => {
		const calls: string[] = [];
		const spawnPublish = mock(async (dir: string) => {
			calls.push(dir);
			return calls.length === 1 ? 1 : 0;
		});

		await expect(
			publishStagedPackages(
				manifest,
				{
					stageDir: tmpDir,
					spawnPublish,
				},
				io,
			),
		).rejects.toThrow(/linux-x64/);
		expect(calls).toHaveLength(1);
	});
});
