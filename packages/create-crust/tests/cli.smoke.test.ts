import { afterAll, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const builtCliPath = resolve(import.meta.dir, "..", "dist", "index.js");
const repoRoot = resolve(import.meta.dir, "..", "..", "..");
const smokeRoot = join(process.env.RUNNER_TEMP ?? tmpdir(), "create-crust-smoke");
const sampleDir = join(smokeRoot, "smoke-cli");
const localPackageDir = join(smokeRoot, "local-packages");

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
		// (not packed) because the publish `files` list ships only compiled
		// binaries — the dev entry point is dist/cli.js.
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

let cleanupSmokeRoot = false;

/** Windows: spawn `cmd /c npm …` so npm resolves (`.cmd` shims need a shell). */
function npmArgv(args: string[]): string[] {
	if (process.platform === "win32") {
		return ["cmd", "/c", "npm", ...args];
	}
	return ["npm", ...args];
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

/** Published @crustjs/crust is either the staged root (bin/crust.js) or a dev build (dist/cli.js). */
function resolveInstalledCrustCli(projectDir: string): string {
	const pkgRoot = join(projectDir, "node_modules", "@crustjs", "crust");
	const binJs = join(pkgRoot, "bin", "crust.js");
	const distJs = join(pkgRoot, "dist", "cli.js");
	if (existsSync(binJs)) {
		return binJs;
	}
	if (existsSync(distJs)) {
		return distJs;
	}
	throw new Error(
		`Could not find crust CLI under ${pkgRoot} (expected bin/crust.js or dist/cli.js).`,
	);
}

/** Host-only target avoids cross-compile downloads (flaky on Windows CI for Linux Bun artifacts). */
function hostCrustBuildTarget(): string {
	const { platform, arch } = process;
	if (platform === "win32") {
		return arch === "arm64" ? "bun-windows-arm64" : "bun-windows-x64-baseline";
	}
	if (platform === "darwin") {
		return arch === "arm64" ? "bun-darwin-arm64" : "bun-darwin-x64";
	}
	if (platform === "linux") {
		return arch === "arm64" ? "bun-linux-arm64" : "bun-linux-x64-baseline";
	}
	return "bun-linux-x64-baseline";
}

function crustBuildArgv(crustCli: string): string[] {
	const normalized = crustCli.replaceAll("\\", "/");
	const useBun = normalized.endsWith("dist/cli.js");
	const runner = useBun ? process.execPath : "node";
	return [runner, crustCli, "build", "--target", hostCrustBuildTarget()];
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

afterAll(() => {
	if (cleanupSmokeRoot) {
		rmSync(smokeRoot, { recursive: true, force: true });
	}
});

describe.skipIf(process.env.CREATE_CRUST_SMOKE !== "1")("create-crust smoke test", () => {
	it("scaffolds, installs, type-checks, and builds a generated project", async () => {
		rmSync(smokeRoot, { recursive: true, force: true });
		mkdirSync(smokeRoot, { recursive: true });

		if (!existsSync(builtCliPath)) {
			throw new Error(
				`Built CLI not found at ${builtCliPath}. Run the package build before test:smoke.`,
			);
		}

		const scaffoldCommand = [
			process.execPath,
			builtCliPath,
			sampleDir,
			"--distribution",
			"binary",
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

		useLocalDependencyPackages(sampleDir, await packLocalDependencyPackages());
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

		const checkTypesCommand = npmArgv(["run", "check:types"]);
		const checkTypes = await run(checkTypesCommand, sampleDir);
		assertSuccess("generated project type-check", checkTypesCommand, sampleDir, checkTypes);

		// Call the installed entry directly: npm may not link a .bin shim for
		// the optional-deps meta package, and registry layout may be bin/crust.js
		// (staged publish) or dist/cli.js (see packages/crust package.json "files").
		const crustCli = resolveInstalledCrustCli(sampleDir);
		const buildCommand = crustBuildArgv(crustCli);

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

		const binaryName = basename(sampleDir);
		const distEntries = readdirSync(join(sampleDir, "dist"));

		expect(distEntries.length).toBeGreaterThan(0);
		expect(
			distEntries.includes("cli") ||
				distEntries.includes("cli.cmd") ||
				distEntries.includes("cli.exe") ||
				distEntries.includes(binaryName) ||
				distEntries.includes(`${binaryName}.exe`) ||
				distEntries.some((entry) => entry.startsWith(`${binaryName}-bun-`)),
		).toBe(true);

		cleanupSmokeRoot = true;
	}, 180_000);
});
