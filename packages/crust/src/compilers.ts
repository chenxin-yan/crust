import { isJsonObject, type JsonObject, type JsonValue } from "@crustjs/utils/json";
import { type RunProcessResult, runProcess, which } from "@crustjs/utils/process";
import satisfies from "semver/functions/satisfies.js";
import validVersion from "semver/functions/valid.js";
import validRange from "semver/ranges/valid.js";

import { BUN_TARGETS, type BuildRuntime, type BunTarget, hostTarget } from "./targets.ts";

export type BuildRunner = {
	command: string;
	env: NodeJS.ProcessEnv;
};

/** A finished compiler process's stderr, then stdout, for error messages. */
export function processOutput({ stdout, stderr }: RunProcessResult): string {
	return [stderr.trim(), stdout.trim()].filter(Boolean).join("\n");
}

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
 * Refuse the host target when the selected `runner` is the `BUN_BE_BUN`
 * fallback and no `-baseline` alias can stand in for it (arm64 hosts).
 */
export function assertTargetsBuildableWithoutBun(
	targets: readonly BunTarget[],
	runner: BuildRunner,
	host = hostTarget(BUN_TARGETS),
): void {
	const externalBun = runner.env.BUN_BE_BUN !== "1";
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
	const result = await runProcess(runner.command, ["--version"], {
		env: runner.env,
		cwd,
		stdio: "collect",
		timeout: COMPILER_VERSION_TIMEOUT_MS,
	});
	const stdout = result.stdout.trim();
	const reported = runtime === "deno" ? /^deno (\S+)/.exec(stdout)?.[1] : stdout;
	const version = result.exitCode === 0 && reported !== undefined ? validVersion(reported) : null;
	if (version === null) {
		const output = processOutput(result);
		throw new Error(
			`Could not read the ${RUNTIME_LABELS[runtime]} version from ${runner.command} --version (exit ${result.exitCode})${output ? `:\n${output}` : "."}`,
		);
	}
	return version;
}

export function isVersionRange(value: JsonValue): value is string {
	return typeof value === "string" && validRange(value) !== null;
}

/**
 * Check the selected compiler against the project's `engines.<runtime>` with
 * npm semver semantics. An absent constraint allows any version; an exact
 * value is a requirement, not a request to install that version.
 */
export function assertCompilerSatisfiesEngines(
	compiler: BuildCompiler,
	userPackageJson: JsonObject,
): void {
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
	userPackageJson: JsonObject,
	cwd: string,
): Promise<BuildCompiler> {
	const runner = runtime === "bun" ? resolveBunBuildRunner() : resolveDenoBuildRunner();
	const compiler = { runtime, runner, version: await readCompilerVersion(runtime, runner, cwd) };
	assertCompilerSatisfiesEngines(compiler, userPackageJson);
	return compiler;
}

// ────────────────────────────────────────────────────────────────────────────
// Deno runtime packages (native `deno bundle`)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Oldest `deno` accepted to bundle a Deno runtime package. Deno 2.4 resolves a
 * package.json project's npm dependencies from the registry instead of its
 * installed node_modules, so it can bundle a different Crust than the project
 * installed. Tested on Linux x64 with Deno 2.5.0 through 2.9.6.
 */
export const DENO_PACKAGE_MIN_VERSION = "2.5.0";

/**
 * Select the external deno that bundles a Deno runtime package, reading its
 * version in the project directory `cwd`. Call it before staging is replaced.
 * A runtime package embeds no Deno, so `engines.deno` stays a consumer
 * requirement and is not checked against this bundler.
 */
export async function resolveDenoPackageBundler(
	cwd: string,
	runner: BuildRunner = resolveDenoBuildRunner(),
): Promise<BuildCompiler> {
	const version = await readCompilerVersion("deno", runner, cwd);
	if (!satisfies(version, `>=${DENO_PACKAGE_MIN_VERSION}`, { includePrerelease: true })) {
		throw new Error(
			`Deno ${version} (${runner.command}) cannot bundle a Deno runtime package; deno ${DENO_PACKAGE_MIN_VERSION} or newer is required.\n` +
				"  Older deno bundle resolves package.json dependencies from the npm registry instead of the installed node_modules.\n" +
				"  crust does not install or upgrade Deno; put a newer deno first on PATH (e.g. with your version manager).",
		);
	}
	return { runtime: "deno", runner, version };
}
