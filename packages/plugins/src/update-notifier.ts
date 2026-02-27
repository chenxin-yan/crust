// ────────────────────────────────────────────────────────────────────────────
// @crustjs/plugins — Update notifier plugin
// ────────────────────────────────────────────────────────────────────────────

import type { CrustPlugin } from "@crustjs/core";
import { configDir, createStore } from "@crustjs/store";

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
// Store schema — notifier state fields
// ────────────────────────────────────────────────────────────────────────────

/** Store name used for the update-notifier cache file. */
const STORE_NAME = "update-notifier";

/** Key used in plugin state for process-level dedupe. */
const DEDUPE_STATE_KEY = "update-notifier:checked";

/**
 * Store field definitions for the update-notifier persistent cache.
 *
 * - `lastCheckedAt` — Unix timestamp (ms) of the last network check.
 * - `latestVersion` — The latest version string from the registry.
 * - `lastNotifiedVersion` — The version last shown in a notice (dedupe).
 */
const NOTIFIER_STORE_FIELDS = {
	lastCheckedAt: { type: "number", default: 0 },
	latestVersion: { type: "string" },
	lastNotifiedVersion: { type: "string" },
} as const;

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
		intervalMs = DEFAULT_INTERVAL_MS,
		enabled = true,
		timeoutMs = DEFAULT_TIMEOUT_MS,
		registryUrl = DEFAULT_REGISTRY_URL,
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

			try {
				// ── Process-level dedupe guard ────────────────────────────
				// Prevents duplicate checks when multiple commands run in
				// a single process (e.g. subcommands sharing the same plugin).
				if (context.state.has(DEDUPE_STATE_KEY)) {
					return;
				}
				context.state.set(DEDUPE_STATE_KEY, true);

				// ── Resolve package name ─────────────────────────────────
				const resolvedPackageName =
					explicitPackageName ?? context.rootCommand.meta.name;

				// ── Create persistent store ──────────────────────────────
				const store = createStore({
					dirPath: configDir(resolvedPackageName),
					name: STORE_NAME,
					fields: NOTIFIER_STORE_FIELDS,
				});

				const state = await store.read();

				// ── Cache gate: skip network if within interval ──────────
				const now = Date.now();
				const elapsed = now - state.lastCheckedAt;

				if (elapsed < intervalMs) {
					// Cache is still fresh — use cached version if available
					if (
						state.latestVersion &&
						isNewerVersion(currentVersion, state.latestVersion) &&
						state.lastNotifiedVersion !== state.latestVersion
					) {
						emitUpdateNotice(currentVersion, state.latestVersion);
						await store.update((s) => ({
							...s,
							lastNotifiedVersion: state.latestVersion,
						}));
					}
					return;
				}

				// ── Network check: fetch latest version ──────────────────
				const latestVersion = await fetchLatestVersion(
					resolvedPackageName,
					registryUrl,
					timeoutMs,
				);

				if (latestVersion === null) {
					// Soft failure — update timestamp to avoid retrying too soon
					await store.update((s) => ({
						...s,
						lastCheckedAt: now,
					}));
					return;
				}

				// ── Persist fetched version and timestamp ─────────────────
				await store.update((s) => ({
					...s,
					lastCheckedAt: now,
					latestVersion,
				}));

				// ── Emit notice if newer and not already notified ─────────
				if (
					isNewerVersion(currentVersion, latestVersion) &&
					state.lastNotifiedVersion !== latestVersion
				) {
					emitUpdateNotice(currentVersion, latestVersion);
					await store.update((s) => ({
						...s,
						lastNotifiedVersion: latestVersion,
					}));
				}
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

/**
 * Emits a concise update notice to stderr.
 *
 * Uses stderr so it does not interfere with piped stdout output.
 *
 * @internal
 */
function emitUpdateNotice(currentVersion: string, latestVersion: string): void {
	console.error(
		`\nUpdate available: ${currentVersion} → ${latestVersion}\nRun "npm update" to update.\n`,
	);
}
