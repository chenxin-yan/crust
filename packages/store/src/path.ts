// ────────────────────────────────────────────────────────────────────────────
// @crustjs/store — Cross-platform config path resolution
// ────────────────────────────────────────────────────────────────────────────

import { homedir } from "node:os";
import { join } from "node:path";
import { CrustStoreError } from "./errors.ts";

/**
 * Default store name used when no explicit `name` is provided.
 * Produces `config.json` as the filename.
 */
const DEFAULT_STORE_NAME = "config";

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
 * Validates that `name` is a non-empty string without path separators or `.json` extension.
 *
 * @param name - Store name to validate.
 * @throws {CrustStoreError} `PATH` if `name` is empty, contains path separators, or ends with `.json`.
 */
function validateName(name: string): void {
	if (!name || name.trim().length === 0) {
		throw new CrustStoreError("PATH", "name must be a non-empty string", {
			path: name ?? "",
		});
	}

	if (name.includes("/") || name.includes("\\")) {
		throw new CrustStoreError("PATH", "name must not contain path separators", {
			path: name,
		});
	}

	if (name.endsWith(".json")) {
		throw new CrustStoreError(
			"PATH",
			"name must not include the .json extension",
			{
				path: name,
			},
		);
	}
}

/**
 * Validates that a directory path is an absolute, non-empty string that
 * does not end with `.json`.
 *
 * @param dirPath - The directory path to validate.
 * @throws {CrustStoreError} `PATH` if the path is empty, not absolute, or ends in `.json`.
 */
function validateDirPath(dirPath: string): void {
	if (!dirPath || dirPath.trim().length === 0) {
		throw new CrustStoreError("PATH", "dirPath must be a non-empty string", {
			path: dirPath ?? "",
		});
	}

	// Check for absolute path — Unix starts with `/`, Windows with drive letter or UNC
	const isAbsolute = dirPath.startsWith("/") || /^[A-Za-z]:[/\\]/.test(dirPath);

	if (!isAbsolute) {
		throw new CrustStoreError("PATH", "dirPath must be an absolute path", {
			path: dirPath,
		});
	}

	if (dirPath.endsWith(".json")) {
		throw new CrustStoreError(
			"PATH",
			"dirPath must be a directory path, not a file path (should not end with .json)",
			{
				path: dirPath,
			},
		);
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
 * @param appName - Application name used as directory name. Must be a non-empty
 *   string without path separators.
 * @param env - Optional platform environment override for testing.
 * @returns Absolute path to the app's config directory.
 * @throws {CrustStoreError} `PATH` if `appName` is invalid or platform is unsupported.
 *
 * @example
 * ```ts
 * import { configDir } from "@crustjs/store";
 *
 * const dir = configDir("my-cli");
 * // → "/home/user/.config/my-cli" (Linux)
 * // → "/Users/user/Library/Application Support/my-cli" (macOS)
 * // → "C:\\Users\\user\\AppData\\Roaming\\my-cli" (Windows)
 * ```
 */
export function configDir(appName: string, env?: PlatformEnv): string {
	validateAppName(appName);

	const resolvedEnv = env ?? getRuntimeEnv();

	switch (resolvedEnv.platform) {
		case "linux": {
			const xdgConfig = resolvedEnv.env.XDG_CONFIG_HOME;
			const base =
				xdgConfig && xdgConfig.trim().length > 0
					? xdgConfig
					: join(resolvedEnv.homedir, ".config");
			return join(base, appName);
		}

		case "darwin": {
			return join(
				resolvedEnv.homedir,
				"Library",
				"Application Support",
				appName,
			);
		}

		case "win32": {
			const appData = resolvedEnv.env.APPDATA;
			const base =
				appData && appData.trim().length > 0
					? appData
					: join(resolvedEnv.homedir, "AppData", "Roaming");
			return join(base, appName);
		}

		default:
			throw new CrustStoreError(
				"PATH",
				`Unsupported platform: ${resolvedEnv.platform}`,
				{
					path: resolvedEnv.platform,
				},
			);
	}
}

// ────────────────────────────────────────────────────────────────────────────
// resolveStorePath — Internal file path construction
// ────────────────────────────────────────────────────────────────────────────

/**
 * Constructs the absolute config file path from a directory and store name.
 *
 * Validates `dirPath` (must be absolute, not end in `.json`) and `name`
 * (no path separators, no `.json` suffix), then joins them as
 * `<dirPath>/<name>.json`.
 *
 * @param dirPath - Absolute directory path.
 * @param name - Optional store name (defaults to `"config"`).
 * @returns Absolute path to the config file.
 * @throws {CrustStoreError} `PATH` if `dirPath` or `name` is invalid.
 */
export function resolveStorePath(dirPath: string, name?: string): string {
	validateDirPath(dirPath);

	// Resolve store name (validate only when explicitly provided)
	const storeName = name ?? DEFAULT_STORE_NAME;
	if (name !== undefined) {
		validateName(name);
	}

	return join(dirPath, `${storeName}.json`);
}
