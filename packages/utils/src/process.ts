import { accessSync, constants, statSync } from "node:fs";
import { delimiter, extname, join, sep } from "node:path";

/** Resolve a bare executable name from PATH (and PATHEXT on Windows). */
export function which(command: string): string | null {
	// Path-containing inputs would produce garbage when joined onto PATH
	// entries; resolve them directly instead.
	if (command.includes(sep) || command.includes("/")) {
		try {
			accessSync(command, constants.X_OK);
			if (statSync(command).isFile()) return command;
		} catch {
			// Fall through: not executable or missing.
		}
		return null;
	}
	const extensions =
		process.platform === "win32" && !extname(command)
			? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";")
			: [""];
	for (const directory of process.env.PATH?.split(delimiter) ?? []) {
		for (const extension of extensions) {
			const candidate = join(directory, command + extension);
			try {
				accessSync(candidate, constants.X_OK);
				if (statSync(candidate).isFile()) return candidate;
			} catch {
				// Missing/non-executable PATH entries are expected while searching.
			}
		}
	}
	return null;
}

/** Compare two SemVer versions for ordering only. */
export function compareSemver(left: string, right: string): -1 | 0 | 1 {
	const parse = (version: string) => {
		const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(
			version,
		);
		if (!match) throw new TypeError(`Invalid semantic version: ${version}`);
		return {
			core: match.slice(1, 4).map(Number),
			prerelease: match[4]?.split(".") ?? [],
		};
	};
	const a = parse(left);
	const b = parse(right);
	for (let index = 0; index < 3; index++) {
		if (a.core[index] !== b.core[index]) return a.core[index]! < b.core[index]! ? -1 : 1;
	}
	if (a.prerelease.length === 0 || b.prerelease.length === 0) {
		return a.prerelease.length === b.prerelease.length ? 0 : a.prerelease.length === 0 ? 1 : -1;
	}
	for (let index = 0; index < Math.max(a.prerelease.length, b.prerelease.length); index++) {
		const x = a.prerelease[index];
		const y = b.prerelease[index];
		// The loop bound guarantees at most one side is exhausted here.
		if (x === undefined || y === undefined) return x === undefined ? -1 : 1;
		if (x === y) continue;
		const xNumeric = /^\d+$/.test(x);
		const yNumeric = /^\d+$/.test(y);
		if (xNumeric && yNumeric) return Number(x) < Number(y) ? -1 : 1;
		if (xNumeric !== yNumeric) return xNumeric ? -1 : 1;
		return x < y ? -1 : 1;
	}
	return 0;
}
