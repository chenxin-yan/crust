import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { Crust, VALIDATION_MODE_ENV } from "@crustjs/core";
import { bold, cyan, dim, green, yellow } from "@crustjs/style";

const PUBLIC_ENV_PREFIX = "PUBLIC_";
const PUBLIC_ENV_PATTERN = `${PUBLIC_ENV_PREFIX}*` as const;

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
 * Single source of truth — all other target maps (`TARGET_ALIASES`,
 * `TARGET_PLATFORM_MAP`, `TARGET_UNAME_MAP`) are derived from this.
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
 * Human-friendly target aliases that map to Bun compile targets.
 *
 * Users can pass either the full Bun target string or these short aliases.
 *
 * @example
 * ```sh
 * crust build --target linux-x64    # same as --target bun-linux-x64-baseline
 * crust build --target darwin-arm64 # same as --target bun-darwin-arm64
 * ```
 */
export const TARGET_ALIASES: Record<string, BunTarget> = Object.fromEntries(
	SUPPORTED_TARGETS.map((t) => [TARGET_INFO[t].alias, t]),
) as Record<string, BunTarget>;

/**
 * Maps each Bun compile target to its `process.platform-process.arch` key
 * used by the JS resolver at runtime.
 */
export const TARGET_PLATFORM_MAP: Record<BunTarget, string> =
	Object.fromEntries(
		SUPPORTED_TARGETS.map((t) => [t, TARGET_INFO[t].platformKey]),
	) as Record<BunTarget, string>;

/**
 * Resolve a user-provided target string to a valid Bun compile target.
 *
 * Accepts both full Bun target names and short aliases.
 *
 * @param input - User-provided target string (e.g. "linux-x64" or "bun-linux-x64-baseline")
 * @returns The resolved Bun compile target
 * @throws {Error} If the target is not recognized
 */
export function resolveTarget(input: string): BunTarget {
	// Direct match against supported targets
	if ((SUPPORTED_TARGETS as readonly string[]).includes(input)) {
		return input as BunTarget;
	}

	// Try alias lookup
	const aliased = TARGET_ALIASES[input];
	if (aliased) {
		return aliased;
	}

	const validTargets = [
		...Object.keys(TARGET_ALIASES),
		...SUPPORTED_TARGETS,
	].join(", ");
	throw new Error(
		`Unknown target "${input}"\n  Valid targets: ${validTargets}`,
	);
}

/**
 * Resolve the base binary name (without target suffix).
 *
 * Priority: --name > package.json name > entry filename
 *
 * @param name - Explicit name from --name flag
 * @param entry - Resolved entry file path
 * @param cwd - Current working directory
 * @returns The resolved base binary name
 */
export function resolveBaseName(
	name: string | undefined,
	entry: string,
	cwd: string,
): string {
	// 1. Explicit --name takes highest priority
	if (name) {
		return name;
	}

	// 2. Try reading name from package.json in cwd
	const pkgPath = join(cwd, "package.json");
	if (existsSync(pkgPath)) {
		try {
			const pkgJson = JSON.parse(readFileSync(pkgPath, "utf-8")) as {
				name?: string;
			};
			if (pkgJson?.name && typeof pkgJson.name === "string") {
				// Strip scope prefix (e.g. @scope/name → name)
				return pkgJson.name.replace(/^@[^/]+\//, "");
			}
		} catch {
			// Ignore parse errors, fall through to entry filename
		}
	}

	// 3. Derive from entry filename (strip extension)
	return basename(entry).replace(/\.[^.]+$/, "");
}

/**
 * Resolve the output file path for a single-target build.
 *
 * Priority: --outfile > --name (as ./<outdir>/<name>) > package.json name > entry filename
 *
 * @param outfile - Explicit output file path from --outfile flag
 * @param name - Binary name from --name flag
 * @param entry - Resolved entry file path
 * @param cwd - Current working directory
 * @param outdir - Output directory
 * @returns The resolved output file path
 */
export function resolveOutfile(
	outfile: string | undefined,
	name: string | undefined,
	entry: string,
	cwd: string,
	outdir: string,
): string {
	// Explicit --outfile takes highest priority
	if (outfile) {
		return resolve(cwd, outfile);
	}

	const baseName = resolveBaseName(name, entry, cwd);
	return resolve(cwd, outdir, baseName);
}

/**
 * Resolve the output file path for a multi-target build.
 *
 * Produces `<outdir>/<name>-<target>` (e.g. `dist/my-cli-bun-linux-x64-baseline`).
 * Windows targets automatically get a `.exe` extension.
 *
 * @param baseName - The resolved base binary name
 * @param target - The Bun compile target
 * @param cwd - Current working directory
 * @param outdir - Output directory
 * @returns The resolved output file path with target suffix
 */
export function resolveTargetOutfile(
	baseName: string,
	target: BunTarget,
	cwd: string,
	outdir: string,
): string {
	const isWindows = target.startsWith("bun-windows");
	const ext = isWindows ? ".exe" : "";
	return resolve(cwd, outdir, `${baseName}-${target}${ext}`);
}

// ────────────────────────────────────────────────────────────────────────────
// Shell resolver generator (Unix + Windows)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Maps each Bun compile target to its `uname -s`/`uname -m` key
 * used by the shell resolver at runtime.
 *
 * Note: Linux ARM64 reports as `aarch64` via `uname -m`,
 * while macOS ARM64 reports as `arm64`.
 */
export const TARGET_UNAME_MAP: Record<BunTarget, string> = Object.fromEntries(
	SUPPORTED_TARGETS.map((t) => [t, TARGET_INFO[t].unameKey]),
) as Record<BunTarget, string>;

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

/**
 * Generate the shell resolver script content (Unix).
 *
 * The resolver detects the platform via `uname -s` and `uname -m`,
 * maps to the correct prebuilt binary, ensures execute permissions,
 * and execs it with all arguments forwarded.
 *
 * @param baseName - The base binary name
 * @param targets - The list of targets that were built
 * @returns The shell resolver script as a string
 */
export function generateResolver(
	baseName: string,
	targets: readonly BunTarget[],
): string {
	// Build case entries for only the targets that were built (excluding Windows)
	const caseEntries: string[] = [];
	for (const target of targets) {
		if (target.startsWith("bun-windows")) continue;
		const unameKey = TARGET_UNAME_MAP[target];
		const filename = getBinaryFilename(baseName, target);
		caseEntries.push(`\t${unameKey}) bin="${filename}" ;;`);
	}
	const caseBody = caseEntries.join("\n");

	return `#!/usr/bin/env bash
# Auto-generated by crust build — do not edit
set -e

source="$0"
while [ -L "$source" ]; do
\tlink_dir="$(cd "$(dirname "$source")" && pwd)"
\tsource="$(readlink "$source")"
\t# Resolve relative symlinks
\t[[ "$source" != /* ]] && source="$link_dir/$source"
done
dir="$(cd "$(dirname "$source")" && pwd)"
platform="$(uname -s)-$(uname -m)"

case "$platform" in
${caseBody}
\t*)
\t\techo "[${baseName}] Unsupported platform: $platform" >&2
\t\techo "[${baseName}] Please open an issue with your OS/CPU details." >&2
\t\texit 1
\t\t;;
esac

bin_path="$dir/$bin"

if [ ! -f "$bin_path" ]; then
\techo "[${baseName}] Prebuilt binary not found: $bin_path" >&2
\techo "[${baseName}] Expected binary for $platform: $bin" >&2
\techo "[${baseName}] Try reinstalling the package." >&2
\texit 1
fi

# Ensure the binary is executable
if [ ! -x "$bin_path" ]; then
\tchmod +x "$bin_path" 2>/dev/null || true
fi

exec "$bin_path" "$@"
`;
}

/**
 * Generate the Windows batch resolver script content (.cmd).
 *
 * The resolver checks `%PROCESSOR_ARCHITECTURE%` and dispatches
 * to the correct prebuilt `.exe` binary.
 *
 * @param baseName - The base binary name
 * @param targets - The list of targets that were built
 * @returns The .cmd resolver script as a string
 */
export function generateCmdResolver(
	baseName: string,
	targets: readonly BunTarget[],
): string {
	const windowsTargets = targets.filter((t) => t.startsWith("bun-windows"));

	// If no Windows targets were built, generate a stub that tells the user
	if (windowsTargets.length === 0) {
		return `@echo off\r\necho [${baseName}] No Windows binary was built for this package. >&2\r\nexit /b 1\r\n`;
	}

	const windowsX64Target = windowsTargets.find(
		(t): t is BunTarget => t === "bun-windows-x64-baseline",
	);
	const windowsArm64Target = windowsTargets.find(
		(t): t is BunTarget => t === "bun-windows-arm64",
	);

	const x64Filename = windowsX64Target
		? getBinaryFilename(baseName, windowsX64Target)
		: "";
	const arm64Filename = windowsArm64Target
		? getBinaryFilename(baseName, windowsArm64Target)
		: "";

	// Build architecture dispatch lines.
	// CMD expands %var% at parse-time, so we cannot test a variable
	// that was set inside the same parenthesized block. Instead we
	// resolve the correct binary for each architecture at generation
	// time and emit flat, independent `if` statements.
	const archLines: string[] = [];

	if (arm64Filename) {
		archLines.push(`if /I "%host_arch%"=="ARM64" set "bin=${arm64Filename}"`);
	} else if (x64Filename) {
		// No native ARM64 binary — fall back to x64 under emulation
		archLines.push(`if /I "%host_arch%"=="ARM64" set "bin=${x64Filename}"`);
	}

	if (x64Filename) {
		archLines.push(`if /I "%host_arch%"=="AMD64" set "bin=${x64Filename}"`);
	}

	const archDispatch = archLines.join("\r\n");

	return `@echo off\r
rem Auto-generated by crust build -- do not edit\r
setlocal\r
set "dir=%~dp0"\r
set "bin="\r
set "host_arch=%PROCESSOR_ARCHITECTURE%"\r
\r
if /I "%PROCESSOR_ARCHITEW6432%"=="ARM64" set "host_arch=ARM64"\r
\r
${archDispatch}\r
\r
if "%bin%"=="" (\r
\techo [${baseName}] Unsupported Windows architecture: %host_arch% >&2\r
\techo [${baseName}] No matching Windows binary was built for this package. >&2\r
\texit /b 1\r
)\r
\r
set "bin_path=%dir%%bin%"\r
\r
if not exist "%bin_path%" (\r
\techo [${baseName}] Prebuilt binary not found: %bin_path% >&2\r
\techo [${baseName}] Try reinstalling the package. >&2\r
\texit /b 1\r
)\r
\r
"%bin_path%" %*\r
`;
}

/**
 * Write the resolver scripts to disk.
 *
 * Generates a POSIX shell script (the primary resolver) and a Windows
 * `.cmd` batch file alongside it for cross-platform npm distribution.
 *
 * @param resolverPath - Absolute path for the resolver file (no extension)
 * @param baseName - The base binary name
 * @param targets - The list of targets that were built
 */
export function writeResolver(
	resolverPath: string,
	baseName: string,
	targets: readonly BunTarget[],
): void {
	const shellContent = generateResolver(baseName, targets);
	writeFileSync(resolverPath, shellContent, { mode: 0o755 });

	const cmdContent = generateCmdResolver(baseName, targets);
	writeFileSync(`${resolverPath}.cmd`, cmdContent);
}

// ────────────────────────────────────────────────────────────────────────────
// Build helpers
// ────────────────────────────────────────────────────────────────────────────

export function resolveEnvFilePaths(
	cwd: string,
	envFiles: string[] | undefined,
): string[] {
	if (!envFiles || envFiles.length === 0) {
		return [];
	}

	return envFiles.map((envFile) => {
		const envPath = resolve(cwd, envFile);
		if (!existsSync(envPath)) {
			throw new Error(
				`Env file not found: ${envPath}\n  Specify a valid env file with --env-file <path>`,
			);
		}
		return envPath;
	});
}

export function toBunEnvFileArgs(envFiles: readonly string[]): string[] {
	return envFiles.flatMap((envFile) => ["--env-file", envFile]);
}

/**
 * Compile a single entry file to a standalone executable.
 *
 * Without env files, uses the programmatic `Bun.build()` API directly.
 * With env files, spawns `bun build --compile` as a subprocess via
 * `process.execPath` + `BUN_BE_BUN=1` so that Bun handles `--env-file`
 * natively — no separate Bun installation required.
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
	if (envFiles.length === 0) {
		const result = await Bun.build({
			entrypoints: [entryPath],
			compile: {
				target,
				outfile: outfilePath,
			},
			env: PUBLIC_ENV_PATTERN,
			minify,
		});

		if (!result.success) {
			const messages = result.logs
				.filter((log) => log.level === "error")
				.map((log) => log.message ?? String(log))
				.join("\n");
			throw new Error(
				`Build failed for ${outfilePath}${messages ? `:\n${messages}` : ""}`,
			);
		}

		return;
	}

	const args = [
		process.execPath,
		"build",
		"--compile",
		...toBunEnvFileArgs(envFiles),
		`--env=${PUBLIC_ENV_PATTERN}`,
		"--outfile",
		outfilePath,
		...(minify ? ["--minify"] : []),
		...(target ? ["--target", target] : []),
		entryPath,
	];

	const proc = Bun.spawn(args, {
		env: {
			...process.env,
			BUN_BE_BUN: "1",
		},
		cwd: process.cwd(),
		stdout: "pipe",
		stderr: "pipe",
	});

	const [stderr, exitCode] = await Promise.all([
		new Response(proc.stderr).text(),
		proc.exited,
	]);

	if (exitCode !== 0) {
		throw new Error(
			`Build failed for ${outfilePath}${stderr.trim() ? `:\n${stderr.trim()}` : ""}`,
		);
	}
}

/**
 * Validate CLI entry by spawning the entry file as a subprocess with
 * `CRUST_INTERNAL_VALIDATE_ONLY=1`. This ensures module resolution runs
 * in the user's project context (their node_modules), not inside the
 * compiled `crust` binary.
 *
 * Uses `process.execPath` (the current binary) with `BUN_BE_BUN=1` so
 * that compiled standalone executables act as the full Bun runtime and
 * can run arbitrary `.ts` files — no separate `bun` install on PATH needed.
 */
const VALIDATE_TIMEOUT_MS = 30_000;

export async function validateEntrypoint(
	entryPath: string,
	envFiles: readonly string[] = [],
): Promise<void> {
	const absoluteEntry = resolve(entryPath);
	const proc = Bun.spawn(
		[process.execPath, ...toBunEnvFileArgs(envFiles), absoluteEntry],
		{
			env: {
				...process.env,
				[VALIDATION_MODE_ENV]: "1",
				BUN_BE_BUN: "1",
			},
			cwd: process.cwd(),
			stdout: "ignore",
			stderr: "pipe",
		},
	);

	const stderrPromise = new Response(proc.stderr).text();

	let timer: ReturnType<typeof setTimeout> | undefined;
	let timedOut = false;
	const exitCode = await Promise.race([
		proc.exited,
		new Promise<never>((_, reject) => {
			timer = setTimeout(() => {
				timedOut = true;
				proc.kill();
				reject(
					new Error(
						`Pre-compile validation timed out after ${VALIDATE_TIMEOUT_MS / 1_000}s.\n  A plugin setup() hook may be hanging. Use --no-validate to skip.`,
					),
				);
			}, VALIDATE_TIMEOUT_MS);
		}),
	]).finally(() => {
		clearTimeout(timer);
		// Always consume stderr to avoid resource leaks on the stream
		if (timedOut) stderrPromise.catch(() => {});
	});

	const stderr = (await stderrPromise).trim();

	if (exitCode !== 0) {
		// stderr contains the raw error message from the validation subprocess
		throw new Error(stderr || "Pre-compile validation failed");
	}

	if (stderr) {
		// Style Warning: prefixed lines from validation subprocess
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
}

// ────────────────────────────────────────────────────────────────────────────
// Build command
// ────────────────────────────────────────────────────────────────────────────

/**
 * The `crust build` command.
 *
 * Compiles a CLI entry file to standalone Bun executable(s).
 * By default, builds for all supported platforms and generates a JS resolver script.
 * Use `--target` to build for specific platform(s) only.
 *
 * @example
 * ```sh
 * crust build                                 # Build for all platforms + JS resolver
 * crust build --entry src/main.ts             # Custom entry point
 * crust build --name my-tool                  # Output as dist/my-tool-*
 * crust build --no-minify                     # Disable minification
 * crust build --target linux-x64              # Build only for Linux x64
 * crust build --target linux-x64 --target darwin-arm64  # Specific platforms only
 * crust build --target linux-x64 --outfile ./my-cli     # Single target with custom output
 * crust build --outdir out                              # Output binaries to out/ directory
 * ```
 */
export const buildCommand = new Crust("build")
	.meta({ description: "Compile your CLI to a standalone executable" })
	.flags({
		entry: {
			type: "string",
			description: "Entry file path",
			default: "src/cli.ts",
			short: "e",
		},
		outfile: {
			type: "string",
			description: "Output file path (single-target builds only)",
			short: "o",
		},
		name: {
			type: "string",
			description:
				"Binary name (defaults to package.json name or entry filename)",
			short: "n",
		},
		minify: {
			type: "boolean",
			description: "Minify the output",
			default: true,
		},
		target: {
			type: "string",
			multiple: true,
			description:
				"Target platform(s) to compile for (e.g. linux-x64, darwin-arm64). Omit to build all.",
			short: "t",
		},
		outdir: {
			type: "string",
			description: "Output directory for compiled binaries",
			default: "dist",
			short: "d",
		},
		resolver: {
			type: "string",
			description:
				"Filename for the resolver script (multi-target builds, no extension)",
			default: "cli",
			short: "r",
		},
		validate: {
			type: "boolean",
			description:
				"Validate command runtime rules before compiling (disable with --no-validate)",
			default: true,
		},
		"env-file": {
			type: "string",
			multiple: true,
			description:
				"Explicit env file(s) used for build-time constants; repeatable",
		},
		package: {
			type: "boolean",
			description: "Stage npm packages in dist/npm instead of raw binaries",
			default: false,
		},
		"stage-dir": {
			type: "string",
			description: "Directory to stage npm packages into when using --package",
			default: "dist/npm",
		},
	} as const)
	.run(async ({ flags }) => {
		const cwd = process.cwd();

		// Resolve entry file path relative to cwd
		const entryPath = resolve(cwd, flags.entry);
		const envFiles = resolveEnvFilePaths(cwd, flags["env-file"]);

		// Verify entry file exists
		if (!existsSync(entryPath)) {
			throw new Error(
				`Entry file not found: ${entryPath}\n  Specify a valid entry file with --entry <path>`,
			);
		}

		if (flags.validate) {
			await validateEntrypoint(entryPath, envFiles);
		}

		if (flags.package) {
			if (flags.outfile) {
				throw new Error(
					"--outfile cannot be used with --package.\n  Use --stage-dir to control the staged npm output directory.",
				);
			}

			const { runDistributeBuild } = await import("./distribute.ts");
			await runDistributeBuild({
				cwd,
				entry: flags.entry,
				name: flags.name,
				minify: flags.minify,
				target: flags.target,
				stageDir: flags["stage-dir"],
				envFiles,
				validate: false,
			});
			return;
		}

		// Resolve targets: default is all platforms, --target narrows to specific ones
		const targets = resolveTargets(flags.target);

		// --outfile is only allowed with exactly one target
		if (flags.outfile && targets.length > 1) {
			throw new Error(
				"--outfile cannot be used when building for multiple targets.\n  Use --name to set the base binary name instead.",
			);
		}

		if (targets.length === 1) {
			// Single-target build: one binary, no resolver
			const outfilePath = resolveOutfile(
				flags.outfile,
				flags.name,
				entryPath,
				cwd,
				flags.outdir,
			);

			console.log(
				`Building ${dim(entryPath)} ${cyan("→")} ${dim(outfilePath)}...`,
			);
			await execBuild(
				entryPath,
				outfilePath,
				flags.minify,
				targets[0],
				envFiles,
			);
			console.log(`${green("✓")} Built successfully: ${outfilePath}`);
		} else {
			// Multi-target build: multiple binaries + JS resolver
			const baseName = resolveBaseName(flags.name, entryPath, cwd);

			console.log(
				`Building ${dim(entryPath)} for ${bold(`${targets.length}`)} target(s)...`,
			);

			const results: string[] = [];
			for (const target of targets) {
				const targetOutfile = resolveTargetOutfile(
					baseName,
					target,
					cwd,
					flags.outdir,
				);

				console.log(`  ${cyan("→")} ${bold(target)}: ${dim(targetOutfile)}`);
				await execBuild(
					entryPath,
					targetOutfile,
					flags.minify,
					target,
					envFiles,
				);
				results.push(targetOutfile);
			}

			// Generate resolver scripts
			const resolverPath = resolve(cwd, flags.outdir, flags.resolver);
			writeResolver(resolverPath, baseName, targets);

			console.log(
				`\n${green("✓")} Built ${bold(`${results.length}`)} target(s) successfully:`,
			);
			for (const r of results) {
				console.log(`  ${r}`);
			}
			console.log(
				`\n${dim("Resolver:")} ${resolverPath} ${dim(`(+ ${resolverPath}.cmd)`)}`,
			);
		}
	});

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
