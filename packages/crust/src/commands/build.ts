import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { defineCommand } from "@crustjs/core";

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
] as const;

export type BunTarget = (typeof SUPPORTED_TARGETS)[number];

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
export const TARGET_ALIASES: Record<string, BunTarget> = {
	"linux-x64": "bun-linux-x64-baseline",
	"linux-arm64": "bun-linux-arm64",
	"darwin-x64": "bun-darwin-x64",
	"darwin-arm64": "bun-darwin-arm64",
	"windows-x64": "bun-windows-x64-baseline",
};

/**
 * Maps each Bun compile target to its `process.platform-process.arch` key
 * used by the JS resolver at runtime.
 */
export const TARGET_PLATFORM_MAP: Record<BunTarget, string> = {
	"bun-linux-x64-baseline": "linux-x64",
	"bun-linux-arm64": "linux-arm64",
	"bun-darwin-x64": "darwin-x64",
	"bun-darwin-arm64": "darwin-arm64",
	"bun-windows-x64-baseline": "win32-x64",
};

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
 * Priority: --outfile > --name (as ./dist/<name>) > package.json name > entry filename
 *
 * @param outfile - Explicit output file path from --outfile flag
 * @param name - Binary name from --name flag
 * @param entry - Resolved entry file path
 * @param cwd - Current working directory
 * @returns The resolved output file path
 */
export function resolveOutfile(
	outfile: string | undefined,
	name: string | undefined,
	entry: string,
	cwd: string,
): string {
	// Explicit --outfile takes highest priority
	if (outfile) {
		return resolve(cwd, outfile);
	}

	const baseName = resolveBaseName(name, entry, cwd);
	return resolve(cwd, "dist", baseName);
}

/**
 * Resolve the output file path for a multi-target build.
 *
 * Produces `dist/<name>-<target>` (e.g. `dist/my-cli-bun-linux-x64-baseline`).
 * Windows targets automatically get a `.exe` extension.
 *
 * @param baseName - The resolved base binary name
 * @param target - The Bun compile target
 * @param cwd - Current working directory
 * @returns The resolved output file path with target suffix
 */
export function resolveTargetOutfile(
	baseName: string,
	target: BunTarget,
	cwd: string,
): string {
	const isWindows = target.startsWith("bun-windows");
	const ext = isWindows ? ".exe" : "";
	return resolve(cwd, "dist", `${baseName}-${target}${ext}`);
}

// ────────────────────────────────────────────────────────────────────────────
// JS resolver generator
// ────────────────────────────────────────────────────────────────────────────

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
 * Generate the JS resolver script content.
 *
 * The resolver detects `process.platform` and `process.arch` at runtime,
 * maps to the correct prebuilt binary, ensures execute permissions on Unix,
 * and spawns it with inherited stdio and exit code propagation.
 *
 * @param baseName - The base binary name
 * @param targets - The list of targets that were built
 * @returns The JS resolver script as a string
 */
export function generateResolver(
	baseName: string,
	targets: readonly BunTarget[],
): string {
	// Build the platform → filename mapping for only the targets that were built
	const entries: string[] = [];
	for (const target of targets) {
		const platformKey = TARGET_PLATFORM_MAP[target];
		const filename = getBinaryFilename(baseName, target);
		entries.push(`\t"${platformKey}": "${filename}"`);
	}
	const mapBody = entries.join(",\n");

	return `#!/usr/bin/env node
"use strict";

const { execFileSync } = require("node:child_process");
const { chmodSync, statSync } = require("node:fs");
const path = require("node:path");

const PLATFORM_ARCH = \`\${process.platform}-\${process.arch}\`;

const TARGET_MAP = {
${mapBody}
};

const binaryName = TARGET_MAP[PLATFORM_ARCH];

if (!binaryName) {
\tconsole.error(
\t\t\`[${baseName}] Unsupported platform: \${PLATFORM_ARCH}. \` +
\t\t\t"Please open an issue with your OS/CPU details."
\t);
\tprocess.exit(1);
}

const binPath = path.join(__dirname, binaryName);

try {
\tstatSync(binPath);
} catch {
\tconsole.error(\`[${baseName}] Prebuilt binary not found: \${binPath}\`);
\tconsole.error(\`[${baseName}] Expected binary for \${PLATFORM_ARCH}: \${binaryName}\`);
\tconsole.error(\`[${baseName}] Try reinstalling the package.\`);
\tprocess.exit(1);
}

// Ensure binary is executable on Unix
if (process.platform !== "win32") {
\ttry {
\t\tconst stats = statSync(binPath);
\t\tif ((stats.mode & 0o111) === 0) {
\t\t\tchmodSync(binPath, stats.mode | 0o111);
\t\t}
\t} catch {
\t\ttry {
\t\t\tchmodSync(binPath, 0o755);
\t\t} catch {
\t\t\t// If chmod fails, continue and let execFileSync report the error
\t\t}
\t}
}

try {
\texecFileSync(binPath, process.argv.slice(2), { stdio: "inherit" });
} catch (error) {
\tif (error && typeof error === "object" && "status" in error && typeof error.status === "number") {
\t\tprocess.exit(error.status);
\t}
\tprocess.exit(1);
}
`;
}

/**
 * Write the JS resolver script to disk.
 *
 * @param resolverPath - Absolute path for the resolver file
 * @param baseName - The base binary name
 * @param targets - The list of targets that were built
 */
export function writeResolver(
	resolverPath: string,
	baseName: string,
	targets: readonly BunTarget[],
): void {
	const content = generateResolver(baseName, targets);
	writeFileSync(resolverPath, content, { mode: 0o755 });
}

// ────────────────────────────────────────────────────────────────────────────
// Build helpers
// ────────────────────────────────────────────────────────────────────────────

/**
 * Build the `bun build --compile` argument array for a single compilation.
 *
 * @param entryPath - Absolute path to the entry file
 * @param outfilePath - Absolute path to the output binary
 * @param minify - Whether to enable minification
 * @param target - Optional Bun compile target for cross-compilation
 * @returns The argument array to pass to `Bun.spawn(["bun", ...args])`
 */
export function buildBunArgs(
	entryPath: string,
	outfilePath: string,
	minify: boolean,
	target?: BunTarget,
): string[] {
	const args: string[] = [
		"build",
		"--compile",
		entryPath,
		"--outfile",
		outfilePath,
	];

	if (target) {
		args.push("--target", target);
	}

	if (minify) {
		args.push("--minify");
	}

	return args;
}

/**
 * Execute a single `bun build --compile` invocation.
 *
 * @param args - The bun build argument array (from `buildBunArgs`)
 * @param cwd - Working directory for the child process
 * @param outfilePath - Output path (used in error messages)
 * @throws {Error} If the build process exits with a non-zero code
 */
async function execBuild(
	args: string[],
	cwd: string,
	outfilePath: string,
): Promise<void> {
	const proc = Bun.spawn(["bun", ...args], {
		cwd,
		stdout: "pipe",
		stderr: "pipe",
	});

	const exitCode = await proc.exited;

	if (exitCode !== 0) {
		const stderr = await new Response(proc.stderr).text();
		throw new Error(
			`Build failed for ${outfilePath} (exit code ${exitCode})${stderr ? `:\n${stderr.trim()}` : ""}`,
		);
	}
}

// ────────────────────────────────────────────────────────────────────────────
// Build command
// ────────────────────────────────────────────────────────────────────────────

/**
 * The `crust build` command.
 *
 * Compiles a CLI entry file to standalone Bun executable(s) using `bun build --compile`.
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
 * ```
 */
export const buildCommand = defineCommand({
	meta: {
		name: "build",
		description: "Compile your CLI to a standalone executable",
	},
	flags: {
		entry: {
			type: String,
			description: "Entry file path",
			default: "src/cli.ts",
			alias: "e",
		},
		outfile: {
			type: String,
			description: "Output file path (single-target builds only)",
			alias: "o",
		},
		name: {
			type: String,
			description:
				"Binary name (defaults to package.json name or entry filename)",
			alias: "n",
		},
		minify: {
			type: Boolean,
			description: "Minify the output",
			default: true,
		},
		target: {
			type: String,
			multiple: true,
			description:
				"Target platform(s) to compile for (e.g. linux-x64, darwin-arm64). Omit to build all.",
			alias: "t",
		},
	},
	async run({ flags }) {
		const cwd = process.cwd();

		// Resolve entry file path relative to cwd
		const entryPath = resolve(cwd, flags.entry);

		// Verify entry file exists
		if (!existsSync(entryPath)) {
			throw new Error(
				`Entry file not found: ${entryPath}\n  Specify a valid entry file with --entry <path>`,
			);
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
			);

			const args = buildBunArgs(
				entryPath,
				outfilePath,
				flags.minify,
				targets[0],
			);
			console.log(`Building ${entryPath} → ${outfilePath}...`);
			await execBuild(args, cwd, outfilePath);
			console.log(`Built successfully: ${outfilePath}`);
		} else {
			// Multi-target build: multiple binaries + JS resolver
			const baseName = resolveBaseName(flags.name, entryPath, cwd);

			console.log(`Building ${entryPath} for ${targets.length} target(s)...`);

			const results: string[] = [];
			for (const target of targets) {
				const targetOutfile = resolveTargetOutfile(baseName, target, cwd);
				const args = buildBunArgs(
					entryPath,
					targetOutfile,
					flags.minify,
					target,
				);

				console.log(`  → ${target}: ${targetOutfile}`);
				await execBuild(args, cwd, targetOutfile);
				results.push(targetOutfile);
			}

			// Generate JS resolver
			const resolverPath = resolve(cwd, "dist", `${baseName}.js`);
			writeResolver(resolverPath, baseName, targets);

			console.log(`\nBuilt ${results.length} target(s) successfully:`);
			for (const r of results) {
				console.log(`  ${r}`);
			}
			console.log(`\nResolver: ${resolverPath}`);
		}
	},
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
function resolveTargets(targetFlags: string[] | undefined): BunTarget[] {
	// No --target flags: build all platforms (default)
	if (!targetFlags || targetFlags.length === 0) {
		return [...SUPPORTED_TARGETS];
	}

	return targetFlags.map(resolveTarget);
}
