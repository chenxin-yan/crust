import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
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
				bin: Object.fromEntries(
					manifest.root.bins.map((command) => [command, `bin/${command}.js`]),
				),
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
					bin: pkg.bins,
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
		root: { name: "@scope/demo", dir: "root", bins: ["demo", "demo-admin"] },
		packages: [
			{
				target: "linux-x64",
				name: "@scope/demo-linux-x64",
				dir: "linux-x64",
				os: "linux",
				cpu: "x64",
				libc: "glibc",
				bins: {
					demo: "bin/demo-bun-linux-x64",
					"demo-admin": "bin/demo-admin-bun-linux-x64",
				},
			},
			{
				target: "darwin-arm64",
				name: "@scope/demo-darwin-arm64",
				dir: "darwin-arm64",
				os: "darwin",
				cpu: "arm64",
				bins: {
					demo: "bin/demo-bun-darwin-arm64",
					"demo-admin": "bin/demo-admin-bun-darwin-arm64",
				},
			},
		],
		publishOrder: ["linux-x64", "darwin-arm64", "root"],
		build: { demo: { extensions: [] } },
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
			root: { name: "@scope/node-demo", dir: "root", bins: ["node-demo"] },
			packages: [],
			publishOrder: ["root"],
		};
		writeStageFixture(nodeDir, nodeManifest);

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

	it("rejects escaped and aliased directories before any publisher runs", async () => {
		const outside = join(tmpDir, "outside");
		const stage = join(tmpDir, "stage");
		mkdirSync(outside);
		writeFileSync(join(outside, "sentinel"), "untouched");
		for (const dir of ["../outside", outside, "escape", "root/../outside-link"]) {
			writeStageFixture(stage, manifest);
			symlinkSync(outside, join(stage, "escape"), "dir");
			symlinkSync(outside, join(stage, "outside-link"), "dir");
			const invalid = structuredClone(manifest);
			invalid.root.dir = dir;
			invalid.publishOrder[2] = dir;
			writeFileSync(
				join(outside, "package.json"),
				readFileSync(join(stage, "root", "package.json")),
			);
			const spawnPublish = mock(async () => 0);
			await expect(
				publishStagedPackages(invalid, { stageDir: stage, spawnPublish }, io),
			).rejects.toThrow(/inside|outside/);
			expect(spawnPublish).not.toHaveBeenCalled();
			expect(readFileSync(join(outside, "sentinel"), "utf8")).toBe("untouched");
			rmSync(stage, { recursive: true });
		}
		for (const alias of ["./root", "alias"]) {
			writeStageFixture(stage, manifest);
			symlinkSync(join(stage, "root"), join(stage, "alias"), "dir");
			const invalid = structuredClone(manifest);
			invalid.packages[1]!.dir = alias;
			invalid.publishOrder[1] = alias;
			const spawnPublish = mock(async () => 0);
			await expect(
				publishStagedPackages(invalid, { stageDir: stage, spawnPublish }, io),
			).rejects.toThrow(/duplicate staged directories/);
			expect(spawnPublish).not.toHaveBeenCalled();
			rmSync(stage, { recursive: true });
		}
	});

	it("rejects external package metadata links before any publisher runs", async () => {
		const outside = join(tmpDir, "outside.json");
		const stage = join(tmpDir, "stage");
		writeStageFixture(stage, manifest);
		const rootPath = join(stage, "root/package.json");
		const sentinel = readFileSync(rootPath, "utf8");
		writeFileSync(outside, sentinel);
		rmSync(rootPath);
		symlinkSync(outside, rootPath, "file");
		const spawnPublish = mock(async () => 0);
		await expect(
			publishStagedPackages(manifest, { stageDir: stage, spawnPublish }, io),
		).rejects.toThrow(/package.json resolves outside/);
		expect(spawnPublish).not.toHaveBeenCalled();
		expect(readFileSync(outside, "utf8")).toBe(sentinel);
	});

	it("uses canonical package paths beneath an explicitly symlinked stage root", async () => {
		const linked = join(tmpDir, "linked");
		symlinkSync(tmpDir, linked, "dir");
		const published: string[] = [];
		await publishStagedPackages(
			manifest,
			{
				stageDir: linked,
				spawnPublish: async (dir) => {
					published.push(dir);
					return 0;
				},
			},
			io,
		);
		expect(published).toEqual(manifest.publishOrder.map((dir) => join(tmpDir, dir)));
	});

	it("narrows persisted manifest and package fields before publishing", async () => {
		const invalidManifests = [
			null,
			[],
			{},
			{ ...manifest, version: 42 },
			{ ...manifest, root: { ...manifest.root, name: 42 } },
			{ ...manifest, root: { ...manifest.root, bins: [42] } },
			{ ...manifest, packages: [null] },
			{ ...manifest, publishOrder: "root" },
			{ ...manifest, packages: [{ ...manifest.packages[0], bins: [] }] },
		];
		for (const invalid of invalidManifests) {
			writeFileSync(join(tmpDir, "manifest.json"), JSON.stringify(invalid));
			const spawnPublish = mock(async () => 0);
			await expect(
				(async () =>
					publishStagedPackages(
						readPublishManifest(tmpDir),
						{ stageDir: tmpDir, spawnPublish },
						io,
					))(),
			).rejects.toThrow(/manifest.json/);
			expect(spawnPublish).not.toHaveBeenCalled();
		}
		const rootPath = join(tmpDir, "root", "package.json");
		const root = JSON.parse(readFileSync(rootPath, "utf8"));
		for (const invalid of [
			null,
			{ ...root, name: 42 },
			{ ...root, version: {} },
			{ ...root, version: " " },
			{ ...root, bin: [] },
			{ ...root, optionalDependencies: [] },
		]) {
			writeFileSync(rootPath, JSON.stringify(invalid));
			const spawnPublish = mock(async () => 0);
			await expect(
				publishStagedPackages(manifest, { stageDir: tmpDir, spawnPublish }, io),
			).rejects.toThrow(/package|field/);
			expect(spawnPublish).not.toHaveBeenCalled();
		}
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

	it("checks every command's bin in the root and each platform package", () => {
		const rootPath = join(tmpDir, "root", "package.json");
		const root = JSON.parse(readFileSync(rootPath, "utf8"));
		writeFileSync(rootPath, JSON.stringify({ ...root, bin: { demo: "bin/demo.js" } }));
		expect(() => validatePublishManifest(tmpDir, manifest)).toThrow(
			"Root staged package is missing correct bin metadata for demo-admin.",
		);
		writeFileSync(rootPath, JSON.stringify(root));

		const stagedPath = join(tmpDir, "darwin-arm64", "package.json");
		const staged = JSON.parse(readFileSync(stagedPath, "utf8"));
		writeFileSync(
			stagedPath,
			JSON.stringify({ ...staged, bin: { ...staged.bin, "demo-admin": "bin/demo-admin" } }),
		);
		expect(() => validatePublishManifest(tmpDir, manifest)).toThrow(
			"Staged package darwin-arm64 is missing correct bin metadata for demo-admin.",
		);
		writeFileSync(stagedPath, JSON.stringify(staged));

		// A manifest entry that forgot a command, and a manifest without commands.
		const partial: DistributionManifest = {
			...manifest,
			packages: manifest.packages.map((pkg) =>
				pkg.dir === "linux-x64" ? { ...pkg, bins: { demo: pkg.bins.demo! } } : pkg,
			),
		};
		expect(() => validatePublishManifest(tmpDir, partial)).toThrow(
			"Staged package linux-x64 is missing correct bin metadata for demo-admin.",
		);
		expect(() =>
			validatePublishManifest(tmpDir, { ...manifest, root: { ...manifest.root, bins: [] } }),
		).toThrow("root.bins must list at least one command");
	});

	it("rejects incomplete or repeated root commands before publishing", async () => {
		const partial = structuredClone(manifest);
		partial.root.bins = ["demo"];
		for (const pkg of partial.packages) delete pkg.bins["demo-admin"];
		const spawnPublish = mock(async () => 0);
		await expect(
			publishStagedPackages(partial, { stageDir: tmpDir, spawnPublish }, io),
		).rejects.toThrow(/command/);
		expect(spawnPublish).not.toHaveBeenCalled();

		const repeated = structuredClone(manifest);
		repeated.root.bins.push("demo");
		expect(() => validatePublishManifest(tmpDir, repeated)).toThrow(/unique/);
	});

	it("rejects extra commands in either platform bin map", () => {
		const extra = structuredClone(manifest);
		extra.packages[0]!.bins.extra = "bin/extra";
		expect(() => validatePublishManifest(tmpDir, extra)).toThrow(/command/);

		const stagedPath = join(tmpDir, "linux-x64", "package.json");
		const staged = JSON.parse(readFileSync(stagedPath, "utf8"));
		staged.bin.extra = "bin/extra";
		writeFileSync(stagedPath, JSON.stringify(staged));
		expect(() => validatePublishManifest(tmpDir, manifest)).toThrow(/command/);
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
