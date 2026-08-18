// ────────────────────────────────────────────────────────────────────────────
// @crustjs/extensions — Update notifier extension
// ────────────────────────────────────────────────────────────────────────────

import { basename } from "node:path";

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
	 *
	 * When omitted, the built-in `@crustjs/store` persistence is used, so
	 * `intervalMs` can be tuned without reimplementing storage.
	 */
	adapter?: UpdateNotifierCacheAdapter;

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
	 *
	 * When omitted with no `updateCommand`, the notice does not suggest a command.
	 */
	installScope?: UpdateNotifierInstallScope;

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
				installScope: UpdateNotifierInstallScope | undefined,
		  ) => string);

	/**
	 * Documentation URL shown after the update notice.
	 */
	updateDocsUrl?: string;

	/**
	 * Cache configuration for cross-run persistence.
	 *
	 * By default, notifier state is persisted in the platform-standard state
	 * directory for {@link packageName}. Set to `false` to disable persistence,
	 * provide `intervalMs` alone to tune the built-in cache interval, or
	 * provide a custom adapter to control storage.
	 *
	 * @example
	 * ```ts
	 * cache: false
	 * ```
	 */
	cache?: false | UpdateNotifierCacheConfig;
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

/**
 * Returns whether `latest` is newer, or false when either version is invalid.
 *
 * @internal
 */
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
 * Uses the platform timeout signal so network stalls cannot hang the CLI process.
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
	try {
		const url = `${registryUrl.replace(/\/+$/, "")}/${encodeURIComponent(packageName)}`;
		const response = await fetch(url, {
			signal: AbortSignal.timeout(timeoutMs),
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
		return installScope === "global"
			? `npm install -g ${packageName}@latest`
			: `yarn add ${packageName}@latest`;
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
	installScopeOption: UpdateNotifierInstallScope | undefined,
	override:
		| string
		| ((
				packageName: string,
				packageManager: UpdateNotifierPackageManager,
				installScope: UpdateNotifierInstallScope | undefined,
		  ) => string)
		| undefined,
): string | undefined {
	if (typeof override === "string") return override;

	if (typeof override !== "function" && installScopeOption === undefined) return undefined;

	const detectedPackageManager =
		packageManagerOption && packageManagerOption !== "auto"
			? packageManagerOption
			: detectPackageManager();

	if (typeof override === "function") {
		return override(packageName, detectedPackageManager, installScopeOption);
	}
	return installScopeOption
		? defaultUpdateCommand(packageName, detectedPackageManager, installScopeOption)
		: undefined;
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
 * - By default, checks are cached for 24 hours in the package's state directory.
 * - `cache: false` disables cross-run persistence.
 * - A custom cache adapter can override the built-in persistence.
 * - The notice is command-less unless `installScope` or `updateCommand` is configured.
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
		installScope,
		updateCommand,
		updateDocsUrl,
		cache,
	} = options;
	const intervalMs = (cache === false ? undefined : cache?.intervalMs) ?? DEFAULT_INTERVAL_MS;

	return defineExtension("update-notifier", {
		hooks: {
			async postRun(context, outcome) {
				if (outcome.status !== "completed") return;

				try {
					let cacheAdapter: UpdateNotifierCacheAdapter = NO_CACHE_ADAPTER;
					if (cache !== false) {
						if (cache?.adapter) {
							cacheAdapter = cache.adapter;
						} else {
							const { createStore, stateDir } = await import("@crustjs/store");
							cacheAdapter = createStore({
								// stateDir rejects path separators; sanitize scoped names (@scope/cli → scope-cli)
								dirPath: stateDir(packageName.replace(/^@/, "").replace(/[/\\]/g, "-")),
								name: "update-notifier",
								fields: {
									lastCheckedAt: { type: "number", default: 0 },
									latestVersion: { type: "string" },
									lastNotifiedVersion: { type: "string" },
								},
							});
						}
					}

					// Corrupt/unreadable cache (e.g. CrustStoreError PARSE) reads as empty
					// so the next successful write repairs the file instead of permanently
					// disabling the notifier.
					const state = normalizeNotifierState(await cacheAdapter.read().catch(() => null));
					const resolvedUpdateCommand = resolveUpdateCommand(
						packageName,
						packageManager,
						installScope,
						updateCommand,
					);

					// ── Cache gate: skip network if within interval ──────────
					const now = Date.now();
					const elapsed = now - state.lastCheckedAt;

					// Negative elapsed (clock rollback, corrupt future timestamp) is
					// treated as stale so the refetch rewrites lastCheckedAt.
					if (cache !== false && elapsed >= 0 && elapsed < intervalMs) {
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
								updateDocsUrl,
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
						emitUpdateNotice(
							currentVersion,
							latestVersion,
							resolvedUpdateCommand,
							updateDocsUrl,
							context.stderr,
						);
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
 * - Optional cyan update command and documentation URL
 *
 * @internal
 */
function emitUpdateNotice(
	currentVersion: string,
	latestVersion: string,
	updateCommand: string | undefined,
	updateDocsUrl: string | undefined,
	stderr: (text: string) => void,
): void {
	const PADDING = 3;

	const contentLines = [
		`Update available  ${dim(currentVersion)} ${yellow("→")} ${bold(green(latestVersion))}`,
		...(updateCommand !== undefined ? [`Run ${cyan(updateCommand)}`] : []),
		...(updateDocsUrl !== undefined ? [`See ${cyan(updateDocsUrl)} to update`] : []),
	];

	// Determine content width from the longest visible line
	const contentWidth = Math.max(...contentLines.map((line) => Bun.stringWidth(line)));
	const innerWidth = contentWidth + PADDING * 2;

	const border = BOX_HORIZONTAL.repeat(innerWidth);
	const pad = " ".repeat(PADDING);
	const emptyLine = `${yellow(BOX_VERTICAL)}${" ".repeat(innerWidth)}${yellow(BOX_VERTICAL)}`;

	const lines = [
		"",
		`${yellow(BOX_TOP_LEFT)}${yellow(border)}${yellow(BOX_TOP_RIGHT)}`,
		emptyLine,
		...contentLines.map(
			(line) =>
				`${yellow(BOX_VERTICAL)}${pad}${padEnd(line, contentWidth)}${pad}${yellow(BOX_VERTICAL)}`,
		),
		emptyLine,
		`${yellow(BOX_BOTTOM_LEFT)}${yellow(border)}${yellow(BOX_BOTTOM_RIGHT)}`,
		"",
	];

	stderr(lines.join("\n"));
}
