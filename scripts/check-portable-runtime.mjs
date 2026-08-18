import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const exemptPackages = new Set(["crust", "create-crust"]);
const violations = [];

async function scan(directory) {
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) await scan(path);
		else if (
			/\.tsx?$/.test(entry.name) &&
			!entry.name.endsWith(".test.ts") &&
			(await readFile(path, "utf8")).includes("Bun.")
		) {
			violations.push(path);
		}
	}
}

for (const entry of await readdir("packages", { withFileTypes: true })) {
	if (entry.isDirectory() && !exemptPackages.has(entry.name)) {
		try {
			await scan(join("packages", entry.name, "src"));
		} catch (error) {
			if (error.code !== "ENOENT") throw error;
		}
	}
}

if (violations.length > 0) {
	console.error(`Bun globals are not portable:\n${violations.join("\n")}`);
	process.exitCode = 1;
}
