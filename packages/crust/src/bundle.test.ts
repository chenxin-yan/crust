import { spawnSync } from "node:child_process";
import {
	access,
	mkdtemp,
	readdir,
	readFile,
	realpath,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { which } from "@crustjs/utils/process";
import { afterEach, describe, expect, it } from "vite-plus/test";

import {
	type BunPluginDriverOptions,
	createBunCompileArgs,
	createBunPluginDriverScript,
	execBuild,
	execBunPackageBuild,
	execDenoPackageBuild,
	execNodeBuild,
	resolveBunPluginSource,
} from "./bundle.ts";
import { BUN_TARGETS, hostTarget } from "./targets.ts";

const bunVersion = spawnSync(which("bun")!, ["--version"], {
	encoding: "utf8",
	timeout: 10_000,
}).stdout.trim();
const denoPath = which("deno");

describe.skipIf(denoPath === null)("execDenoPackageBuild", () => {
	const tempDirs: string[] = [];

	afterEach(async () => {
		await Promise.all(tempDirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
	});

	it("fails with deno's diagnostics without leaving a bundle or temporary inputs", async () => {
		const directory = await mkdtemp(join(tmpdir(), "crust-deno-package-test-"));
		tempDirs.push(directory);
		await writeFile(join(directory, "cli.ts"), 'import "./missing.ts";\n');
		const outfile = join(directory, "out", "bin", "cli.js");

		await expect(
			execDenoPackageBuild(join(directory, "cli.ts"), outfile, directory, {
				command: denoPath!,
				env: process.env,
			}),
		).rejects.toThrow(/^Build failed for .*cli\.js:\n[\s\S]*missing\.ts/);
		await expect(access(outfile)).rejects.toThrow();
		expect(await readdir(directory)).toEqual(["cli.ts"]);
	}, 60_000);
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
