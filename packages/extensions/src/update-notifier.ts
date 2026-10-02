// ────────────────────────────────────────────────────────────────────────────
// @crustjs/extensions — Update notifier extension
// ────────────────────────────────────────────────────────────────────────────

import { basename } from "node:path";

import {
	CrustError,
	type ExtensionFactory,
	type ExtensionId,
	defineExtension,
	defineExtensionId,
} from "@crustjs/core";
import { bold, cyan, dim, green, padEnd, stringWidth, yellow } from "@crustjs/style";
import { isJsonObject, type JsonValue } from "@crustjs/utils/json";
import { packageManagerFromUserAgent } from "@crustjs/utils/process";

const UPDATE_NOTIFIER: ExtensionId = defineExtensionId("crust:update-notifier");

export type UpdateNotifierPackageManager = "npm" | "pnpm" | "yarn" | "bun";

export type UpdateCommandResolver = (info: {
	packageName: string;
	packageManager: UpdateNotifierPackageManager;
}) => string;

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
 * updateNotifier({ packageName: "my-cli" });
 * ```
 */
export interface UpdateNotifierOptions {
	/**
	 * Override the current version of the CLI package.
	 *
	 * @default The root command's `meta.version`
	 */
	currentVersion?: string;

	/**
	 * The npm package name to check for updates.
	 */
	packageName: string;

	/**
	 * Network request timeout in milliseconds for the registry check.
	 *
	 * If the check does not complete within this duration, it is silently
	 * aborted and treated as a soft failure. This timeout does not bound cache
	 * operations or the entire postRun hook.
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
	 * Upgrade command shown in the notice.
	 *
	 * Pass a string for a fixed command, a callback to build one from the
	 * package name and detected package manager, or a scope to generate the
	 * package manager's standard local/global command. When omitted, the notice
	 * does not suggest a command. Callbacks and package-manager detection run
	 * only when a notice is shown.
	 */
	updateCommand?: string | UpdateCommandResolver | { scope: "global" | "local" };

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

function compareSemver(left: string, right: string): -1 | 0 | 1 {
	const parse = (version: string) => {
		const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(
			version,
		);
		if (!match) throw new TypeError(`Invalid semantic version: ${version}`);
		return {
			core: match.slice(1, 4).map(Number),
			prerelease: match[4]?.split(".") ?? [],
		};
	};
	const a = parse(left);
	const b = parse(right);
	for (let index = 0; index < 3; index++) {
		if (a.core[index] !== b.core[index]) return a.core[index]! < b.core[index]! ? -1 : 1;
	}
	if (a.prerelease.length === 0 || b.prerelease.length === 0) {
		return a.prerelease.length === b.prerelease.length ? 0 : a.prerelease.length === 0 ? 1 : -1;
	}
	for (let index = 0; index < Math.max(a.prerelease.length, b.prerelease.length); index++) {
		const x = a.prerelease[index];
		const y = b.prerelease[index];
		if (x === undefined || y === undefined) return x === undefined ? -1 : 1;
		if (x === y) continue;
		const xNumeric = /^\d+$/.test(x);
		const yNumeric = /^\d+$/.test(y);
		if (xNumeric && yNumeric) return Number(x) < Number(y) ? -1 : 1;
		if (xNumeric !== yNumeric) return xNumeric ? -1 : 1;
		return x < y ? -1 : 1;
	}
	return 0;
}

/**
 * Returns whether `latest` is newer, or false when either version is invalid.
 *
 * @internal
 */
export function isNewerVersion(current: string, latest: string): boolean {
	try {
		return compareSemver(latest, current) === 1;
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

		const data: JsonValue = JSON.parse(await response.text());
		const tags = isJsonObject(data) ? data["dist-tags"] : undefined;
		const latest = tags !== undefined && isJsonObject(tags) ? tags.latest : undefined;
		// oxlint-disable-next-line anti-slop/no-runtime-typeof -- parsing registry JSON at its I/O boundary.
		return typeof latest === "string" && latest.length > 0 ? latest : null;
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
	if (!input) return { lastCheckedAt: 0 };

	const lastCheckedAt = Number.isFinite(input.lastCheckedAt) ? input.lastCheckedAt : 0;
	const latestVersion = input.latestVersion?.length ? input.latestVersion : undefined;
	const lastNotifiedVersion = input.lastNotifiedVersion?.length
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

/** @internal */
export async function createStoreCacheAdapter(
	packageName: string,
	registryUrl: string,
): Promise<UpdateNotifierCacheAdapter> {
	const { createStore, stateDir } = await import("@crustjs/store");
	const store = createStore({
		// stateDir rejects path separators; encodeURIComponent is injective
		// (@scope/cli → %40scope%2Fcli), so distinct packages never collide
		dirPath: stateDir(encodeURIComponent(packageName)),
		name: "update-notifier",
		fields: {
			lastCheckedAt: { type: "number", default: 0 },
			latestVersion: { type: "string" },
			lastNotifiedVersion: { type: "string" },
			registryUrl: { type: "string" },
		},
	});
	return {
		// State cached from a different registry is stale, not reusable
		read: async () => {
			const state = await store.read();
			if (state.registryUrl !== registryUrl) return null;
			return {
				lastCheckedAt: state.lastCheckedAt,
				latestVersion: state.latestVersion,
				lastNotifiedVersion: state.lastNotifiedVersion,
			};
		},
		// Explicit keys: the store's write type requires every field present
		write: async (state) => {
			await store.write({
				lastCheckedAt: state.lastCheckedAt,
				latestVersion: state.latestVersion,
				lastNotifiedVersion: state.lastNotifiedVersion,
				registryUrl,
			});
		},
	};
}

function detectPackageManager(): UpdateNotifierPackageManager {
	const detectedFromUserAgent = packageManagerFromUserAgent(process.env.npm_config_user_agent);
	if (detectedFromUserAgent) return detectedFromUserAgent;

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

// Yarn Berry has no `global`, so global Yarn installs fall back to npm.
const INSTALL_COMMANDS = {
	npm: { global: "npm install -g", local: "npm install" },
	pnpm: { global: "pnpm add -g", local: "pnpm add" },
	yarn: { global: "npm install -g", local: "yarn add" },
	bun: { global: "bun add -g", local: "bun add" },
} as const satisfies Record<UpdateNotifierPackageManager, Record<"global" | "local", string>>;

function defaultUpdateCommand(
	packageName: string,
	packageManager: UpdateNotifierPackageManager,
	scope: "global" | "local",
): string {
	return `${INSTALL_COMMANDS[packageManager][scope]} ${packageName}@latest`;
}

function resolveUpdateCommand(
	packageName: string,
	updateCommand: UpdateNotifierOptions["updateCommand"],
): string | undefined {
	// oxlint-disable-next-line anti-slop/no-runtime-typeof -- discriminating a typed options union.
	if (updateCommand === undefined || typeof updateCommand === "string") return updateCommand;

	const packageManager = detectPackageManager();
	// oxlint-disable-next-line anti-slop/no-runtime-typeof -- discriminating a typed options union.
	if (typeof updateCommand === "function") {
		return updateCommand({ packageName, packageManager });
	}
	return defaultUpdateCommand(packageName, packageManager, updateCommand.scope);
}

// ────────────────────────────────────────────────────────────────────────────
// Extension factory
// ────────────────────────────────────────────────────────────────────────────

/**
 * Creates an update notifier extension that checks the npm registry after a
 * successful command action and displays a notice when a newer version is available.
 *
 * **Behavior:**
 * - By default, checks are cached for 24 hours in the package's state directory.
 * - `cache: false` disables cross-run persistence.
 * - A custom cache adapter can override the built-in persistence.
 * - The notice is command-less unless `updateCommand` is configured.
 * - The postRun hook awaits the network check and cache reads and writes,
 *   delaying invocation completion after the action.
 * - `timeoutMs` bounds only the network request, defaulting to 5 seconds.
 * - Network, cache, and parsing errors are silently swallowed. A missing
 *   current version throws a DEFINITION error before that recovery block.
 * - Update notices are intentionally written to the invocation's stderr callback.
 * - Duplicate notifications for the same version are suppressed.
 *
 * @param options - Extension configuration. `packageName` is required.
 * @returns An Extension registered with `.extend()`.
 *
 * @example
 * ```ts
 * import { Crust } from "@crustjs/core";
 * import { updateNotifier } from "@crustjs/extensions";
 *
 * const app = new Crust("my-cli", { description: "My awesome CLI", version: "1.2.3" })
 *   .extend(updateNotifier({ packageName: "my-cli" }))
 *   .action(() => {
 *     console.log("Hello!");
 *   });
 *
 * await app.execute();
 * ```
 */
export const updateNotifier: ExtensionFactory<[options: UpdateNotifierOptions]> = defineExtension(
	UPDATE_NOTIFIER,
).factory((extension, options) => {
	const {
		currentVersion,
		packageName,
		timeoutMs = DEFAULT_TIMEOUT_MS,
		registryUrl = DEFAULT_REGISTRY_URL,
		updateCommand,
		updateDocsUrl,
		cache,
	} = options;
	const intervalMs = (cache === false ? undefined : cache?.intervalMs) ?? DEFAULT_INTERVAL_MS;

	return extension.postRun(async (context, outcome) => {
		if (outcome.status !== "completed") return;

		const resolvedCurrentVersion = currentVersion ?? context.rootCommand.meta.version;
		if (resolvedCurrentVersion === undefined) {
			throw new CrustError(
				"DEFINITION",
				"The update notifier extension requires a version in new Crust(name, { version }) or currentVersion",
			);
		}

		try {
			let cacheAdapter: UpdateNotifierCacheAdapter = NO_CACHE_ADAPTER;
			if (cache !== false) {
				if (cache?.adapter) {
					cacheAdapter = cache.adapter;
				} else {
					cacheAdapter = await createStoreCacheAdapter(packageName, registryUrl);
				}
			}

			// Corrupt/unreadable cache (e.g. CrustStoreError PARSE) reads as empty
			// so the next successful write repairs the file instead of permanently
			// disabling the notifier.
			const state = normalizeNotifierState(await cacheAdapter.read().catch(() => null));
			const notify = (latestVersion: string): boolean => {
				if (
					!isNewerVersion(resolvedCurrentVersion, latestVersion) ||
					state.lastNotifiedVersion === latestVersion
				) {
					return false;
				}
				emitUpdateNotice(
					resolvedCurrentVersion,
					latestVersion,
					resolveUpdateCommand(packageName, updateCommand),
					updateDocsUrl,
					context.stderr,
				);
				return true;
			};

			// ── Cache gate: skip network if within interval ──────────
			const now = Date.now();
			const elapsed = now - state.lastCheckedAt;

			// Negative elapsed (clock rollback, corrupt future timestamp) is
			// treated as stale so the refetch rewrites lastCheckedAt.
			if (cache !== false && elapsed >= 0 && elapsed < intervalMs) {
				// Cache is still fresh — use cached version if available
				if (state.latestVersion && notify(state.latestVersion)) {
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
			// `finally` records the check even when an `updateCommand` callback
			// throws, so a broken callback cannot force a refetch on every run.
			let notified = false;
			try {
				notified = notify(latestVersion);
			} finally {
				await cacheAdapter.write(
					notified ? { ...nextState, lastNotifiedVersion: latestVersion } : nextState,
				);
			}
		} catch {
			// Registry, cache, and notification failures must not fail the completed command.
		}
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Internal — Update notice output
// ────────────────────────────────────────────────────────────────────────────

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
	const contentWidth = Math.max(...contentLines.map((line) => stringWidth(line)));
	const innerWidth = contentWidth + PADDING * 2;

	const border = "─".repeat(innerWidth);
	const pad = " ".repeat(PADDING);
	const emptyLine = `${yellow("│")}${" ".repeat(innerWidth)}${yellow("│")}`;

	const lines = [
		"",
		`${yellow("╭")}${yellow(border)}${yellow("╮")}`,
		emptyLine,
		...contentLines.map(
			(line) => `${yellow("│")}${pad}${padEnd(line, contentWidth)}${pad}${yellow("│")}`,
		),
		emptyLine,
		`${yellow("╰")}${yellow(border)}${yellow("╯")}`,
		"",
	];

	stderr(lines.join("\n"));
}
