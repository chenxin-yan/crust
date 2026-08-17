import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { resolveSourceDir } from "./source.ts";

// ────────────────────────────────────────────────────────────────────────────
// Test helpers
// ────────────────────────────────────────────────────────────────────────────

const SELF_DIR = dirname(fileURLToPath(import.meta.url));

let tmpDir: string;

beforeEach(async () => {
	const base = join(SELF_DIR, ".tmp-source-test");
	const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
	tmpDir = join(base, id);
	await mkdir(tmpDir, { recursive: true });
});

afterEach(async () => {
	try {
		await rm(tmpDir, { recursive: true });
	} catch {
		// Ignore cleanup errors
	}
});

async function withArgv1<T>(value: string, fn: () => Promise<T>): Promise<T> {
	const original = process.argv[1];
	process.argv[1] = value;
	try {
		return await fn();
	} finally {
		if (original === undefined) {
			process.argv.length = 1;
		} else {
			process.argv[1] = original;
		}
	}
}

// ────────────────────────────────────────────────────────────────────────────
// resolveSourceDir — success modes
// ────────────────────────────────────────────────────────────────────────────

describe("resolveSourceDir", () => {
	describe("success modes", () => {
		it("resolves a file: URL via fileURLToPath", () => {
			const url = pathToFileURL(`${tmpDir}/`);
			expect(resolveSourceDir(url)).toBe(fileURLToPath(url));
		});

		it("returns absolute string paths verbatim (after resolve)", () => {
			expect(resolveSourceDir(tmpDir)).toBe(tmpDir);
		});

		it("normalizes absolute string paths with `.` / `..` segments", () => {
			const messy = join(tmpDir, ".", "sub", "..");
			expect(resolveSourceDir(messy)).toBe(tmpDir);
		});

		it("resolves relative string paths from the nearest package.json walking up from process.argv[1]", async () => {
			// `packages/utils/src/source.test.ts` lives inside packages/utils/,
			// which has a package.json. Using this file as the fake argv[1]
			// must land the resolver at packages/utils/.
			const fakeEntry = join(SELF_DIR, "source.ts");
			await withArgv1(fakeEntry, async () => {
				const resolved = resolveSourceDir("templates/base");
				expect(resolved.endsWith("/packages/utils/templates/base")).toBe(true);
			});
		});

		it("treats process.argv[1] pointing at a directory the same as pointing at a file inside it", async () => {
			const fakeEntryFile = join(SELF_DIR, "source.ts");
			const fakeEntryDir = SELF_DIR;
			const fromFile = await withArgv1(fakeEntryFile, async () => resolveSourceDir("x/y"));
			const fromDir = await withArgv1(fakeEntryDir, async () => resolveSourceDir("x/y"));
			expect(fromFile).toBe(fromDir);
		});
	});

	// ──────────────────────────────────────────────────────────────────────
	// resolveSourceDir — failure modes
	// ──────────────────────────────────────────────────────────────────────

	describe("failure modes", () => {
		it("rejects a non-file: URL and names the offending protocol", () => {
			const url = new URL("https://example.com/templates/base");
			expect(() => resolveSourceDir(url)).toThrow(/file: protocol/);
			expect(() => resolveSourceDir(url)).toThrow(/https:/);
		});

		it("throws a descriptive error when relative input is given but process.argv[1] is unset", () => {
			const original = process.argv[1];
			process.argv.length = 1;
			try {
				expect(() => resolveSourceDir("x/y")).toThrow(/process\.argv\[1\] is not set/);
				expect(() => resolveSourceDir("x/y")).toThrow(/absolute path or a file: URL/);
			} finally {
				if (original !== undefined) process.argv[1] = original;
			}
		});

		it("throws a descriptive error when no walkable package.json is found", async () => {
			// /tmp typically has no package.json walking up from it.
			await withArgv1("/tmp/no-pkg-here.js", async () => {
				expect(() => resolveSourceDir("rel/path")).toThrow(/no package\.json was found/);
				expect(() => resolveSourceDir("rel/path")).toThrow(/rel\/path/);
				expect(() => resolveSourceDir("rel/path")).toThrow(/\/tmp\/no-pkg-here\.js/);
			});
		});
	});

	// ──────────────────────────────────────────────────────────────────────
	// resolveSourceDir — edge cases
	// ──────────────────────────────────────────────────────────────────────

	describe("edge cases", () => {
		it("walks the lexical (un-realpath'd) path of process.argv[1] when it is a symlink", async () => {
			// Documented behavior: `findNearestPackageRoot` uses `path.resolve()`,
			// NOT `fs.realpath()`. So a symlink in directory A that points to a
			// file in directory B still walks up from A's parent chain, not B's.
			//
			// Fixture layout:
			//   tmpDir/pkg/package.json     <- real package containing the target
			//   tmpDir/pkg/index.ts
			//   tmpDir/entry-link.ts -> tmpDir/pkg/index.ts
			//
			// With argv[1] = tmpDir/entry-link.ts, the resolver walks up from
			// tmpDir (the symlink's parent) and lands on the first package.json
			// it finds going upward — NOT on tmpDir/pkg/package.json. In this
			// worktree it will land on packages/utils/package.json, since tmpDir
			// is nested under packages/utils/src/.tmp-source-test/...
			const pkgDir = join(tmpDir, "pkg");
			await mkdir(pkgDir, { recursive: true });
			await writeFile(
				join(pkgDir, "package.json"),
				JSON.stringify({ name: "fixture-pkg" }),
				"utf-8",
			);
			await writeFile(join(pkgDir, "index.ts"), "export {};\n", "utf-8");

			const linkPath = join(tmpDir, "entry-link.ts");
			await symlink(join(pkgDir, "index.ts"), linkPath);

			await withArgv1(linkPath, async () => {
				const resolved = resolveSourceDir("templates/base");
				// Lexical walk lands on packages/utils/package.json, not on the
				// inner fixture's package.json.
				expect(resolved.endsWith("/packages/utils/templates/base")).toBe(true);
				expect(resolved).not.toContain("/pkg/templates/base");
			});
		});
	});
});
