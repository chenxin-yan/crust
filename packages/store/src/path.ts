// ────────────────────────────────────────────────────────────────────────────
// @crustjs/store — Cross-platform path resolution for config/data/state/cache
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
// Internal: XDG-based directory resolver for Unix (Linux + macOS)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Returns an XDG-based directory for Unix platforms using the given env var
 * name and fallback relative path segment.
 */
function resolveUnixDir(
	env: PlatformEnv,
	xdgEnvVar: string,
	fallbackSegments: string[],
	appName: string,
): string {
	const xdgValue = env.env[xdgEnvVar];
	const base =
		xdgValue && xdgValue.trim().length > 0
			? xdgValue
			: join(env.homedir, ...fallbackSegments);
	return join(base, appName);
}

/**
 * Throws an unsupported platform error.
 */
function throwUnsupportedPlatform(platform: string): never {
	throw new CrustStoreError("PATH", `Unsupported platform: ${platform}`, {
		path: platform,
	});
}

// ────────────────────────────────────────────────────────────────────────────
// configDir — Platform-standard config directory
// ────────────────────────────────────────────────────────────────────────────

/**
 * Resolves the platform-standard config directory for the given app.
 *
 * Platform conventions:
 * - **Linux / macOS**: `$XDG_CONFIG_HOME/<appName>` or `~/.config/<appName>`
 * - **Windows**: `%APPDATA%/<appName>` or `~/AppData/Roaming/<appName>`
 *
 * macOS uses XDG conventions for consistency with Linux.
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
 * // → "/Users/user/.config/my-cli" (macOS)
 * // → "C:\\Users\\user\\AppData\\Roaming\\my-cli" (Windows)
 * ```
 */
export function configDir(appName: string, env?: PlatformEnv): string {
	validateAppName(appName);
	const resolvedEnv = env ?? getRuntimeEnv();

	switch (resolvedEnv.platform) {
		case "linux":
		case "darwin":
			return resolveUnixDir(
				resolvedEnv,
				"XDG_CONFIG_HOME",
				[".config"],
				appName,
			);

		case "win32": {
			const appData = resolvedEnv.env.APPDATA;
			const base =
				appData && appData.trim().length > 0
					? appData
					: join(resolvedEnv.homedir, "AppData", "Roaming");
			return join(base, appName);
		}

		default:
			throwUnsupportedPlatform(resolvedEnv.platform);
	}
}

// ────────────────────────────────────────────────────────────────────────────
// dataDir — Platform-standard data directory
// ────────────────────────────────────────────────────────────────────────────

/**
 * Resolves the platform-standard data directory for the given app.
 *
 * Platform conventions:
 * - **Linux / macOS**: `$XDG_DATA_HOME/<appName>` or `~/.local/share/<appName>`
 * - **Windows**: `%LOCALAPPDATA%/<appName>/Data` or `~/AppData/Local/<appName>/Data`
 *
 * macOS uses XDG conventions for consistency with Linux.
 *
 * @param appName - Application name used as directory name. Must be a non-empty
 *   string without path separators.
 * @param env - Optional platform environment override for testing.
 * @returns Absolute path to the app's data directory.
 * @throws {CrustStoreError} `PATH` if `appName` is invalid or platform is unsupported.
 *
 * @example
 * ```ts
 * import { dataDir } from "@crustjs/store";
 *
 * const dir = dataDir("my-cli");
 * // → "/home/user/.local/share/my-cli" (Linux)
 * // → "/Users/user/.local/share/my-cli" (macOS)
 * // → "C:\\Users\\user\\AppData\\Local\\my-cli\\Data" (Windows)
 * ```
 */
export function dataDir(appName: string, env?: PlatformEnv): string {
	validateAppName(appName);
	const resolvedEnv = env ?? getRuntimeEnv();

	switch (resolvedEnv.platform) {
		case "linux":
		case "darwin":
			return resolveUnixDir(
				resolvedEnv,
				"XDG_DATA_HOME",
				[".local", "share"],
				appName,
			);

		case "win32": {
			const localAppData = resolvedEnv.env.LOCALAPPDATA;
			const base =
				localAppData && localAppData.trim().length > 0
					? localAppData
					: join(resolvedEnv.homedir, "AppData", "Local");
			return join(base, appName, "Data");
		}

		default:
			throwUnsupportedPlatform(resolvedEnv.platform);
	}
}

// ────────────────────────────────────────────────────────────────────────────
// stateDir — Platform-standard state directory
// ────────────────────────────────────────────────────────────────────────────

/**
 * Resolves the platform-standard state directory for the given app.
 *
 * Platform conventions:
 * - **Linux / macOS**: `$XDG_STATE_HOME/<appName>` or `~/.local/state/<appName>`
 * - **Windows**: `%LOCALAPPDATA%/<appName>/State` or `~/AppData/Local/<appName>/State`
 *
 * macOS uses XDG conventions for consistency with Linux.
 *
 * @param appName - Application name used as directory name. Must be a non-empty
 *   string without path separators.
 * @param env - Optional platform environment override for testing.
 * @returns Absolute path to the app's state directory.
 * @throws {CrustStoreError} `PATH` if `appName` is invalid or platform is unsupported.
 *
 * @example
 * ```ts
 * import { stateDir } from "@crustjs/store";
 *
 * const dir = stateDir("my-cli");
 * // → "/home/user/.local/state/my-cli" (Linux)
 * // → "/Users/user/.local/state/my-cli" (macOS)
 * // → "C:\\Users\\user\\AppData\\Local\\my-cli\\State" (Windows)
 * ```
 */
export function stateDir(appName: string, env?: PlatformEnv): string {
	validateAppName(appName);
	const resolvedEnv = env ?? getRuntimeEnv();

	switch (resolvedEnv.platform) {
		case "linux":
		case "darwin":
			return resolveUnixDir(
				resolvedEnv,
				"XDG_STATE_HOME",
				[".local", "state"],
				appName,
			);

		case "win32": {
			const localAppData = resolvedEnv.env.LOCALAPPDATA;
			const base =
				localAppData && localAppData.trim().length > 0
					? localAppData
					: join(resolvedEnv.homedir, "AppData", "Local");
			return join(base, appName, "State");
		}

		default:
			throwUnsupportedPlatform(resolvedEnv.platform);
	}
}

// ────────────────────────────────────────────────────────────────────────────
// cacheDir — Platform-standard cache directory
// ────────────────────────────────────────────────────────────────────────────

/**
 * Resolves the platform-standard cache directory for the given app.
 *
 * Platform conventions:
 * - **Linux / macOS**: `$XDG_CACHE_HOME/<appName>` or `~/.cache/<appName>`
 * - **Windows**: `%LOCALAPPDATA%/<appName>/Cache` or `~/AppData/Local/<appName>/Cache`
 *
 * macOS uses XDG conventions for consistency with Linux.
 *
 * @param appName - Application name used as directory name. Must be a non-empty
 *   string without path separators.
 * @param env - Optional platform environment override for testing.
 * @returns Absolute path to the app's cache directory.
 * @throws {CrustStoreError} `PATH` if `appName` is invalid or platform is unsupported.
 *
 * @example
 * ```ts
 * import { cacheDir } from "@crustjs/store";
 *
 * const dir = cacheDir("my-cli");
 * // → "/home/user/.cache/my-cli" (Linux)
 * // → "/Users/user/.cache/my-cli" (macOS)
 * // → "C:\\Users\\user\\AppData\\Local\\my-cli\\Cache" (Windows)
 * ```
 */
export function cacheDir(appName: string, env?: PlatformEnv): string {
	validateAppName(appName);
	const resolvedEnv = env ?? getRuntimeEnv();

	switch (resolvedEnv.platform) {
		case "linux":
		case "darwin":
			return resolveUnixDir(resolvedEnv, "XDG_CACHE_HOME", [".cache"], appName);

		case "win32": {
			const localAppData = resolvedEnv.env.LOCALAPPDATA;
			const base =
				localAppData && localAppData.trim().length > 0
					? localAppData
					: join(resolvedEnv.homedir, "AppData", "Local");
			return join(base, appName, "Cache");
		}

		default:
			throwUnsupportedPlatform(resolvedEnv.platform);
	}
}

// ────────────────────────────────────────────────────────────────────────────
// resolveStorePath — Internal file path construction
// ────────────────────────────────────────────────────────────────────────────

/**
 * Constructs the absolute store file path from a directory and store name.
 *
 * Validates `dirPath` (must be absolute, not end in `.json`) and `name`
 * (no path separators, no `.json` suffix), then joins them as
 * `<dirPath>/<name>.json`.
 *
 * @param dirPath - Absolute directory path.
 * @param name - Optional store name (defaults to `"config"`).
 * @returns Absolute path to the store file.
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
