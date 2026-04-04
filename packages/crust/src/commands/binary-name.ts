import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";

/**
 * Resolve the base binary name (without target suffix).
 *
 * Priority: explicit name > package.json name > entry filename
 */
export function resolveBaseName(
	name: string | undefined,
	entry: string,
	cwd: string,
): string {
	if (name) {
		return name;
	}

	const pkgPath = join(cwd, "package.json");
	if (existsSync(pkgPath)) {
		try {
			const pkgJson = JSON.parse(readFileSync(pkgPath, "utf-8")) as {
				name?: string;
			};
			if (pkgJson?.name && typeof pkgJson.name === "string") {
				return pkgJson.name.replace(/^@[^/]+\//, "");
			}
		} catch {
			// Ignore parse errors, fall through to entry filename
		}
	}

	return basename(entry).replace(/\.[^.]+$/, "");
}
