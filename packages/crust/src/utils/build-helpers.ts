import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

import { BUILD_OUT_DIR_ENV, type CommandSnapshot, SNAPSHOT_PATH_ENV } from "@crustjs/core/tooling";
import { yellow } from "@crustjs/style";
import { exitCodeOf, which } from "@crustjs/utils/process";

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

/** Deno cross-compile targets supported by `deno compile`. */
export const DENO_TARGETS = [
	"x86_64-unknown-linux-gnu",
	"aarch64-unknown-linux-gnu",
	"x86_64-apple-darwin",
	"aarch64-apple-darwin",
	"x86_64-pc-windows-msvc",
] as const;

export type DenoTarget = (typeof DENO_TARGETS)[number];
export type CompileTarget = BunTarget | DenoTarget;
export type BuildRuntime = "bun" | "deno";

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

/** Resolver metadata only; alias/platformKey are Bun-target concerns (npm packaging, host detection). */
export const DENO_TARGET_INFO = {
	"x86_64-unknown-linux-gnu": { unameKey: "Linux-x86_64", os: "linux", cpu: "x64" },
	"aarch64-unknown-linux-gnu": { unameKey: "Linux-aarch64", os: "linux", cpu: "arm64" },
	"x86_64-apple-darwin": { unameKey: "Darwin-x86_64", os: "darwin", cpu: "x64" },
	"aarch64-apple-darwin": { unameKey: "Darwin-arm64", os: "darwin", cpu: "arm64" },
	"x86_64-pc-windows-msvc": { unameKey: "Windows-x64", os: "win32", cpu: "x64" },
} as const satisfies Record<DenoTarget, ResolverTargetInfo>;

type ResolverTargetInfo = Pick<TargetInfo, "unameKey" | "os" | "cpu">;

const COMPILE_TARGET_INFO = { ...TARGET_INFO, ...DENO_TARGET_INFO } as const;

export function getTargetInfo(target: CompileTarget): ResolverTargetInfo {
	return COMPILE_TARGET_INFO[target];
}

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
		`Unknown target "${input}".${hint}\n  Valid targets: "bun", "deno", canonical Bun targets (${validTargets}), or Deno compile triples (${DENO_TARGETS.join(", ")})`,
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
export function getBinaryFilename(baseName: string, target: CompileTarget): string {
	const ext = getTargetInfo(target).os === "win32" ? ".exe" : "";
	return `${baseName}-${target}${ext}`;
}

export type ProjectMetadata = {
	name?: string;
	engines: { bun?: string; deno?: string };
	hasDenoMarker: boolean;
	hasBunMarker: boolean;
};

/** Read project metadata once for runtime detection and output naming. */
export function readProjectMetadata(cwd: string): ProjectMetadata {
	let name: string | undefined;
	let engines: ProjectMetadata["engines"] = {};
	const pkgPath = join(cwd, "package.json");
	if (existsSync(pkgPath)) {
		try {
			const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
				name?: unknown;
				engines?: { bun?: unknown; deno?: unknown };
			};
			if (typeof pkg.name === "string") name = pkg.name;
			engines = {
				...(typeof pkg.engines?.bun === "string" ? { bun: pkg.engines.bun } : {}),
				...(typeof pkg.engines?.deno === "string" ? { deno: pkg.engines.deno } : {}),
			};
		} catch {
			// Invalid package metadata does not prevent marker-based detection.
		}
	}

	return {
		name,
		engines,
		hasDenoMarker: ["deno.json", "deno.jsonc", "deno.lock"].some((file) =>
			existsSync(join(cwd, file)),
		),
		hasBunMarker: ["bun.lock", "bun.lockb"].some((file) => existsSync(join(cwd, file))),
	};
}

function hostBunTarget(): BunTarget {
	const target = SUPPORTED_TARGETS.find(
		(candidate) => TARGET_INFO[candidate].platformKey === `${process.platform}-${process.arch}`,
	);
	if (!target) {
		throw new Error(`Bun compilation is unsupported on ${process.platform}-${process.arch}.`);
	}
	return target;
}

export type BuildPlan =
	| { runtime: "bun"; targets: BunTarget[] }
	| { runtime: "deno"; targets: DenoTarget[] };

/** Resolve toolchain and targets with explicit flags > engines > markers > Bun default. */
export function resolveBuildPlan(
	targetFlags: string[] | undefined,
	metadata: Pick<ProjectMetadata, "engines" | "hasDenoMarker" | "hasBunMarker">,
): BuildPlan {
	const flags = targetFlags ?? [];
	const runtimeFlags = flags.filter(
		(flag): flag is BuildRuntime => flag === "bun" || flag === "deno",
	);
	if (new Set(runtimeFlags).size > 1) {
		throw new Error('Cannot combine "--target bun" and "--target deno".');
	}

	const requested = flags.filter((flag) => flag !== "bun" && flag !== "deno");
	const bunTargets = requested.filter((flag) =>
		(SUPPORTED_TARGETS as readonly string[]).includes(flag),
	);
	const denoTargets = requested.filter((flag) =>
		(DENO_TARGETS as readonly string[]).includes(flag),
	);
	const unknown = requested.filter(
		(flag) => !bunTargets.includes(flag) && !denoTargets.includes(flag),
	);
	if (unknown.length > 0) resolveTarget(unknown[0]!);

	const explicitRuntime = runtimeFlags[0];
	const wantsBun = explicitRuntime === "bun" || bunTargets.length > 0;
	const wantsDeno = explicitRuntime === "deno" || denoTargets.length > 0;
	if (wantsBun && wantsDeno) {
		throw new Error("Cannot mix Bun and Deno targets in one build.");
	}

	if (wantsBun) {
		return {
			runtime: "bun",
			targets: (bunTargets.length > 0 ? bunTargets : [hostBunTarget()]) as BunTarget[],
		};
	}
	if (wantsDeno) {
		return { runtime: "deno", targets: denoTargets as DenoTarget[] };
	}

	const runtime: BuildRuntime = metadata.engines.deno
		? "deno"
		: metadata.engines.bun
			? "bun"
			: metadata.hasDenoMarker
				? "deno"
				: "bun";
	return runtime === "deno"
		? { runtime, targets: [] }
		: { runtime, targets: [...SUPPORTED_TARGETS] };
}

/** Resolve the base binary name from an explicit name, package name, or entry filename. */
export function resolveBaseName(
	name: string | undefined,
	entry: string,
	cwd: string,
	metadata: ProjectMetadata = readProjectMetadata(cwd),
): string {
	if (name) return name;
	if (metadata.name) return metadata.name.replace(/^@[^/]+\//, "");
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
export function resolveBunBuildRunner(path: string | undefined = process.env.PATH): BunBuildRunner {
	const bunPath = which("bun", path);
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

	const proc = spawn(args[0]!, args.slice(1), {
		env: runner.env as NodeJS.ProcessEnv,
		cwd: process.cwd(),
		stdio: ["ignore", "pipe", "pipe"],
	});

	const [stdout, stderr, exitCode] = await Promise.all([
		readStream(proc.stdout),
		readStream(proc.stderr),
		exitCodeOf(proc),
	]);

	if (exitCode !== 0) {
		const output = [stderr.trim(), stdout.trim()].filter(Boolean).join("\n");
		throw new Error(`Build failed for ${outfilePath}${output ? `:\n${output}` : ""}`);
	}
}

/** Compile a standalone executable with Deno's native compiler. */
export async function execDenoBuild(
	entryPath: string,
	outfilePath: string,
	target?: DenoTarget,
	envFiles: readonly string[] = [],
	path: string | undefined = process.env.PATH,
): Promise<void> {
	const denoPath = which("deno", path);
	if (!denoPath) {
		throw new Error(
			'Deno was selected for this build but "deno" was not found on PATH. Install Deno from https://deno.com/runtime or select --target bun.',
		);
	}

	await mkdir(dirname(outfilePath), { recursive: true });
	// -A: Crust core reads process.env before dispatch, so a sandboxed binary
	// crashes with NotCapable on startup. Full grants also match Bun compile,
	// which has no sandbox. A permission passthrough flag can narrow this later.
	const args = [
		"compile",
		"-A",
		"--output",
		outfilePath,
		...envFiles.map((envFile) => `--env-file=${envFile}`),
		...(target ? ["--target", target] : []),
		entryPath,
	];
	const proc = spawn(denoPath, args, {
		cwd: process.cwd(),
		stdio: ["ignore", "pipe", "pipe"],
	});
	const [stdout, stderr, exitCode] = await Promise.all([
		readStream(proc.stdout),
		readStream(proc.stderr),
		exitCodeOf(proc),
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
		const proc = spawn(process.execPath, [...toBunEnvFileArgs(envFiles), absoluteEntry], {
			env: {
				...process.env,
				[SNAPSHOT_PATH_ENV]: snapshotPath,
				[BUILD_OUT_DIR_ENV]: resolve(outDir),
				BUN_BE_BUN: "1",
			},
			cwd: process.cwd(),
			stdio: ["ignore", "ignore", "pipe"],
			timeout: SNAPSHOT_TIMEOUT_MS,
		});

		const stderrPromise = readStream(proc.stderr);
		const exitCode = await exitCodeOf(proc);
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

function readStream(stream: NodeJS.ReadableStream): Promise<string> {
	return new Promise((complete, reject) => {
		let output = "";
		stream.setEncoding("utf8");
		stream.on("data", (chunk) => (output += chunk));
		stream.once("end", () => complete(output));
		stream.once("error", reject);
	});
}
