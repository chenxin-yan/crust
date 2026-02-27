// ────────────────────────────────────────────────────────────────────────────
// @crustjs/plugins — Update notifier plugin
// ────────────────────────────────────────────────────────────────────────────

import type { CrustPlugin } from "@crustjs/core";

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
 *   currentVersion: "1.2.3",
 *   packageName: "my-cli",
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
	 * updateNotifierPlugin({ currentVersion: pkg.version });
	 * ```
	 */
	currentVersion: string;

	/**
	 * The npm package name to check for updates.
	 *
	 * When omitted, defaults to the root command's `meta.name` at runtime.
	 */
	packageName?: string;

	/**
	 * Minimum interval in milliseconds between network update checks.
	 *
	 * Cached results are reused until this interval elapses.
	 *
	 * @default 86_400_000 (24 hours)
	 */
	intervalMs?: number;

	/**
	 * Whether the update notifier is enabled.
	 *
	 * Set to `false` to silently disable all check and notification behavior.
	 *
	 * @default true
	 */
	enabled?: boolean;

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
// Plugin factory
// ────────────────────────────────────────────────────────────────────────────

/**
 * Creates an update notifier plugin that performs background version checks
 * against the npm registry and displays a concise notice when a newer
 * version is available.
 *
 * **Behavior:**
 * - Checks are cached locally and run at most once per `intervalMs` (default 24h).
 * - The network check is non-blocking — it never delays command execution.
 * - All internal errors (network, store, parsing) are silently swallowed.
 * - The update notice is emitted *after* the command handler completes.
 * - Duplicate notifications for the same version are suppressed.
 *
 * @param options - Plugin configuration. Only `currentVersion` is required.
 * @returns A {@link CrustPlugin} instance.
 *
 * @example
 * ```ts
 * import { defineCommand, runMain } from "@crustjs/core";
 * import { updateNotifierPlugin } from "@crustjs/plugins";
 * import pkg from "../package.json";
 *
 * const root = defineCommand({
 *   meta: { name: "my-cli", description: "My awesome CLI" },
 *   run() {
 *     console.log("Hello!");
 *   },
 * });
 *
 * runMain(root, {
 *   plugins: [
 *     updateNotifierPlugin({ currentVersion: pkg.version }),
 *   ],
 * });
 * ```
 */
export function updateNotifierPlugin(
	options: UpdateNotifierPluginOptions,
): CrustPlugin {
	const {
		currentVersion,
		packageName: explicitPackageName,
		intervalMs: _intervalMs = DEFAULT_INTERVAL_MS,
		enabled = true,
		timeoutMs: _timeoutMs = DEFAULT_TIMEOUT_MS,
		registryUrl: _registryUrl = DEFAULT_REGISTRY_URL,
	} = options;

	// Early bail: disabled plugin returns a no-op
	if (!enabled) {
		return { name: "update-notifier" };
	}

	return {
		name: "update-notifier",

		async middleware(context, next) {
			// Always let the command execute first
			await next();

			// Resolve package name: explicit option → root command meta name
			const _resolvedPackageName =
				explicitPackageName ?? context.rootCommand.meta.name;

			// ──────────────────────────────────────────────────────────────
			// Runtime implementation will be added in subsequent tasks:
			// - Task 2: npm latest-version fetch + version comparison
			// - Task 3: persistent cache, middleware flow, notification
			// ──────────────────────────────────────────────────────────────

			void currentVersion;
		},
	};
}
