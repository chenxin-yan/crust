// ────────────────────────────────────────────────────────────────────────────
// @crustjs/extensions — Update notifier extension
// ────────────────────────────────────────────────────────────────────────────

import { basename, isAbsolute, relative, resolve } from "node:path";

import { type Extension, defineExtension } from "@crustjs/core";
import { bold, cyan, dim, green, padEnd, yellow } from "@crustjs/style";

export type UpdateNotifierPackageManager = "npm" | "pnpm" | "yarn" | "bun";
export type UpdateNotifierInstallScope = "local" | "global";

export interface UpdateNotifierState {
	lastCheckedAt: number;
	latestVersion?: string;
	lastNotifiedVersion?: string;
}

export interface UpdateNotifierCacheAdapter {
	read(): Promise<UpdateNotifierState | null | undefined>;
	write(state: UpdateNotifierState): Promise<void>;
}

/**
 * Cache configuration for the update notifier extension.
 *
 * Wraps a {@link UpdateNotifierCacheAdapter} with cache-specific settings.
 */
export interface UpdateNotifierCacheConfig {
	/**
	 * Persistence adapter for reading and writing notifier state.
	 */
	adapter: UpdateNotifierCacheAdapter;

	/**
	 * Minimum interval in milliseconds between network update checks.
	 *
	 * Cached results are reused until this interval elapses.
	 *
	 * @default 86_400_000 (24 hours)
	 */
	intervalMs?: number;
}

// ────────────────────────────────────────────────────────────────────────────
// Options
// ────────────────────────────────────────────────────────────────────────────

/**
 * Configuration options for the update notifier extension.
 *
 * @example
 * ```ts
 * import { updateNotifier } from "@crustjs/extensions";
 *
 * updateNotifier({
 *   packageName: "my-cli",
 *   currentVersion: "1.2.3",
 * });
 * ```
 */
export interface UpdateNotifierOptions {
	/**
	 * The current version of the CLI package.
	 *
	 * Typically sourced from `package.json`:
	 * ```ts
	 * import pkg from "../package.json";
	 * updateNotifier({ packageName: pkg.name, currentVersion: pkg.version });
	 * ```
	 */
	currentVersion: string;

	/**
	 * The npm package name to check for updates.
	 */
	packageName: string;

	/**
	 * Network request timeout in milliseconds for the registry check.
	 *
	 * If the check does not complete within this duration, it is silently
	 * aborted and treated as a soft failure.
	 *
	 * @default 5_000 (5 seconds)
	 */
	timeoutMs?: number;

	/**
	 * Custom npm registry URL to query for the latest version.
	 *
	 * @default "https://registry.npmjs.org"
	 */
	registryUrl?: string;

	/**
	 * Package manager used to generate the suggested upgrade command.
	 * Set to `"auto"` to infer from the runtime environment.
	 *
	 * @default "auto"
	 */
	packageManager?: UpdateNotifierPackageManager | "auto";

	/**
	 * Install scope used to generate the suggested upgrade command.
	 * Set to `"auto"` to infer whether the CLI is running from a global
	 * install or a project-local dependency.
	 *
	 * @default "auto"
	 */
	installScope?: UpdateNotifierInstallScope | "auto";

	/**
	 * Override the upgrade command shown in the notice.
	 *
	 * Useful when users install the CLI globally or through channels other than
	 * npm-style package managers (e.g. Homebrew, custom installers).
	 */
	updateCommand?:
		| string
		| ((
				packageName: string,
				packageManager: UpdateNotifierPackageManager,
				installScope: UpdateNotifierInstallScope,
		  ) => string);

	/**
	 * Optional cache configuration for cross-run persistence.
	 *
	 * By default, no cross-run persistence is used and checks occur once
	 * per process execution.
	 *
	 * @example
	 * ```ts
	 * cache: {
	 *   adapter: {
	 *     read: async () => ({ lastCheckedAt: 0 }),
	 *     write: async (state) => {
	 *       await store.write({
	 *         lastCheckedAt: state.lastCheckedAt,
	 *         latestVersion: state.latestVersion,
	 *         lastNotifiedVersion: state.lastNotifiedVersion,
	 *       });
	 *     },
	 *   },
	 *   intervalMs: 86_400_000, // 24 hours
	 * }
	 * ```
	 */
	cache?: UpdateNotifierCacheConfig;
}

// ────────────────────────────────────────────────────────────────────────────
// Defaults
// ────────────────────────────────────────────────────────────────────────────

/** Default check interval: 24 hours. */
const DEFAULT_INTERVAL_MS = 86_400_000;

/** Default network timeout: 5 seconds. */
const DEFAULT_TIMEOUT_MS = 5_000;

/** Default npm registry URL. */
const DEFAULT_REGISTRY_URL = "https://registry.npmjs.org";

// ────────────────────────────────────────────────────────────────────────────
// Internal utilities — version comparison
// ────────────────────────────────────────────────────────────────────────────

/** Returns whether `latest` is newer, or false when either version is invalid. */
export function isNewerVersion(current: string, latest: string): boolean {
	try {
		return Bun.semver.order(latest, current) === 1;
	} catch {
		return false;
	}
}

// ────────────────────────────────────────────────────────────────────────────
// Internal utilities — npm registry fetch
// ────────────────────────────────────────────────────────────────────────────

/**
 * Fetch the `dist-tags.latest` version string for a package from an npm
 * registry.
 *
 * Uses `AbortController` with `setTimeout` to enforce a hard timeout so
 * network stalls cannot hang the CLI process.
 *
 * Returns `null` on any failure (network error, timeout, non-OK status,
 * missing/malformed response body).
 *
 * @internal
 */
export async function fetchLatestVersion(
	packageName: string,
	registryUrl: string,
	timeoutMs: number,
): Promise<string | null> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);

	try {
		const url = `${registryUrl.replace(/\/+$/, "")}/${encodeURIComponent(packageName)}`;
		const response = await fetch(url, {
			signal: controller.signal,
			headers: { Accept: "application/vnd.npm.install-v1+json" },
		});

		if (!response.ok) return null;

		const data = (await response.json()) as {
			"dist-tags"?: Record<string, string>;
		};

		const latest = data?.["dist-tags"]?.latest;
		if (typeof latest !== "string" || latest.length === 0) return null;

		return latest;
	} catch {
		// Network error, abort, JSON parse failure — all soft failures
		return null;
	} finally {
		clearTimeout(timer);
	}
}

// ────────────────────────────────────────────────────────────────────────────
// Cache state — notifier persistence fields
// ────────────────────────────────────────────────────────────────────────────

function normalizeNotifierState(
	input: UpdateNotifierState | null | undefined,
): UpdateNotifierState {
	if (!input || typeof input !== "object") return { lastCheckedAt: 0 };

	const lastCheckedAt =
		typeof input.lastCheckedAt === "number" && Number.isFinite(input.lastCheckedAt)
			? input.lastCheckedAt
			: 0;
	const latestVersion =
		typeof input.latestVersion === "string" && input.latestVersion.length > 0
			? input.latestVersion
			: undefined;
	const lastNotifiedVersion =
		typeof input.lastNotifiedVersion === "string" && input.lastNotifiedVersion.length > 0
			? input.lastNotifiedVersion
			: undefined;

	return {
		lastCheckedAt,
		latestVersion,
		lastNotifiedVersion,
	};
}

const NO_CACHE_ADAPTER: UpdateNotifierCacheAdapter = {
	read: async () => null,
	write: async () => {},
};

function detectPackageManager(): UpdateNotifierPackageManager {
	const userAgent = process.env.npm_config_user_agent;
	if (userAgent) {
		if (userAgent.startsWith("bun")) return "bun";
		if (userAgent.startsWith("pnpm")) return "pnpm";
		if (userAgent.startsWith("yarn")) return "yarn";
		if (userAgent.startsWith("npm")) return "npm";
	}

	const detectedFromExecPath = detectPackageManagerFromExecPath(process.env.npm_execpath);
	if (detectedFromExecPath) return detectedFromExecPath;

	const detectedFromRuntime = detectPackageManagerFromExecPath(process.execPath);
	if (detectedFromRuntime) return detectedFromRuntime;

	return "npm";
}

function detectInstallScopeFromEnvironment(): UpdateNotifierInstallScope {
	const explicitGlobal = process.env.npm_config_global;
	if (explicitGlobal === "true") return "global";
	if (explicitGlobal === "false") return "local";

	const candidatePaths = [process.argv[0], process.argv[1], process.env.npm_execpath];

	const globalRoots = [process.env.BUN_INSTALL, process.env.PNPM_HOME];

	if (
		globalRoots.some(
			(rootPath) =>
				rootPath && candidatePaths.some((pathValue) => isPathWithin(rootPath, pathValue)),
		)
	) {
		return "global";
	}

	if (candidatePaths.some((pathValue) => isLikelyLocalInstallPath(pathValue))) {
		return "local";
	}

	// Default to "global" — a CLI running outside node_modules without any
	// package-manager env vars is far more likely to be a global install.
	return "global";
}

function detectPackageManagerFromExecPath(
	execPath: string | undefined,
): UpdateNotifierPackageManager | null {
	if (!execPath) return null;

	const executable = basename(execPath).toLowerCase();
	if (executable === "bun" || executable.startsWith("bun-")) return "bun";
	if (executable === "pnpm" || executable.startsWith("pnpm-")) return "pnpm";
	if (executable === "yarn" || executable.startsWith("yarn-")) return "yarn";
	if (executable === "npm" || executable.startsWith("npm-")) return "npm";
	return null;
}

function isPathWithin(parentPath: string, childPath: string | undefined): boolean {
	if (!childPath) return false;

	const resolvedParent = resolve(parentPath);
	const resolvedChild = resolve(childPath);
	const rel = relative(resolvedParent, resolvedChild);
	return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function isLikelyLocalInstallPath(pathValue: string | undefined): boolean {
	if (!pathValue) return false;

	const normalizedPath = pathValue.replaceAll("\\", "/").toLowerCase();
	const cwd = process.cwd().replaceAll("\\", "/").toLowerCase();
	return (
		(normalizedPath.includes("/node_modules/.bin/") || normalizedPath.includes("/node_modules/")) &&
		normalizedPath.startsWith(cwd)
	);
}

/**
 * Detect the Yarn major version from the `npm_config_user_agent` env var.
 * Returns `null` when the version cannot be determined.
 *
 * The user-agent format is: `yarn/<version> npm/? node/<version> <os> <arch>`
 */
function getYarnMajorVersion(): number | null {
	const ua = process.env.npm_config_user_agent;
	if (!ua) return null;
	const match = ua.match(/^yarn\/(\d+)/);
	return match ? Number(match[1]) : null;
}

function defaultUpdateCommand(
	packageName: string,
	packageManager: UpdateNotifierPackageManager,
	installScope: UpdateNotifierInstallScope,
): string {
	if (packageManager === "pnpm") {
		return installScope === "global"
			? `pnpm add -g ${packageName}@latest`
			: `pnpm add ${packageName}@latest`;
	}
	if (packageManager === "yarn") {
		if (installScope === "global") {
			const major = getYarnMajorVersion();
			// `yarn global add` was removed in Yarn v2+ (Berry).
			// When version is unknown, fall back to npm as the safer default.
			return major !== null && major < 2
				? `yarn global add ${packageName}@latest`
				: `npm install -g ${packageName}@latest`;
		}
		return `yarn add ${packageName}@latest`;
	}
	if (packageManager === "bun") {
		return installScope === "global"
			? `bun add -g ${packageName}@latest`
			: `bun add ${packageName}@latest`;
	}
	return installScope === "global"
		? `npm install -g ${packageName}@latest`
		: `npm install ${packageName}@latest`;
}

function resolveUpdateCommand(
	packageName: string,
	packageManagerOption: UpdateNotifierPackageManager | "auto" | undefined,
	installScopeOption: UpdateNotifierInstallScope | "auto" | undefined,
	override:
		| string
		| ((
				packageName: string,
				packageManager: UpdateNotifierPackageManager,
				installScope: UpdateNotifierInstallScope,
		  ) => string)
		| undefined,
): string {
	if (typeof override === "string") return override;

	const detectedPackageManager =
		packageManagerOption && packageManagerOption !== "auto"
			? packageManagerOption
			: detectPackageManager();
	const detectedInstallScope =
		installScopeOption && installScopeOption !== "auto"
			? installScopeOption
			: detectInstallScopeFromEnvironment();

	if (typeof override === "function") {
		return override(packageName, detectedPackageManager, detectedInstallScope);
	}
	return defaultUpdateCommand(packageName, detectedPackageManager, detectedInstallScope);
}

// ────────────────────────────────────────────────────────────────────────────
// Extension factory
// ────────────────────────────────────────────────────────────────────────────

/**
 * Creates an update notifier extension that performs background version checks
 * against the npm registry and displays a concise notice when a newer
 * version is available.
 *
 * **Behavior:**
 * - With `cache`, checks are reused up to `cache.intervalMs` (default 24h).
 * - Without `cache`, checks run once per process execution.
 * - The network check is non-blocking — it never delays command execution.
 * - All internal errors (network, cache, parsing) are silently swallowed.
 * - The update notice is emitted *after* the command action completes.
 * - Duplicate notifications for the same version are suppressed.
 *
 * @param options - Extension configuration. `currentVersion` and `packageName` are required.
 * @returns An Extension registered with `.extend()`.
 *
 * @example
 * ```ts
 * import { Crust } from "@crustjs/core";
 * import { updateNotifier } from "@crustjs/extensions";
 * import pkg from "../package.json";
 *
 * const app = new Crust("my-cli", { description: "My awesome CLI" })
 *   .extend(updateNotifier({ packageName: "my-cli", currentVersion: pkg.version }))
 *   .action(() => {
 *     console.log("Hello!");
 *   });
 *
 * await app.execute();
 * ```
 */
export function updateNotifier(options: UpdateNotifierOptions): Extension {
	const {
		currentVersion,
		packageName,
		timeoutMs = DEFAULT_TIMEOUT_MS,
		registryUrl = DEFAULT_REGISTRY_URL,
		packageManager = "auto",
		installScope = "auto",
		updateCommand,
		cache,
	} = options;
	const hasCache = cache !== undefined;
	const intervalMs = cache?.intervalMs ?? DEFAULT_INTERVAL_MS;
	const cacheAdapter = cache?.adapter ?? NO_CACHE_ADAPTER;

	return defineExtension("update-notifier", {
		hooks: {
			async postRun(context, outcome) {
				if (outcome.status !== "completed") return;

				try {
					// ── Resolve package name ─────────────────────────────────
					const state = normalizeNotifierState(await cacheAdapter.read());
					const resolvedUpdateCommand = resolveUpdateCommand(
						packageName,
						packageManager,
						installScope,
						updateCommand,
					);

					// ── Cache gate: skip network if within interval ──────────
					const now = Date.now();
					const elapsed = now - state.lastCheckedAt;

					if (hasCache && elapsed < intervalMs) {
						// Cache is still fresh — use cached version if available
						if (
							state.latestVersion &&
							isNewerVersion(currentVersion, state.latestVersion) &&
							state.lastNotifiedVersion !== state.latestVersion
						) {
							emitUpdateNotice(
								currentVersion,
								state.latestVersion,
								resolvedUpdateCommand,
								context.stderr,
							);
							await cacheAdapter.write({
								...state,
								lastNotifiedVersion: state.latestVersion,
							});
						}
						return;
					}

					// ── Network check: fetch latest version ──────────────────
					const latestVersion = await fetchLatestVersion(packageName, registryUrl, timeoutMs);

					if (latestVersion === null) {
						// Soft failure — update timestamp to avoid retrying too soon
						await cacheAdapter.write({
							...state,
							lastCheckedAt: now,
						});
						return;
					}

					// ── Persist fetched version and timestamp ─────────────────
					const nextState: UpdateNotifierState = {
						...state,
						lastCheckedAt: now,
						latestVersion,
					};

					// ── Emit notice if newer and not already notified ─────────
					if (
						isNewerVersion(currentVersion, latestVersion) &&
						state.lastNotifiedVersion !== latestVersion
					) {
						emitUpdateNotice(currentVersion, latestVersion, resolvedUpdateCommand, context.stderr);
						nextState.lastNotifiedVersion = latestVersion;
					}

					await cacheAdapter.write(nextState);
				} catch {
					// All notifier internal errors are silently swallowed.
					// The extension must never affect command exit codes or output.
				}
			},
		},
	});
}

// ────────────────────────────────────────────────────────────────────────────
// Internal — Update notice output
// ────────────────────────────────────────────────────────────────────────────

// Box-drawing characters (rounded corners)
const BOX_TOP_LEFT = "╭";
const BOX_TOP_RIGHT = "╮";
const BOX_BOTTOM_LEFT = "╰";
const BOX_BOTTOM_RIGHT = "╯";
const BOX_HORIZONTAL = "─";
const BOX_VERTICAL = "│";

/**
 * Emits a styled, boxed update notice to stderr.
 *
 * Uses stderr so the notice does not interfere with piped stdout.
 *
 * The notice uses rounded-corner box-drawing characters and ANSI colors:
 * - Yellow box border
 * - Dim current version, bold green latest version
 * - Cyan update command
 *
 * @internal
 */
function emitUpdateNotice(
	currentVersion: string,
	latestVersion: string,
	updateCommand: string,
	stderr: (text: string) => void,
): void {
	const PADDING = 3;

	const versionLine = `Update available  ${dim(currentVersion)} ${yellow("→")} ${bold(green(latestVersion))}`;
	const commandLine = `Run ${cyan(updateCommand)}`;

	// Determine content width from the longest visible line
	const contentWidth = Math.max(Bun.stringWidth(versionLine), Bun.stringWidth(commandLine));
	const innerWidth = contentWidth + PADDING * 2;

	const border = BOX_HORIZONTAL.repeat(innerWidth);
	const pad = " ".repeat(PADDING);
	const emptyLine = `${yellow(BOX_VERTICAL)}${" ".repeat(innerWidth)}${yellow(BOX_VERTICAL)}`;

	const lines = [
		"",
		`${yellow(BOX_TOP_LEFT)}${yellow(border)}${yellow(BOX_TOP_RIGHT)}`,
		emptyLine,
		`${yellow(BOX_VERTICAL)}${pad}${padEnd(versionLine, contentWidth)}${pad}${yellow(BOX_VERTICAL)}`,
		`${yellow(BOX_VERTICAL)}${pad}${padEnd(commandLine, contentWidth)}${pad}${yellow(BOX_VERTICAL)}`,
		emptyLine,
		`${yellow(BOX_BOTTOM_LEFT)}${yellow(border)}${yellow(BOX_BOTTOM_RIGHT)}`,
		"",
	];

	stderr(lines.join("\n"));
}
