import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { beforeAll, describe, expect, it } from "vite-plus/test";

import { ensureDist } from "./helpers.ts";

// ────────────────────────────────────────────────────────────────────────────
// Startup imports — built-ins stay external even in a bundled app, and a static
// `node:*` import evaluates every lazy getter on that built-in (`fs.promises`,
// `util.parseArgs`, …). The published entry resolves built-ins with
// `process.getBuiltinModule()` where they are used; its only external imports
// are `@crustjs/utils` subpaths, which an app's bundle shares with the other
// Crust packages.
// ────────────────────────────────────────────────────────────────────────────

const dist = resolve(import.meta.dirname, "../dist");

/** Every file reachable from `entry` through static imports, plus external specifiers. */
function staticGraph(entry: string): { files: string[]; external: string[] } {
	const files: string[] = [];
	const external: string[] = [];
	const visit = (file: string) => {
		if (files.includes(file)) return;
		files.push(file);
		const source = readFileSync(file, "utf8");
		for (const match of source.matchAll(
			/^(?:import|export)\s[^"'\n]*?\bfrom\s*["']([^"']+)["']|^import\s*["']([^"']+)["']/gm,
		)) {
			const specifier = (match[1] ?? match[2])!;
			if (specifier.startsWith(".")) visit(resolve(dirname(file), specifier));
			else external.push(specifier);
		}
	};
	visit(entry);
	return { files, external };
}

beforeAll(ensureDist);

describe("@crustjs/core startup imports", () => {
	it("imports no Node built-in and no package other than @crustjs/utils", () => {
		const graph = staticGraph(resolve(dist, "index.js"));
		expect(graph.files.length).toBeGreaterThan(1);
		expect(graph.external.filter((specifier) => !specifier.startsWith("@crustjs/utils/"))).toEqual(
			[],
		);
	});
});
