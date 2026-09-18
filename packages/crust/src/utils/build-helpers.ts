import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { existsSync, readFileSync } from "node:fs";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { text } from "node:stream/consumers";
import { pathToFileURL } from "node:url";

import type { BuildReport, InvocationIO } from "@crustjs/core";
import { type CommandSnapshot, SNAPSHOT_PATH_ENV } from "@crustjs/core/tooling";
import { yellow } from "@crustjs/style";
import { BUILD_OUT_DIR_ENV } from "@crustjs/utils/artifacts";
import { isErrnoException } from "@crustjs/utils/error";
import { isJsonObject, type JsonObject, type JsonValue } from "@crustjs/utils/json";
import { runProcess, which } from "@crustjs/utils/process";

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
	runtime: "Bun" | "Deno";
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

/** `--target` value that stands for this machine's canonical target. */
export const HOST_TARGET = "host";

/**
 * Canonical targets for `--target` inputs, deduplicated in input order. No
 * inputs means every target of the table; `host` means this machine's target.
 */
export function resolveTargets<T extends string>(
	table: TargetTable<T>,
	targetFlags: string[] | undefined,
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
 * binaries still work in environments without a separate Bun install.
 */
export function resolveBunBuildRunner(): BuildRunner {
	const bunPath = which("bun");
	if (bunPath) {
		return {
			command: bunPath,
			env: { ...process.env },
		};
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
 */
export function assertTargetsBuildableWithoutBun(
	targets: readonly BunTarget[],
	host = hostTarget(BUN_TARGETS),
): void {
	if (
		host === null ||
		!targets.includes(host) ||
		bunBaselineAlias(host) !== null ||
		which("bun") !== null
	) {
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
	| { target: "node"; format: "esm" }
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
if (options.build.target === "node") {
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
		await runBuildProcess(
			resolveBunBuildRunner(),
			[...toBunEnvFileArgs(envFiles), driverPath],
			outfilePath,
			cwd,
		);
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
): Promise<void> {
	const runner = resolveBunBuildRunner();
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

export async function execNodeBuild(
	entryPath: string,
	outfilePath: string,
	minify: boolean,
	envFiles: readonly string[],
	cwd: string,
	bunPlugins: readonly string[] = [],
): Promise<void> {
	if (bunPlugins.length > 0) {
		await runBunPluginDriver(
			{
				entrypoints: [entryPath],
				minify,
				env: "PUBLIC_*",
				target: "node",
				format: "esm",
			},
			outfilePath,
			bunPlugins,
			envFiles,
			cwd,
		);
	} else {
		await runBuildProcess(
			resolveBunBuildRunner(),
			[
				"build",
				...toBunEnvFileArgs(envFiles),
				"--env=PUBLIC_*",
				"--define",
				CRUST_BUILD_DEFINE_ARG,
				"--target",
				"node",
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
	const shebang = "#!/usr/bin/env node\n";
	await writeFile(outfilePath, shebang + output.replace(/^#![^\n]*(?:\n|$)/, ""));
	if (process.platform !== "win32") await chmod(outfilePath, 0o755);
}

export async function execDenoBuild(
	entryPath: string,
	outfilePath: string,
	target: DenoTarget,
	cwd: string,
): Promise<void> {
	const denoPath = which("deno");
	if (!denoPath) {
		throw new Error(
			"Deno is required for the deno runtime but was not found on PATH.\n  Install Deno from https://deno.com/ and try again.",
		);
	}
	await runBuildProcess(
		{ command: denoPath, env: { ...process.env } },
		createDenoCompileArgs(entryPath, outfilePath, target),
		outfilePath,
		cwd,
	);
}

/**
 * Prepare a CLI entry's Command Snapshot in the user's project context.
 *
 * The entry runs as a subprocess with `CRUST_INTERNAL_SNAPSHOT_PATH` pointing
 * to a temporary file. `.execute()` validates and writes the command graph and
 * adjacent Build Report, then exits before any following entrypoint code can run.
 *
 * Uses `process.execPath` (the current binary) with `BUN_BE_BUN=1` so
 * compiled standalone executables can run arbitrary `.ts` files without a
 * separate `bun` install on PATH.
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
): Promise<{ snapshot: CommandSnapshot; build: BuildReport }> {
	const absoluteEntry = resolve(entryPath);
	const snapshotDir = await mkdtemp(join(tmpdir(), "crust-snapshot-"));
	const snapshotPath = join(snapshotDir, "command.json");
	const buildReportPath = join(snapshotDir, "build-report.json");

	try {
		const spawnedAt = Date.now();
		const proc = spawn(process.execPath, [...toBunEnvFileArgs(envFiles), absoluteEntry], {
			env: {
				...process.env,
				[SNAPSHOT_PATH_ENV]: snapshotPath,
				[BUILD_OUT_DIR_ENV]: resolve(outDir),
				BUN_BE_BUN: "1",
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
