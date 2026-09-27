import { spawnSync } from "node:child_process";
import {
	access,
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	realpath,
	rm,
	stat,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { defineExtensionId } from "@crustjs/core";
import { which } from "@crustjs/utils/process";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import crustPackage from "../../package.json" with { type: "json" };
import {
	assertCompilerSatisfiesEngines,
	assertTargetsBuildableWithoutBun,
	type BuildCompiler,
	BUN_TARGETS,
	buildEntrypoint,
	bunBaselineAlias,
	bunCompileTarget,
	createBunCompileArgs,
	createBunPluginDriverScript,
	execBuild,
	execBunPackageBuild,
	execNodeBuild,
	hostTarget,
	assertNodeExeBackendSupports,
	crustInstallPath,
	NODE_EXE_BACKEND_PACKAGES,
	NODE_TARGETS,
	nodeExeTarget,
	readCompilerVersion,
	resolveBinaryCompiler,
	resolveBunBuildRunner,
	resolveBunPluginSource,
	resolveNodeBinaryCompiler,
	resolveNodeBuildRunner,
	resolveNodeExeBackend,
	resolveTargets,
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

const bunVersion = spawnSync(which("bun")!, ["--version"], {
	encoding: "utf8",
	timeout: 10_000,
}).stdout.trim();
const denoPath = which("deno");

describe("readCompilerVersion", () => {
	it("reads the version the selected bun reports", async () => {
		expect(await readCompilerVersion("bun", resolveBunBuildRunner(), process.cwd())).toBe(
			bunVersion,
		);
	});

	it.skipIf(denoPath === null)("reads the version the selected deno reports", async () => {
		const reported = spawnSync(denoPath!, ["--version"], {
			encoding: "utf8",
			timeout: 10_000,
		}).stdout;
		expect(
			await readCompilerVersion("deno", { command: denoPath!, env: process.env }, process.cwd()),
		).toBe(/^deno (\S+)/.exec(reported)![1]);
	});

	it("reads the embedded Bun version from the BUN_BE_BUN fallback, not the outer process", () => {
		const helpers = JSON.stringify(new URL("./build-helpers.ts", import.meta.url).href);
		const probe = spawnSync(
			which("bun")!,
			[
				"--eval",
				`import { resolveBinaryCompiler } from ${helpers};
const { runner, version } = await resolveBinaryCompiler("bun", { engines: { bun: Bun.version } }, process.cwd());
console.log(JSON.stringify({ command: runner.command, bunBeBun: runner.env.BUN_BE_BUN, execPath: process.execPath, version, embedded: Bun.version }));`,
			],
			{ env: { ...process.env, PATH: "" }, encoding: "utf8", timeout: 10_000 },
		);
		expect(probe.stderr).toBe("");
		expect(probe.status).toBe(0);
		const fallback = JSON.parse(probe.stdout) as Record<string, string>;
		expect(fallback.command).toBe(fallback.execPath);
		expect(fallback.bunBeBun).toBe("1");
		expect(fallback.version).toBe(fallback.embedded);
	});

	it.skipIf(denoPath === null)(
		"rejects output that is not the requested runtime's version",
		async () => {
			await expect(
				readCompilerVersion("bun", { command: denoPath!, env: process.env }, process.cwd()),
			).rejects.toThrow(/^Could not read the Bun version from .*deno --version \(exit 0\):\ndeno /);
			await expect(
				readCompilerVersion("deno", resolveBunBuildRunner(), process.cwd()),
			).rejects.toThrow(
				`Could not read the Deno version from ${which("bun")} --version (exit 0):\n${bunVersion}`,
			);
		},
	);

	// A hung compiler or version-manager shim must fail the build, not stall it.
	it.skipIf(process.platform === "win32")(
		"kills a --version probe that does not exit by the deadline",
		async () => {
			const dir = await mkdtemp(join(tmpdir(), "crust-stalled-compiler-"));
			const pidFile = join(dir, "pid");
			const compiler = join(dir, "bun");
			await writeFile(
				compiler,
				`#!/bin/sh\necho $$ > '${pidFile}.tmp'\nmv '${pidFile}.tmp' '${pidFile}'\nexec sleep 60\n`,
				{
					mode: 0o755,
				},
			);
			let pid: number | undefined;
			vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
			try {
				const probe = readCompilerVersion("bun", { command: compiler, env: process.env }, dir);
				while (pid === undefined) {
					await new Promise(setImmediate);
					pid = await readFile(pidFile, "utf8").then(Number, () => undefined);
				}
				const rejected = expect(probe).rejects.toThrow(
					`${compiler} --version did not exit within 30000 ms and was killed.`,
				);
				await vi.advanceTimersByTimeAsync(30_000);
				await rejected;
				vi.useRealTimers();
				await vi.waitFor(() => expect(() => process.kill(pid!, 0)).toThrow());
			} finally {
				vi.useRealTimers();
				try {
					if (pid !== undefined) process.kill(pid, "SIGKILL");
				} catch {
					// Already gone.
				}
				await rm(dir, { recursive: true, force: true });
			}
		},
		10_000,
	);
});

describe("assertCompilerSatisfiesEngines", () => {
	const compiler: BuildCompiler = {
		runtime: "bun",
		runner: { command: "/opt/bun/bin/bun", env: {} },
		version: "1.4.2",
	};
	const check = (userPackageJson: Parameters<typeof assertCompilerSatisfiesEngines>[1]) => () =>
		assertCompilerSatisfiesEngines(compiler, userPackageJson);

	it.each([
		["no package.json", undefined],
		["no engines", { name: "cli" }],
		["another runtime's engines only", { engines: { node: ">=99", deno: "not a range" } }],
		["an exact match", { engines: { bun: "1.4.2" } }],
		["a satisfied range", { engines: { bun: ">=1.4.0 <2" } }],
		["a satisfied caret range", { engines: { bun: "^1.3.0" } }],
	])("accepts %s", (_label, userPackageJson) => {
		expect(check(userPackageJson)).not.toThrow();
	});

	it.each([
		["a newer exact version", "1.4.3"],
		["an older exact version", "1.4.1"],
		["an unsatisfied range", ">=1.5.0"],
	])("rejects %s without substituting another compiler", (_label, constraint) => {
		expect(check({ engines: { bun: constraint } })).toThrow(
			`Bun 1.4.2 (/opt/bun/bin/bun) does not satisfy package.json engines.bun "${constraint}".\n` +
				"  Binaries embed the selected compiler's Bun version; crust does not install or upgrade it.\n" +
				"  Put a matching bun first on PATH (e.g. with your version manager), or update package.json engines.bun.",
		);
	});

	it.each(["latest", ">=1.4.0 ||| banana", 1.4, null, ["1.4.2"]])(
		"rejects the malformed constraint %j",
		(constraint) => {
			expect(check({ engines: { bun: constraint } })).toThrow(
				`package.json engines.bun is not a valid semver range: ${JSON.stringify(constraint)}.`,
			);
		},
	);

	it("rejects engines that is not an object", () => {
		expect(check({ engines: "bun 1.4.2" })).toThrow(
			"package.json engines must be an object of runtime version ranges.",
		);
	});
});

describe("resolveBinaryCompiler", () => {
	it("selects bun on PATH and validates its actual version", async () => {
		const compiler = await resolveBinaryCompiler(
			"bun",
			{ engines: { bun: bunVersion } },
			process.cwd(),
		);
		expect(compiler).toMatchObject({ runtime: "bun", version: bunVersion });
		expect(compiler.runner.command).toBe(which("bun"));
		await expect(
			resolveBinaryCompiler("bun", { engines: { bun: "0.0.1" } }, process.cwd()),
		).rejects.toThrow(
			`Bun ${bunVersion} (${which("bun")}) does not satisfy package.json engines.bun "0.0.1".`,
		);
	});

	it.skipIf(denoPath === null)(
		"selects deno on PATH and validates its actual version",
		async () => {
			const compiler = await resolveBinaryCompiler("deno", undefined, process.cwd());
			expect(compiler.runner.command).toBe(denoPath);
			await expect(
				resolveBinaryCompiler("deno", { engines: { deno: `>${compiler.version}` } }, process.cwd()),
			).rejects.toThrow(`Deno ${compiler.version} (${denoPath}) does not satisfy`);
		},
	);

	it("reports a missing deno instead of falling back to another compiler", async () => {
		await expect(
			withoutBunOnPath(() => resolveBinaryCompiler("deno", undefined, process.cwd())),
		).rejects.toThrow("Deno is required for the deno runtime but was not found on PATH.");
	});
});

describe("NODE_TARGETS", () => {
	it("maps each target to tsdown's executable target and npm metadata", () => {
		expect(
			NODE_TARGETS.targets.map((target) => [
				target,
				nodeExeTarget(target, "26.10.0"),
				NODE_TARGETS.info[target].platformKey,
			]),
		).toEqual([
			["linux-x64", { platform: "linux", arch: "x64", nodeVersion: "26.10.0" }, "linux-x64"],
			["linux-arm64", { platform: "linux", arch: "arm64", nodeVersion: "26.10.0" }, "linux-arm64"],
			["darwin-x64", { platform: "darwin", arch: "x64", nodeVersion: "26.10.0" }, "darwin-x64"],
			[
				"darwin-arm64",
				{ platform: "darwin", arch: "arm64", nodeVersion: "26.10.0" },
				"darwin-arm64",
			],
			["win-x64", { platform: "win", arch: "x64", nodeVersion: "26.10.0" }, "win32-x64"],
			["win-arm64", { platform: "win", arch: "arm64", nodeVersion: "26.10.0" }, "win32-arm64"],
		]);
		// Official Node Linux builds link glibc; npm must skip them on musl.
		expect(NODE_TARGETS.info["linux-arm64"].libc).toBe("glibc");
	});

	it("rejects musl and points package aliases at the canonical Node target", () => {
		expect(() => resolveTargets(NODE_TARGETS, ["linux-x64-musl"])).toThrow(
			'Unknown Node target "linux-x64-musl". Targets must use canonical Node names.\n  Valid targets: linux-x64, linux-arm64, darwin-x64, darwin-arm64, win-x64, win-arm64',
		);
		expect(() => resolveTargets(NODE_TARGETS, ["windows-x64"])).toThrow(
			'Unknown Node target "windows-x64". Targets must use canonical Node names. Did you mean "win-x64"?',
		);
		expect(() => resolveTargets(NODE_TARGETS, ["bun-linux-x64"])).toThrow(
			'Unknown Node target "bun-linux-x64"',
		);
	});
});

describe("crustInstallPath", () => {
	it("resolves from the executable inside a compiled crust and from the module otherwise", () => {
		const exe = resolve("/pkg/node_modules/@crustjs/crust-linux-x64/bin/crust-bun-linux-x64");
		expect(crustInstallPath("file:///$bunfs/root/crust", exe)).toBe(exe);
		expect(crustInstallPath("file:///B:/~BUN/root/crust.exe", exe)).toBe(exe);
		const library = pathToFileURL(resolve("/pkg/node_modules/@crustjs/crust/dist/index.js"));
		expect(crustInstallPath(library.href, exe)).toBe(
			resolve("/pkg/node_modules/@crustjs/crust/dist/index.js"),
		);
	});
});

describe("Node binary compiler", () => {
	const nodePath = which("node");
	const backend = { version: "0.23.0", engines: "^22.18.0 || ^24.11.0 || >=26.0.0" };
	const nodeCompiler = (version: string): BuildCompiler => ({
		runtime: "node",
		runner: { command: "/opt/node/bin/node", env: {} },
		version,
	});

	it("tells tsdown's package engines apart from its executable minimum", () => {
		expect(() =>
			assertNodeExeBackendSupports(nodeCompiler("25.9.0"), { ...backend, seaMinVersion: "25.7.0" }),
		).toThrow(
			'Node 25.9.0 (/opt/node/bin/node) is not supported by tsdown 0.23.0, which builds node standalone binaries: its package requires Node "^22.18.0 || ^24.11.0 || >=26.0.0".\n' +
				"  Binaries embed the selected node's version; crust does not install or upgrade it.\n" +
				"  Put a supported node first on PATH (e.g. with your version manager).",
		);
		expect(() =>
			assertNodeExeBackendSupports(nodeCompiler("24.21.0"), {
				...backend,
				seaMinVersion: "25.7.0",
			}),
		).toThrow(
			"Node 24.21.0 (/opt/node/bin/node) cannot build standalone executables: tsdown 0.23.0's executable builder requires Node 25.7.0 or later.",
		);
		expect(() => assertNodeExeBackendSupports(nodeCompiler("24.21.0"), backend)).not.toThrow();
		expect(() =>
			assertNodeExeBackendSupports(nodeCompiler("26.10.0"), {
				...backend,
				seaMinVersion: "25.7.0",
			}),
		).not.toThrow();
	});

	it.skipIf(nodePath === null)(
		"reads both requirements from the tsdown installed with crust, under the selected node",
		async () => {
			const compiler = { ...nodeCompiler("24.21.0"), runner: resolveNodeBuildRunner() };
			await expect(resolveNodeExeBackend(compiler, process.cwd())).rejects.toThrow(
				`Node 24.21.0 (${nodePath}) cannot build standalone executables: tsdown 0.23.0's executable builder requires Node 25.7.0 or later.`,
			);
			await expect(
				resolveNodeExeBackend({ ...compiler, version: "25.9.0" }, process.cwd()),
			).rejects.toThrow('its package requires Node "^22.18.0 || ^24.11.0 || >=26.0.0"');
			const backendInstalled = await resolveNodeExeBackend(
				{ ...compiler, version: "26.10.0" },
				process.cwd(),
			);
			expect(backendInstalled).toMatchObject({ ...backend, seaMinVersion: "25.7.0" });
			expect(await realpath(backendInstalled.packageJsonPath)).toBe(
				await realpath(fileURLToPath(import.meta.resolve("tsdown/package.json"))),
			);
		},
	);

	it("never resolves the backend from outside crust's installation, even through NODE_PATH", async () => {
		const elsewhere = await mkdtemp(join(tmpdir(), "crust-no-backend-"));
		const nodePathEnv = process.env.NODE_PATH;
		// Where the repository's tsdown really lives; Node's require would fall back to it.
		process.env.NODE_PATH = resolve(
			fileURLToPath(import.meta.resolve("tsdown/package.json")),
			"..",
			"..",
		);
		try {
			const installPath = join(elsewhere, "bin", "crust");
			await expect(
				resolveNodeExeBackend(nodeCompiler("26.10.0"), process.cwd(), installPath),
			).rejects.toThrow(
				`tsdown, which builds node standalone binaries, is not installed with crust (${installPath}).\n  @crustjs/crust ships tsdown and @tsdown/exe as optional dependencies, which package managers skip when optional dependencies are disabled or the installing node does not satisfy tsdown's engines.\n  Reinstall @crustjs/crust with optional dependencies enabled`,
			);
		} finally {
			process.env.NODE_PATH = nodePathEnv;
			await rm(elsewhere, { recursive: true, force: true });
		}
	});

	it.skipIf(nodePath === null)(
		"uses only crust's pinned backend, never a consumer's, across npm and pnpm layouts",
		async () => {
			const pins = crustPackage.optionalDependencies;
			const dir = await realpath(await mkdtemp(join(tmpdir(), "crust-backend-layouts-")));
			// A loadable stand-in for a tsdown or @tsdown/exe package at `version`.
			const fakePackage = async (at: string, name: string, version: string) => {
				await mkdir(at, { recursive: true });
				await writeFile(
					join(at, "package.json"),
					JSON.stringify({
						name,
						version,
						type: "module",
						engines: { node: backend.engines },
						exports: { "./package.json": "./package.json", "./internal": "./internal.js" },
					}),
				);
				await writeFile(join(at, "internal.js"), 'export const NODE_SEA_MIN_VERSION = "25.7.0";\n');
			};
			const backendAt = async (modules: string, versions: Record<string, string> = pins) => {
				for (const name of NODE_EXE_BACKEND_PACKAGES) {
					await fakePackage(join(modules, name), name, versions[name]!);
				}
			};
			const compiler = { ...nodeCompiler("26.10.0"), runner: resolveNodeBuildRunner() };
			const resolveFrom = (installPath: string) =>
				resolveNodeExeBackend(compiler, process.cwd(), installPath);
			const consumer = { tsdown: "0.22.0", "@tsdown/exe": "0.22.0" };
			try {
				// npm, crust's optional backend omitted: only the project's own tsdown is reachable.
				const npm = join(dir, "npm", "node_modules");
				const npmCrust = join(npm, "@crustjs", "crust-linux-x64", "bin", "crust");
				await backendAt(npm, consumer);
				await expect(resolveFrom(npmCrust)).rejects.toThrow(
					`tsdown 0.22.0 (${join(npm, "tsdown", "package.json")}) is not the tsdown ${pins.tsdown} that crust builds node standalone binaries with.\n  @crustjs/crust ships tsdown and @tsdown/exe as optional dependencies`,
				);
				// npm nests crust's copy under a conflicting project tsdown.
				await backendAt(join(npm, "@crustjs", "crust-linux-x64", "node_modules"));
				await expect(resolveFrom(npmCrust)).resolves.toHaveProperty(
					"packageJsonPath",
					join(npm, "@crustjs", "crust-linux-x64", "node_modules", "tsdown", "package.json"),
				);
				// npm hoists crust's copy to the project's node_modules.
				const hoisted = join(dir, "npm-hoisted", "node_modules");
				await backendAt(hoisted);
				await expect(
					resolveFrom(join(hoisted, "@crustjs", "crust", "dist", "index.js")),
				).resolves.toHaveProperty("packageJsonPath", join(hoisted, "tsdown", "package.json"));

				// pnpm: crust's tsdown is a symlink beside it, @tsdown/exe beside tsdown's real directory;
				// a project tsdown is hoisted into .pnpm/node_modules and the project's node_modules.
				const pnpm = join(dir, "pnpm", "node_modules");
				const store = join(pnpm, ".pnpm");
				const crustModules = join(store, "@crustjs+crust@0.4.1", "node_modules");
				const pnpmCrust = join(crustModules, "@crustjs", "crust", "dist", "index.js");
				await backendAt(join(store, "node_modules"), consumer);
				await backendAt(pnpm, consumer);
				await mkdir(dirname(pnpmCrust), { recursive: true });
				await expect(resolveFrom(pnpmCrust)).rejects.toThrow("is not the tsdown");
				const tsdownModules = join(store, `tsdown@${pins.tsdown}`, "node_modules");
				await fakePackage(join(tsdownModules, "tsdown"), "tsdown", pins.tsdown);
				await symlink(join(tsdownModules, "tsdown"), join(crustModules, "tsdown"), "junction");
				// @tsdown/exe resolves from tsdown's real directory, here to the project's copy.
				await expect(resolveFrom(pnpmCrust)).rejects.toThrow(
					`@tsdown/exe 0.22.0 (${join(store, "node_modules", "@tsdown", "exe", "package.json")}) is not the @tsdown/exe ${pins["@tsdown/exe"]} that crust builds node standalone binaries with.`,
				);
				await fakePackage(
					join(tsdownModules, "@tsdown", "exe"),
					"@tsdown/exe",
					pins["@tsdown/exe"],
				);
				await expect(resolveFrom(pnpmCrust)).resolves.toMatchObject({
					packageJsonPath: join(crustModules, "tsdown", "package.json"),
					version: pins.tsdown,
				});
			} finally {
				await rm(dir, { recursive: true, force: true });
			}
		},
	);

	it.skipIf(nodePath === null)("checks engines.node before loading the backend", async () => {
		await expect(
			resolveNodeBinaryCompiler({ engines: { node: "0.0.1" } }, process.cwd()),
		).rejects.toThrow(/^Node \S+ \(.+\) does not satisfy package\.json engines\.node "0\.0\.1"\./);
	});

	it("reports a missing node instead of falling back to another runtime", async () => {
		await expect(
			withoutBunOnPath(() => resolveNodeBinaryCompiler(undefined, process.cwd())),
		).rejects.toThrow("Node is required for node standalone binaries but was not found on PATH.");
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

describe("execBunPackageBuild", () => {
	const tempDirs: string[] = [];

	afterEach(async () => {
		await Promise.all(tempDirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
	});

	// PUBLIC_PINNED exists only in the pinned runner's environment, so its
	// inlined value proves the bundle was built by that runner.
	const pinnedRunner = () => ({
		command: which("bun")!,
		env: { ...process.env, PUBLIC_PINNED: "pinned-runner" },
	});

	async function project(): Promise<string> {
		const directory = await mkdtemp(join(tmpdir(), "crust-bun-package-test-"));
		tempDirs.push(directory);
		await writeFile(
			join(directory, ".env.build"),
			"PUBLIC_FROM_FILE=public\nBUILD_SECRET=secret\n",
		);
		await writeFile(
			join(directory, "plugin.ts"),
			`export default { name: "greeting", setup(build) {
	build.onResolve({ filter: /^virtual:greeting$/ }, () => ({ path: "greeting", namespace: "greeting" }));
	build.onLoad({ filter: /.*/, namespace: "greeting" }, () => ({ contents: 'export default "from plugin";', loader: "js" }));
} };
`,
		);
		return directory;
	}

	function runBundle(outfile: string): Record<string, string | null> {
		const run = spawnSync(which("bun")!, [outfile], {
			env: { PATH: process.env.PATH },
			encoding: "utf8",
			timeout: 10_000,
		});
		expect(run.stderr).toBe("");
		expect(run.status).toBe(0);
		return JSON.parse(run.stdout) as Record<string, string | null>;
	}

	const report = (extra = "") =>
		`console.log(JSON.stringify({ bun: typeof Bun === "undefined" ? null : Bun.version, fromFile: process.env.PUBLIC_FROM_FILE ?? null, pinned: process.env.PUBLIC_PINNED ?? null, secret: process.env.BUILD_SECRET ?? null, marker: process.env.CRUST_INTERNAL_BUILD ?? null${extra} }));\n`;

	it("bundles Bun-targeted ESM behind a bun shebang with PUBLIC_* values and the build marker", async () => {
		const directory = await project();
		await writeFile(join(directory, "cli.ts"), `#!/usr/bin/env node\n${report()}`);
		const outfile = join(directory, "out", "cli.js");
		await execBunPackageBuild(
			join(directory, "cli.ts"),
			outfile,
			false,
			[join(directory, ".env.build")],
			directory,
			[],
			pinnedRunner(),
		);

		const output = await readFile(outfile, "utf8");
		expect(output.startsWith("#!/usr/bin/env bun\n// @bun\n")).toBe(true);
		expect(output).not.toContain("#!/usr/bin/env node");
		expect(output).not.toContain('"secret"');
		if (process.platform !== "win32") expect((await stat(outfile)).mode & 0o111).toBe(0o111);
		expect(runBundle(outfile)).toEqual({
			bun: bunVersion,
			fromFile: "public",
			pinned: "pinned-runner",
			secret: null,
			marker: "1",
		});
	});

	it("runs crust.bunPlugins through the pinned runner and keeps the same contract", async () => {
		const directory = await project();
		await writeFile(
			join(directory, "cli.ts"),
			`import greeting from "virtual:greeting";\n${report(", greeting")}`,
		);
		const outfile = join(directory, "cli.js");
		await execBunPackageBuild(
			join(directory, "cli.ts"),
			outfile,
			true,
			[join(directory, ".env.build")],
			directory,
			["./plugin.ts"],
			pinnedRunner(),
		);

		const output = await readFile(outfile, "utf8");
		expect(output.startsWith("#!/usr/bin/env bun\n// @bun\n")).toBe(true);
		expect(output).not.toContain('"secret"');
		expect(runBundle(outfile)).toEqual({
			bun: bunVersion,
			fromFile: "public",
			pinned: "pinned-runner",
			secret: null,
			marker: "1",
			greeting: "from plugin",
		});
		expect((await readdir(directory)).filter((name) => name.startsWith(".crust-build-"))).toEqual(
			[],
		);
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

	it("judges the pinned runner rather than looking up bun on PATH again", async () => {
		expect(() =>
			assertTargetsBuildableWithoutBun(["bun-darwin-arm64"], "bun-darwin-arm64", fallbackRunner),
		).toThrow("Cannot build bun-darwin-arm64 without a separate bun executable on PATH.");
		await withoutBunOnPath(() => {
			expect(() =>
				assertTargetsBuildableWithoutBun(["bun-darwin-arm64"], "bun-darwin-arm64", realBunRunner),
			).not.toThrow();
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
				`const artifact = defineExtension(defineExtensionId("artifact")).build(() => [{ path: "artifact.txt", content: "built" }, { path: "assets/bytes.bin", content: new Uint8Array([0, 255, 128, 10]) }]);\n` +
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
				`const broken = defineExtension(defineExtensionId("broken")).build(() => { throw new Error("disk full"); });\n` +
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
			await new Crust("fixture").extend(defineExtension(defineExtensionId("fixture")).build(() => [{ path: "assets/real.txt", content: "hook output" }])).execute();`,
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
			await new Crust("fixture").extend(defineExtension(defineExtensionId("empty")).build(() => [])).execute();`,
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
