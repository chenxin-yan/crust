import { spawnSync } from "node:child_process";
import { access, mkdtemp, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { defineExtensionId } from "@crustjs/core";
import { which } from "@crustjs/utils/process";
import { afterEach, describe, expect, it } from "vite-plus/test";

import {
	assertTargetsBuildableWithoutBun,
	BUN_TARGETS,
	buildEntrypoint,
	bunBaselineAlias,
	bunCompileTarget,
	createBunCompileArgs,
	createBunPluginDriverScript,
	execBuild,
	execNodeBuild,
	hostTarget,
	resolveBunBuildRunner,
	resolveBunPluginSource,
	type BunPluginDriverOptions,
} from "./build-helpers.ts";

const coreUrl = import.meta.resolve("@crustjs/core");
const io = { stdout: () => {}, stderr: () => {} };

async function withoutBunOnPath<T>(run: () => T): Promise<T> {
	const path = process.env.PATH;
	process.env.PATH = "";
	try {
		return await run();
	} finally {
		process.env.PATH = path;
	}
}

describe("resolveBunBuildRunner", () => {
	it("prefers bun on PATH and falls back to this executable as bun", () => {
		const bun = which("bun")!;
		expect(resolveBunBuildRunner().command).toBe(bun);
		// Only a Bun process can stand in for bun, so observe the fallback inside real Bun with no PATH.
		const helpers = JSON.stringify(new URL("./build-helpers.ts", import.meta.url).href);
		const probe = spawnSync(
			bun,
			[
				"--eval",
				`import { resolveBunBuildRunner } from ${helpers};
const runner = resolveBunBuildRunner();
console.log(JSON.stringify({ command: runner.command, execPath: process.execPath, bunBeBun: runner.env.BUN_BE_BUN }));`,
			],
			{ env: { ...process.env, PATH: "" }, encoding: "utf8", timeout: 10_000 },
		);
		expect(probe.stderr).toBe("");
		expect(probe.status).toBe(0);
		const fallback = JSON.parse(probe.stdout) as Record<string, string>;
		expect(fallback.command).toBe(fallback.execPath);
		expect(fallback.bunBeBun).toBe("1");
	});

	it("refuses to stand in for bun from a non-Bun process such as Node running the library", async () => {
		expect(resolveBunBuildRunner(false).command).toBe(which("bun")!);
		await expect(withoutBunOnPath(() => resolveBunBuildRunner(false))).rejects.toThrow(
			"bun was not found on PATH",
		);
	});
});

describe("resolveBunPluginSource", () => {
	it("imports bare specifiers from the project and paths as file URLs", () => {
		const cwd = resolve("/projects/my cli");
		expect(resolveBunPluginSource("@opentui/solid/bun-plugin", cwd)).toBe(
			"@opentui/solid/bun-plugin",
		);
		expect(resolveBunPluginSource("./build/plugin.ts", cwd)).toBe(
			pathToFileURL(resolve(cwd, "build/plugin.ts")).href,
		);
		expect(resolveBunPluginSource("../shared/plugin.ts", cwd)).toBe(
			pathToFileURL(resolve(cwd, "../shared/plugin.ts")).href,
		);
		const absolute = resolve("/opt/plugins/plugin.ts");
		expect(resolveBunPluginSource(absolute, cwd)).toBe(pathToFileURL(absolute).href);
	});
});

describe("createBunPluginDriverScript", () => {
	const awkward = String.raw`C:\Program Files\my "cli"\dist\my cli.exe`;

	function embeddedOptions(script: string): BunPluginDriverOptions {
		const line = script.split("\n").find((candidate) => candidate.startsWith("const options = "));
		expect(line).toBeDefined();
		// SAFETY: the driver embeds exactly one JSON.stringify(options) statement; the test round-trips it.
		return JSON.parse(line!.slice("const options = ".length, -1)) as BunPluginDriverOptions;
	}

	it("embeds compile options as JSON so quotes, spaces, and backslashes survive", () => {
		const options: BunPluginDriverOptions = {
			plugins: [
				{ specifier: "@opentui/solid/bun-plugin", source: "@opentui/solid/bun-plugin" },
				{ specifier: './it\'s "quoted".ts', source: "file:///proj/it's%20%22quoted%22.ts" },
			],
			build: {
				entrypoints: [String.raw`C:\Program Files\my "cli"\src\cli.tsx`],
				minify: false,
				env: "PUBLIC_*",
				target: "bun",
				compile: { target: "bun-windows-x64", outfile: awkward, autoloadBunfig: false },
			},
			outfile: awkward,
		};
		const script = createBunPluginDriverScript(options);
		expect(embeddedOptions(script)).toEqual(options);
		expect(script).toContain('define: {"process.env.CRUST_INTERNAL_BUILD":"\\"1\\""}');
		expect(script).toContain("throw: false");
		expect(script).toContain("must default-export a Bun bundler plugin ({ name, setup })");
	});

	it("embeds Node bundle options and refuses to write more than one output", () => {
		const options: BunPluginDriverOptions = {
			plugins: [{ specifier: "./plugin.ts", source: "file:///proj/plugin.ts" }],
			build: {
				entrypoints: ["/proj/src/cli.ts"],
				minify: true,
				env: "PUBLIC_*",
				target: "node",
				format: "esm",
			},
			outfile: "/proj/dist/cli.js",
		};
		const script = createBunPluginDriverScript(options);
		expect(embeddedOptions(script)).toEqual(options);
		expect(script).toContain("await Bun.write(options.outfile, result.outputs[0])");
		expect(script).toContain(
			"error: cannot write multiple output files without an output directory",
		);
	});
});

describe.skipIf(hostTarget(BUN_TARGETS) === null)("execBuild with crust.bunPlugins", () => {
	const tempDirs: string[] = [];

	afterEach(async () => {
		await Promise.all(tempDirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
	});

	async function project(pluginSource: string): Promise<string> {
		const directory = await mkdtemp(join(tmpdir(), "crust-bun-plugin-test-"));
		tempDirs.push(directory);
		await writeFile(join(directory, "cli.ts"), 'console.log("hello");\n');
		await writeFile(join(directory, "plugin.ts"), pluginSource);
		return directory;
	}

	async function leftoverDrivers(directory: string): Promise<string[]> {
		return (await readdir(directory)).filter((name) => name.startsWith(".crust-build-"));
	}

	it("names the project directory, not the deleted driver, when a plugin cannot be imported", async () => {
		const directory = await project("");
		const error = await execBuild(
			join(directory, "cli.ts"),
			join(directory, "out"),
			false,
			hostTarget(BUN_TARGETS)!,
			[],
			directory,
			["./missing.ts"],
		).catch((cause: unknown) => cause);
		expect(error).toBeInstanceOf(Error);
		expect((error as Error).message).toContain(
			`crust.bunPlugins entry ./missing.ts could not be imported from ${await realpath(directory)}: Cannot find module '${join(await realpath(directory), "missing.ts")}'`,
		);
		expect((error as Error).message).not.toContain(".crust-build-");
		expect(await leftoverDrivers(directory)).toEqual([]);
	});

	it("refuses a Node bundle with more than one output and removes the driver", async () => {
		const directory = await project('export default { name: "noop", setup() {} };\n');
		await writeFile(join(directory, "asset.bin"), "payload\n");
		await writeFile(
			join(directory, "cli.ts"),
			'import asset from "./asset.bin" with { type: "file" };\nconsole.log(asset);\n',
		);
		const outfile = join(directory, "out.js");
		await expect(
			execNodeBuild(join(directory, "cli.ts"), outfile, false, [], directory, ["./plugin.ts"]),
		).rejects.toThrow(
			/Build failed for .*out\.js:\nerror: cannot write multiple output files without an output directory/,
		);
		expect(await leftoverDrivers(directory)).toEqual([]);
		await expect(access(outfile)).rejects.toThrow();
	});

	it("rejects a module that does not default-export a plugin and removes the driver", async () => {
		const directory = await project(
			"export default function createPlugin() { return { name: 'factory', setup() {} }; }\n",
		);
		await expect(
			execBuild(
				join(directory, "cli.ts"),
				join(directory, "out"),
				false,
				hostTarget(BUN_TARGETS)!,
				[],
				directory,
				["./plugin.ts"],
			),
		).rejects.toThrow(
			"crust.bunPlugins entry ./plugin.ts must default-export a Bun bundler plugin ({ name, setup }). Wrap a plugin factory in a module that default-exports the created plugin.",
		);
		expect(await leftoverDrivers(directory)).toEqual([]);
	});

	it("fails with diagnostics when a plugin throws and removes the driver", async () => {
		const directory = await project(
			'export default { name: "broken", setup() { throw new Error("plugin exploded"); } };\n',
		);
		const outfile = join(directory, "out");
		await expect(
			execBuild(
				join(directory, "cli.ts"),
				outfile,
				false,
				hostTarget(BUN_TARGETS)!,
				[],
				directory,
				["./plugin.ts"],
			),
		).rejects.toThrow(/Build failed for .*out[\s\S]*plugin exploded/);
		expect(await leftoverDrivers(directory)).toEqual([]);
		await expect(access(outfile)).rejects.toThrow();
	});
});

const fallbackRunner = { command: process.execPath, env: { BUN_BE_BUN: "1" } };
const realBunRunner = { command: "/usr/local/bin/bun", env: {} };

describe("bunBaselineAlias", () => {
	it("maps every x64 target to its -baseline spelling and arm64 to nothing", () => {
		expect(bunBaselineAlias("bun-linux-x64")).toBe("bun-linux-x64-baseline");
		expect(bunBaselineAlias("bun-linux-x64-musl")).toBe("bun-linux-x64-musl-baseline");
		expect(bunBaselineAlias("bun-darwin-x64")).toBe("bun-darwin-x64-baseline");
		expect(bunBaselineAlias("bun-windows-x64")).toBe("bun-windows-x64-baseline");
		expect(bunBaselineAlias("bun-linux-arm64")).toBeNull();
		expect(bunBaselineAlias("bun-linux-arm64-musl")).toBeNull();
		expect(bunBaselineAlias("bun-darwin-arm64")).toBeNull();
		expect(bunBaselineAlias("bun-windows-arm64")).toBeNull();
	});
});

describe("bunCompileTarget", () => {
	it("substitutes the -baseline alias only for the self-copy target under the fallback runner", () => {
		expect(bunCompileTarget("bun-linux-x64", fallbackRunner, "bun-linux-x64")).toBe(
			"bun-linux-x64-baseline",
		);
		expect(bunCompileTarget("bun-windows-x64", fallbackRunner, "bun-windows-x64")).toBe(
			"bun-windows-x64-baseline",
		);
		expect(bunCompileTarget("bun-darwin-arm64", fallbackRunner, "bun-linux-x64")).toBe(
			"bun-darwin-arm64",
		);
		expect(bunCompileTarget("bun-linux-x64", fallbackRunner, null)).toBe("bun-linux-x64");
	});

	it("passes the canonical target to a real bun", () => {
		expect(bunCompileTarget("bun-linux-x64", realBunRunner, "bun-linux-x64")).toBe("bun-linux-x64");
	});

	it("leaves an arm64 self-copy target alone; the guard refuses it earlier", () => {
		expect(bunCompileTarget("bun-darwin-arm64", fallbackRunner, "bun-darwin-arm64")).toBe(
			"bun-darwin-arm64",
		);
	});
});

describe("assertTargetsBuildableWithoutBun", () => {
	it("refuses the self-copying target and lists the remaining targets when bun is absent", async () => {
		await withoutBunOnPath(() => {
			expect(() =>
				assertTargetsBuildableWithoutBun(BUN_TARGETS.targets, "bun-darwin-arm64"),
			).toThrow(
				"Cannot build bun-darwin-arm64 without a separate bun executable on PATH.\n" +
					"  Bun reuses the running crust executable as the base for its own platform, which yields a binary that crashes on start.\n" +
					"  Install Bun (https://bun.sh), or pass --target with the other targets (e.g. --target bun-linux-x64 --target bun-linux-arm64 --target bun-linux-x64-musl --target bun-linux-arm64-musl --target bun-darwin-x64 --target bun-windows-x64 --target bun-windows-arm64).",
			);
			expect(() =>
				assertTargetsBuildableWithoutBun(["bun-linux-arm64-musl"], "bun-linux-arm64-musl"),
			).toThrow("Install Bun (https://bun.sh), or build a different target.");
		});
	});

	it("keeps every other target buildable without bun", async () => {
		await withoutBunOnPath(() => {
			expect(() =>
				assertTargetsBuildableWithoutBun(
					["bun-linux-x64", "bun-darwin-x64", "bun-windows-arm64"],
					"bun-darwin-arm64",
				),
			).not.toThrow();
			expect(() => assertTargetsBuildableWithoutBun(BUN_TARGETS.targets, null)).not.toThrow();
		});
	});

	it("allows an x64 self-copy target without bun because its -baseline alias is downloaded clean", async () => {
		await withoutBunOnPath(() => {
			for (const host of [
				"bun-linux-x64",
				"bun-linux-x64-musl",
				"bun-darwin-x64",
				"bun-windows-x64",
			] as const) {
				expect(() => assertTargetsBuildableWithoutBun(BUN_TARGETS.targets, host)).not.toThrow();
			}
		});
	});

	it("allows the self-copying target when bun is on PATH", () => {
		expect(which("bun")).not.toBeNull();
		expect(() =>
			assertTargetsBuildableWithoutBun(BUN_TARGETS.targets, "bun-darwin-arm64"),
		).not.toThrow();
	});
});

describe("createBunCompileArgs", () => {
	it("compiles without cwd bunfig autoloading and keeps env, outfile, minify, target order", () => {
		expect(
			createBunCompileArgs("/p/src/cli.ts", "/p/dist/cli", true, "bun-darwin-arm64", ["/p/.env"]),
		).toEqual([
			"build",
			"--compile",
			"--no-compile-autoload-bunfig",
			"--env-file",
			"/p/.env",
			"--env=PUBLIC_*",
			"--define",
			'process.env.CRUST_INTERNAL_BUILD="1"',
			"--outfile",
			"/p/dist/cli",
			"--minify",
			"--target",
			"bun-darwin-arm64",
			"/p/src/cli.ts",
		]);
		expect(
			createBunCompileArgs("/p/src/cli.ts", "/p/dist/cli", false, "bun-linux-x64", []),
		).toEqual([
			"build",
			"--compile",
			"--no-compile-autoload-bunfig",
			"--env=PUBLIC_*",
			"--define",
			'process.env.CRUST_INTERNAL_BUILD="1"',
			"--outfile",
			"/p/dist/cli",
			"--target",
			"bun-linux-x64",
			"/p/src/cli.ts",
		]);
	});
});

describe("buildEntrypoint", () => {
	const tempDirs: string[] = [];

	afterEach(async () => {
		await Promise.all(tempDirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
	});

	it("returns the entry snapshot and exits before trailing code", async () => {
		const directory = await mkdtemp(join(tmpdir(), "crust-entry-snapshot-test-"));
		tempDirs.push(directory);
		const entry = join(directory, "cli.ts");
		const trailingMarker = join(directory, "trailing-code-ran");
		await writeFile(
			entry,
			`import { Crust } from ${JSON.stringify(coreUrl)};\n` +
				`const app = new Crust("fixture", { description: "Fixture CLI" }).action(() => {});\n` +
				`await app.execute();\n` +
				`await Bun.write(${JSON.stringify(trailingMarker)}, "ran");\n`,
		);

		const { snapshot, build } = await buildEntrypoint(
			entry,
			join(directory, "dist"),
			[],
			io,
			directory,
		);

		expect(snapshot.meta).toMatchObject({ name: "fixture", description: "Fixture CLI" });
		expect(snapshot.hasAction).toBe(true);
		expect(build).toEqual({ extensions: [] });
		await expect(access(trailingMarker)).rejects.toThrow();
	});

	it("runs Extension build hooks and returns their artifact report", async () => {
		const directory = await mkdtemp(join(tmpdir(), "crust-entry-build-test-"));
		tempDirs.push(directory);
		const entry = join(directory, "cli.ts");
		const outDir = join(directory, "dist");
		await writeFile(
			entry,
			`import { Crust, defineExtension, defineExtensionId } from ${JSON.stringify(coreUrl)};\n` +
				`const artifact = defineExtension(defineExtensionId("artifact"), { build: () => [{ path: "artifact.txt", content: "built" }, { path: "assets/bytes.bin", content: new Uint8Array([0, 255, 128, 10]) }] });\n` +
				`const app = new Crust("fixture").extend(artifact).action(() => {});\n` +
				`await app.execute();\n`,
		);

		const result = await buildEntrypoint(entry, outDir, [], io, directory);

		expect(result.snapshot.meta.name).toBe("fixture");
		expect(result.build.extensions).toHaveLength(1);
		expect(String(result.build.extensions[0]?.id)).toBe("artifact");
		expect(result.build.extensions[0]?.files).toEqual(["artifact.txt", "assets/bytes.bin"]);
		expect(await readFile(join(outDir, "artifact.txt"), "utf8")).toBe("built");
		expect(new Uint8Array(await readFile(join(outDir, "assets/bytes.bin")))).toEqual(
			new Uint8Array([0, 255, 128, 10]),
		);
	});

	it("builds skill and man artifacts without absolute source paths", async () => {
		const directory = await mkdtemp(join(tmpdir(), "crust-entry-artifacts-test-"));
		tempDirs.push(directory);
		const entry = join(directory, "cli.ts");
		const outDir = join(directory, "dist");
		await writeFile(join(directory, "package.json"), '{"name":"demo"}');
		const skillsUrl = pathToFileURL(
			resolve(import.meta.dirname, "../../../skills/src/index.ts"),
		).href;
		const manUrl = pathToFileURL(resolve(import.meta.dirname, "../../../man/src/index.ts")).href;
		await writeFile(
			entry,
			`import { Crust } from ${JSON.stringify(coreUrl)};\n` +
				`import { skill } from ${JSON.stringify(skillsUrl)};\n` +
				`import { man } from ${JSON.stringify(manUrl)};\n` +
				`await new Crust("demo", { description: "Demo" }).extend(skill({}), man()).execute();\n`,
		);

		// Run the entry subprocess from the fixture project root so advertised
		// sources are relative to that project.
		await buildEntrypoint(entry, outDir, [], io, directory);

		// The man hook runs after the skills hook and reads the skill it just wrote
		// into the build output, advertised relative to the project root.
		const manual = await readFile(join(outDir, "man", "demo.1"), "utf8");
		const packagedSkill = await readFile(join(outDir, "skills", "demo", "SKILL.md"), "utf8");
		expect(manual).toContain(`Source: ${join("dist", "skills", "demo")}`);
		expect(manual).not.toContain(directory);
		expect(packagedSkill).not.toContain(directory);
	});

	it("attributes Extension build failures", async () => {
		const directory = await mkdtemp(join(tmpdir(), "crust-entry-build-test-"));
		tempDirs.push(directory);
		const entry = join(directory, "cli.ts");
		await writeFile(
			entry,
			`import { Crust, defineExtension, defineExtensionId } from ${JSON.stringify(coreUrl)};\n` +
				`const broken = defineExtension(defineExtensionId("broken"), { build: () => { throw new Error("disk full"); } });\n` +
				`await new Crust("fixture").extend(broken).execute();\n`,
		);

		await expect(
			buildEntrypoint(entry, join(directory, "dist"), [], io, directory),
		).rejects.toThrow('Extension "broken" build failed: disk full');
	});

	it("explains when an entry exits without producing a snapshot", async () => {
		const directory = await mkdtemp(join(tmpdir(), "crust-entry-snapshot-test-"));
		tempDirs.push(directory);
		const entry = join(directory, "cli.ts");
		await writeFile(entry, "export {};\n");

		await expect(
			buildEntrypoint(entry, join(directory, "dist"), [], io, directory),
		).rejects.toThrow("Entry exited without producing a Command Snapshot");
	});

	it("explains when core produces a snapshot without a build report", async () => {
		const directory = await mkdtemp(join(tmpdir(), "crust-entry-report-test-"));
		tempDirs.push(directory);
		const entry = join(directory, "cli.ts");
		await writeFile(
			entry,
			`await Bun.write(process.env.CRUST_INTERNAL_SNAPSHOT_PATH!, JSON.stringify({ meta: { name: "old-core" } }));\n`,
		);

		await expect(
			buildEntrypoint(entry, join(directory, "dist"), [], io, directory),
		).rejects.toThrow("Command Snapshot without a Build Report");
	});

	it.each([
		null,
		{},
		{ extensions: {} },
		{ extensions: [null] },
		{ extensions: [{ id: 42, files: [] }] },
		{ extensions: [{ id: "legacy", files: "unknown" }] },
		{ extensions: [{ id: "legacy" }] },
		{ extensions: [{ id: "bad", files: [42] }] },
		{ extensions: [{ id: "", files: [] }] },
		{ extensions: [{ id: " padded ", files: [] }] },
		{ extensions: [{ id: "missing", files: ["missing.txt"] }] },
	])("rejects malformed or synthetic legacy reports: %j", async (report) => {
		const directory = await mkdtemp(join(tmpdir(), "crust-entry-report-test-"));
		tempDirs.push(directory);
		const entry = join(directory, "cli.ts");
		await writeFile(
			entry,
			`import { dirname, join } from "node:path";
			await Bun.write(process.env.CRUST_INTERNAL_SNAPSHOT_PATH!, JSON.stringify({ meta: { name: "fixture" } }));
			await Bun.write(join(dirname(process.env.CRUST_INTERNAL_SNAPSHOT_PATH!), "build-report.json"), ${JSON.stringify(JSON.stringify(report))});`,
		);
		await expect(
			buildEntrypoint(entry, join(directory, "dist"), [], io, directory),
		).rejects.toThrow(/invalid Build Report[\s\S]*compatible @crustjs\/core/);
	});

	it.each([
		"../outside.txt",
		"/outside.txt",
		"C:outside.txt",
		"assets/../present.txt",
		"assets\\present.txt",
		".",
		"directory",
		"linked.txt",
		"linked-dir/outside.txt",
	])("rejects unsafe or nonregular reported paths: %s", async (file) => {
		const directory = await mkdtemp(join(tmpdir(), "crust-entry-report-path-test-"));
		tempDirs.push(directory);
		const entry = join(directory, "cli.ts");
		await writeFile(
			entry,
			`import { mkdirSync, symlinkSync } from "node:fs";
			import { dirname, join } from "node:path";
			const outDir = process.env.CRUST_INTERNAL_BUILD_OUT_DIR!;
			mkdirSync(join(outDir, "directory"), { recursive: true });
			await Bun.write(join(outDir, "present.txt"), "present");
			await Bun.write(join(dirname(outDir), "outside.txt"), "outside");
			symlinkSync(join(dirname(outDir), "outside.txt"), join(outDir, "linked.txt"), "file");
			symlinkSync(dirname(outDir), join(outDir, "linked-dir"), "dir");
			await Bun.write(process.env.CRUST_INTERNAL_SNAPSHOT_PATH!, JSON.stringify({ meta: { name: "fixture" } }));
			await Bun.write(join(dirname(process.env.CRUST_INTERNAL_SNAPSHOT_PATH!), "build-report.json"), ${JSON.stringify(JSON.stringify({ extensions: [{ id: "fixture", files: [file] }] }))});`,
		);
		await expect(
			buildEntrypoint(entry, join(directory, "dist"), [], io, directory),
		).rejects.toThrow(/invalid Build Report[\s\S]*compatible @crustjs\/core/);
	});

	it("keeps reports scoped to hook output rather than all entry side effects", async () => {
		const directory = await mkdtemp(join(tmpdir(), "crust-entry-side-effect-test-"));
		tempDirs.push(directory);
		const entry = join(directory, "cli.ts");
		const outDir = join(directory, "dist");
		await writeFile(
			entry,
			`import { join } from "node:path";
			import { Crust, defineExtension, defineExtensionId } from ${JSON.stringify(coreUrl)};
			await Bun.write(join(process.env.CRUST_INTERNAL_BUILD_OUT_DIR!, "extra.txt"), "side effect");
			await new Crust("fixture").extend(defineExtension(defineExtensionId("fixture"), {
				build: () => [{ path: "assets/real.txt", content: "hook output" }]
			})).execute();`,
		);
		const result = await buildEntrypoint(entry, outDir, [], io, directory);
		expect(result.build.extensions[0]?.files).toEqual(["assets/real.txt"]);
		expect(await readFile(join(outDir, "extra.txt"), "utf8")).toBe("side effect");
	});

	it("preserves an executed hook's empty array report", async () => {
		const directory = await mkdtemp(join(tmpdir(), "crust-entry-empty-test-"));
		tempDirs.push(directory);
		const entry = join(directory, "cli.ts");
		await writeFile(
			entry,
			`import { Crust, defineExtension, defineExtensionId } from ${JSON.stringify(coreUrl)};
			await new Crust("fixture").extend(defineExtension(defineExtensionId("empty"), { build: () => [] })).execute();`,
		);
		const result = await buildEntrypoint(entry, join(directory, "dist"), [], io, directory);
		expect(result.build).toEqual({ extensions: [{ id: defineExtensionId("empty"), files: [] }] });
	});

	it("rethrows the entry's error when the subprocess exits non-zero", async () => {
		const directory = await mkdtemp(join(tmpdir(), "crust-entry-snapshot-test-"));
		tempDirs.push(directory);
		const entry = join(directory, "cli.ts");
		await writeFile(entry, `throw new Error("entry blew up before execute");\n`);

		await expect(
			buildEntrypoint(entry, join(directory, "dist"), [], io, directory),
		).rejects.toThrow("entry blew up before execute");
	});

	it("explains when the snapshot file contains invalid JSON", async () => {
		const directory = await mkdtemp(join(tmpdir(), "crust-entry-snapshot-test-"));
		tempDirs.push(directory);
		const entry = join(directory, "cli.ts");
		await writeFile(
			entry,
			`await Bun.write(process.env.CRUST_INTERNAL_SNAPSHOT_PATH!, "not json");\n`,
		);

		await expect(
			buildEntrypoint(entry, join(directory, "dist"), [], io, directory),
		).rejects.toThrow("Entry produced an invalid Command Snapshot");
	});
});
