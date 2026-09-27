import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { chmod, copyFile, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, posix, resolve, win32 } from "node:path";
import { text } from "node:stream/consumers";
import { fileURLToPath, pathToFileURL } from "node:url";

import { type BuildReport, defineExtensionId, type InvocationIO } from "@crustjs/core";
import { type CommandSnapshot, SNAPSHOT_PATH_ENV } from "@crustjs/core/tooling";
import { yellow } from "@crustjs/style";
import { BUILD_OUT_DIR_ENV } from "@crustjs/utils/artifacts";
import { isErrnoException } from "@crustjs/utils/error";
import { isJsonObject, type JsonObject, type JsonValue } from "@crustjs/utils/json";
import { isWithin } from "@crustjs/utils/path";
import { runProcess, which } from "@crustjs/utils/process";
import satisfies from "semver/functions/satisfies.js";
import validVersion from "semver/functions/valid.js";
import validRange from "semver/ranges/valid.js";

// ────────────────────────────────────────────────────────────────────────────
// Build runtimes and compile targets
// ────────────────────────────────────────────────────────────────────────────

export const BUILD_RUNTIMES = ["bun", "deno", "node"] as const;
export type BuildRuntime = (typeof BUILD_RUNTIMES)[number];

export type TargetInfo = {
	alias: string;
	platformKey: string;
	os: "linux" | "darwin" | "win32";
	cpu: "x64" | "arm64";
	/** C library the Linux binary links against; drives the npm `libc` field and launcher selection. */
	libc?: "glibc" | "musl";
};

export type TargetTable<T extends string> = {
	runtime: "Bun" | "Deno" | "Node";
	targets: readonly T[];
	info: Record<T, TargetInfo>;
};

const BUN_TARGET_NAMES = [
	"bun-linux-x64",
	"bun-linux-arm64",
	"bun-linux-x64-musl",
	"bun-linux-arm64-musl",
	"bun-darwin-x64",
	"bun-darwin-arm64",
	"bun-windows-x64",
	"bun-windows-arm64",
] as const;

export type BunTarget = (typeof BUN_TARGET_NAMES)[number];

export const BUN_TARGETS = {
	runtime: "Bun",
	targets: BUN_TARGET_NAMES,
	info: {
		"bun-linux-x64": {
			alias: "linux-x64",
			platformKey: "linux-x64",
			os: "linux",
			cpu: "x64",
			libc: "glibc",
		},
		"bun-linux-arm64": {
			alias: "linux-arm64",
			platformKey: "linux-arm64",
			os: "linux",
			cpu: "arm64",
			libc: "glibc",
		},
		"bun-linux-x64-musl": {
			alias: "linux-x64-musl",
			platformKey: "linux-x64-musl",
			os: "linux",
			cpu: "x64",
			libc: "musl",
		},
		"bun-linux-arm64-musl": {
			alias: "linux-arm64-musl",
			platformKey: "linux-arm64-musl",
			os: "linux",
			cpu: "arm64",
			libc: "musl",
		},
		"bun-darwin-x64": {
			alias: "darwin-x64",
			platformKey: "darwin-x64",
			os: "darwin",
			cpu: "x64",
		},
		"bun-darwin-arm64": {
			alias: "darwin-arm64",
			platformKey: "darwin-arm64",
			os: "darwin",
			cpu: "arm64",
		},
		"bun-windows-x64": {
			alias: "windows-x64",
			platformKey: "win32-x64",
			os: "win32",
			cpu: "x64",
		},
		"bun-windows-arm64": {
			alias: "windows-arm64",
			platformKey: "win32-arm64",
			os: "win32",
			cpu: "arm64",
		},
	},
} as const satisfies TargetTable<BunTarget>;

const DENO_TARGET_NAMES = [
	"x86_64-unknown-linux-gnu",
	"aarch64-unknown-linux-gnu",
	"x86_64-apple-darwin",
	"aarch64-apple-darwin",
	"x86_64-pc-windows-msvc",
	"aarch64-pc-windows-msvc",
] as const;

export type DenoTarget = (typeof DENO_TARGET_NAMES)[number];

export const DENO_TARGETS = {
	runtime: "Deno",
	targets: DENO_TARGET_NAMES,
	info: {
		"x86_64-unknown-linux-gnu": {
			alias: "linux-x64",
			platformKey: "linux-x64",
			os: "linux",
			cpu: "x64",
			libc: "glibc",
		},
		"aarch64-unknown-linux-gnu": {
			alias: "linux-arm64",
			platformKey: "linux-arm64",
			os: "linux",
			cpu: "arm64",
			libc: "glibc",
		},
		"x86_64-apple-darwin": {
			alias: "darwin-x64",
			platformKey: "darwin-x64",
			os: "darwin",
			cpu: "x64",
		},
		"aarch64-apple-darwin": {
			alias: "darwin-arm64",
			platformKey: "darwin-arm64",
			os: "darwin",
			cpu: "arm64",
		},
		"x86_64-pc-windows-msvc": {
			alias: "windows-x64",
			platformKey: "win32-x64",
			os: "win32",
			cpu: "x64",
		},
		"aarch64-pc-windows-msvc": {
			alias: "windows-arm64",
			platformKey: "win32-arm64",
			os: "win32",
			cpu: "arm64",
		},
	},
} as const satisfies TargetTable<DenoTarget>;

// Node's own release platform names (`node-v26.10.0-win-x64`), which tsdown's
// executable builder accepts as `{ platform, arch }`. It has no libc variant:
// the official Linux builds link glibc, so musl hosts have no Node target.
const NODE_TARGET_NAMES = [
	"linux-x64",
	"linux-arm64",
	"darwin-x64",
	"darwin-arm64",
	"win-x64",
	"win-arm64",
] as const;

export type NodeTarget = (typeof NODE_TARGET_NAMES)[number];

export const NODE_TARGETS = {
	runtime: "Node",
	targets: NODE_TARGET_NAMES,
	info: {
		"linux-x64": {
			alias: "linux-x64",
			platformKey: "linux-x64",
			os: "linux",
			cpu: "x64",
			libc: "glibc",
		},
		"linux-arm64": {
			alias: "linux-arm64",
			platformKey: "linux-arm64",
			os: "linux",
			cpu: "arm64",
			libc: "glibc",
		},
		"darwin-x64": {
			alias: "darwin-x64",
			platformKey: "darwin-x64",
			os: "darwin",
			cpu: "x64",
		},
		"darwin-arm64": {
			alias: "darwin-arm64",
			platformKey: "darwin-arm64",
			os: "darwin",
			cpu: "arm64",
		},
		"win-x64": {
			alias: "windows-x64",
			platformKey: "win32-x64",
			os: "win32",
			cpu: "x64",
		},
		"win-arm64": {
			alias: "windows-arm64",
			platformKey: "win32-arm64",
			os: "win32",
			cpu: "arm64",
		},
	},
} as const satisfies TargetTable<NodeTarget>;

/** `--target` value that stands for this machine's canonical target. */
export const HOST_TARGET = "host";

/**
 * Canonical targets for `--target` inputs, deduplicated in input order. No
 * inputs means every target of the table; `host` means this machine's target.
 */
export function resolveTargets<T extends string>(
	table: TargetTable<T>,
	targetFlags: readonly string[] | undefined,
): T[] {
	if (!targetFlags?.length) return [...table.targets];

	const targets = targetFlags.map((input) => {
		if (input === HOST_TARGET) {
			const host = hostTarget(table);
			if (host === null) {
				throw new Error(
					`No ${table.runtime} target matches this machine (${hostPlatformKey()}).\n  Valid targets: ${table.targets.join(", ")}`,
				);
			}
			return host;
		}
		const exact = table.targets.find((target) => target === input);
		if (exact) return exact;

		const canonical = table.targets.find((target) => table.info[target].alias === input);
		const hint = canonical ? ` Did you mean "${canonical}"?` : "";
		const runtime = table.runtime === "Bun" ? "" : `${table.runtime} `;
		throw new Error(
			`Unknown ${runtime}target "${input}". Targets must use canonical ${table.runtime} names.${hint}\n  Valid targets: ${table.targets.join(", ")}`,
		);
	});
	return [...new Set(targets)];
}

/** True on musl-based Linux (Alpine, Void, …). Mirrors the check in Bun's own npm installer. */
export function isMuslHost(): boolean {
	if (process.platform !== "linux") return false;
	try {
		// SAFETY: @types/node types the report as `object`; header.glibcVersionRuntime is a documented field.
		const report = process.report?.getReport() as
			| { header?: { glibcVersionRuntime?: string } }
			| undefined;
		if (report?.header) return report.header.glibcVersionRuntime === undefined;
	} catch {
		// process.report is unavailable in some embedders; fall through to the file probe.
	}
	return existsSync("/etc/alpine-release");
}

function hostPlatformKey(): string {
	return `${process.platform}-${process.arch}${isMuslHost() ? "-musl" : ""}`;
}

export function hostTarget<T extends string>(table: TargetTable<T>): T | null {
	const platformKey = hostPlatformKey();
	return table.targets.find((target) => table.info[target].platformKey === platformKey) ?? null;
}

export function readUserPackageJson(cwd: string): JsonValue | undefined {
	const packageJsonPath = join(cwd, "package.json");
	if (!existsSync(packageJsonPath)) return undefined;

	try {
		// SAFETY: JSON.parse returns only JSON-compatible values for a valid JSON document.
		return JSON.parse(readFileSync(packageJsonPath, "utf8")) as JsonValue;
	} catch (error) {
		throw new Error(
			`Failed to parse package.json in ${cwd}: ${error instanceof Error ? error.message : String(error)}`,
			{ cause: error },
		);
	}
}

function toBunEnvFileArgs(envFiles: readonly string[]): string[] {
	return envFiles.flatMap((envFile) => ["--env-file", envFile]);
}

export type BuildRunner = {
	command: string;
	env: NodeJS.ProcessEnv;
};

/**
 * Resolve the safest executable to run `bun build`.
 *
 * Prefer the real Bun binary when it is available on PATH, because invoking
 * standalone compilation from inside a compiled Crust executable can trigger
 * Bun runtime bugs on some host/target combinations.
 *
 * Fall back to the current executable with `BUN_BE_BUN=1` so packaged Crust
 * binaries still work in environments without a separate Bun install. Only a
 * Bun process can stand in for bun: the library `build()` may run under Node,
 * where the fallback would spawn node with Bun flags, so that case is an error.
 */
export function resolveBunBuildRunner(
	runningUnderBun: boolean = process.versions.bun !== undefined,
): BuildRunner {
	const bunPath = which("bun");
	if (bunPath) {
		return {
			command: bunPath,
			env: { ...process.env },
		};
	}
	if (!runningUnderBun) {
		throw new Error(
			"bun was not found on PATH.\n  crust build compiles with the Bun bundler and prepares Command Snapshots with bun; install Bun (https://bun.sh) or run the build under bun.",
		);
	}

	return {
		command: process.execPath,
		env: {
			...process.env,
			BUN_BE_BUN: "1",
		},
	};
}

// Bun compiles its compiled-in default target — the host os/arch/libc with
// `baseline: false` (src/options_types/compile_target.rs, `CompileTarget::default`
// / `is_default`) — by copying the running executable onto itself; every other
// target is downloaded clean. Inside a standalone Crust that base already
// carries a bundle and the result segfaults on start, so the host target needs
// either a real `bun` or the `-baseline` alias below.

/**
 * Bun's `-baseline` spelling of an x64 target, or null for arm64.
 *
 * Bun 1.4 ships one x64 build, so the alias yields the same executable (Bun
 * 1.4.2 downloads a `bun-<target>-baseline-v1.4.2` base that is byte-identical
 * to the plain one; checked for linux-x64-musl and darwin-x64), but `baseline:
 * true` is never Bun's compiled-in default, so it is never the self-copy target.
 * arm64 spellings with the suffix resolve to the plain aarch64 base instead.
 */
export function bunBaselineAlias(target: BunTarget): string | null {
	return BUN_TARGETS.info[target].cpu === "x64" ? `${target}-baseline` : null;
}

/**
 * Target string passed to Bun: the `-baseline` alias when the `BUN_BE_BUN`
 * fallback runner would otherwise compile `target` by copying itself.
 */
export function bunCompileTarget(
	target: BunTarget,
	runner: BuildRunner,
	host = hostTarget(BUN_TARGETS),
): string {
	if (target !== host || runner.env.BUN_BE_BUN !== "1") {
		return target;
	}
	return bunBaselineAlias(target) ?? target;
}

/**
 * Refuse the host target when only the `BUN_BE_BUN` fallback runner is
 * available and no `-baseline` alias can stand in for it (arm64 hosts).
 * Pass the selected `runner` to judge that compiler instead of looking up
 * `bun` on PATH again.
 */
export function assertTargetsBuildableWithoutBun(
	targets: readonly BunTarget[],
	host = hostTarget(BUN_TARGETS),
	runner?: BuildRunner,
): void {
	const externalBun = runner ? runner.env.BUN_BE_BUN !== "1" : which("bun") !== null;
	if (host === null || !targets.includes(host) || bunBaselineAlias(host) !== null || externalBun) {
		return;
	}
	const others = targets.filter((target) => target !== host);
	const alternative =
		others.length > 0
			? `pass --target with the other targets (e.g. ${others.map((target) => `--target ${target}`).join(" ")})`
			: "build a different target";
	throw new Error(
		`Cannot build ${host} without a separate bun executable on PATH.\n` +
			"  Bun reuses the running crust executable as the base for its own platform, which yields a binary that crashes on start.\n" +
			`  Install Bun (https://bun.sh), or ${alternative}.`,
	);
}

/** The external `deno` on PATH; Deno has no embedded fallback. */
export function resolveDenoBuildRunner(): BuildRunner {
	const denoPath = which("deno");
	if (!denoPath) {
		throw new Error(
			"Deno is required for the deno runtime but was not found on PATH.\n  Install Deno from https://deno.com/ and try again.",
		);
	}
	return { command: denoPath, env: { ...process.env } };
}

/** The external `node` on PATH, which runs tsdown's executable builder; there is no embedded fallback. */
export function resolveNodeBuildRunner(): BuildRunner {
	const nodePath = which("node");
	if (!nodePath) {
		throw new Error(
			"Node is required for node standalone binaries but was not found on PATH.\n  Binaries embed the selected node's version; install Node (https://nodejs.org) or put it first on PATH with your version manager.",
		);
	}
	return { command: nodePath, env: { ...process.env } };
}

// ────────────────────────────────────────────────────────────────────────────
// Binary compiler versions
// ────────────────────────────────────────────────────────────────────────────

const RUNTIME_LABELS = { bun: "Bun", deno: "Deno", node: "Node" } as const;

/** The compiler selected once for a build and the runtime version it embeds. */
export type BuildCompiler = {
	runtime: BuildRuntime;
	runner: BuildRunner;
	version: string;
};

const COMPILER_VERSION_TIMEOUT_MS = 30_000;

/**
 * Runtime version reported by the runner itself (`<command> --version`), never
 * the runtime hosting this process: `bun` prints `1.4.2`, `deno` prints
 * `deno 2.9.6 (…)`, `node` prints `v24.21.0`. Under the `BUN_BE_BUN` fallback
 * this is the embedded Bun, which is the compiler. `cwd` must be the directory
 * compilation runs in: a version-manager shim picks its runtime from it. A
 * probe still running after {@link COMPILER_VERSION_TIMEOUT_MS} is killed and
 * fails the build, before `.crust/` is replaced.
 */
export async function readCompilerVersion(
	runtime: BuildRuntime,
	runner: BuildRunner,
	cwd: string,
): Promise<string> {
	const { exitCode, stdout, stderr } = await runProcess(runner.command, ["--version"], {
		env: runner.env,
		cwd,
		stdio: "collect",
		timeout: COMPILER_VERSION_TIMEOUT_MS,
	});
	const reported = runtime === "deno" ? /^deno (\S+)/.exec(stdout.trim())?.[1] : stdout.trim();
	const version = exitCode === 0 && reported !== undefined ? validVersion(reported) : null;
	if (version === null) {
		const output = [stderr.trim(), stdout.trim()].filter(Boolean).join("\n");
		throw new Error(
			`Could not read the ${RUNTIME_LABELS[runtime]} version from ${runner.command} --version (exit ${exitCode})${output ? `:\n${output}` : "."}`,
		);
	}
	return version;
}

function isVersionRange(value: JsonValue): value is string {
	return typeof value === "string" && validRange(value) !== null;
}

/**
 * Check the selected compiler against the project's `engines.<runtime>` with
 * npm semver semantics. An absent constraint allows any version; an exact
 * value is a requirement, not a request to install that version.
 */
export function assertCompilerSatisfiesEngines(
	compiler: BuildCompiler,
	userPackageJson: JsonValue | undefined,
): void {
	if (userPackageJson === undefined || !isJsonObject(userPackageJson)) return;
	const { engines } = userPackageJson;
	if (engines === undefined) return;
	if (!isJsonObject(engines)) {
		throw new Error("package.json engines must be an object of runtime version ranges.");
	}
	const constraint = engines[compiler.runtime];
	if (constraint === undefined) return;
	const field = `package.json engines.${compiler.runtime}`;
	if (!isVersionRange(constraint)) {
		throw new Error(
			`${field} is not a valid semver range: ${JSON.stringify(constraint)}.\n  Use an exact version or range such as "1.4.2" or ">=1.4.0".`,
		);
	}
	if (!satisfies(compiler.version, constraint)) {
		const label = RUNTIME_LABELS[compiler.runtime];
		throw new Error(
			`${label} ${compiler.version} (${compiler.runner.command}) does not satisfy ${field} "${constraint}".\n` +
				`  Binaries embed the selected compiler's ${label} version; crust does not install or upgrade it.\n` +
				`  Put a matching ${compiler.runtime} first on PATH (e.g. with your version manager), or update ${field}.`,
		);
	}
}

/**
 * Select the binary compiler once for a build: the Bun runner (external bun
 * first, then the embedded fallback) or the external deno. Returns its actual
 * version, read in the project directory `cwd`, after validating it against
 * `engines`. Pass `runner` and the same `cwd` on to the `exec*`/`buildEntrypoint`
 * helpers so every step uses this same compiler.
 */
export async function resolveBinaryCompiler(
	runtime: "bun" | "deno",
	userPackageJson: JsonValue | undefined,
	cwd: string,
): Promise<BuildCompiler> {
	const runner = runtime === "bun" ? resolveBunBuildRunner() : resolveDenoBuildRunner();
	const compiler = { runtime, runner, version: await readCompilerVersion(runtime, runner, cwd) };
	assertCompilerSatisfiesEngines(compiler, userPackageJson);
	return compiler;
}

// ────────────────────────────────────────────────────────────────────────────
// Node standalone binaries (tsdown exe)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Crust's own optional dependencies that build Node standalone binaries.
 * Crust's staged root and platform packages declare them
 * (scripts/stage-node-exe-dependencies.ts) so an installed crust resolves them
 * next to itself; an install that skipped them only affects Node binaries.
 */
export const NODE_EXE_BACKEND_PACKAGES = ["tsdown", "@tsdown/exe"] as const;

/** Crust's installed tsdown, as the selected Node resolves and loads it. */
export type NodeExeBackend = {
	/** tsdown's package.json, resolved from Crust's own installation. */
	packageJsonPath: string;
	version: string;
	/** tsdown's package `engines.node`. */
	engines: string;
	/** Oldest Node tsdown's executable builder accepts (Node SEA with an ESM entry). */
	seaMinVersion: string;
};

/** The selected external Node together with the backend it builds binaries with. */
export type NodeBinaryCompiler = BuildCompiler & { runtime: "node"; backend: NodeExeBackend };

/**
 * A file of Crust's own installation that the backend is resolved from, never
 * the project or PATH. A compiled crust serves its modules from Bun's virtual
 * filesystem (`/$bunfs/`, `B:/~BUN/` on Windows), so there it is the
 * executable, inside its platform package.
 */
export function crustInstallPath(moduleUrl = import.meta.url, execPath = process.execPath): string {
	return /^file:\/\/\/(?:\$bunfs|[A-Za-z]:\/~BUN)\//.test(moduleUrl)
		? execPath
		: fileURLToPath(moduleUrl);
}

/**
 * `<dir>/node_modules/<name>/package.json` for the nearest `dir` at or above
 * `from`: Node's node_modules lookup without its NODE_PATH and global-folder
 * fallbacks, so only an installation next to `from` can supply the package.
 */
function findInstalledPackageJson(from: string, name: string): string | null {
	for (let dir = from; ; dir = dirname(dir)) {
		const candidate = join(dir, "node_modules", name, "package.json");
		if (existsSync(candidate)) return candidate;
		if (dirname(dir) === dir) return null;
	}
}

function isTsdownPackageJson(
	value: JsonValue,
): value is JsonObject & { version: string; engines: JsonObject & { node: string } } {
	return (
		isJsonObject(value) &&
		typeof value.version === "string" &&
		value.engines !== undefined &&
		isJsonObject(value.engines) &&
		value.engines.node !== undefined &&
		isVersionRange(value.engines.node)
	);
}

// Loads tsdown's executable-builder minimum under the selected Node, the way
// the build loads tsdown: as a self-reference from its package.json.
function createNodeExeProbeScript(tsdownPackageJson: string): string {
	return `// Generated by crust build to read tsdown's executable minimum; deleted when it exits.
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const internal = createRequire(${JSON.stringify(tsdownPackageJson)}).resolve("tsdown/internal");
console.log((await import(pathToFileURL(internal).href)).NODE_SEA_MIN_VERSION);
`;
}

const NODE_TOOLCHAIN_GUIDANCE =
	"  Binaries embed the selected node's version; crust does not install or upgrade it.\n  Put a supported node first on PATH (e.g. with your version manager).";

/**
 * Checks the selected Node against the installed backend's two separate
 * requirements: tsdown's package `engines.node` and its executable builder's
 * minimum (skipped while unknown). Both come from the installed tsdown, not
 * from this file.
 */
export function assertNodeExeBackendSupports(
	compiler: BuildCompiler,
	backend: Pick<NodeExeBackend, "version" | "engines"> & { seaMinVersion?: string },
): void {
	const selected = `Node ${compiler.version} (${compiler.runner.command})`;
	if (!satisfies(compiler.version, backend.engines)) {
		throw new Error(
			`${selected} is not supported by tsdown ${backend.version}, which builds node standalone binaries: its package requires Node "${backend.engines}".\n${NODE_TOOLCHAIN_GUIDANCE}`,
		);
	}
	if (
		backend.seaMinVersion !== undefined &&
		!satisfies(compiler.version, `>=${backend.seaMinVersion}`)
	) {
		throw new Error(
			`${selected} cannot build standalone executables: tsdown ${backend.version}'s executable builder requires Node ${backend.seaMinVersion} or later.\n${NODE_TOOLCHAIN_GUIDANCE}`,
		);
	}
}

/**
 * Finds Crust's installed tsdown and @tsdown/exe from `installPath` and
 * validates the selected Node against tsdown's requirements, loading the
 * executable builder's minimum under that Node. `cwd` is the project
 * directory, as for every other compiler step.
 */
export async function resolveNodeExeBackend(
	compiler: BuildCompiler,
	cwd: string,
	installPath: string = crustInstallPath(),
): Promise<NodeExeBackend> {
	const reinstall =
		`  @crustjs/crust ships ${NODE_EXE_BACKEND_PACKAGES.join(" and ")} as optional dependencies, which package managers skip when optional dependencies are disabled or the installing node does not satisfy tsdown's engines.\n` +
		"  Reinstall @crustjs/crust with optional dependencies enabled under a node that can build Node binaries (e.g. the one on PATH here).";
	const packageJsonPath = findInstalledPackageJson(dirname(installPath), "tsdown");
	if (packageJsonPath === null) {
		throw new Error(
			`tsdown, which builds node standalone binaries, is not installed with crust (${installPath}).\n${reinstall}`,
		);
	}
	// tsdown imports @tsdown/exe from its real location for executable targets.
	if (findInstalledPackageJson(dirname(realpathSync(packageJsonPath)), "@tsdown/exe") === null) {
		throw new Error(
			`@tsdown/exe is not installed beside crust's tsdown (${packageJsonPath}).\n${reinstall}`,
		);
	}
	const tsdownPackage: JsonValue = JSON.parse(readFileSync(packageJsonPath, "utf8"));
	if (!isTsdownPackageJson(tsdownPackage)) {
		throw new Error(`Unexpected tsdown package metadata in ${packageJsonPath}.\n${reinstall}`);
	}
	const backend = {
		packageJsonPath,
		version: tsdownPackage.version,
		engines: tsdownPackage.engines.node,
	};
	assertNodeExeBackendSupports(compiler, backend);

	const workDir = await mkdtemp(join(tmpdir(), "crust-node-exe-probe-"));
	try {
		const scriptPath = join(workDir, "probe.mjs");
		await writeFile(scriptPath, createNodeExeProbeScript(packageJsonPath));
		const { exitCode, stdout, stderr } = await runProcess(compiler.runner.command, [scriptPath], {
			env: compiler.runner.env,
			cwd,
			stdio: "collect",
		});
		const seaMinVersion = exitCode === 0 ? validVersion(stdout.trim()) : null;
		if (seaMinVersion === null) {
			const output = [stderr.trim(), stdout.trim()].filter(Boolean).join("\n");
			throw new Error(
				`tsdown ${backend.version}'s executable builder could not be loaded with ${compiler.runner.command} (exit ${exitCode}).\n${reinstall}${output ? `\n${output}` : ""}`,
			);
		}
		const resolved = { ...backend, seaMinVersion };
		assertNodeExeBackendSupports(compiler, resolved);
		return resolved;
	} finally {
		await rm(workDir, { recursive: true, force: true });
	}
}

/**
 * Select the Node binary compiler once for a build: the external `node`, its
 * version read in the project directory `cwd`, validated against the
 * project's `engines.node` and then the installed tsdown's requirements.
 * Pass it to {@link execNodeBinaryBuild} for every command and target.
 */
export async function resolveNodeBinaryCompiler(
	userPackageJson: JsonValue | undefined,
	cwd: string,
): Promise<NodeBinaryCompiler> {
	const runner = resolveNodeBuildRunner();
	const compiler = {
		runtime: "node" as const,
		runner,
		version: await readCompilerVersion("node", runner, cwd),
	};
	assertCompilerSatisfiesEngines(compiler, userPackageJson);
	return { ...compiler, backend: await resolveNodeExeBackend(compiler, cwd) };
}

// ────────────────────────────────────────────────────────────────────────────
// Bun bundler plugins (package.json crust.bunPlugins)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Module source the generated driver imports for a `crust.bunPlugins` specifier.
 *
 * Paths become file URLs resolved against the project; bare specifiers are
 * imported as written so they resolve from the project's own node_modules.
 */
export function resolveBunPluginSource(specifier: string, cwd: string): string {
	return specifier.startsWith(".") || isAbsolute(specifier)
		? pathToFileURL(resolve(cwd, specifier)).href
		: specifier;
}

/**
 * Marks every Bun/Node bundle crust produces so `resolveArtifactDir` (core)
 * can tell a staged bundle from source at runtime. Not a `PUBLIC_*` variable:
 * it is internal to crust, never user-set. Deno compile has no define, but
 * standalone Deno binaries are detected directly.
 */
const CRUST_BUILD_DEFINE = { "process.env.CRUST_INTERNAL_BUILD": '"1"' } as const;
// The value keeps its quotes so bun inlines a string literal, not a number.
const CRUST_BUILD_DEFINE_ARG = 'process.env.CRUST_INTERNAL_BUILD="1"';

type BunPluginDriverBuild = {
	entrypoints: [string];
	minify: boolean;
	env: "PUBLIC_*";
} & (
	| { target: "bun"; compile: { target: string; outfile: string; autoloadBunfig: false } }
	| { target: "bun" | "node"; format: "esm" }
);

export type BunPluginDriverOptions = {
	plugins: Array<{ specifier: string; source: string }>;
	build: BunPluginDriverBuild;
	outfile: string;
};

/**
 * Script that runs `Bun.build` with the project's bundler plugins.
 *
 * `bun build` has no plugin flag, so plugins are loaded by a generated script
 * placed in the project root (project module resolution) and run with the
 * same runner as the CLI path. Every value is embedded via JSON.stringify.
 */
export function createBunPluginDriverScript(options: BunPluginDriverOptions): string {
	return `// Generated by crust build for crust.bunPlugins; deleted when the build finishes.
const options = ${JSON.stringify(options)};
const plugins = [];
for (const { specifier, source } of options.plugins) {
	let plugin;
	try {
		plugin = (await import(source)).default;
	} catch (error) {
		// Bun names this (soon deleted) driver as the importer; the project root is the useful location.
		const message = (error instanceof Error ? error.message : String(error)).replace(\` imported from \${import.meta.path}\`, "");
		console.error(\`crust.bunPlugins entry \${specifier} could not be imported from \${process.cwd()}: \${message}\`);
		process.exit(1);
	}
	if (typeof plugin !== "object" || plugin === null || typeof plugin.name !== "string" || typeof plugin.setup !== "function") {
		console.error(\`crust.bunPlugins entry \${specifier} must default-export a Bun bundler plugin ({ name, setup }). Wrap a plugin factory in a module that default-exports the created plugin.\`);
		process.exit(1);
	}
	plugins.push(plugin);
}
const result = await Bun.build({ ...options.build, define: ${JSON.stringify(CRUST_BUILD_DEFINE)}, plugins, throw: false });
if (!result.success) {
	for (const log of result.logs) console.error(log);
	process.exit(1);
}
if (!options.build.compile) {
	if (result.outputs.length !== 1) {
		// Same refusal as \`bun build --outfile\`: a file-type asset import yields entry + asset.
		console.error("error: cannot write multiple output files without an output directory");
		process.exit(1);
	}
	await Bun.write(options.outfile, result.outputs[0]);
}
`;
}

async function runBunPluginDriver(
	build: BunPluginDriverBuild,
	outfilePath: string,
	bunPlugins: readonly string[],
	envFiles: readonly string[],
	cwd: string,
	runner: BuildRunner,
): Promise<void> {
	const driverPath = join(cwd, `.crust-build-${randomBytes(6).toString("hex")}.ts`);
	await writeFile(
		driverPath,
		createBunPluginDriverScript({
			plugins: bunPlugins.map((specifier) => ({
				specifier,
				source: resolveBunPluginSource(specifier, cwd),
			})),
			build,
			outfile: outfilePath,
		}),
	);
	try {
		// The runtime loads env files before the script runs, so `env: "PUBLIC_*"`
		// inlines the same values as the CLI path's --env-file/--env flags.
		await runBuildProcess(runner, [...toBunEnvFileArgs(envFiles), driverPath], outfilePath, cwd);
	} finally {
		await rm(driverPath, { force: true });
	}
}

/**
 * Compile a single entry file to a standalone executable.
 *
 * Uses `bun build --compile` as a subprocess so the standalone compiler runs
 * in Bun's CLI process rather than inside the current Crust runtime.
 * This avoids in-process compiler issues seen on some host/target
 * combinations while still supporting env-file loading natively.
 *
 * @param entryPath - Absolute path to the entry file
 * @param outfilePath - Absolute path to the output binary
 * @param minify - Whether to enable minification
 * @param target - Bun compile target
 * @param envFiles - Optional env files to load during build
 * @param bunPlugins - Bun bundler plugin specifiers; when present the build
 *   runs through the generated `Bun.build` driver instead of `bun build`
 * @param runner - The selected Bun compiler (`resolveBinaryCompiler`)
 * @throws {Error} If the build fails
 */
export async function execBuild(
	entryPath: string,
	outfilePath: string,
	minify: boolean,
	target: BunTarget,
	envFiles: readonly string[],
	cwd: string,
	bunPlugins: readonly string[] = [],
	runner: BuildRunner = resolveBunBuildRunner(),
): Promise<void> {
	const compileTarget = bunCompileTarget(target, runner);
	if (bunPlugins.length > 0) {
		await runBunPluginDriver(
			{
				entrypoints: [entryPath],
				minify,
				env: "PUBLIC_*",
				target: "bun",
				compile: {
					target: compileTarget,
					outfile: outfilePath,
					autoloadBunfig: false,
				},
			},
			outfilePath,
			bunPlugins,
			envFiles,
			cwd,
			runner,
		);
		return;
	}
	const args = createBunCompileArgs(entryPath, outfilePath, minify, compileTarget, envFiles);
	await runBuildProcess(runner, args, outfilePath, cwd);
}

export function createBunCompileArgs(
	entryPath: string,
	outfilePath: string,
	minify: boolean,
	target: string,
	envFiles: readonly string[] = [],
): string[] {
	return [
		"build",
		"--compile",
		// A standalone otherwise runs the bunfig.toml of whatever directory it is
		// started in, so an unresolvable consumer `preload` would kill it before
		// user code. `.env` autoloading is intentionally left on.
		"--no-compile-autoload-bunfig",
		...toBunEnvFileArgs(envFiles),
		"--env=PUBLIC_*",
		"--define",
		CRUST_BUILD_DEFINE_ARG,
		"--outfile",
		outfilePath,
		...(minify ? ["--minify"] : []),
		"--target",
		target,
		entryPath,
	];
}

function createDenoCompileArgs(
	entryPath: string,
	outfilePath: string,
	target: DenoTarget,
): string[] {
	// No --env-file: `deno compile` embeds EVERY variable from the file into the
	// binary (verified empirically on Deno 2.9 — secrets included), with no
	// equivalent of bun's --env=PUBLIC_* filter. The build command rejects
	// --env-file for the deno runtime instead of leaking secrets.
	return [
		"compile",
		// -A: Crust core reads process.env before dispatch, so a sandboxed binary
		// crashes with NotCapable on startup. Full grants also match Bun compile,
		// which has no sandbox. A permission passthrough flag can narrow this later.
		"-A",
		"--output",
		outfilePath,
		"--target",
		target,
		entryPath,
	];
}

async function runBuildProcess(
	runner: BuildRunner,
	args: readonly string[],
	outfilePath: string,
	cwd: string,
): Promise<void> {
	const { exitCode, stdout, stderr } = await runProcess(runner.command, args, {
		env: runner.env,
		cwd,
		stdio: "collect",
	});

	if (exitCode !== 0) {
		const output = [stderr.trim(), stdout.trim()].filter(Boolean).join("\n");
		throw new Error(`Build failed for ${outfilePath}${output ? `:\n${output}` : ""}`);
	}
}

/** Bundle a Node runtime package entry: ESM for Node behind `#!/usr/bin/env node`. */
export async function execNodeBuild(
	entryPath: string,
	outfilePath: string,
	minify: boolean,
	envFiles: readonly string[],
	cwd: string,
	bunPlugins: readonly string[] = [],
	runner: BuildRunner = resolveBunBuildRunner(),
): Promise<void> {
	await execScriptBuild("node", entryPath, outfilePath, minify, envFiles, cwd, bunPlugins, runner);
}

/**
 * Bundle a Bun runtime package entry: Bun-targeted ESM behind
 * `#!/usr/bin/env bun`, so the installed bin launches with Bun rather than Node.
 */
export async function execBunPackageBuild(
	entryPath: string,
	outfilePath: string,
	minify: boolean,
	envFiles: readonly string[],
	cwd: string,
	bunPlugins: readonly string[] = [],
	runner: BuildRunner = resolveBunBuildRunner(),
): Promise<void> {
	await execScriptBuild("bun", entryPath, outfilePath, minify, envFiles, cwd, bunPlugins, runner);
}

async function execScriptBuild(
	target: "bun" | "node",
	entryPath: string,
	outfilePath: string,
	minify: boolean,
	envFiles: readonly string[],
	cwd: string,
	bunPlugins: readonly string[],
	runner: BuildRunner,
): Promise<void> {
	if (bunPlugins.length > 0) {
		await runBunPluginDriver(
			{
				entrypoints: [entryPath],
				minify,
				env: "PUBLIC_*",
				target,
				format: "esm",
			},
			outfilePath,
			bunPlugins,
			envFiles,
			cwd,
			runner,
		);
	} else {
		await runBuildProcess(
			runner,
			[
				"build",
				...toBunEnvFileArgs(envFiles),
				"--env=PUBLIC_*",
				"--define",
				CRUST_BUILD_DEFINE_ARG,
				"--target",
				target,
				"--format",
				"esm",
				"--outfile",
				outfilePath,
				...(minify ? ["--minify"] : []),
				entryPath,
			],
			outfilePath,
			cwd,
		);
	}

	const output = await readFile(outfilePath, "utf8");
	const shebang = `#!/usr/bin/env ${target}\n`;
	await writeFile(outfilePath, shebang + output.replace(/^#![^\n]*(?:\n|$)/, ""));
	if (process.platform !== "win32") await chmod(outfilePath, 0o755);
}

export async function execDenoBuild(
	entryPath: string,
	outfilePath: string,
	target: DenoTarget,
	cwd: string,
	runner: BuildRunner = resolveDenoBuildRunner(),
): Promise<void> {
	await runBuildProcess(
		runner,
		createDenoCompileArgs(entryPath, outfilePath, target),
		outfilePath,
		cwd,
	);
}

/** tsdown's `ExeTarget` (`@tsdown/exe`): Node's release platform and arch, and the exact embedded version. */
export type NodeExeTarget = {
	platform: "linux" | "darwin" | "win";
	arch: "x64" | "arm64";
	nodeVersion: string;
};

/** tsdown's executable target for a Node target, embedding exactly `nodeVersion`. */
export function nodeExeTarget(target: NodeTarget, nodeVersion: string): NodeExeTarget {
	const { os, cpu } = NODE_TARGETS.info[target];
	return { platform: os === "win32" ? "win" : os, arch: cpu, nodeVersion };
}

type NodeExeBuildScriptOptions = {
	tsdownPackageJson: string;
	cwd: string;
	entry: string;
	bundleDir: string;
	exeDir: string;
	minify: boolean;
	envFiles: readonly string[];
	target: NodeExeTarget;
};

/**
 * Script the selected Node runs to build one command for one target with
 * tsdown's programmatic `build`. Every value is embedded via JSON.stringify.
 */
function createNodeExeBuildScript(options: NodeExeBuildScriptOptions): string {
	return `// Generated by crust build for a Node standalone binary; deleted when the build finishes.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { parseEnv } from "node:util";

const options = ${JSON.stringify(options)};
const { build } = await import(pathToFileURL(createRequire(options.tsdownPackageJson).resolve("tsdown")).href);
// The PUBLIC_* constants of \`bun build --env-file ... --env=PUBLIC_*\`: later files override earlier ones, the environment overrides both.
const env = {};
for (const file of options.envFiles) Object.assign(env, parseEnv(readFileSync(file, "utf8")));
Object.assign(env, process.env);
await build({
	config: false,
	cwd: options.cwd,
	entry: { app: options.entry },
	outDir: options.bundleDir,
	format: "esm",
	platform: "node",
	// Bundled CommonJS dependencies still read __dirname/__filename.
	shims: true,
	dts: false,
	minify: options.minify,
	logLevel: "warn",
	report: false,
	define: ${JSON.stringify(CRUST_BUILD_DEFINE)},
	env: Object.fromEntries(Object.entries(env).filter(([name]) => name.startsWith("PUBLIC_"))),
	envPrefix: "PUBLIC_",
	// An executable ships no node_modules: bundle every dependency and fail on
	// any import other than a Node built-in left for the runtime to resolve.
	deps: { alwaysBundle: () => true, onlyBundle: false, onlyImport: [] },
	exe: { outDir: options.exeDir, fileName: "app", targets: [options.target] },
});
`;
}

/**
 * Build a single entry file into a Node standalone executable with tsdown's
 * executable builder (Node SEA), run by the selected external Node and
 * embedding exactly its version for `target`. tsdown takes a single entry per
 * executable, so callers build every command separately. Matching official
 * Node binaries for targets are downloaded, checksum-verified, and cached by
 * @tsdown/exe. Builds for darwin are only code-signed on a macOS host.
 *
 * @param compiler - The selected Node compiler (`resolveNodeBinaryCompiler`)
 * @param onWarning - Receives the backend's warnings (such as a skipped code
 *   signature) after a successful build
 * @throws {Error} If the build fails
 */
export async function execNodeBinaryBuild(
	entryPath: string,
	outfilePath: string,
	minify: boolean,
	target: NodeTarget,
	envFiles: readonly string[],
	cwd: string,
	compiler: NodeBinaryCompiler,
	onWarning: (message: string) => void = () => {},
): Promise<void> {
	const workDir = await mkdtemp(join(tmpdir(), "crust-node-exe-"));
	try {
		const scriptPath = join(workDir, "build.mjs");
		const exeDir = join(workDir, "exe");
		await writeFile(
			scriptPath,
			createNodeExeBuildScript({
				tsdownPackageJson: compiler.backend.packageJsonPath,
				cwd,
				entry: resolve(cwd, entryPath),
				bundleDir: join(workDir, "bundle"),
				exeDir,
				minify,
				envFiles,
				target: nodeExeTarget(target, compiler.version),
			}),
		);
		const { exitCode, stdout, stderr } = await runProcess(compiler.runner.command, [scriptPath], {
			env: compiler.runner.env,
			cwd,
			stdio: "collect",
		});
		const output = [stderr.trim(), stdout.trim()].filter(Boolean).join("\n");
		if (exitCode !== 0) {
			throw new Error(`Build failed for ${outfilePath}${output ? `:\n${output}` : ""}`);
		}
		const produced = await readdir(exeDir);
		if (produced.length !== 1) {
			throw new Error(
				`Build failed for ${outfilePath}: expected one executable from tsdown, found ${JSON.stringify(produced)}.`,
			);
		}
		await copyFile(join(exeDir, produced[0]!), outfilePath);
		if (output) onWarning(output);
	} finally {
		await rm(workDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
	}
}

// Calls @tsdown/exe's `resolveNodeBinary` for each target exactly as tsdown's
// executable builder does (no download options), loading @tsdown/exe from
// tsdown's real location, where tsdown imports it from.
function createNodeExeProvisionScript(
	tsdownPackageJson: string,
	targets: ReadonlyArray<{ name: NodeTarget; target: NodeExeTarget }>,
): string {
	return `// Generated by crust build to provision Node binaries for targets; deleted when it exits.
import { realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const exe = createRequire(realpathSync(${JSON.stringify(tsdownPackageJson)})).resolve("@tsdown/exe");
const { resolveNodeBinary } = await import(pathToFileURL(exe).href);
for (const { name, target } of ${JSON.stringify(targets)}) {
	try {
		await resolveNodeBinary(target, {});
	} catch (error) {
		console.error(name + ": " + error.message + (error.cause?.message ? "\\n" + error.cause.message : ""));
		process.exit(1);
	}
}
`;
}

/**
 * Provisions the Node binary every target embeds before anything is staged,
 * with the selected Node and the call tsdown's executable builder makes per
 * target (@tsdown/exe's `resolveNodeBinary`): an uncached official archive of
 * exactly `compiler.version` is downloaded, checksum-verified, unpacked with
 * the tool that target's archive needs on this host, and cached, where
 * {@link execNodeBinaryBuild} then finds it. A missing unpacking tool, a failed
 * download, or a checksum mismatch therefore fails here, before `.crust/` is
 * replaced; cached targets need nothing.
 *
 * @throws {Error} If a target cannot be provisioned
 */
export async function provisionNodeExeTargets(
	targets: readonly NodeTarget[],
	cwd: string,
	compiler: NodeBinaryCompiler,
): Promise<void> {
	const workDir = await mkdtemp(join(tmpdir(), "crust-node-exe-provision-"));
	try {
		const scriptPath = join(workDir, "provision.mjs");
		await writeFile(
			scriptPath,
			createNodeExeProvisionScript(
				compiler.backend.packageJsonPath,
				targets.map((name) => ({ name, target: nodeExeTarget(name, compiler.version) })),
			),
		);
		const { exitCode, stdout, stderr } = await runProcess(compiler.runner.command, [scriptPath], {
			env: compiler.runner.env,
			cwd,
			stdio: "collect",
		});
		if (exitCode !== 0) {
			const output = [stderr.trim(), stdout.trim()].filter(Boolean).join("\n");
			throw new Error(
				`Could not provision the Node ${compiler.version} binary that node standalone binaries embed${output ? `:\n${output}` : "."}\n` +
					"  tsdown downloads each target's official Node archive once and unpacks it with tar (GNU tar also needs xz for linux targets), or unzip for win targets on non-Windows hosts.\n" +
					"  Install the missing tool, or build only targets this machine can provision (--target).",
			);
		}
	} finally {
		await rm(workDir, { recursive: true, force: true });
	}
}

/**
 * Prepare a CLI entry's Command Snapshot in the user's project context.
 *
 * The entry runs as a subprocess with `CRUST_INTERNAL_SNAPSHOT_PATH` pointing
 * to a temporary file. `.execute()` validates and writes the command graph and
 * adjacent Build Report, then exits before any following entrypoint code can run.
 *
 * Runs with the same bun as compilation (`resolveBunBuildRunner`, or the
 * pinned Bun `runner`): bun on PATH, or a compiled standalone crust executable
 * as `BUN_BE_BUN=1`, so arbitrary `.ts` entries run without a separate `bun`
 * install.
 */
const SNAPSHOT_TIMEOUT_MS = 30_000;

function isBuildReport(value: JsonValue): value is JsonObject & BuildReport {
	return (
		isJsonObject(value) &&
		Array.isArray(value.extensions) &&
		value.extensions.every(
			(extension: JsonValue): extension is JsonObject & BuildReport["extensions"][number] =>
				isJsonObject(extension) &&
				typeof extension.id === "string" &&
				Array.isArray(extension.files) &&
				extension.files.every((file: JsonValue): file is string => typeof file === "string"),
		)
	);
}

export async function buildEntrypoint(
	entryPath: string,
	outDir: string,
	envFiles: readonly string[],
	io: InvocationIO,
	cwd: string,
	runner: BuildRunner = resolveBunBuildRunner(),
): Promise<{ snapshot: CommandSnapshot; build: BuildReport }> {
	const absoluteEntry = resolve(entryPath);
	const snapshotDir = await mkdtemp(join(tmpdir(), "crust-snapshot-"));
	const snapshotPath = join(snapshotDir, "command.json");
	const buildReportPath = join(snapshotDir, "build-report.json");

	try {
		const spawnedAt = Date.now();
		const proc = spawn(runner.command, [...toBunEnvFileArgs(envFiles), absoluteEntry], {
			env: {
				...runner.env,
				[SNAPSHOT_PATH_ENV]: snapshotPath,
				[BUILD_OUT_DIR_ENV]: resolve(outDir),
			},
			cwd,
			stdio: ["ignore", "ignore", "pipe"],
			timeout: SNAPSHOT_TIMEOUT_MS,
		});

		const stderrPromise = text(proc.stderr);
		const [exitCode] = await once(proc, "close");
		const stderr = (await stderrPromise).trim();

		if (proc.signalCode !== null) {
			// ChildProcess does not report whether the kill came from our timeout
			// option, so use elapsed time to tell it apart from external signals.
			if (Date.now() - spawnedAt >= SNAPSHOT_TIMEOUT_MS) {
				throw new Error(
					`Command Snapshot preparation timed out after ${SNAPSHOT_TIMEOUT_MS / 1_000}s.\n  An Extension build hook may be hanging. Use --no-validate to skip entry preparation and build hooks.`,
				);
			}
			throw new Error(
				`Command Snapshot preparation was killed by ${proc.signalCode}.${stderr ? `\n${stderr}` : ""}`,
			);
		}

		if (exitCode !== 0) {
			// stderr contains the raw error message from the snapshot subprocess
			throw new Error(stderr || "Command Snapshot preparation failed");
		}

		if (stderr) {
			// Style Warning: prefixed lines from snapshot preparation
			const styled = stderr
				.split("\n")
				.map((line) =>
					line.startsWith("Warning:")
						? `${yellow("Warning:")}${line.slice("Warning:".length)}`
						: line,
				)
				.join("\n");
			io.stderr(styled);
		}

		let serialized: string;
		try {
			serialized = await readFile(snapshotPath, "utf8");
		} catch (error) {
			if (isErrnoException(error) && error.code === "ENOENT") {
				throw new Error(
					`Entry exited without producing a Command Snapshot.\n  Ensure ${absoluteEntry} calls await app.execute() and uses a compatible @crustjs/core version.`,
					{ cause: error },
				);
			}
			throw error;
		}
		let snapshot: CommandSnapshot;
		try {
			// SAFETY: the paired core snapshot writer serializes a prepared CommandSnapshot to this private path.
			snapshot = JSON.parse(serialized) as CommandSnapshot;
		} catch (error) {
			throw new Error(
				`Entry produced an invalid Command Snapshot.\n  Ensure ${absoluteEntry} uses a compatible @crustjs/core version.`,
				{ cause: error },
			);
		}

		let serializedBuild: string;
		try {
			serializedBuild = await readFile(buildReportPath, "utf8");
		} catch (error) {
			if (isErrnoException(error) && error.code === "ENOENT") {
				throw new Error(
					`Entry produced a Command Snapshot without a Build Report.\n  Ensure ${absoluteEntry} uses a compatible @crustjs/core version.`,
					{ cause: error },
				);
			}
			throw error;
		}
		try {
			// The subprocess uses the application's Core, which may have a different report contract.
			const build: JsonValue = JSON.parse(serializedBuild);
			if (!isBuildReport(build)) {
				throw new Error("Expected extensions with string ids and files arrays.");
			}
			for (const extension of build.extensions) {
				defineExtensionId(extension.id);
				for (const file of extension.files) {
					// Reports use Core's normalized POSIX-relative paths, not arbitrary entry side effects.
					const path = resolve(outDir, file);
					if (
						file === "." ||
						file.includes("\\") ||
						posix.normalize(file) !== file ||
						win32.isAbsolute(file) ||
						/^[A-Za-z]:/.test(file) ||
						!isWithin(resolve(outDir), path) ||
						!isWithin(realpathSync(outDir), realpathSync(path)) ||
						!lstatSync(path).isFile()
					) {
						throw new Error(
							`Reported artifact must be a normalized, contained regular file: ${file}`,
						);
					}
				}
			}
			return { snapshot, build };
		} catch (error) {
			throw new Error(
				`Entry produced an invalid Build Report.\n  Ensure ${absoluteEntry} uses a compatible @crustjs/core version; upgrade Core, @crustjs/crust, and build-hook Extensions together to the pure-return build API.`,
				{ cause: error },
			);
		}
	} finally {
		await rm(snapshotDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
	}
}
