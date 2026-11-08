// ────────────────────────────────────────────────────────────────────────────
// @crustjs/extensions — Update notifier extension
// ────────────────────────────────────────────────────────────────────────────

import {
	type Extension,
	type ExtensionId,
	type RootMetaKey,
	defineExtension,
	defineExtensionId,
} from "@crustjs/core";
import type { PackageManager } from "@crustjs/utils/package-manager";

import { isCI } from "./is-ci.ts";

const UPDATE_NOTIFIER: ExtensionId = /* @__PURE__ */ defineExtensionId("crust:update-notifier");

export type UpdateNotifierPackageManager = PackageManager;

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

/** CI runs, redirected stderr, and the user's opt-out skip the check entirely. */
function isUpdateCheckSuppressed(): boolean {
	return isCI() || !!process.env.NO_UPDATE_NOTIFIER || !process.stderr?.isTTY;
}

// ────────────────────────────────────────────────────────────────────────────
// Extension factory
// ────────────────────────────────────────────────────────────────────────────

type UpdateNotifierRegistration<K extends RootMetaKey> = Extension<{}, [], {}, [], K>;

/** An explicit `currentVersion` supplies the version; omitting it requires root metadata. */
export interface UpdateNotifierExtension {
	(options: UpdateNotifierOptions & { currentVersion: string }): UpdateNotifierRegistration<never>;
	(options: UpdateNotifierOptions): UpdateNotifierRegistration<"version">;
	readonly id: ExtensionId;
}

// The builder requires no metadata so one factory serves both overloads; the
// `UpdateNotifierExtension` annotation narrows omitted versions to require root `version`.
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
 * - Network, cache, and parsing errors are silently swallowed.
 * - The check is skipped, with no cache or network access, when `CI` is set
 *   (other than `"0"` or `"false"` in any letter case), when `NO_UPDATE_NOTIFIER` is non-empty, or
 *   when `process.stderr` is not a TTY.
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
 *   .action(({ stdout }) => {
 *     stdout("Hello!");
 *   });
 *
 * await app.execute();
 * ```
 */
export const updateNotifier: UpdateNotifierExtension = /* @__PURE__ */ defineExtension(
	UPDATE_NOTIFIER,
).factory((extension, options: UpdateNotifierOptions) => {
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

		// SAFETY: the `UpdateNotifierExtension` overloads require root `version` metadata without `currentVersion`.
		const resolvedCurrentVersion = currentVersion ?? context.rootCommand.meta.version!;
		if (isUpdateCheckSuppressed()) return;

		try {
			// The registry check, cache, and notice (with @crustjs/style) load only when a check runs.
			const { runUpdateCheck } = await import("./update-notifier-check.ts");
			await runUpdateCheck({
				currentVersion: resolvedCurrentVersion,
				packageName,
				timeoutMs,
				registryUrl,
				intervalMs,
				updateCommand,
				updateDocsUrl,
				cache,
				stderr: context.stderr,
			});
		} catch {
			// A check chunk that fails to load (e.g. replaced by an upgrade mid-run) must not fail the completed command.
		}
	});
});
