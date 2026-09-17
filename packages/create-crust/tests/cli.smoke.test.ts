import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
		// the workspace package's bin is the Bun bootstrap dist/cli.js.
		name: "@crustjs/crust",
		dir: "crust",
		requiredBuildOutput: "dist/cli.js",
		linkDir: true,
	},
] as const;

interface CommandResult {
	exitCode: number;
	stdout: string;
	stderr: string;
}

/** Compile target per host, keyed by the `.crust/<platform>` directory it stages into. */
const HOST_TARGETS = {
	"linux-x64": { bun: "bun-linux-x64", deno: "x86_64-unknown-linux-gnu" },
	"linux-arm64": { bun: "bun-linux-arm64", deno: "aarch64-unknown-linux-gnu" },
	"darwin-x64": { bun: "bun-darwin-x64", deno: "x86_64-apple-darwin" },
	"darwin-arm64": { bun: "bun-darwin-arm64", deno: "aarch64-apple-darwin" },
	"windows-x64": { bun: "bun-windows-x64", deno: "x86_64-pc-windows-msvc" },
	"windows-arm64": { bun: "bun-windows-arm64", deno: "aarch64-pc-windows-msvc" },
} satisfies Record<string, { bun: string; deno: string }>;

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

/** Host-only targets avoid cross-compile downloads (flaky on Windows CI for Linux Bun artifacts). */
function hostTargets() {
	const os = process.platform === "win32" ? "windows" : process.platform;
	const platform = `${os}-${process.arch}`;
	const entry = Object.entries(HOST_TARGETS).find(([key]) => key === platform);
	if (entry === undefined) {
		throw new Error(`No crust build host target for ${platform}.`);
	}
	return { platform, ...entry[1] };
}

/** The linked workspace crust is the Bun bootstrap bundle, so run it with Bun. */
function crustBuildArgv(projectDir: string, target: string | undefined): string[] {
	const crustCli = join(projectDir, "node_modules", "@crustjs", "crust", "dist", "cli.js");
	return [process.execPath, crustCli, "build", ...(target ? ["--target", target] : [])];
}

async function packLocalDependencyPackages(): Promise<Record<string, string>> {
	mkdirSync(localPackageDir, { recursive: true });
	const specs: Record<string, string> = {};

	for (const pkg of localDependencyPackages) {
		const packageDir = join(repoRoot, "packages", pkg.dir);
		const requiredBuildOutput = join(packageDir, pkg.requiredBuildOutput);
		if (!existsSync(requiredBuildOutput)) {
			throw new Error(
				`Built package output not found at ${requiredBuildOutput}. Run the package build before test:smoke.`,
			);
		}

		if ("linkDir" in pkg && pkg.linkDir) {
			specs[pkg.name] = `file:${packageDir.replaceAll("\\", "/")}`;
			continue;
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
	expect(existsSync(join(sampleDir, "node_modules", "@crustjs", "utils"))).toBe(false);
	expect(existsSync(join(sampleDir, "package-lock.json"))).toBe(true);

	// Run the template's own check:types script the way its users do.
	const checkTypesCommand =
		runtime === "deno" ? denoArgv(["task", "check:types"]) : npmArgv(["run", "check:types"]);
	const checkTypes = await run(checkTypesCommand, sampleDir);
	assertSuccess("generated project type-check", checkTypesCommand, sampleDir, checkTypes);

	const host = hostTargets();
	const target = runtime === "node" ? undefined : host[runtime];
	const buildCommand = crustBuildArgv(sampleDir, target);

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

	const name = basename(sampleDir);
	const crustDir = join(sampleDir, ".crust");
	const launcher = join(crustDir, "root", "bin", `${name}.js`);
	expect(existsSync(join(crustDir, "manifest.json"))).toBe(true);
	expect(existsSync(launcher)).toBe(true);
	if (target !== undefined) {
		const platformBin = join(crustDir, host.platform, "bin");
		expect(readdirSync(platformBin)).toContain(
			`${name}-${target}${process.platform === "win32" ? ".exe" : ""}`,
		);
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
