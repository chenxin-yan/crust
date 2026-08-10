import { beforeAll, describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

// The bunup entry list and the package.json exports map are maintained by
// hand; this guards against adding a subpath to one but not the other and
// shipping an export that resolves to a missing dist file.

const pkgDir = resolve(import.meta.dir, "..");

beforeAll(() => {
	// In turbo runs build precedes test; this fallback only serves a direct
	// `bun test` on a fresh checkout. Never rebuild an existing dist: sibling
	// packages' tests import from dist in parallel and a rebuild races them.
	if (!existsSync(join(pkgDir, "dist/index.js"))) {
		const build = Bun.spawnSync(["bun", "run", "build"], { cwd: pkgDir });
		if (build.exitCode !== 0) {
			throw new Error(`build failed:\n${build.stdout.toString()}\n${build.stderr.toString()}`);
		}
	}
});

describe("package exports", () => {
	it("every exports map target exists in dist", async () => {
		const pkg = await Bun.file(join(pkgDir, "package.json")).json();
		const exportsMap = pkg.exports as Record<string, Record<string, string>>;

		expect(Object.keys(exportsMap).length).toBeGreaterThan(1);

		const missing: string[] = [];
		for (const [subpath, conditions] of Object.entries(exportsMap)) {
			for (const [condition, target] of Object.entries(conditions)) {
				if (!existsSync(join(pkgDir, target))) {
					missing.push(`${subpath} (${condition}) → ${target}`);
				}
			}
		}
		expect(missing).toEqual([]);
	});
});
