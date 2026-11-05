import { readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

import { describe, expect, it } from "vite-plus/test";

const srcDir = import.meta.dirname;

/** Value (non-type) static import specifiers and dynamic import() specifiers of one module. */
function importsOf(file: string): { static: string[]; dynamic: string[] } {
	const source = readFileSync(file, "utf8");
	const statics: string[] = [];
	for (const match of source.matchAll(
		/^(?:import|export)\s+(type\s+)?(?:(\{[^}]*\}|[\w*\s,{}]+?)\s+from\s+)?["']([^"']+)["']/gm,
	)) {
		const [, typeOnly, clause, specifier] = match;
		if (typeOnly) continue;
		// `import { type A, type B } from` is erased like `import type`.
		const names = clause
			?.match(/^\{([^}]*)\}$/)?.[1]
			?.split(",")
			.map((name) => name.trim());
		if (names?.filter(Boolean).every((name) => name.startsWith("type "))) continue;
		statics.push(specifier!);
	}
	const dynamic = [...source.matchAll(/import\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1]!);
	return { static: statics, dynamic };
}

/** Every module reachable from `entry` through static imports, plus external specifiers. */
function staticGraph(entry: string): { modules: Set<string>; external: Set<string> } {
	const modules = new Set<string>();
	const external = new Set<string>();
	const visit = (file: string) => {
		if (modules.has(file)) return;
		modules.add(file);
		for (const specifier of importsOf(file).static) {
			if (specifier.startsWith(".")) visit(resolve(dirname(file), specifier));
			else external.add(specifier);
		}
	};
	visit(entry);
	return { modules, external };
}

describe("startup import graph", () => {
	const root = staticGraph(join(srcDir, "index.ts"));

	it("loads only @crustjs/core when the package is imported", () => {
		expect([...root.external]).toEqual(["@crustjs/core"]);
	});

	it("keeps lazily loaded modules from importing startup modules", () => {
		// A lazy module that imports a startup module forces the bundler to split
		// that module into a shared chunk, which every CLI then loads at startup.
		const lazyEntries = [...root.modules].flatMap((file) =>
			importsOf(file)
				.dynamic.filter((specifier) => specifier.startsWith("."))
				.map((specifier) => resolve(dirname(file), specifier)),
		);
		expect(lazyEntries.length).toBeGreaterThan(0);
		for (const entry of lazyEntries) {
			const shared = [...staticGraph(entry).modules].filter((file) => root.modules.has(file));
			expect(
				shared.map((file) => relative(srcDir, file)),
				relative(srcDir, entry),
			).toEqual([]);
		}
	});
});
