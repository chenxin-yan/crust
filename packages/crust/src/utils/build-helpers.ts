import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

import { BUILD_OUT_DIR_ENV, type CommandSnapshot, SNAPSHOT_PATH_ENV } from "@crustjs/core/tooling";
import { yellow } from "@crustjs/style";

// ────────────────────────────────────────────────────────────────────────────
// Supported Bun compile targets
// ────────────────────────────────────────────────────────────────────────────

/**
 * All Bun compile targets supported by `crust build`.
 *
 * Uses baseline x64 variants for maximum CPU compatibility (Nehalem 2008+).
 * ARM64 targets have no baseline/modern distinction.
 */
export const SUPPORTED_TARGETS = [
	"bun-linux-x64-baseline",
	"bun-linux-arm64",
	"bun-darwin-x64",
	"bun-darwin-arm64",
	"bun-windows-x64-baseline",
	"bun-windows-arm64",
] as const;

export type BunTarget = (typeof SUPPORTED_TARGETS)[number];

/**
 * Consolidated metadata for every supported Bun compile target.
 *
 * Single source of truth for target metadata.
 */
export type TargetInfo = {
	/** Human-friendly alias (e.g. "linux-x64", "darwin-arm64") */
	alias: string;
	/** `process.platform`-`process.arch` key (e.g. "linux-x64", "win32-arm64") */
	platformKey: string;
	/** `uname -s`-`uname -m` key used by shell resolvers (e.g. "Linux-x86_64") */
	unameKey: string;
	/** npm `os` field value */
	os: "linux" | "darwin" | "win32";
	/** npm `cpu` field value */
	cpu: "x64" | "arm64";
};

export const TARGET_INFO = {
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
} as const satisfies Record<BunTarget, TargetInfo>;

/**
 * Resolve a canonical Bun target string to a supported compile target.
 *
 * @param input - User-provided canonical Bun target string
 * @returns The resolved Bun compile target
 * @throws {Error} If the target is not recognized
 */
export function resolveTarget(input: string): BunTarget {
	if ((SUPPORTED_TARGETS as readonly string[]).includes(input)) {
		return input as BunTarget;
	}

	const canonical = SUPPORTED_TARGETS.find((target) => TARGET_INFO[target].alias === input);
	const hint = canonical ? ` Did you mean "${canonical}"?` : "";
	const validTargets = SUPPORTED_TARGETS.join(", ");
	throw new Error(
		`Unknown target "${input}". Targets must use canonical Bun names.${hint}\n  Valid targets: ${validTargets}`,
	);
}

/**
 * Resolve the list of Bun targets from flags.
 *
 * When no `--target` is provided, defaults to all supported targets.
 * When `--target` is provided, builds only the specified target(s).
 *
 * @param targetFlags - Values from repeatable --target flag
 * @returns Array of resolved BunTarget values
 */
export function resolveTargets(targetFlags: string[] | undefined): BunTarget[] {
	// No --target flags: build all platforms (default)
	if (!targetFlags || targetFlags.length === 0) {
		return [...SUPPORTED_TARGETS];
	}

	return targetFlags.map(resolveTarget);
}

/**
 * Get the binary filename (basename only) for a given target.
 *
 * @param baseName - The base binary name
 * @param target - The Bun compile target
 * @returns The filename (e.g. "my-cli-bun-darwin-arm64" or "my-cli-bun-windows-x64-baseline.exe")
 */
export function getBinaryFilename(baseName: string, target: BunTarget): string {
	const isWindows = target.startsWith("bun-windows");
	const ext = isWindows ? ".exe" : "";
	return `${baseName}-${target}${ext}`;
}

/** Resolve the base binary name from an explicit name, package name, or entry filename. */
export function resolveBaseName(name: string | undefined, entry: string, cwd: string): string {
	if (name) return name;

	const pkgPath = join(cwd, "package.json");
	if (existsSync(pkgPath)) {
		try {
			const pkgJson = JSON.parse(readFileSync(pkgPath, "utf-8")) as { name?: string };
			if (typeof pkgJson.name === "string") return pkgJson.name.replace(/^@[^/]+\//, "");
		} catch {
			// Ignore parse errors, fall through to entry filename
		}
	}

	return basename(entry).replace(/\.[^.]+$/, "");
}

function toBunEnvFileArgs(envFiles: readonly string[]): string[] {
	return envFiles.flatMap((envFile) => ["--env-file", envFile]);
}

export type BunBuildRunner = {
	command: string;
	env: Record<string, string | undefined>;
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
export function resolveBunBuildRunner(): BunBuildRunner {
	const bunPath = Bun.which("bun");
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
	target?: BunTarget,
	envFiles: readonly string[] = [],
): Promise<void> {
	const runner = resolveBunBuildRunner();
	const args = [
		runner.command,
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

	const proc = Bun.spawn(args, {
		env: runner.env,
		cwd: process.cwd(),
		stdout: "pipe",
		stderr: "pipe",
	});

	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);

	if (exitCode !== 0) {
		const output = [stderr.trim(), stdout.trim()].filter(Boolean).join("\n");
		throw new Error(`Build failed for ${outfilePath}${output ? `:\n${output}` : ""}`);
	}
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
	envFiles: readonly string[] = [],
): Promise<CommandSnapshot> {
	const absoluteEntry = resolve(entryPath);
	const snapshotDir = await mkdtemp(join(tmpdir(), "crust-snapshot-"));
	const snapshotPath = join(snapshotDir, "command.json");

	try {
		const spawnedAt = Date.now();
		const proc = Bun.spawn([process.execPath, ...toBunEnvFileArgs(envFiles), absoluteEntry], {
			env: {
				...process.env,
				[SNAPSHOT_PATH_ENV]: snapshotPath,
				[BUILD_OUT_DIR_ENV]: resolve(outDir),
				BUN_BE_BUN: "1",
			},
			cwd: process.cwd(),
			stdout: "ignore",
			stderr: "pipe",
			timeout: SNAPSHOT_TIMEOUT_MS,
		});

		const stderrPromise = new Response(proc.stderr).text();
		const exitCode = await proc.exited;
		const stderr = (await stderrPromise).trim();

		if (proc.signalCode !== null) {
			// Bun's async Subprocess does not expose exitedDueToTimeout, so use
			// elapsed time to tell our timeout kill apart from external signals.
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
			process.stderr.write(`${styled}\n`);
		}

		let serialized: string;
		try {
			serialized = await readFile(snapshotPath, "utf8");
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") {
				throw new Error(
					`Entry exited without producing a Command Snapshot.\n  Ensure ${absoluteEntry} calls await app.execute() and uses a compatible @crustjs/core version.`,
					{ cause: error },
				);
			}
			throw error;
		}
		try {
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
