/** Returns whether child is parent itself or lies below it. */
export function isWithin(parent: string, child: string): boolean {
	const { isAbsolute, relative, sep } = process.getBuiltinModule("node:path");
	const path = relative(parent, child);
	return path === "" || (!isAbsolute(path) && path !== ".." && !path.startsWith(`..${sep}`));
}

/**
 * `raw` with a leading `~` replaced by the home directory (`~user` stays literal):
 * no shell expands it in `--flag=~/x`, a prompt answer, or an environment value.
 *
 * Use it alone for a path opened on the spot, such as an `@path`: the filesystem
 * then walks `..` through symlinks, which {@link resolveUserPath} collapses first.
 */
export function expandHome(raw: string): string {
	const home = process.platform === "win32" ? /^~(?=[\\/]|$)/ : /^~(?=\/|$)/;
	// A replacer function keeps `$` sequences in the home directory literal.
	return raw.replace(home, () => process.getBuiltinModule("node:os").homedir());
}

/**
 * Absolute path for a path the end user typed: a flag or positional value, a
 * prompt answer, or an environment variable. A leading `~` is the home directory
 * ({@link expandHome}) and a relative path resolves against the working directory.
 *
 * @throws {Error} when `raw` is empty.
 */
export function resolveUserPath(raw: string): string {
	if (raw === "") throw new Error("Path cannot be empty");
	return process.getBuiltinModule("node:path").resolve(expandHome(raw));
}

/**
 * Absolute path for a path passed in code, with Node `fs` semantics: a `file:`
 * `URL` object is converted, and a relative string resolves against the working
 * directory. `~` and `file://` strings stay literal.
 *
 * @throws {Error} when `input` is an empty string or a URL that is not `file:`.
 */
export function resolvePathLike(input: string | URL): string {
	if (input instanceof URL) {
		if (input.protocol !== "file:") {
			throw new Error(`Path URL must use the file: protocol, got "${input.protocol}".`);
		}
		return process.getBuiltinModule("node:url").fileURLToPath(input);
	}
	if (input === "") throw new Error("Path cannot be empty");
	return process.getBuiltinModule("node:path").resolve(input);
}
