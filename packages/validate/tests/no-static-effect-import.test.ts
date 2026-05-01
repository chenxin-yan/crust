// Regression test: a Zod-only / Standard-Schema-only consumer must be able
// to `import "@crustjs/validate"` without having `effect` installed.
//
// `effect` is declared as an optional peer in package.json, so any runtime
// `import` from `effect/*` along the static graph rooted at `src/index.ts`
// would break that contract.
//
// Type-only imports (`import type ...`) are erased at runtime and are fine.

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";

const SRC_ROOT = resolve(import.meta.dir, "../src");

function loadSource(file: string): string | undefined {
	try {
		return readFileSync(file, "utf8");
	} catch {
		return undefined;
	}
}

function resolveLocal(spec: string, fromFile: string): string | undefined {
	if (spec.startsWith(".")) {
		const base = resolve(dirname(fromFile), spec);
		// Try as-is, then with .ts, then as a folder index.
		for (const candidate of [
			base,
			`${base}.ts`,
			`${base}.tsx`,
			resolve(base, "index.ts"),
		]) {
			if (loadSource(candidate)) return candidate;
		}
	}
	return undefined;
}

function collectRuntimeImports(src: string): string[] {
	// Match runtime `import ... from "..."`, `import "..."` (side-effect),
	// and runtime `export ... from "..."` re-exports. Skip `import type` and
	// `export type` since those are erased.
	const out: string[] = [];
	const patterns: RegExp[] = [
		/^[ \t]*import(?!\s+type\s)\s+(?:[^"']*?\s+from\s+)?["']([^"']+)["']/gm,
		/^[ \t]*export(?!\s+type\s)\s+(?:\*|\{[^}]*\}|\*\s+as\s+\w+)\s+from\s+["']([^"']+)["']/gm,
	];
	for (const re of patterns) {
		for (const match of src.matchAll(re)) {
			const spec = match[1];
			if (spec) out.push(spec);
		}
	}
	return out;
}

function walkRuntimeGraph(entryAbsPath: string): {
	files: Set<string>;
	externalSpecs: Set<string>;
} {
	const files = new Set<string>();
	const externalSpecs = new Set<string>();
	const stack: string[] = [entryAbsPath];

	while (stack.length > 0) {
		const file = stack.pop();
		if (!file || files.has(file)) continue;
		files.add(file);

		const src = loadSource(file);
		if (!src) continue;

		for (const spec of collectRuntimeImports(src)) {
			if (spec.startsWith(".")) {
				const resolved = resolveLocal(spec, file);
				if (resolved) {
					stack.push(resolved);
				}
			} else if (!isAbsolute(spec)) {
				externalSpecs.add(spec);
			}
		}
	}

	return { files, externalSpecs };
}

describe("root entry static import graph", () => {
	it("does not statically import any `effect/*` module at runtime", () => {
		const entry = resolve(SRC_ROOT, "index.ts");
		const { externalSpecs } = walkRuntimeGraph(entry);
		const offenders = [...externalSpecs].filter(
			(spec) => spec === "effect" || spec.startsWith("effect/"),
		);
		expect(offenders).toEqual([]);
	});

	it("does not statically import `zod` either (parity check)", () => {
		const entry = resolve(SRC_ROOT, "index.ts");
		const { externalSpecs } = walkRuntimeGraph(entry);
		const offenders = [...externalSpecs].filter(
			(spec) => spec === "zod" || spec.startsWith("zod/"),
		);
		expect(offenders).toEqual([]);
	});
});
