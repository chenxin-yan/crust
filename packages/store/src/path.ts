// ────────────────────────────────────────────────────────────────────────────
// @crustjs/store — Cross-platform config path resolution
// ────────────────────────────────────────────────────────────────────────────

import { homedir } from "node:os";
import { join } from "node:path";
import { CrustStoreError } from "./errors.ts";

/**
 * Default config filename used when deriving platform-standard paths.
 */
const CONFIG_FILENAME = "config.json";

// ────────────────────────────────────────────────────────────────────────────
// Platform environment — injectable for testing
// ────────────────────────────────────────────────────────────────────────────

/**
 * Encapsulates runtime environment values needed for path resolution.
 *
 * Exposed as a parameter to allow deterministic testing without mutating
 * `process.env` or `process.platform`.
 */
export interface PlatformEnv {
	/** Operating system platform identifier (e.g. `"linux"`, `"darwin"`, `"win32"`). */
	platform: string;
	/** Environment variables map. */
	env: Record<string, string | undefined>;
	/** User home directory path. */
	homedir: string;
}

/**
 * Returns the current runtime environment for path resolution.
 *
 * @returns Platform environment values sourced from `process` and `os.homedir()`.
 */
function getRuntimeEnv(): PlatformEnv {
	return {
		platform: process.platform,
		env: process.env as Record<string, string | undefined>,
		homedir: homedir(),
	};
}

// ────────────────────────────────────────────────────────────────────────────
// Path validation helpers
// ────────────────────────────────────────────────────────────────────────────

/**
 * Validates that `appName` is a non-empty string without path separators.
 *
 * @param appName - Application name to validate.
 * @throws {CrustStoreError} `PATH` if `appName` is empty or contains path separators.
 */
function validateAppName(appName: string): void {
	if (!appName || appName.trim().length === 0) {
		throw new CrustStoreError("PATH", "appName must be a non-empty string", {
			path: appName ?? "",
		});
	}

	if (appName.includes("/") || appName.includes("\\")) {
		throw new CrustStoreError(
			"PATH",
			"appName must not contain path separators",
			{
				path: appName,
			},
		);
	}
}

/**
 * Validates that an explicit file path override is an absolute path ending in `.json`.
 *
 * @param filePath - The explicit path override to validate.
 * @throws {CrustStoreError} `PATH` if the path is not absolute or does not end in `.json`.
 */
function validateFilePath(filePath: string): void {
	if (!filePath || filePath.trim().length === 0) {
		throw new CrustStoreError("PATH", "filePath must be a non-empty string", {
			path: filePath ?? "",
		});
	}

	// Check for absolute path — Unix starts with `/`, Windows with drive letter or UNC
	const isAbsolute =
		filePath.startsWith("/") || /^[A-Za-z]:[/\\]/.test(filePath);

	if (!isAbsolute) {
		throw new CrustStoreError("PATH", "filePath must be an absolute path", {
			path: filePath,
		});
	}

	if (!filePath.endsWith(".json")) {
		throw new CrustStoreError("PATH", "filePath must end with .json", {
			path: filePath,
		});
	}
}

// ────────────────────────────────────────────────────────────────────────────
// Platform-standard config directory resolution
// ────────────────────────────────────────────────────────────────────────────

/**
 * Resolves the platform-standard config directory for the given app.
 *
 * Platform conventions:
 * - **Linux**: `$XDG_CONFIG_HOME/<appName>` or `~/.config/<appName>`
 * - **macOS**: `~/Library/Application Support/<appName>`
 * - **Windows**: `%APPDATA%/<appName>` or `~/AppData/Roaming/<appName>`
 *
 * @param appName - Application name used as directory name.
 * @param env - Platform environment (defaults to runtime environment).
 * @returns Absolute path to the app's config directory.
 * @throws {CrustStoreError} `PATH` on unsupported platforms or missing home directory.
 */
function resolveConfigDir(appName: string, env: PlatformEnv): string {
	switch (env.platform) {
		case "linux": {
			const xdgConfig = env.env.XDG_CONFIG_HOME;
			const base =
				xdgConfig && xdgConfig.trim().length > 0
					? xdgConfig
					: join(env.homedir, ".config");
			return join(base, appName);
		}

		case "darwin": {
			return join(env.homedir, "Library", "Application Support", appName);
		}

		case "win32": {
			const appData = env.env.APPDATA;
			const base =
				appData && appData.trim().length > 0
					? appData
					: join(env.homedir, "AppData", "Roaming");
			return join(base, appName);
		}

		default:
			throw new CrustStoreError(
				"PATH",
				`Unsupported platform: ${env.platform}`,
				{
					path: env.platform,
				},
			);
	}
}

// ────────────────────────────────────────────────────────────────────────────
// Public API — resolveStorePath
// ────────────────────────────────────────────────────────────────────────────

/**
 * Resolves the absolute config file path for a store.
 *
 * When `filePath` is provided, it is validated and used directly (bypassing
 * platform path derivation). Otherwise, the path is derived from `appName`
 * using platform-standard conventions.
 *
 * Resolution rules:
 * - Explicit `filePath` → validated as absolute `.json` path and returned as-is.
 * - No `filePath` → derive from `appName` and platform:
 *   - Linux: `$XDG_CONFIG_HOME/<appName>/config.json` (fallback `~/.config/<appName>/config.json`)
 *   - macOS: `~/Library/Application Support/<appName>/config.json`
 *   - Windows: `%APPDATA%/<appName>/config.json` (fallback `~/AppData/Roaming/<appName>/config.json`)
 *
 * @param appName - Application name used to derive the config directory.
 * @param filePath - Optional explicit file path override.
 * @param env - Optional platform environment override for testing.
 * @returns Absolute path to the config file.
 * @throws {CrustStoreError} `PATH` if inputs are invalid or platform is unsupported.
 *
 * @example
 * ```ts
 * // Platform-derived path
 * const path = resolveStorePath("my-cli");
 * // → "/home/user/.config/my-cli/config.json" (Linux)
 *
 * // Explicit override
 * const path = resolveStorePath("my-cli", "/custom/path/settings.json");
 * // → "/custom/path/settings.json"
 * ```
 */
export function resolveStorePath(
	appName: string,
	filePath?: string,
	env?: PlatformEnv,
): string {
	// Always validate appName — it's required even when filePath is provided
	validateAppName(appName);

	// Explicit path override bypasses platform derivation
	if (filePath !== undefined) {
		validateFilePath(filePath);
		return filePath;
	}

	// Resolve runtime environment if not injected
	const resolvedEnv = env ?? getRuntimeEnv();

	const configDir = resolveConfigDir(appName, resolvedEnv);
	return join(configDir, CONFIG_FILENAME);
}
