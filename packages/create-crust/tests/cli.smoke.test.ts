import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

type Runtime = "bun" | "node" | "deno";

const builtCliPath = resolve(import.meta.dir, "..", ".crust", "root", "bin", "create-crust.js");
const repoRoot = resolve(import.meta.dir, "..", "..", "..");
const smokeRoot = join(process.env.RUNNER_TEMP ?? tmpdir(), "create-crust-smoke");
const localPackageDir = join(smokeRoot, "local-packages");
const smokeEnabled = process.env.CREATE_CRUST_SMOKE === "1";
// Resolved path so Windows spawns deno.exe without a shell; also the presence probe.
const denoPath = Bun.which("deno");
// Deno is optional locally but mandatory in CI, where a missing binary must fail loudly.
const denoSkipReason =
	denoPath === null && !process.env.CI
		? "deno is not on PATH; skipping the Deno smoke case (set CI=1 to make it mandatory)"
		: null;

const localDependencyPackages = [
	{
		// Runtime dependency of core; has no dist/index.js, any subpath output works.
		name: "@crustjs/utils",
		dir: "utils",
		requiredBuildOutput: "dist/terminal.js",
	},
	{
		name: "@crustjs/style",
		dir: "style",
		requiredBuildOutput: "dist/index.js",
	},
	{
		name: "@crustjs/core",
		dir: "core",
		requiredBuildOutput: "dist/index.js",
	},
	{
		name: "@crustjs/extensions",
		dir: "extensions",
		requiredBuildOutput: "dist/index.js",
	},
	{
		// The 0.2.0 cohort is unpublished until release; link the workspace
		// package so the scaffolded project's devDependency resolves. Linked
		// (not packed): the published layout is the staged `.crust/root`, while
		// the workspace package's bin is its source, which the smoke runs with
		// Bun by path.
		name: "@crustjs/crust",
		dir: "crust",
	},
] as const;

interface CommandResult {
	exitCode: number;
	stdout: string;
	stderr: string;
}

let localSpecs: Record<string, string> = {};
// A failed case leaves the workspace behind for the CI failure artifact.
let keepSmokeRoot = false;

/** Windows: spawn `cmd /c npm …` so npm resolves (`.cmd` shims need a shell). */
function npmArgv(args: string[]): string[] {
	if (process.platform === "win32") {
		return ["cmd", "/c", "npm", ...args];
	}
	return ["npm", ...args];
}

function denoArgv(args: string[]): string[] {
	if (denoPath === null) {
		throw new Error("deno is required on PATH for the Deno smoke case but was not found.");
	}
	return [denoPath, ...args];
}

async function run(
	command: string[],
	cwd: string,
	env?: Record<string, string>,
): Promise<CommandResult> {
	const proc = Bun.spawn(command, {
		cwd,
		env: {
			...process.env,
			...env,
		},
		stdout: "pipe",
		stderr: "pipe",
	});

	return {
		exitCode: await proc.exited,
		stdout: await new Response(proc.stdout).text(),
		stderr: await new Response(proc.stderr).text(),
	};
}

function formatFailure(
	label: string,
	command: string[],
	cwd: string,
	result: CommandResult,
): string {
	return [
		`${label} failed`,
		`command: ${command.join(" ")}`,
		`cwd: ${cwd}`,
		`exit code: ${result.exitCode}`,
		`stdout:\n${result.stdout.trim() || "<empty>"}`,
		`stderr:\n${result.stderr.trim() || "<empty>"}`,
	].join("\n\n");
}

function assertSuccess(label: string, command: string[], cwd: string, result: CommandResult): void {
	if (result.exitCode !== 0) {
		throw new Error(formatFailure(label, command, cwd, result));
	}
}

/** The linked workspace crust's bin is its Bun source entry, so run it with Bun. */
function crustBuildArgv(projectDir: string, runtime: Runtime): string[] {
	const crustCli = join(projectDir, "node_modules", "@crustjs", "crust", "src", "cli.ts");
	// Host-only target avoids cross-compile downloads (flaky on Windows CI for Linux Bun artifacts).
	return [process.execPath, crustCli, "build", ...(runtime === "node" ? [] : ["--target", "host"])];
}

async function packLocalDependencyPackages(): Promise<Record<string, string>> {
	mkdirSync(localPackageDir, { recursive: true });
	const specs: Record<string, string> = {};

	for (const pkg of localDependencyPackages) {
		const packageDir = join(repoRoot, "packages", pkg.dir);
		if (!("requiredBuildOutput" in pkg)) {
			specs[pkg.name] = `file:${packageDir.replaceAll("\\", "/")}`;
			continue;
		}

		const requiredBuildOutput = join(packageDir, pkg.requiredBuildOutput);
		if (!existsSync(requiredBuildOutput)) {
			throw new Error(
				`Built package output not found at ${requiredBuildOutput}. Run the package build before test:smoke.`,
			);
		}

		const before = new Set(readdirSync(localPackageDir));
		const packCommand = [
			process.execPath,
			"pm",
			"pack",
			"--destination",
			localPackageDir,
			"--cwd",
			packageDir,
		];
		const pack = await run(packCommand, repoRoot, { BUN_BE_BUN: "1" });
		assertSuccess(`pack ${pkg.name}`, packCommand, repoRoot, pack);

		const tarballs = readdirSync(localPackageDir).filter(
			(entry) => entry.endsWith(".tgz") && !before.has(entry),
		);
		const [tarball] = tarballs;
		if (tarballs.length !== 1 || tarball === undefined) {
			throw new Error(`Expected one tarball for ${pkg.name}, found ${tarballs.length}.`);
		}
		specs[pkg.name] = pathToFileURL(join(localPackageDir, tarball)).href;
	}

	return specs;
}

function useLocalDependencyPackages(projectDir: string, specs: Record<string, string>): void {
	const packageJsonPath = join(projectDir, "package.json");
	const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));

	packageJson.devDependencies ??= {};
	for (const [name, spec] of Object.entries(specs)) {
		if (packageJson.dependencies?.[name] !== undefined) {
			packageJson.dependencies[name] = spec;
		} else {
			packageJson.devDependencies[name] = spec;
		}
	}

	writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, "\t")}\n`);
}

/**
 * Adds a second `bin` entry to a scaffolded project: `src/admin.ts` is the
 * template entry with its root command renamed to `<name>-admin`, so the
 * build has two commands with distinct names, entries, and actions.
 */
function addSecondEntry(projectDir: string, name: string): string {
	const command = `${name}-admin`;
	const cli = readFileSync(join(projectDir, "src", "cli.ts"), "utf8");
	writeFileSync(
		join(projectDir, "src", "admin.ts"),
		cli.replace(`new Crust(${JSON.stringify(name)}`, `new Crust(${JSON.stringify(command)}`),
	);
	const packageJsonPath = join(projectDir, "package.json");
	const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
	packageJson.bin[command] = "src/admin.ts";
	writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, "\t")}\n`);
	return command;
}

/** A `node_modules/.bin` command the way a shell runs it: the `.cmd` shim through cmd.exe on Windows. */
function shimArgv(binDir: string, command: string, args: string[]): string[] {
	return process.platform === "win32"
		? ["cmd", "/c", join(binDir, `${command}.cmd`), ...args]
		: [join(binDir, command), ...args];
}

/**
 * `npm link`s `packageDir` into a fresh consumer (paths with spaces; npm prefix
 * and cache inside the smoke root, never the user's global state) and runs each
 * command's action and help through the shim npm generated. For the project
 * itself the shim runs the TypeScript source via its shebang; for `.crust/root`
 * it runs the staged launcher or bundle.
 */
async function linkAndRunCommands(
	label: string,
	packageDir: string,
	consumerDir: string,
	commands: readonly string[],
): Promise<void> {
	mkdirSync(consumerDir, { recursive: true });
	writeFileSync(
		join(consumerDir, "package.json"),
		'{ "name": "link-consumer", "private": true }\n',
	);
	const npmEnv = {
		npm_config_prefix: join(consumerDir, "npm prefix"),
		npm_config_cache: join(consumerDir, "npm cache"),
	};
	// --omit=optional: the staged root lists unpublished platform packages.
	const linkFlags = ["--ignore-scripts", "--offline", "--omit=optional", "--no-audit", "--no-fund"];
	const registerCommand = npmArgv(["link", ...linkFlags]);
	const register = await run(registerCommand, packageDir, npmEnv);
	assertSuccess(`${label} npm link (register)`, registerCommand, packageDir, register);
	const { name } = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8"));
	const linkCommand = npmArgv(["link", name, ...linkFlags]);
	const link = await run(linkCommand, consumerDir, npmEnv);
	assertSuccess(`${label} npm link ${name}`, linkCommand, consumerDir, link);
	// The shims below must reach this package (source tree or staged root), not a copy.
	expect(realpathSync(join(consumerDir, "node_modules", name))).toBe(realpathSync(packageDir));

	const binDir = join(consumerDir, "node_modules", ".bin");
	for (const command of commands) {
		const actionCommand = shimArgv(binDir, command, ["Ada"]);
		const action = await run(actionCommand, consumerDir);
		assertSuccess(`${label} ${command} action`, actionCommand, consumerDir, action);
		expect(action.stdout.trim()).toBe("Hello, Ada!");
		const helpCommand = shimArgv(binDir, command, ["--help"]);
		const help = await run(helpCommand, consumerDir);
		assertSuccess(`${label} ${command} --help`, helpCommand, consumerDir, help);
		expect(help.stdout).toContain(command);
	}
}

async function smokeRuntime(runtime: Runtime): Promise<void> {
	const sampleDir = join(smokeRoot, `smoke-${runtime}`);
	const scaffoldCommand = [
		process.execPath,
		builtCliPath,
		sampleDir,
		"--runtime",
		runtime,
		"--no-install",
		"--no-git",
	];
	const scaffold = await run(scaffoldCommand, smokeRoot, {
		BUN_BE_BUN: "1",
		npm_config_user_agent: "npm/10.0.0 node/v22.0.0",
	});

	assertSuccess("create-crust scaffold", scaffoldCommand, smokeRoot, scaffold);
	expect(existsSync(join(sampleDir, "package.json"))).toBe(true);
	expect(existsSync(join(sampleDir, "tsconfig.json"))).toBe(true);
	expect(existsSync(join(sampleDir, "src", "cli.ts"))).toBe(true);
	expect(existsSync(join(sampleDir, "README.md"))).toBe(true);

	const name = basename(sampleDir);
	const commands = [name, addSecondEntry(sampleDir, name)];
	useLocalDependencyPackages(sampleDir, localSpecs);
	// npm installs every runtime's project, including Deno's. create-crust itself
	// runs `deno install` for Deno projects, but `deno install` treats the smoke's
	// `file:` tarball specs as directory links (it symlinks the .tgz path), so the
	// install step is test infrastructure here; `deno check` and `deno compile`
	// then consume the npm-populated node_modules as Deno's default BYONM layout.
	// Audit/funding lookups hit registry endpoints the smoke test does not need;
	// when they degrade, npm blocks on them and the test times out.
	const installCommand = npmArgv(["install", "--no-audit", "--no-fund"]);
	const install = await run(installCommand, sampleDir, {
		BUN_BE_BUN: "1",
		npm_config_user_agent: "npm/10.0.0 node/v22.0.0",
	});
	assertSuccess("generated project install", installCommand, sampleDir, install);
	expect(existsSync(join(sampleDir, "node_modules"))).toBe(true);
	// The local utils tarball, not the unrelated registry 0.0.x shape (which has no
	// dist/ subpath files), must satisfy core's runtime dependency.
	const installedUtilsDir = join(sampleDir, "node_modules", "@crustjs", "utils");
	expect(JSON.parse(readFileSync(join(installedUtilsDir, "package.json"), "utf8")).version).toBe(
		JSON.parse(readFileSync(join(repoRoot, "packages", "utils", "package.json"), "utf8")).version,
	);
	expect(existsSync(join(installedUtilsDir, "dist", "terminal.js"))).toBe(true);
	expect(existsSync(join(sampleDir, "package-lock.json"))).toBe(true);

	// Run the template's own check:types script the way its users do.
	const checkTypesCommand =
		runtime === "deno" ? denoArgv(["task", "check:types"]) : npmArgv(["run", "check:types"]);
	const checkTypes = await run(checkTypesCommand, sampleDir);
	assertSuccess("generated project type-check", checkTypesCommand, sampleDir, checkTypes);

	const buildCommand = crustBuildArgv(sampleDir, runtime);

	// GitHub-hosted Windows: project is often on D: while default TEMP/cache are on C:;
	// Bun compile can fail extracting toolchains across volumes (oven-sh/bun#28327).
	const buildTmpDir = join(sampleDir, ".smoke-tmp");
	const buildBunCache = join(sampleDir, ".smoke-bun-cache");
	if (process.platform === "win32") {
		mkdirSync(buildTmpDir, { recursive: true });
		mkdirSync(buildBunCache, { recursive: true });
	}
	const buildExtraEnv: Record<string, string> | undefined =
		process.platform === "win32"
			? {
					TEMP: buildTmpDir,
					TMP: buildTmpDir,
					BUN_INSTALL_CACHE_DIR: buildBunCache,
				}
			: undefined;

	const build = await run(buildCommand, sampleDir, buildExtraEnv);
	assertSuccess("generated project build", buildCommand, sampleDir, build);

	const crustDir = join(sampleDir, ".crust");
	for (const command of commands) {
		expect(existsSync(join(crustDir, "root", "bin", `${command}.js`))).toBe(true);
	}
	const manifest = JSON.parse(readFileSync(join(crustDir, "manifest.json"), "utf8"));
	expect(manifest.root.bins).toEqual(commands);
	if (runtime !== "node") {
		// `--target host` stages exactly one platform package, holding every command's binary.
		expect(manifest.packages).toHaveLength(1);
		expect(Object.keys(manifest.packages[0].bins)).toEqual(commands);
		for (const command of commands) {
			expect(
				existsSync(join(crustDir, manifest.packages[0].dir, manifest.packages[0].bins[command])),
			).toBe(true);
		}
	}

	// Run the template's own `start` script the way its users do, so the
	// launcher is exercised under the template's runtime (bun/node/deno) and the
	// script's `{{name}}` path is verified. `--silent` drops npm's script banner,
	// which would otherwise satisfy the `name` assertion by itself.
	const startCommand =
		runtime === "deno"
			? denoArgv(["task", "start", "--help"])
			: npmArgv(["run", "--silent", "start", "--", "--help"]);
	const start = await run(startCommand, sampleDir);
	assertSuccess("generated project start", startCommand, sampleDir, start);
	expect(start.stdout).toContain(name);

	// `bin` points at the source, so linking the project runs src/*.ts through the
	// runtime shebang (a cmd-shim `.cmd` on Windows); linking `.crust/root` runs
	// the staged launcher/bundle. Both consumers live under a path with spaces.
	const linkRoot = join(smokeRoot, "link consumers", runtime);
	await linkAndRunCommands("source link", sampleDir, join(linkRoot, "source"), commands);
	await linkAndRunCommands(
		"staged link",
		join(crustDir, "root"),
		join(linkRoot, "staged"),
		commands,
	);
}

function smokeCase(runtime: Runtime): () => Promise<void> {
	return async () => {
		try {
			await smokeRuntime(runtime);
		} catch (error) {
			keepSmokeRoot = true;
			throw error;
		}
	};
}

afterAll(() => {
	if (smokeEnabled && !keepSmokeRoot) {
		rmSync(smokeRoot, { recursive: true, force: true });
	}
});

describe.skipIf(!smokeEnabled)("create-crust smoke test", () => {
	beforeAll(async () => {
		rmSync(smokeRoot, { recursive: true, force: true });
		mkdirSync(smokeRoot, { recursive: true });

		if (!existsSync(builtCliPath)) {
			throw new Error(
				`Built CLI not found at ${builtCliPath}. Run the package build before test:smoke.`,
			);
		}
		if (denoSkipReason !== null) {
			console.warn(denoSkipReason);
		}

		localSpecs = await packLocalDependencyPackages();
	});

	// Generous timeouts: each case installs from the registry and compiles a
	// binary; `deno compile` also downloads a denort runtime on a cold cache.
	it("bun: scaffolds, installs, type-checks, builds, and runs", smokeCase("bun"), 300_000);
	it("node: scaffolds, installs, type-checks, builds, and runs", smokeCase("node"), 300_000);
	it.skipIf(denoSkipReason !== null)(
		"deno: scaffolds, installs, type-checks, builds, and runs",
		smokeCase("deno"),
		300_000,
	);
});
