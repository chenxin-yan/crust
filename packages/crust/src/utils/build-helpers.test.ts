import { afterEach, describe, expect, it } from "bun:test";
import { access, mkdtemp, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
	assertTargetsBuildableWithoutBun,
	BUN_TARGETS,
	buildEntrypoint,
	bunBaselineAlias,
	bunCompileTarget,
	CRUST_BUILD_DEFINE,
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
	it("prefers bun on PATH and falls back to this executable as bun", async () => {
		expect(resolveBunBuildRunner().command).toBe(Bun.which("bun")!);
		const fallback = await withoutBunOnPath(() => resolveBunBuildRunner());
		expect(fallback.command).toBe(process.execPath);
		expect(fallback.env.BUN_BE_BUN).toBe("1");
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
				define: CRUST_BUILD_DEFINE,
				target: "bun",
				compile: { target: "bun-windows-x64", outfile: awkward, autoloadBunfig: false },
			},
			outfile: awkward,
		};
		const script = createBunPluginDriverScript(options);
		expect(embeddedOptions(script)).toEqual(options);
		expect(embeddedOptions(script).build.define).toEqual({
			"process.env.CRUST_INTERNAL_BUILD": '"1"',
		});
		expect(script).toContain('"autoloadBunfig":false');
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
				define: CRUST_BUILD_DEFINE,
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

describe.skipIf(hostTarget(BUN_TARGETS) === null)("execBuild with --bun-plugin", () => {
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
			`--bun-plugin ./missing.ts could not be imported from ${await realpath(directory)}: Cannot find module '${join(await realpath(directory), "missing.ts")}'`,
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
			"--bun-plugin ./plugin.ts must default-export a Bun bundler plugin ({ name, setup }). Wrap a plugin factory in a module that default-exports the created plugin.",
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
		expect(Bun.which("bun")).not.toBeNull();
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
				`const artifact = defineExtension(defineExtensionId("artifact"), { build: async ({ outDir }) => { await Bun.write(outDir + "/artifact.txt", "built"); return ["artifact.txt"]; } });\n` +
				`const app = new Crust("fixture").extend(artifact).action(() => {});\n` +
				`await app.execute();\n`,
		);

		const result = await buildEntrypoint(entry, outDir, [], io, directory);

		expect(result.snapshot.meta.name).toBe("fixture");
		expect(result.build.extensions).toHaveLength(1);
		expect(String(result.build.extensions[0]?.id)).toBe("artifact");
		expect(result.build.extensions[0]?.files).toEqual(["artifact.txt"]);
		expect(await Bun.file(join(outDir, "artifact.txt")).text()).toBe("built");
	});

	it("builds skill and man artifacts without absolute source paths", async () => {
		const directory = await mkdtemp(join(tmpdir(), "crust-entry-artifacts-test-"));
		tempDirs.push(directory);
		const entry = join(directory, "cli.ts");
		const outDir = join(directory, "dist");
		await Bun.write(join(directory, "package.json"), '{"name":"demo"}');
		const skillsUrl = pathToFileURL(resolve(import.meta.dir, "../../../skills/src/index.ts")).href;
		const manUrl = pathToFileURL(resolve(import.meta.dir, "../../../man/src/index.ts")).href;
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
		const manual = await Bun.file(join(outDir, "man", "demo.1")).text();
		const packagedSkill = await Bun.file(join(outDir, "skills", "demo", "SKILL.md")).text();
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
