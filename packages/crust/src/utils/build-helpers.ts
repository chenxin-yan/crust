import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, readFileSync } from "node:fs";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { text } from "node:stream/consumers";

import type { InvocationIO } from "@crustjs/core";
import { BUILD_OUT_DIR_ENV, type CommandSnapshot, SNAPSHOT_PATH_ENV } from "@crustjs/core/tooling";
import { yellow } from "@crustjs/style";
import { isErrnoException } from "@crustjs/utils/error";
import { isJsonObject, type JsonValue } from "@crustjs/utils/json";
import { runProcess, which } from "@crustjs/utils/process";

// ────────────────────────────────────────────────────────────────────────────
// Build runtimes and compile targets
// ────────────────────────────────────────────────────────────────────────────

export const BUILD_RUNTIMES = ["bun", "deno", "node"] as const;
export type BuildRuntime = (typeof BUILD_RUNTIMES)[number];

export type TargetInfo = {
	alias: string;
	platformKey: string;
	unameKey: string;
	os: "linux" | "darwin" | "win32";
	cpu: "x64" | "arm64";
};

export type TargetTable<T extends string> = {
	runtime: "Bun" | "Deno";
	targets: readonly T[];
	info: Record<T, TargetInfo>;
};

const BUN_TARGET_NAMES = [
	"bun-linux-x64-baseline",
	"bun-linux-arm64",
	"bun-darwin-x64",
	"bun-darwin-arm64",
	"bun-windows-x64-baseline",
	"bun-windows-arm64",
] as const;

export type BunTarget = (typeof BUN_TARGET_NAMES)[number];

export const BUN_TARGETS = {
	runtime: "Bun",
	targets: BUN_TARGET_NAMES,
	info: {
		"bun-linux-x64-baseline": {
			alias: "linux-x64",
			platformKey: "linux-x64",
			unameKey: "Linux-x86_64",
			os: "linux",
			cpu: "x64",
		},
		"bun-linux-arm64": {
			alias: "linux-arm64",
			platformKey: "linux-arm64",
			unameKey: "Linux-aarch64",
			os: "linux",
			cpu: "arm64",
		},
		"bun-darwin-x64": {
			alias: "darwin-x64",
			platformKey: "darwin-x64",
			unameKey: "Darwin-x86_64",
			os: "darwin",
			cpu: "x64",
		},
		"bun-darwin-arm64": {
			alias: "darwin-arm64",
			platformKey: "darwin-arm64",
			unameKey: "Darwin-arm64",
			os: "darwin",
			cpu: "arm64",
		},
		"bun-windows-x64-baseline": {
			alias: "windows-x64",
			platformKey: "win32-x64",
			unameKey: "Windows-x64",
			os: "win32",
			cpu: "x64",
		},
		"bun-windows-arm64": {
			alias: "windows-arm64",
			platformKey: "win32-arm64",
			unameKey: "Windows-arm64",
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
			unameKey: "Linux-x86_64",
			os: "linux",
			cpu: "x64",
		},
		"aarch64-unknown-linux-gnu": {
			alias: "linux-arm64",
			platformKey: "linux-arm64",
			unameKey: "Linux-aarch64",
			os: "linux",
			cpu: "arm64",
		},
		"x86_64-apple-darwin": {
			alias: "darwin-x64",
			platformKey: "darwin-x64",
			unameKey: "Darwin-x86_64",
			os: "darwin",
			cpu: "x64",
		},
		"aarch64-apple-darwin": {
			alias: "darwin-arm64",
			platformKey: "darwin-arm64",
			unameKey: "Darwin-arm64",
			os: "darwin",
			cpu: "arm64",
		},
		"x86_64-pc-windows-msvc": {
			alias: "windows-x64",
			platformKey: "win32-x64",
			unameKey: "Windows-x64",
			os: "win32",
			cpu: "x64",
		},
		"aarch64-pc-windows-msvc": {
			alias: "windows-arm64",
			platformKey: "win32-arm64",
			unameKey: "Windows-arm64",
			os: "win32",
			cpu: "arm64",
		},
	},
} as const satisfies TargetTable<DenoTarget>;

export function resolveTargets<T extends string>(
	table: TargetTable<T>,
	targetFlags: string[] | undefined,
): T[] {
	if (!targetFlags?.length) return [...table.targets];

	return targetFlags.map((input) => {
		const exact = table.targets.find((target) => target === input);
		if (exact) return exact;

		const canonical = table.targets.find((target) => table.info[target].alias === input);
		const hint = canonical ? ` Did you mean "${canonical}"?` : "";
		const runtime = table.runtime === "Bun" ? "" : `${table.runtime} `;
		throw new Error(
			`Unknown ${runtime}target "${input}". Targets must use canonical ${table.runtime} names.${hint}\n  Valid targets: ${table.targets.join(", ")}`,
		);
	});
}

export function binaryFilename<T extends string>(
	table: TargetTable<T>,
	baseName: string,
	target: T,
): string {
	return `${baseName}-${target}${table.info[target].os === "win32" ? ".exe" : ""}`;
}

export function hostTarget<T extends string>(table: TargetTable<T>): T | null {
	const platformKey = `${process.platform}-${process.arch}`;
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

function hasStringName(value: JsonValue | undefined): value is { name: string } {
	return value !== undefined && isJsonObject(value) && typeof value.name === "string";
}

/** Resolve the base binary name from an explicit name, package name, or entry filename. */
export function resolveBaseName(
	name: string | undefined,
	entry: string,
	cwd: string,
	packageJson: JsonValue | undefined,
): string {
	if (name) return name;

	if (hasStringName(packageJson)) return packageJson.name.replace(/^@[^/]+\//, "");

	return basename(entry).replace(/\.[^.]+$/, "");
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
function resolveBunBuildRunner(): BuildRunner {
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
 * @param target - Optional Bun compile target for cross-compilation
 * @param envFiles - Optional env files to load during build
 * @throws {Error} If the build fails
 */
export async function execBuild(
	entryPath: string,
	outfilePath: string,
	minify: boolean,
	target: BunTarget | undefined,
	envFiles: readonly string[],
	cwd: string,
): Promise<void> {
	const runner = resolveBunBuildRunner();
	const args = createBunCompileArgs(entryPath, outfilePath, minify, target, envFiles);
	await runBuildProcess(runner, args, outfilePath, cwd);
}

function createBunCompileArgs(
	entryPath: string,
	outfilePath: string,
	minify: boolean,
	target?: BunTarget,
	envFiles: readonly string[] = [],
): string[] {
	return [
		"build",
		"--compile",
		...toBunEnvFileArgs(envFiles),
		"--env=PUBLIC_*",
		"--outfile",
		outfilePath,
		...(minify ? ["--minify"] : []),
		...(target ? ["--target", target] : []),
		entryPath,
	];
}

function createNodeBuildArgs(
	entryPath: string,
	outfilePath: string,
	minify: boolean,
	envFiles: readonly string[] = [],
): string[] {
	return [
		"build",
		...toBunEnvFileArgs(envFiles),
		"--env=PUBLIC_*",
		"--target",
		"node",
		"--format",
		"esm",
		"--outfile",
		outfilePath,
		...(minify ? ["--minify"] : []),
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
): Promise<void> {
	const runner = resolveBunBuildRunner();
	await runBuildProcess(
		runner,
		createNodeBuildArgs(entryPath, outfilePath, minify, envFiles),
		outfilePath,
		cwd,
	);

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
			"Deno is required for --runtime deno but was not found on PATH.\n  Install Deno from https://deno.com/ and try again.",
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
 * to a temporary file. `.execute()` validates and writes the command graph,
 * then exits before any following entrypoint code can run.
 *
 * Uses `process.execPath` (the current binary) with `BUN_BE_BUN=1` so
 * compiled standalone executables can run arbitrary `.ts` files without a
 * separate `bun` install on PATH.
 */
const SNAPSHOT_TIMEOUT_MS = 30_000;

export async function buildEntrypoint(
	entryPath: string,
	outDir: string,
	envFiles: readonly string[],
	io: InvocationIO,
	cwd: string,
): Promise<CommandSnapshot> {
	const absoluteEntry = resolve(entryPath);
	const snapshotDir = await mkdtemp(join(tmpdir(), "crust-snapshot-"));
	const snapshotPath = join(snapshotDir, "command.json");

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
		try {
			// SAFETY: the paired core snapshot writer serializes a prepared CommandSnapshot to this private path.
			return JSON.parse(serialized) as CommandSnapshot;
		} catch (error) {
			throw new Error(
				`Entry produced an invalid Command Snapshot.\n  Ensure ${absoluteEntry} uses a compatible @crustjs/core version.`,
				{ cause: error },
			);
		}
	} finally {
		await rm(snapshotDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
	}
}
