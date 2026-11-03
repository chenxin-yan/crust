/** Returns whether child is parent itself or lies below it. */
export function isWithin(parent: string, child: string): boolean {
	const { isAbsolute, relative, sep } = process.getBuiltinModule("node:path");
	const path = relative(parent, child);
	return path === "" || (!isAbsolute(path) && path !== ".." && !path.startsWith(`..${sep}`));
}
