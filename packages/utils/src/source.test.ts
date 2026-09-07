import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { resolveSourceDir } from "./source.ts";

// ────────────────────────────────────────────────────────────────────────────
// Test helpers
// ────────────────────────────────────────────────────────────────────────────

let tmpDir: string;

beforeEach(async () => {
	tmpDir = await mkdtemp(join(tmpdir(), "crust-source-"));
});

afterEach(async () => {
	await rm(tmpDir, { recursive: true, force: true });
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
			await writeFile(join(tmpDir, "package.json"), "{}");
			await mkdir(join(tmpDir, "src"));
			const fakeEntry = join(tmpDir, "src", "entry.ts");
			await writeFile(fakeEntry, "export {};\n");
			await withArgv1(fakeEntry, async () => {
				const resolved = resolveSourceDir("templates/base");
				expect(resolved).toBe(join(tmpDir, "templates", "base"));
			});
		});

		it("treats process.argv[1] pointing at a directory the same as pointing at a file inside it", async () => {
			await writeFile(join(tmpDir, "package.json"), "{}");
			const fakeEntryFile = join(tmpDir, "entry.ts");
			await writeFile(fakeEntryFile, "export {};\n");
			const fakeEntryDir = tmpDir;
			const fromFile = await withArgv1(fakeEntryFile, async () => resolveSourceDir("x/y"));
			const fromDir = await withArgv1(fakeEntryDir, async () => resolveSourceDir("x/y"));
			expect(fromFile).toBe(join(tmpDir, "x", "y"));
			expect(fromDir).toBe(fromFile);
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
			// This requires no package.json in the temporary directory's ancestors.
			const entry = join(tmpDir, "no-pkg-here.js");
			await withArgv1(entry, async () => {
				expect(() => resolveSourceDir("rel/path")).toThrow(/no package\.json was found/);
				expect(() => resolveSourceDir("rel/path")).toThrow(/rel\/path/);
				expect(() => resolveSourceDir("rel/path")).toThrow(entry);
			});
		});
	});

	// ──────────────────────────────────────────────────────────────────────
	// resolveSourceDir — edge cases
	// ──────────────────────────────────────────────────────────────────────

	describe("edge cases", () => {
		it("walks the lexical (un-realpath'd) path of process.argv[1] when it is a symlink", async () => {
			// Lexical walking must find the outer package, not the symlink target's package.
			await writeFile(join(tmpDir, "package.json"), "{}");
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
				// The outer fixture owns the lexical entrypoint.
				expect(resolved).toBe(join(tmpDir, "templates", "base"));
				expect(resolved).not.toBe(join(pkgDir, "templates", "base"));
			});
		});
	});
});
