import type { ChildProcess } from "node:child_process";
import { accessSync, constants, statSync } from "node:fs";
import { delimiter, extname, join } from "node:path";

/** Resolve an executable from PATH. */
export function which(command: string, path: string | undefined = process.env.PATH): string | null {
	const extensions =
		process.platform === "win32" && !extname(command)
			? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";")
			: [""];
	for (const directory of path?.split(delimiter) ?? []) {
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

/** Resolve a spawned process's exit code, rejecting on spawn errors. */
export function exitCodeOf(proc: ChildProcess): Promise<number> {
	return new Promise((resolve, reject) => {
		proc.once("error", reject);
		proc.once("close", (code) => resolve(code ?? 1));
	});
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
