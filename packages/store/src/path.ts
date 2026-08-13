// ────────────────────────────────────────────────────────────────────────────
// @crustjs/store — Cross-platform path resolution for config/data/state/cache
// ────────────────────────────────────────────────────────────────────────────

import { homedir } from "node:os";
import { join, win32 } from "node:path";

import { CrustStoreError } from "./errors.ts";

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
		env: process.env,
		homedir: homedir(),
	};
}

// ────────────────────────────────────────────────────────────────────────────
// Path validation helpers
// ────────────────────────────────────────────────────────────────────────────

/** Validates a path input according to its role. */
function validatePath(value: string, field: "appName" | "name" | "dirPath"): void {
	if (typeof value !== "string" || !value.trim()) {
		throw new CrustStoreError("PATH", `${field} must be a non-empty string`, {
			path: typeof value === "string" ? value : "",
		});
	}

	if (field !== "dirPath" && (value.includes("/") || value.includes("\\"))) {
		throw new CrustStoreError("PATH", `${field} must not contain path separators`, { path: value });
	}

	if (field === "dirPath" && !win32.isAbsolute(value)) {
		throw new CrustStoreError("PATH", "dirPath must be an absolute path", { path: value });
	}

	if (field === "name" && value.endsWith(".json")) {
		throw new CrustStoreError("PATH", "name must not include the .json extension", { path: value });
	}

	if (field === "dirPath" && value.endsWith(".json")) {
		throw new CrustStoreError(
			"PATH",
			"dirPath must be a directory path, not a file path (should not end with .json)",
			{ path: value },
		);
	}
}

// ────────────────────────────────────────────────────────────────────────────
// Internal: platform directory resolver
// ────────────────────────────────────────────────────────────────────────────

const DIRECTORY_CONFIG = {
	config: {
		xdg: "XDG_CONFIG_HOME",
		unixFallback: [".config"],
		windowsEnv: "APPDATA",
		windowsFallback: ["AppData", "Roaming"],
		windowsSuffix: [],
	},
	data: {
		xdg: "XDG_DATA_HOME",
		unixFallback: [".local", "share"],
		windowsEnv: "LOCALAPPDATA",
		windowsFallback: ["AppData", "Local"],
		windowsSuffix: ["Data"],
	},
	state: {
		xdg: "XDG_STATE_HOME",
		unixFallback: [".local", "state"],
		windowsEnv: "LOCALAPPDATA",
		windowsFallback: ["AppData", "Local"],
		windowsSuffix: ["State"],
	},
	cache: {
		xdg: "XDG_CACHE_HOME",
		unixFallback: [".cache"],
		windowsEnv: "LOCALAPPDATA",
		windowsFallback: ["AppData", "Local"],
		windowsSuffix: ["Cache"],
	},
} as const;

function resolvePlatformDir(
	kind: keyof typeof DIRECTORY_CONFIG,
	appName: string,
	env = getRuntimeEnv(),
): string {
	validatePath(appName, "appName");
	const config = DIRECTORY_CONFIG[kind];

	if (env.platform === "linux" || env.platform === "darwin") {
		const configured = env.env[config.xdg];
		const base = configured?.trim() ? configured : join(env.homedir, ...config.unixFallback);
		return join(base, appName);
	}
	if (env.platform === "win32") {
		const configured = env.env[config.windowsEnv];
		const base = configured?.trim() ? configured : join(env.homedir, ...config.windowsFallback);
		return join(base, appName, ...config.windowsSuffix);
	}

	throw new CrustStoreError("PATH", `Unsupported platform: ${env.platform}`, {
		path: env.platform,
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
	return resolvePlatformDir("config", appName, env);
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
	return resolvePlatformDir("data", appName, env);
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
	return resolvePlatformDir("state", appName, env);
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
	return resolvePlatformDir("cache", appName, env);
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
 * @param name - Store name used as the JSON filename.
 * @returns Absolute path to the store file.
 * @throws {CrustStoreError} `PATH` if `dirPath` or `name` is invalid.
 */
export function resolveStorePath(dirPath: string, name: string): string {
	validatePath(dirPath, "dirPath");
	validatePath(name, "name");
	return join(dirPath, `${name}.json`);
}
