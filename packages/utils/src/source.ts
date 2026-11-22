// ────────────────────────────────────────────────────────────────────────────
// Package root lookup
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
 * @internal Used by `artifactPath`.
 */
export function findNearestPackageRoot(startPath: string): string | null {
	const { existsSync, statSync } = process.getBuiltinModule("node:fs");
	const { dirname, join, resolve } = process.getBuiltinModule("node:path");
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
