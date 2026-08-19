import { readdir, readFile } from "node:fs/promises";
import { join, sep } from "node:path";

const exemptPackages = new Set(["crust"]);
const violations = [];

for (const relative of await readdir("packages", { recursive: true })) {
	const [pkg, dir] = relative.split(sep);
	const path = join("packages", relative);
	if (
		dir === "src" &&
		!exemptPackages.has(pkg) &&
		/\.tsx?$/.test(relative) &&
		!relative.endsWith(".test.ts") &&
		(await readFile(path, "utf8")).includes("Bun.")
	) {
		violations.push(path);
	}
}

if (violations.length > 0) {
	console.error(`Bun globals are not portable:\n${violations.join("\n")}`);
	process.exitCode = 1;
}
