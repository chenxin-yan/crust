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
