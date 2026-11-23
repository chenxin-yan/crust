import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { scaffold } from "../src/scaffold.ts";
import type { ScaffoldOptions } from "../src/types.ts";

// ────────────────────────────────────────────────────────────────────────────
// Test Helpers
// ────────────────────────────────────────────────────────────────────────────

let tempDir: string;
let templateDir: string;
let destDir: string;

beforeEach(() => {
	tempDir = mkdtempSync(join(tmpdir(), "crust-scaffold-test-"));
	templateDir = join(tempDir, "template");
	destDir = join(tempDir, "output");
	mkdirSync(templateDir, { recursive: true });
});

afterEach(() => {
	rmSync(tempDir, { recursive: true, force: true });
});

/**
 * Create a file inside the template directory with the given content.
 */
function createTemplateFile(relativePath: string, content: string): void {
	const filePath = join(templateDir, relativePath);
	mkdirSync(join(filePath, ".."), { recursive: true });
	writeFileSync(filePath, content, "utf-8");
}

/**
 * Create a binary file inside the template directory.
 */
function createTemplateBinaryFile(relativePath: string, data: Buffer): void {
	const filePath = join(templateDir, relativePath);
	mkdirSync(join(filePath, ".."), { recursive: true });
	writeFileSync(filePath, data);
}

/**
 * Scaffold the test template into the output directory.
 */
function scaffoldTemplate(options: Partial<Omit<ScaffoldOptions, "template">> = {}) {
	return scaffold({ template: templateDir, dest: destDir, ...options });
}

function mode(path: string): number {
	return statSync(path).mode & 0o777;
}

/**
 * Read a file from the output directory.
 */
function readOutputFile(relativePath: string): string {
	return readFileSync(join(destDir, relativePath), "utf-8");
}

// ────────────────────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────────────────────

describe("scaffold", () => {
	it("copies template files byte for byte, without reading placeholders", async () => {
		createTemplateFile("package.json", '{ "name": "{{name}}" }');
		// Latin-1 "café": not valid UTF-8, so a text round trip would replace the last byte.
		createTemplateBinaryFile("src/latin1.txt", Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x0a]));

		const result = await scaffoldTemplate();

		expect(result.files).toEqual(["package.json", join("src", "latin1.txt")]);
		expect(readOutputFile("package.json")).toBe('{ "name": "{{name}}" }');
		expect(readFileSync(join(destDir, "src", "latin1.txt"))).toEqual(
			Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x0a]),
		);
	});

	// Windows file modes carry only the read-only bit.
	it.skipIf(process.platform === "win32")("copies each template file's mode", async () => {
		createTemplateFile("bin/run.sh", "#!/bin/sh\n");
		chmodSync(join(templateDir, "bin", "run.sh"), 0o755);
		createTemplateFile("secret.txt", "s");
		chmodSync(join(templateDir, "secret.txt"), 0o600);

		await scaffoldTemplate();

		expect(mode(join(destDir, "bin", "run.sh"))).toBe(0o755);
		expect(mode(join(destDir, "secret.txt"))).toBe(0o600);
	});

	describe("files", () => {
		it("writes files from code without a template", async () => {
			const result = await scaffold({
				dest: destDir,
				files: { "README.md": "# my-app\n", "src/index.ts": "export {};\n" },
			});

			expect(result.files).toEqual(["README.md", join("src", "index.ts")]);
			expect(readOutputFile("README.md")).toBe("# my-app\n");
			expect(readOutputFile(join("src", "index.ts"))).toBe("export {};\n");
		});

		it("wins over the template file at the same path and keeps its mode", async () => {
			createTemplateFile("bin/run.sh", "old");
			chmodSync(join(templateDir, "bin", "run.sh"), 0o755);
			createTemplateFile("keep.txt", "kept");

			const result = await scaffoldTemplate({ files: { "bin/run.sh": "new" } });

			expect(result.files).toEqual([join("bin", "run.sh"), "keep.txt"]);
			expect(readOutputFile(join("bin", "run.sh"))).toBe("new");
			expect(readOutputFile("keep.txt")).toBe("kept");
			if (process.platform !== "win32") expect(mode(join(destDir, "bin", "run.sh"))).toBe(0o755);
		});

		it("writes keys as given: the _ rename applies to copied files only", async () => {
			createTemplateFile("_gitignore", "from template");

			const result = await scaffoldTemplate({ files: { _npmrc: "a", ".gitignore": "from code" } });

			expect(result.files).toEqual([".gitignore", "_npmrc"]);
			expect(readOutputFile(".gitignore")).toBe("from code");
			expect(readOutputFile("_npmrc")).toBe("a");
		});

		it.each([
			["../outside.txt", "is not a path inside the new project"],
			["src/../../outside.txt", "is not a path inside the new project"],
			[join(tmpdir(), "absolute.txt"), "is not a path inside the new project"],
			["", "is not a path inside the new project"],
			[".git/hooks/pre-commit", "is inside .git"],
		])("refuses the key %j before writing anything", async (key, message) => {
			createTemplateFile("a.txt", "a");

			await expect(scaffoldTemplate({ files: { [key]: "x" } })).rejects.toThrow(message);
			expect(existsSync(destDir)).toBe(false);
			expect(existsSync(join(tempDir, "outside.txt"))).toBe(false);
		});
	});

	it("refuses an empty plan before deleting anything", async () => {
		mkdirSync(destDir);
		writeFileSync(join(destDir, "keep.txt"), "keep");

		await expect(scaffoldTemplate({ conflict: "replace" })).rejects.toThrow("Nothing to scaffold");
		await expect(scaffold({ dest: destDir, files: {}, conflict: "replace" })).rejects.toThrow(
			"Nothing to scaffold",
		);
		expect(readOutputFile("keep.txt")).toBe("keep");
	});

	describe("dryRun", () => {
		it("returns the files it would write and writes nothing", async () => {
			createTemplateFile("_gitignore", "x");
			createTemplateFile("src/index.ts", "x");
			const options = { files: { "README.md": "# a\n" } };

			const planned = await scaffoldTemplate({ ...options, dryRun: true });

			expect(existsSync(destDir)).toBe(false);
			expect(planned.files).toEqual((await scaffoldTemplate(options)).files);
		});

		it("runs the conflict check", async () => {
			mkdirSync(destDir);
			writeFileSync(join(destDir, "existing.txt"), "x");
			createTemplateFile("a.txt", "a");

			await expect(scaffoldTemplate({ dryRun: true })).rejects.toThrow("non-empty");
		});
	});

	describe("conflict", () => {
		beforeEach(() => {
			createTemplateFile("file.txt", "new content");
			mkdirSync(join(destDir, ".git"), { recursive: true });
			writeFileSync(join(destDir, ".git", "HEAD"), "ref: refs/heads/main\n");
		});

		it("counts a destination holding only .git as empty", async () => {
			const result = await scaffoldTemplate();

			expect(result.files).toEqual(["file.txt"]);
			expect(readOutputFile(join(".git", "HEAD"))).toBe("ref: refs/heads/main\n");
		});

		it("'replace' empties the destination first and keeps .git", async () => {
			mkdirSync(join(destDir, "old"));
			writeFileSync(join(destDir, "old", "stale.txt"), "stale");
			writeFileSync(join(destDir, "file.txt"), "old content");

			await scaffoldTemplate({ conflict: "replace" });

			expect(readdirSync(destDir).sort()).toEqual([".git", "file.txt"]);
			expect(readOutputFile("file.txt")).toBe("new content");
			expect(readOutputFile(join(".git", "HEAD"))).toBe("ref: refs/heads/main\n");
		});

		it("'overwrite' replaces conflicting files and leaves the others", async () => {
			writeFileSync(join(destDir, "file.txt"), "old content");
			writeFileSync(join(destDir, "other.txt"), "other");

			await scaffoldTemplate({ conflict: "overwrite" });

			expect(readOutputFile("file.txt")).toBe("new content");
			expect(readOutputFile("other.txt")).toBe("other");
		});
	});

	it("renames dotfiles at the root and in subdirectories: _gitignore becomes .gitignore", async () => {
		createTemplateFile("_gitignore", "node_modules\ndist\n");
		createTemplateFile("config/_eslintrc.json", '{ "root": true }');

		const result = await scaffoldTemplate();

		const nested = join("config", ".eslintrc.json");
		expect([...result.files].sort()).toEqual([".gitignore", nested]);
		expect(existsSync(join(destDir, "_gitignore"))).toBe(false);
		expect(readOutputFile(".gitignore")).toBe("node_modules\ndist\n");
		expect(readOutputFile(nested)).toBe('{ "root": true }');
	});

	it("does not rename files starting with double underscore", async () => {
		createTemplateFile("__file.ts", "export const preserved = true;");
		createTemplateFile("__tests__/foo.test.ts", "test('foo', () => {})");
		createTemplateFile("__mocks__/bar.ts", "export default {}");

		const result = await scaffoldTemplate();

		expect(result.files).toContain("__file.ts");
		expect(readOutputFile("__file.ts")).toBe("export const preserved = true;");
		expect(result.files).toContain(join("__tests__", "foo.test.ts"));
		expect(result.files).toContain(join("__mocks__", "bar.ts"));
		expect(readOutputFile(join("__tests__", "foo.test.ts"))).toBe("test('foo', () => {})");
		expect(readOutputFile(join("__mocks__", "bar.ts"))).toBe("export default {}");
	});

	it("defaults conflict to 'abort'", async () => {
		// Create a non-empty destination directory
		mkdirSync(destDir, { recursive: true });
		writeFileSync(join(destDir, "existing.txt"), "existing content");

		createTemplateFile("file.txt", "hello");

		await expect(scaffoldTemplate()).rejects.toThrow("already exists and is non-empty");
		expect(existsSync(join(destDir, "file.txt"))).toBe(false);
	});

	// Windows needs a privilege to create symlinks; the traversal itself is the same on every platform.
	it.skipIf(process.platform === "win32")(
		"skips symlinked files and writes only template-relative paths under dest",
		async () => {
			createTemplateFile("src/index.ts", "// my-app");
			const outsideFile = join(tempDir, "outside.txt");
			writeFileSync(outsideFile, "outside", "utf-8");
			symlinkSync(outsideFile, join(templateDir, "linked.txt"));

			const result = await scaffoldTemplate();

			expect(result.files).toEqual([join("src", "index.ts")]);
			expect(existsSync(join(destDir, "linked.txt"))).toBe(false);
			expect(readOutputFile(join("src", "index.ts"))).toBe("// my-app");
		},
	);

	// Destination containment: overwrite must never write through a link that
	// leaves the destination, whether the link is the file itself, an ancestor
	// directory, or a dangling link whose target would be created outside.
	describe.skipIf(process.platform === "win32")("destination containment", () => {
		let outsideDir: string;
		let sentinel: string;

		beforeEach(() => {
			outsideDir = join(tempDir, "outside");
			sentinel = join(outsideDir, "sentinel.txt");
			mkdirSync(outsideDir, { recursive: true });
			writeFileSync(sentinel, "original", "utf-8");
			mkdirSync(destDir, { recursive: true });
		});

		it("rejects a destination file link that escapes the destination", async () => {
			createTemplateFile("config.txt", "my-app");
			symlinkSync(sentinel, join(destDir, "config.txt"));

			await expect(scaffoldTemplate({ conflict: "overwrite" })).rejects.toThrow(
				/config\.txt.*outside the destination/,
			);
			expect(readFileSync(sentinel, "utf-8")).toBe("original");
		});

		it("rejects a destination ancestor directory link that escapes the destination", async () => {
			createTemplateFile("src/deep/index.ts", "my-app");
			symlinkSync(outsideDir, join(destDir, "src"));

			await expect(scaffoldTemplate({ conflict: "overwrite" })).rejects.toThrow(
				/src.*outside the destination/,
			);
			expect(existsSync(join(outsideDir, "deep"))).toBe(false);
		});

		it("rejects a dangling destination link, which would create its target", async () => {
			createTemplateFile("notes.txt", "my-app");
			const missingTarget = join(outsideDir, "created-by-write.txt");
			symlinkSync(missingTarget, join(destDir, "notes.txt"));

			await expect(scaffoldTemplate({ conflict: "overwrite" })).rejects.toThrow(
				/notes\.txt.*outside the destination/,
			);
			expect(existsSync(missingTarget)).toBe(false);
		});

		it("writes nothing when a later file escapes, in a dry run as well", async () => {
			createTemplateFile("a.txt", "a");
			createTemplateFile("z.txt", "z");
			symlinkSync(sentinel, join(destDir, "z.txt"));

			for (const dryRun of [true, false]) {
				await expect(scaffoldTemplate({ conflict: "overwrite", dryRun })).rejects.toThrow(
					"outside the destination",
				);
			}
			expect(existsSync(join(destDir, "a.txt"))).toBe(false);
			expect(readFileSync(sentinel, "utf-8")).toBe("original");
		});

		it("checks files keys against links as well", async () => {
			symlinkSync(outsideDir, join(destDir, "src"));

			await expect(
				scaffold({ dest: destDir, files: { "src/index.ts": "x" }, conflict: "overwrite" }),
			).rejects.toThrow(/src.*outside the destination/);
			expect(existsSync(join(outsideDir, "index.ts"))).toBe(false);
		});

		it("writes through a link that stays inside the destination", async () => {
			createTemplateFile("alias.txt", "my-app");
			writeFileSync(join(destDir, "real.txt"), "old", "utf-8");
			symlinkSync(join(destDir, "real.txt"), join(destDir, "alias.txt"));

			const result = await scaffoldTemplate({ conflict: "overwrite" });

			expect(result.files).toEqual(["alias.txt"]);
			expect(readOutputFile("real.txt")).toBe("my-app");
		});

		it("treats an explicitly chosen symlinked root as the destination", async () => {
			createTemplateFile("src/index.ts", "my-app");
			const linkedRoot = join(tempDir, "linked-root");
			symlinkSync(destDir, linkedRoot);

			const result = await scaffoldTemplate({ dest: linkedRoot });

			expect(result.files).toEqual([join("src", "index.ts")]);
			expect(readOutputFile(join("src", "index.ts"))).toBe("my-app");
		});
	});

	it("allows scaffold on an empty existing directory with conflict 'abort'", async () => {
		// Create an empty destination directory
		mkdirSync(destDir, { recursive: true });

		createTemplateFile("file.txt", "content");

		const result = await scaffoldTemplate({ conflict: "abort" });

		expect(result.files).toContain("file.txt");
		expect(readOutputFile("file.txt")).toBe("content");
	});

	it("resolves template from a file: URL", async () => {
		createTemplateFile("hello.txt", "hi URL");

		const result = await scaffold({ template: pathToFileURL(templateDir), dest: destDir });

		expect(result.files).toContain("hello.txt");
		expect(readOutputFile("hello.txt")).toBe("hi URL");
	});

	it("throws when template directory does not exist", async () => {
		await expect(
			scaffold({ template: "/nonexistent/path/to/template", dest: destDir }),
		).rejects.toThrow("does not exist");
	});

	it("throws when template path is a file, not a directory", async () => {
		const filePath = join(tempDir, "not-a-dir.txt");
		writeFileSync(filePath, "I am a file");

		await expect(scaffold({ template: filePath, dest: destDir })).rejects.toThrow(
			"is not a directory",
		);
	});
});
