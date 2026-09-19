import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import * as processUtils from "@crustjs/utils/process";
import type { RunProcessResult } from "@crustjs/utils/process";

import {
	buildPublishCommand,
	publishStagedPackages,
	readPublishManifest,
	validatePublishManifest,
} from "../../src/commands/publish.ts";
import type { DistributionManifest } from "../utils/distribute.ts";

const io = { stdout: () => {}, stderr: () => {} };

const ok: RunProcessResult = { exitCode: 0, stdout: "", stderr: "" };

/** Real `npm view <spec> version --json` shapes (npm 11): exists => quoted version, exit 0. */
function viewExists(spec: string): RunProcessResult {
	return { exitCode: 0, stdout: `"${spec.slice(spec.lastIndexOf("@") + 1)}"\n`, stderr: "" };
}

function viewError(code: string, spec: string): RunProcessResult {
	const version = spec.slice(spec.lastIndexOf("@") + 1);
	const summary =
		code === "E404" ? `No match found for version ${version}` : `${code} while fetching ${spec}`;
	return {
		exitCode: 1,
		stdout: `{\n  "error": {\n    "code": "${code}",\n    "summary": "${summary}",\n    "detail": "..."\n  }\n}\n`,
		stderr: `npm error code ${code}`,
	};
}

type NpmHandlers = {
	view?: (spec: string, dir: string, args: string[]) => RunProcessResult;
	publish?: (dir: string, args: string[]) => RunProcessResult;
};

/** Default: every version is missing (E404) and every publish succeeds. */
function mockNpm(handlers: NpmHandlers = {}) {
	return mock(async (dir: string, args: string[]): Promise<RunProcessResult> => {
		if (args[0] === "view") {
			return (handlers.view ?? ((spec) => viewError("E404", spec)))(args[1]!, dir, args);
		}
		return (handlers.publish ?? (() => ok))(dir, args);
	});
}

function publishCalls(runNpm: ReturnType<typeof mockNpm>): string[] {
	return runNpm.mock.calls.filter(([, args]) => args[0] === "publish").map(([dir]) => dir);
}

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

		const runNpm = mockNpm();
		await publishStagedPackages(loaded, { stageDir: nodeDir, runNpm }, io);
		expect(publishCalls(runNpm)).toEqual([join(nodeDir, "root")]);
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
			const runNpm = mockNpm();
			await expect(publishStagedPackages(invalid, { stageDir: stage, runNpm }, io)).rejects.toThrow(
				/inside|outside/,
			);
			expect(runNpm).not.toHaveBeenCalled();
			expect(readFileSync(join(outside, "sentinel"), "utf8")).toBe("untouched");
			rmSync(stage, { recursive: true });
		}
		for (const alias of ["./root", "alias"]) {
			writeStageFixture(stage, manifest);
			symlinkSync(join(stage, "root"), join(stage, "alias"), "dir");
			const invalid = structuredClone(manifest);
			invalid.packages[1]!.dir = alias;
			invalid.publishOrder[1] = alias;
			const runNpm = mockNpm();
			await expect(publishStagedPackages(invalid, { stageDir: stage, runNpm }, io)).rejects.toThrow(
				/duplicate staged directories/,
			);
			expect(runNpm).not.toHaveBeenCalled();
			rmSync(stage, { recursive: true });
		}
	});

	it.each(["platform", "root"])(
		"rejects duplicate %s package names before any publisher runs",
		async (duplicate) => {
			const invalid = structuredClone(manifest);
			invalid.packages[1]!.name =
				duplicate === "root" ? invalid.root.name : invalid.packages[0]!.name;
			writeStageFixture(tmpDir, invalid);
			const runNpm = mockNpm();
			await expect(
				publishStagedPackages(invalid, { stageDir: tmpDir, runNpm }, io),
			).rejects.toThrow(/duplicate package names/);
			expect(runNpm).not.toHaveBeenCalled();
		},
	);

	it("rejects external package metadata links before any publisher runs", async () => {
		const outside = join(tmpDir, "outside.json");
		const stage = join(tmpDir, "stage");
		writeStageFixture(stage, manifest);
		const rootPath = join(stage, "root/package.json");
		const sentinel = readFileSync(rootPath, "utf8");
		writeFileSync(outside, sentinel);
		rmSync(rootPath);
		symlinkSync(outside, rootPath, "file");
		const runNpm = mockNpm();
		await expect(publishStagedPackages(manifest, { stageDir: stage, runNpm }, io)).rejects.toThrow(
			/package.json resolves outside/,
		);
		expect(runNpm).not.toHaveBeenCalled();
		expect(readFileSync(outside, "utf8")).toBe(sentinel);
	});

	it("uses canonical package paths beneath an explicitly symlinked stage root", async () => {
		const linked = join(tmpDir, "linked");
		symlinkSync(tmpDir, linked, "dir");
		const runNpm = mockNpm();
		await publishStagedPackages(manifest, { stageDir: linked, runNpm }, io);
		expect(publishCalls(runNpm)).toEqual(manifest.publishOrder.map((dir) => join(tmpDir, dir)));
		// The existence check runs in the same canonical directory so .npmrc resolution matches.
		expect(runNpm.mock.calls[0]).toEqual([
			join(tmpDir, "linux-x64"),
			["view", "@scope/demo-linux-x64@1.2.3", "version", "--json"],
		]);
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
			const runNpm = mockNpm();
			await expect(
				(async () =>
					publishStagedPackages(readPublishManifest(tmpDir), { stageDir: tmpDir, runNpm }, io))(),
			).rejects.toThrow(/manifest.json/);
			expect(runNpm).not.toHaveBeenCalled();
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
			{ ...root, publishConfig: [] },
			{ ...root, publishConfig: { registry: 42 } },
			{ ...root, publishConfig: { "@scope:registry": " " } },
		]) {
			writeFileSync(rootPath, JSON.stringify(invalid));
			const runNpm = mockNpm();
			await expect(
				publishStagedPackages(manifest, { stageDir: tmpDir, runNpm }, io),
			).rejects.toThrow(/package|field/);
			expect(runNpm).not.toHaveBeenCalled();
		}
	});

	it("rejects malformed publish order", async () => {
		const invalid: DistributionManifest = {
			...manifest,
			publishOrder: ["root", "linux-x64", "darwin-arm64"],
		};

		expect(() => validatePublishManifest(tmpDir, invalid)).toThrow(/root package last/);
		// Validation always runs before any npm publish is spawned.
		const runNpm = mockNpm();
		await expect(publishStagedPackages(invalid, { stageDir: tmpDir, runNpm }, io)).rejects.toThrow(
			/root package last/,
		);
		expect(runNpm).not.toHaveBeenCalled();
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
		const runNpm = mockNpm();
		await expect(publishStagedPackages(partial, { stageDir: tmpDir, runNpm }, io)).rejects.toThrow(
			/command/,
		);
		expect(runNpm).not.toHaveBeenCalled();

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

	it("supports dry-run without spawning npm at all", async () => {
		const runNpm = mockNpm();
		await publishStagedPackages(manifest, { stageDir: tmpDir, dryRun: true, runNpm }, io);
		expect(runNpm).not.toHaveBeenCalled();
	});

	it.each([true, false, undefined])("selects npm stdio when stdin.isTTY is %s", async (isTTY) => {
		const descriptor = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
		const npm = join(tmpDir, "npm");
		const which = spyOn(processUtils, "which").mockReturnValue(npm);
		const runProcess = spyOn(processUtils, "runProcess").mockImplementation(async (_npm, args) =>
			args[0] === "view"
				? viewError("E404", args[1]!)
				: {
						exitCode: 0,
						stdout: isTTY ? "" : "registry stdout\n",
						stderr: isTTY ? "" : "registry stderr\r\n",
					},
		);
		const stdout = mock((_text: string) => {});
		const stderr = mock((_text: string) => {});
		try {
			Object.defineProperty(process.stdin, "isTTY", { configurable: true, value: isTTY });
			await publishStagedPackages(
				manifest,
				{ stageDir: tmpDir, tag: "bootstrap" },
				{ stdout, stderr },
			);
			// The lookup always collects (its stdout is parsed); only publish inherits the TTY.
			expect(runProcess.mock.calls.filter(([, args]) => args[0] === "view")).toEqual(
				manifest.publishOrder.map((dir) => [
					npm,
					expect.arrayContaining(["view"]),
					{ cwd: join(tmpDir, dir) },
				]),
			);
			expect(runProcess.mock.calls.filter(([, args]) => args[0] === "publish")).toEqual(
				manifest.publishOrder.map((dir) => [
					npm,
					["publish", "--tag", "bootstrap"],
					{ cwd: join(tmpDir, dir), stdio: isTTY ? "inherit" : "collect" },
				]),
			);
			if (isTTY) {
				expect(stdout).not.toHaveBeenCalledWith("registry stdout");
				expect(stderr).not.toHaveBeenCalled();
			} else {
				expect(stdout).toHaveBeenCalledWith("registry stdout");
				expect(stderr.mock.calls).toEqual(manifest.publishOrder.map(() => ["registry stderr"]));
			}
		} finally {
			which.mockRestore();
			runProcess.mockRestore();
			if (descriptor) Object.defineProperty(process.stdin, "isTTY", descriptor);
			else Reflect.deleteProperty(process.stdin, "isTTY");
		}
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
				runNpm: mockNpm({
					publish: () => ({
						exitCode: 0,
						stdout: "registry stdout\n",
						stderr: "registry stderr\n",
					}),
				}),
			},
			invocationIO,
		);

		expect(stdout).toContain("registry stdout");
		// A successful E404 lookup stays quiet; only publish output reaches stderr.
		expect(stderr).toEqual(["registry stderr", "registry stderr", "registry stderr"]);
	});

	it("stops on first failed publish", async () => {
		const runNpm = mockNpm({ publish: () => ({ exitCode: 1, stdout: "", stderr: "" }) });

		await expect(publishStagedPackages(manifest, { stageDir: tmpDir, runNpm }, io)).rejects.toThrow(
			/linux-x64/,
		);
		expect(publishCalls(runNpm)).toHaveLength(1);
	});

	it("skips versions the registry already has and publishes the rest in order", async () => {
		const lines: string[] = [];
		const runNpm = mockNpm({
			view: (spec) =>
				spec.startsWith("@scope/demo-linux-x64@") ? viewExists(spec) : viewError("E404", spec),
		});
		await publishStagedPackages(
			manifest,
			{ stageDir: tmpDir, runNpm },
			{ stdout: (text) => lines.push(text), stderr: () => {} },
		);
		expect(publishCalls(runNpm)).toEqual([join(tmpDir, "darwin-arm64"), join(tmpDir, "root")]);
		expect(lines.join("\n")).toMatch(/linux-x64: .*skip: 1\.2\.3 already published/);
		expect(lines.join("\n")).toMatch(
			/Published .*2.* staged package\(s\), skipped .*1.* already published/,
		);
	});

	it("is a no-op when every staged version is already published", async () => {
		const lines: string[] = [];
		const runNpm = mockNpm({ view: viewExists });
		await publishStagedPackages(
			manifest,
			{ stageDir: tmpDir, runNpm },
			{ stdout: (text) => lines.push(text), stderr: () => {} },
		);
		expect(publishCalls(runNpm)).toEqual([]);
		expect(lines.join("\n")).toMatch(
			/All .*3.* staged package\(s\) are already published as 1\.2\.3/,
		);
	});

	it.each([
		["E401", (spec: string) => viewError("E401", spec)],
		["FETCH_ERROR", (spec: string) => viewError("FETCH_ERROR", spec)],
		["garbage", () => ({ exitCode: 1, stdout: "not json\n", stderr: "" })],
		["empty success", () => ok],
	])("aborts before any publish when the lookup is inconclusive (%s)", async (label, view) => {
		const runNpm = mockNpm({ view });
		await expect(publishStagedPackages(manifest, { stageDir: tmpDir, runNpm }, io)).rejects.toThrow(
			label.startsWith("E") || label === "FETCH_ERROR" ? new RegExp(label) : /Could not check/,
		);
		expect(publishCalls(runNpm)).toEqual([]);
	});

	it.each([
		// The scoped key goes through as its own flag: only `--@scope:registry` beats an
		// `.npmrc` `@scope:registry=`, which is what npm publish's publishConfig overlay does.
		[
			"scoped publishConfig",
			{ "@scope:registry": "https://scoped", registry: "https://pc" },
			"https://cli",
			["--@scope:registry=https://scoped", "--registry", "https://cli"],
		],
		[
			"scoped publishConfig only",
			{ "@scope:registry": "https://scoped" },
			undefined,
			["--@scope:registry=https://scoped"],
		],
		["CLI --registry", { registry: "https://pc" }, "https://cli", ["--registry", "https://cli"]],
		["publishConfig.registry", { registry: "https://pc" }, undefined, ["--registry", "https://pc"]],
		["none", { access: "public" }, undefined, []],
	])(
		"resolves the lookup registry like npm publish: %s",
		async (_label, publishConfig, cli, expected) => {
			for (const dir of manifest.publishOrder) {
				const path = join(tmpDir, dir, "package.json");
				writeFileSync(
					path,
					JSON.stringify({ ...JSON.parse(readFileSync(path, "utf8")), publishConfig }),
				);
			}
			const runNpm = mockNpm();
			await publishStagedPackages(manifest, { stageDir: tmpDir, runNpm, registry: cli }, io);
			const [, viewArgs] = runNpm.mock.calls[0]!;
			expect(viewArgs.slice(4)).toEqual(expected);
			// npm publish reads publishConfig itself; only the CLI override is forwarded.
			const [, publishArgs] = runNpm.mock.calls.find(([, args]) => args[0] === "publish")!;
			expect(publishArgs).toEqual(cli ? ["publish", "--registry", cli] : ["publish"]);
		},
	);

	it("wraps a rejected publish in the same recovery summary", async () => {
		const runNpm = mockNpm({
			publish: (dir) => {
				if (dir.endsWith("darwin-arm64")) throw new Error("spawn npm EAGAIN");
				return ok;
			},
		});
		await expect(publishStagedPackages(manifest, { stageDir: tmpDir, runNpm }, io)).rejects.toThrow(
			/darwin-arm64.*before npm exited: spawn npm EAGAIN\n.*published: linux-x64\n.*skipped.*\n.*not attempted: root\n.*rerun `crust publish`/,
		);
		expect(publishCalls(runNpm)).toEqual([join(tmpDir, "linux-x64"), join(tmpDir, "darwin-arm64")]);
	});

	it("resumes after a failed run without republishing what already went up", async () => {
		const failing = mockNpm({
			publish: (dir) =>
				dir.endsWith("darwin-arm64") ? { exitCode: 1, stdout: "", stderr: "" } : ok,
		});
		await expect(
			publishStagedPackages(manifest, { stageDir: tmpDir, runNpm: failing }, io),
		).rejects.toThrow(
			/published: linux-x64\n.*skipped \(already published\): none\n.*not attempted: root\n.*rerun `crust publish`/,
		);
		expect(publishCalls(failing)).toEqual([
			join(tmpDir, "linux-x64"),
			join(tmpDir, "darwin-arm64"),
		]);

		// Run 2: the registry now has linux-x64.
		const resumed = mockNpm({
			view: (spec) =>
				spec.startsWith("@scope/demo-linux-x64@") ? viewExists(spec) : viewError("E404", spec),
		});
		await publishStagedPackages(manifest, { stageDir: tmpDir, runNpm: resumed }, io);
		expect(publishCalls(resumed)).toEqual([join(tmpDir, "darwin-arm64"), join(tmpDir, "root")]);
	});
});
