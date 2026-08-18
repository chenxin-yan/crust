import { beforeAll, describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

// The bunup entry list and the package.json exports map are maintained by
// hand; this guards the root-only surface and verifies its dist targets.

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
	it("exports only the root with targets that exist in dist", async () => {
		const pkg = await Bun.file(join(pkgDir, "package.json")).json();
		const exportsMap = pkg.exports as Record<string, Record<string, string>>;

		expect(Object.keys(exportsMap)).toEqual(["."]);

		for (const target of Object.values(exportsMap["."])) {
			expect(existsSync(join(pkgDir, target))).toBe(true);
		}
	});
});
