import { existsSync } from "node:fs";
import { join } from "node:path";

// ────────────────────────────────────────────────────────────────────────────
// Package Manager Detection
// ────────────────────────────────────────────────────────────────────────────

/**
 * Lockfile names mapped to their package manager.
 *
 * Checked in order: bun → pnpm → yarn → npm.
 */
const LOCKFILE_MAP: ReadonlyArray<readonly [string, string]> = [
	["bun.lock", "bun"],
	["bun.lockb", "bun"],
	["pnpm-lock.yaml", "pnpm"],
	["yarn.lock", "yarn"],
	["package-lock.json", "npm"],
] as const;

/**
 * Detect the package manager for a project directory.
 *
 * Detection strategy (first match wins):
 * 1. Check for lockfiles in `cwd` (bun.lock/bun.lockb → pnpm-lock.yaml → yarn.lock → package-lock.json)
 * 2. Parse the `npm_config_user_agent` environment variable
 * 3. Default to `"npm"`
 *
 * @param cwd - The directory to check for lockfiles. Defaults to `process.cwd()`.
 * @returns The detected package manager name: `"bun"`, `"pnpm"`, `"yarn"`, or `"npm"`.
 *
 * @example
 * ```ts
 * const pm = detectPackageManager("./my-project");
 * // => "bun" (if bun.lock exists)
 * ```
 */
export function detectPackageManager(cwd?: string): string {
	const dir = cwd ?? process.cwd();

	// Check lockfiles in priority order
	for (const [lockfile, manager] of LOCKFILE_MAP) {
		if (existsSync(join(dir, lockfile))) {
			return manager;
		}
	}

	// Fall back to npm_config_user_agent (set by npm/yarn/pnpm/bun when running scripts)
	const userAgent = process.env.npm_config_user_agent;
	if (userAgent) {
		if (userAgent.startsWith("bun")) return "bun";
		if (userAgent.startsWith("pnpm")) return "pnpm";
		if (userAgent.startsWith("yarn")) return "yarn";
		if (userAgent.startsWith("npm")) return "npm";
	}

	return "npm";
}

// ────────────────────────────────────────────────────────────────────────────
// Git Helpers
// ────────────────────────────────────────────────────────────────────────────

/**
 * Check whether `git` is installed and available on the system PATH.
 *
 * Runs `git --version` and returns `true` if it exits successfully.
 *
 * @returns `true` if git is available, `false` otherwise.
 *
 * @example
 * ```ts
 * if (isGitInstalled()) {
 *   console.log("Git is available");
 * }
 * ```
 */
export function isGitInstalled(): boolean {
	try {
		const result = Bun.spawnSync(["git", "--version"]);
		return result.exitCode === 0;
	} catch {
		return false;
	}
}

/**
 * Read the current git user's name and email from `git config`.
 *
 * Returns `null` for either field if it is not configured.
 *
 * @returns An object with `name` and `email` (each `string | null`).
 *
 * @example
 * ```ts
 * const user = getGitUser();
 * console.log(user.name);  // "Jane Doe" or null
 * console.log(user.email); // "jane@example.com" or null
 * ```
 */
export function getGitUser(): { name: string | null; email: string | null } {
	return {
		name: readGitConfig("user.name"),
		email: readGitConfig("user.email"),
	};
}

/**
 * Read a single git config value. Returns `null` if the key is not set
 * or git is not available.
 */
function readGitConfig(key: string): string | null {
	try {
		const result = Bun.spawnSync(["git", "config", key]);
		if (result.exitCode !== 0) {
			return null;
		}
		const value = result.stdout.toString().trim();
		return value.length > 0 ? value : null;
	} catch {
		return null;
	}
}
