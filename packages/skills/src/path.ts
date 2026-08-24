import { isAbsolute, relative, sep } from "node:path";

/** Returns whether child is parent itself or lies below it. */
export function isWithin(parent: string, child: string): boolean {
	const path = relative(parent, child);
	return path === "" || (!isAbsolute(path) && path !== ".." && !path.startsWith(`..${sep}`));
}
