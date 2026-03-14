// ────────────────────────────────────────────────────────────────────────────
// @crustjs/plugins — Update notifier plugin
// ────────────────────────────────────────────────────────────────────────────

import { basename, isAbsolute, relative, resolve } from "node:path";
import type { CrustPlugin } from "@crustjs/core";
import { bold, cyan, dim, green, visibleWidth, yellow } from "@crustjs/style";

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
 * Cache configuration for the update notifier plugin.
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
 * Configuration options for the update notifier plugin.
 *
 * @example
 * ```ts
 * import { updateNotifierPlugin } from "@crustjs/plugins";
 *
 * updateNotifierPlugin({
 *   packageName: "my-cli",
 *   currentVersion: "1.2.3",
 * });
 * ```
 */
export interface UpdateNotifierPluginOptions {
	/**
	 * The current version of the CLI package.
	 *
	 * Typically sourced from `package.json`:
	 * ```ts
	 * import pkg from "../package.json";
	 * updateNotifierPlugin({ packageName: pkg.name, currentVersion: pkg.version });
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
	 *
	 * Set to "auto" (default) to infer from the runtime environment.
	 */
	packageManager?: UpdateNotifierPackageManager | "auto";

	/**
	 * Install scope used to generate the suggested upgrade command.
	 *
	 * Set to "auto" (default) to infer whether the CLI is running from a
	 * global install or a project-local dependency.
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
// Internal utilities — version parsing & comparison
// ────────────────────────────────────────────────────────────────────────────

/**
 * Parsed representation of a standard semver version (major.minor.patch).
 * Prerelease and build metadata are intentionally ignored — the plugin
 * only compares stable release versions.
 */
interface SemverParts {
	major: number;
	minor: number;
	patch: number;
}

/**
 * Attempt to parse a version string into numeric semver parts.
 *
 * Accepts `"major.minor.patch"` with an optional leading `"v"`.
 * Returns `null` for any input that does not match the expected format
 * or contains non-finite numeric segments.
 *
 * **Note:** Prerelease suffixes (e.g. `-beta.1`) and build metadata
 * (e.g. `+sha.abc`) are intentionally stripped before parsing. The
 * plugin treats prerelease versions as equivalent to their base version
 * for comparison purposes, which avoids false-positive update notices for
 * users on prerelease channels.
 *
 * @internal
 */
export function parseSemver(version: string): SemverParts | null {
	// Strip optional leading "v"
	const cleaned = version.startsWith("v") ? version.slice(1) : version;

	// Strip prerelease / build-metadata suffix (anything after first - or +)
	const base = cleaned.split(/[-+]/)[0] ?? "";

	const parts = base.split(".");
	if (parts.length !== 3) return null;

	const [rawMajor, rawMinor, rawPatch] = parts as [string, string, string];
	const major = Number(rawMajor);
	const minor = Number(rawMinor);
	const patch = Number(rawPatch);

	if (
		!Number.isFinite(major) ||
		!Number.isFinite(minor) ||
		!Number.isFinite(patch)
	) {
		return null;
	}

	if (major < 0 || minor < 0 || patch < 0) return null;

	return { major, minor, patch };
}

/**
 * Returns `true` when `latest` represents a strictly newer stable version
 * than `current`. Returns `false` for equal versions, older versions, or
 * when either input is unparsable.
 *
 * @internal
 */
export function isNewerVersion(current: string, latest: string): boolean {
	const cur = parseSemver(current);
	const lat = parseSemver(latest);
	if (!cur || !lat) return false;

	if (lat.major !== cur.major) return lat.major > cur.major;
	if (lat.minor !== cur.minor) return lat.minor > cur.minor;
	return lat.patch > cur.patch;
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

/** Key used in plugin state for process-level dedupe. */
const DEDUPE_STATE_KEY = "update-notifier:checked";

const EMPTY_NOTIFIER_STATE: UpdateNotifierState = { lastCheckedAt: 0 };

function normalizeNotifierState(
	input: UpdateNotifierState | null | undefined,
): UpdateNotifierState {
	if (!input || typeof input !== "object") return { ...EMPTY_NOTIFIER_STATE };

	const lastCheckedAt =
		typeof input.lastCheckedAt === "number" &&
		Number.isFinite(input.lastCheckedAt)
			? input.lastCheckedAt
			: 0;
	const latestVersion =
		typeof input.latestVersion === "string" && input.latestVersion.length > 0
			? input.latestVersion
			: undefined;
	const lastNotifiedVersion =
		typeof input.lastNotifiedVersion === "string" &&
		input.lastNotifiedVersion.length > 0
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

function detectPackageManagerFromUserAgent(): UpdateNotifierPackageManager {
	const userAgent = process.env.npm_config_user_agent;
	if (userAgent) {
		if (userAgent.startsWith("bun")) return "bun";
		if (userAgent.startsWith("pnpm")) return "pnpm";
		if (userAgent.startsWith("yarn")) return "yarn";
		if (userAgent.startsWith("npm")) return "npm";
	}

	const detectedFromExecPath = detectPackageManagerFromExecPath(
		process.env.npm_execpath,
	);
	if (detectedFromExecPath) return detectedFromExecPath;

	const detectedFromRuntime = detectPackageManagerFromExecPath(
		process.execPath,
	);
	if (detectedFromRuntime) return detectedFromRuntime;

	const bunInstallDir = process.env.BUN_INSTALL;
	if (
		bunInstallDir &&
		[
			process.execPath,
			process.argv[0],
			process.argv[1],
			process.env.npm_execpath,
		].some((pathValue) => isPathWithin(bunInstallDir, pathValue))
	) {
		return "bun";
	}

	return "npm";
}

function detectInstallScopeFromEnvironment(
	packageManager: UpdateNotifierPackageManager,
): UpdateNotifierInstallScope {
	const explicitGlobal = process.env.npm_config_global;
	if (explicitGlobal === "true") return "global";
	if (explicitGlobal === "false") return "local";

	const candidatePaths = [
		process.execPath,
		process.argv[0],
		process.argv[1],
		process.env.npm_execpath,
	];

	const globalRoots = [
		process.env.BUN_INSTALL,
		process.env.npm_config_prefix,
		process.env.PREFIX,
		process.env.PNPM_HOME,
	];

	if (
		globalRoots.some(
			(rootPath) =>
				rootPath &&
				candidatePaths.some((pathValue) => isPathWithin(rootPath, pathValue)),
		)
	) {
		return "global";
	}

	if (candidatePaths.some((pathValue) => isLikelyLocalInstallPath(pathValue))) {
		return "local";
	}

	if (packageManager === "bun" && process.env.BUN_INSTALL) {
		return "global";
	}

	return "local";
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

function isPathWithin(
	parentPath: string,
	childPath: string | undefined,
): boolean {
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
		(normalizedPath.includes("/node_modules/.bin/") ||
			normalizedPath.includes("/node_modules/")) &&
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
	const detectedPackageManager =
		packageManagerOption && packageManagerOption !== "auto"
			? packageManagerOption
			: detectPackageManagerFromUserAgent();
	const detectedInstallScope =
		installScopeOption && installScopeOption !== "auto"
			? installScopeOption
			: detectInstallScopeFromEnvironment(detectedPackageManager);

	if (typeof override === "string") return override;
	if (typeof override === "function") {
		return override(packageName, detectedPackageManager, detectedInstallScope);
	}
	return defaultUpdateCommand(
		packageName,
		detectedPackageManager,
		detectedInstallScope,
	);
}

// ────────────────────────────────────────────────────────────────────────────
// Plugin factory
// ────────────────────────────────────────────────────────────────────────────

/**
 * Creates an update notifier plugin that performs background version checks
 * against the npm registry and displays a concise notice when a newer
 * version is available.
 *
 * **Behavior:**
 * - With `cache`, checks are reused up to `cache.intervalMs` (default 24h).
 * - Without `cache`, checks run once per process execution.
 * - The network check is non-blocking — it never delays command execution.
 * - All internal errors (network, cache, parsing) are silently swallowed.
 * - The update notice is emitted *after* the command handler completes.
 * - Duplicate notifications for the same version are suppressed.
 *
 * @param options - Plugin configuration. `currentVersion` and `packageName` are required.
 * @returns A {@link CrustPlugin} instance.
 *
 * @example
 * ```ts
 * import { Crust } from "@crustjs/core";
 * import { updateNotifierPlugin } from "@crustjs/plugins";
 * import pkg from "../package.json";
 *
 * const app = new Crust("my-cli").meta({ description: "My awesome CLI" })
 *   .use(updateNotifierPlugin({ packageName: "my-cli", currentVersion: pkg.version }))
 *   .run(() => {
 *     console.log("Hello!");
 *   });
 *
 * await app.execute();
 * ```
 */
export function updateNotifierPlugin(
	options: UpdateNotifierPluginOptions,
): CrustPlugin {
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

	return {
		name: "update-notifier",

		async middleware(context, next) {
			// Always let the command execute first
			await next();

			try {
				// ── Process-level dedupe guard ────────────────────────────
				// Prevents duplicate checks when multiple commands run in
				// a single process (e.g. subcommands sharing the same plugin).
				if (context.state.has(DEDUPE_STATE_KEY)) {
					return;
				}
				context.state.set(DEDUPE_STATE_KEY, true);

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
						);
						await cacheAdapter.write({
							...state,
							lastNotifiedVersion: state.latestVersion,
						});
					}
					return;
				}

				// ── Network check: fetch latest version ──────────────────
				const latestVersion = await fetchLatestVersion(
					packageName,
					registryUrl,
					timeoutMs,
				);

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
					emitUpdateNotice(
						currentVersion,
						latestVersion,
						resolvedUpdateCommand,
					);
					nextState.lastNotifiedVersion = latestVersion;
				}

				await cacheAdapter.write(nextState);
			} catch {
				// All notifier internal errors are silently swallowed.
				// The plugin must never affect command exit codes or output.
			}
		},
	};
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
 * Pad a line to a fixed visible width, accounting for ANSI escape codes.
 *
 * @internal
 */
function padLine(text: string, width: number): string {
	const padding = width - visibleWidth(text);
	return padding > 0 ? text + " ".repeat(padding) : text;
}

/**
 * Emits a styled, boxed update notice to stdout via `console.log`.
 *
 * Uses stdout (not stderr) because an update notice is informational,
 * not an error.
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
): void {
	const PADDING = 3;

	const versionLine = `Update available  ${dim(currentVersion)} ${yellow("→")} ${bold(green(latestVersion))}`;
	const commandLine = `Run ${cyan(updateCommand)}`;

	// Determine content width from the longest visible line
	const contentWidth = Math.max(
		visibleWidth(versionLine),
		visibleWidth(commandLine),
	);
	const innerWidth = contentWidth + PADDING * 2;

	const border = BOX_HORIZONTAL.repeat(innerWidth);
	const pad = " ".repeat(PADDING);
	const emptyLine = `${yellow(BOX_VERTICAL)}${" ".repeat(innerWidth)}${yellow(BOX_VERTICAL)}`;

	const lines = [
		"",
		`${yellow(BOX_TOP_LEFT)}${yellow(border)}${yellow(BOX_TOP_RIGHT)}`,
		emptyLine,
		`${yellow(BOX_VERTICAL)}${pad}${padLine(versionLine, contentWidth)}${pad}${yellow(BOX_VERTICAL)}`,
		`${yellow(BOX_VERTICAL)}${pad}${padLine(commandLine, contentWidth)}${pad}${yellow(BOX_VERTICAL)}`,
		emptyLine,
		`${yellow(BOX_BOTTOM_LEFT)}${yellow(border)}${yellow(BOX_BOTTOM_RIGHT)}`,
		"",
	];

	console.log(lines.join("\n"));
}
