import { existsSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// ────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ────────────────────────────────────────────────────────────────────────────

/**
 * Find the nearest directory containing `package.json` by walking up the
 * filesystem from `startPath`.
 *
 * If `startPath` points at an existing file, its parent directory is used as
 * the starting point. The directory walk uses `path.resolve()` (lexical), not
 * `fs.realpath()`, so a symlink's parent chain is walked rather than the
 * symlink target's parent chain.
 *
 * @param startPath - Directory or file path to start walking from.
 * @returns The absolute path of the nearest enclosing directory containing
 *   `package.json`, or `null` if the filesystem root is reached first.
 *
 * @internal Not exported from the package's public surface in `0.0.1`.
 *   Promotion to public is tracked as tech debt and will happen when a
 *   standalone external consumer is identified.
 */
function findNearestPackageRoot(startPath: string): string | null {
	let current = resolve(startPath);

	if (existsSync(current) && !statSync(current).isDirectory()) {
		current = dirname(current);
	}

	while (true) {
		if (existsSync(join(current, "package.json"))) {
			return current;
		}

		const parent = dirname(current);
		if (parent === current) {
			return null;
		}

		current = parent;
	}
}

// ────────────────────────────────────────────────────────────────────────────
// Public — resolveSourceDir
// ────────────────────────────────────────────────────────────────────────────

/**
 * Resolves an absolute filesystem path from a caller-supplied source
 * directory descriptor. Designed for tools that ship reference assets
 * (templates, skill bundles, etc.) alongside their published package and
 * need a uniform way to locate them at runtime regardless of how the
 * consumer expressed the path.
 *
 * Three input modes are supported:
 * - **`URL`** — must use the `file:` protocol. Resolved via
 *   `url.fileURLToPath()`. The intended idiom is
 *   `new URL("./relative/path", import.meta.url)`.
 * - **Absolute string path** — returned as `path.resolve(input)`.
 * - **Relative string path** — resolved against the nearest `package.json`
 *   directory walking up from `process.argv[1]`. This makes
 *   `"templates/base"` resolve to `<consumer-package-root>/templates/base`
 *   regardless of cwd.
 *
 * Three failure modes throw descriptive `Error`s:
 * - URL with non-`file:` protocol — message names the offending protocol.
 * - Relative string path with `process.argv[1]` unset — message suggests
 *   switching to an absolute path or a `file:` URL.
 * - Relative string path but no `package.json` found walking up — message
 *   names the entrypoint and the relative input, and suggests switching to
 *   an absolute path or a `file:` URL.
 *
 * @param input - File URL, absolute path, or package-relative path.
 * @returns Absolute filesystem path.
 * @throws {Error} For any of the three failure modes above.
 *
 * @example
 * ```ts
 * import { resolveSourceDir } from "@crustjs/utils";
 *
 * // 1. file: URL — relative to the calling module
 * const a = resolveSourceDir(new URL("../templates/base", import.meta.url));
 *
 * // 2. Absolute path
 * const b = resolveSourceDir("/abs/path/to/templates/base");
 *
 * // 3. Relative path — resolved from the consuming package's root
 * const c = resolveSourceDir("templates/base");
 * ```
 */
export function resolveSourceDir(input: string | URL): string {
	if (input instanceof URL) {
		if (input.protocol !== "file:") {
			throw new Error(`sourceDir URL must use file: protocol, got "${input.protocol}".`);
		}
		return fileURLToPath(input);
	}

	if (isAbsolute(input)) {
		return resolve(input);
	}

	const entrypoint = process.argv[1];
	if (!entrypoint) {
		throw new Error(
			`Could not resolve relative sourceDir "${input}" because process.argv[1] is not set. ` +
				`Pass an absolute path or a file: URL.`,
		);
	}

	const packageRoot = findNearestPackageRoot(resolve(entrypoint));
	if (!packageRoot) {
		throw new Error(
			`Could not resolve relative sourceDir "${input}" from entrypoint "${entrypoint}" ` +
				`because no package.json was found in its parent directories. ` +
				`Pass an absolute path or a file: URL.`,
		);
	}

	return resolve(packageRoot, input);
}
