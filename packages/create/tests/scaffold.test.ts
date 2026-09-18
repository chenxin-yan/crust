import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { pathToFileURL } from "node:url";

import { scaffold } from "../src/scaffold.ts";

// ────────────────────────────────────────────────────────────────────────────
// Test Helpers
// ────────────────────────────────────────────────────────────────────────────

let tempDir: string;
let templateDir: string;
let destDir: string;

beforeEach(() => {
	tempDir = join(
		tmpdir(),
		`crust-scaffold-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	);
	templateDir = join(tempDir, "template");
	destDir = join(tempDir, "output");
	mkdirSync(templateDir, { recursive: true });
});

afterEach(() => {
	if (existsSync(tempDir)) {
		rmSync(tempDir, { recursive: true, force: true });
	}
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
 * Read a file from the output directory.
 */
function readOutputFile(relativePath: string): string {
	return readFileSync(join(destDir, relativePath), "utf-8");
}

// ────────────────────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────────────────────

describe("scaffold", () => {
	it("scaffolds a simple template with text files and interpolation", async () => {
		createTemplateFile("package.json", '{ "name": "{{name}}", "description": "{{description}}" }');
		createTemplateFile("src/index.ts", "// {{name}} - {{description}}");

		const result = await scaffold({
			template: templateDir,
			dest: destDir,

			context: { name: "my-app", description: "A cool CLI" },
		});

		expect(result.files).toContain("package.json");
		expect(result.files).toContain(join("src", "index.ts"));
		expect(result.files).toHaveLength(2);

		expect(readOutputFile("package.json")).toBe(
			'{ "name": "my-app", "description": "A cool CLI" }',
		);
		expect(readOutputFile(join("src", "index.ts"))).toBe("// my-app - A cool CLI");
	});

	it("renames dotfiles: _gitignore becomes .gitignore", async () => {
		createTemplateFile("_gitignore", "node_modules\ndist\n");

		const result = await scaffold({
			template: templateDir,
			dest: destDir,

			context: {},
		});

		expect(result.files).toContain(".gitignore");
		expect(result.files).not.toContain("_gitignore");
		expect(existsSync(join(destDir, ".gitignore"))).toBe(true);
		expect(existsSync(join(destDir, "_gitignore"))).toBe(false);
		expect(readOutputFile(".gitignore")).toBe("node_modules\ndist\n");
	});

	it("renames dotfiles in subdirectories", async () => {
		createTemplateFile("config/_eslintrc.json", '{ "root": true }');

		const result = await scaffold({
			template: templateDir,
			dest: destDir,

			context: {},
		});

		const expected = join("config", ".eslintrc.json");
		expect(result.files).toContain(expected);
		expect(readOutputFile(expected)).toBe('{ "root": true }');
	});

	it("does not rename files starting with double underscore", async () => {
		createTemplateFile("__file.ts", "export const preserved = true;");
		createTemplateFile("__tests__/foo.test.ts", "test('foo', () => {})");
		createTemplateFile("__mocks__/bar.ts", "export default {}");

		const result = await scaffold({
			template: templateDir,
			dest: destDir,

			context: {},
		});

		expect(result.files).toContain("__file.ts");
		expect(readOutputFile("__file.ts")).toBe("export const preserved = true;");
		expect(result.files).toContain(join("__tests__", "foo.test.ts"));
		expect(result.files).toContain(join("__mocks__", "bar.ts"));
		expect(readOutputFile(join("__tests__", "foo.test.ts"))).toBe("test('foo', () => {})");
		expect(readOutputFile(join("__mocks__", "bar.ts"))).toBe("export default {}");
	});

	it("throws when conflict is 'abort' and dest is non-empty", async () => {
		// Create a non-empty destination directory
		mkdirSync(destDir, { recursive: true });
		writeFileSync(join(destDir, "existing.txt"), "existing content");

		createTemplateFile("file.txt", "hello");

		await expect(
			scaffold({
				template: templateDir,
				dest: destDir,

				context: {},
				conflict: "abort",
			}),
		).rejects.toThrow("already exists and is non-empty");
	});

	it("defaults conflict to 'abort'", async () => {
		// Create a non-empty destination directory
		mkdirSync(destDir, { recursive: true });
		writeFileSync(join(destDir, "existing.txt"), "existing content");

		createTemplateFile("file.txt", "hello");

		await expect(
			scaffold({
				template: templateDir,
				dest: destDir,

				context: {},
			}),
		).rejects.toThrow("already exists and is non-empty");
	});

	it("overwrites files when conflict is 'overwrite'", async () => {
		// Create destination with an existing file
		mkdirSync(destDir, { recursive: true });
		writeFileSync(join(destDir, "file.txt"), "old content");

		createTemplateFile("file.txt", "new content from {{author}}");

		const result = await scaffold({
			template: templateDir,
			dest: destDir,

			context: { author: "crust" },
			conflict: "overwrite",
		});

		expect(result.files).toContain("file.txt");
		expect(readOutputFile("file.txt")).toBe("new content from crust");
	});

	it("copies binary files without interpolation", async () => {
		// Create a binary file with null bytes (simulating an image)
		const binaryData = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x0d, 0x0a, 0x1a, 0x0a]);
		createTemplateBinaryFile("assets/image.png", binaryData);

		// Also create a text file with {{var}} to show binary skips interpolation
		createTemplateFile("readme.txt", "Hello {{name}}");

		const result = await scaffold({
			template: templateDir,
			dest: destDir,

			context: { name: "world" },
		});

		expect(result.files).toContain(join("assets", "image.png"));
		expect(result.files).toContain("readme.txt");

		// Binary file should be identical to the source
		const outputBinary = readFileSync(join(destDir, "assets", "image.png"));
		expect(Buffer.compare(outputBinary, binaryData)).toBe(0);

		// Text file should have interpolation applied
		expect(readOutputFile("readme.txt")).toBe("Hello world");
	});

	// Windows needs a privilege to create symlinks; the traversal itself is the same on every platform.
	it.skipIf(process.platform === "win32")(
		"skips symlinked files and writes only template-relative paths under dest",
		async () => {
			createTemplateFile("src/index.ts", "// {{name}}");
			const outsideFile = join(tempDir, "outside.txt");
			writeFileSync(outsideFile, "outside", "utf-8");
			symlinkSync(outsideFile, join(templateDir, "linked.txt"));

			const result = await scaffold({
				template: templateDir,
				dest: destDir,
				context: { name: "my-app" },
			});

			expect(result.files).toEqual([join("src", "index.ts")]);
			expect(result.files.some((file) => isAbsolute(file) || file.startsWith(".."))).toBe(false);
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
			createTemplateFile("config.txt", "{{name}}");
			symlinkSync(sentinel, join(destDir, "config.txt"));

			await expect(
				scaffold({
					template: templateDir,
					dest: destDir,
					context: { name: "my-app" },
					conflict: "overwrite",
				}),
			).rejects.toThrow(/config\.txt.*outside the destination/);
			expect(readFileSync(sentinel, "utf-8")).toBe("original");
		});

		it("rejects a destination ancestor directory link that escapes the destination", async () => {
			createTemplateFile("src/deep/index.ts", "{{name}}");
			symlinkSync(outsideDir, join(destDir, "src"));

			await expect(
				scaffold({
					template: templateDir,
					dest: destDir,
					context: { name: "my-app" },
					conflict: "overwrite",
				}),
			).rejects.toThrow(/src.*outside the destination/);
			expect(existsSync(join(outsideDir, "deep"))).toBe(false);
		});

		it("rejects a dangling destination link, which would create its target", async () => {
			createTemplateFile("notes.txt", "{{name}}");
			const missingTarget = join(outsideDir, "created-by-write.txt");
			symlinkSync(missingTarget, join(destDir, "notes.txt"));

			await expect(
				scaffold({
					template: templateDir,
					dest: destDir,
					context: { name: "my-app" },
					conflict: "overwrite",
				}),
			).rejects.toThrow(/notes\.txt.*outside the destination/);
			expect(existsSync(missingTarget)).toBe(false);
		});

		it("does not write earlier template files when a later one escapes", async () => {
			createTemplateFile("a.txt", "a");
			createTemplateFile("z.txt", "z");
			symlinkSync(sentinel, join(destDir, "z.txt"));

			await expect(
				scaffold({ template: templateDir, dest: destDir, context: {}, conflict: "overwrite" }),
			).rejects.toThrow("outside the destination");
			expect(existsSync(join(destDir, "a.txt"))).toBe(false);
			expect(readFileSync(sentinel, "utf-8")).toBe("original");
		});

		it("writes through a link that stays inside the destination", async () => {
			createTemplateFile("alias.txt", "{{name}}");
			writeFileSync(join(destDir, "real.txt"), "old", "utf-8");
			symlinkSync(join(destDir, "real.txt"), join(destDir, "alias.txt"));

			const result = await scaffold({
				template: templateDir,
				dest: destDir,
				context: { name: "my-app" },
				conflict: "overwrite",
			});

			expect(result.files).toEqual(["alias.txt"]);
			expect(readOutputFile("real.txt")).toBe("my-app");
		});

		it("treats an explicitly chosen symlinked root as the destination", async () => {
			createTemplateFile("src/index.ts", "{{name}}");
			const linkedRoot = join(tempDir, "linked-root");
			symlinkSync(destDir, linkedRoot);

			const result = await scaffold({
				template: templateDir,
				dest: linkedRoot,
				context: { name: "my-app" },
			});

			expect(result.files).toEqual([join("src", "index.ts")]);
			expect(readOutputFile(join("src", "index.ts"))).toBe("my-app");
		});
	});

	it("allows scaffold on an empty existing directory with conflict 'abort'", async () => {
		// Create an empty destination directory
		mkdirSync(destDir, { recursive: true });

		createTemplateFile("file.txt", "content");

		const result = await scaffold({
			template: templateDir,
			dest: destDir,

			context: {},
			conflict: "abort",
		});

		expect(result.files).toContain("file.txt");
		expect(readOutputFile("file.txt")).toBe("content");
	});

	it("composes templates by calling scaffold twice (layering)", async () => {
		// First scaffold: base template
		const baseTemplateDir = join(tempDir, "template-base");
		mkdirSync(baseTemplateDir, { recursive: true });
		writeFileSync(join(baseTemplateDir, "package.json"), '{ "name": "{{name}}" }');
		writeFileSync(join(baseTemplateDir, "README.md"), "# {{name}}");

		await scaffold({
			template: baseTemplateDir,
			dest: destDir,

			context: { name: "my-project" },
		});

		// Second scaffold: overlay template (adds/overwrites)
		const overlayTemplateDir = join(tempDir, "template-overlay");
		mkdirSync(join(overlayTemplateDir, "src"), { recursive: true });
		writeFileSync(join(overlayTemplateDir, "src/index.ts"), "// {{name}} entry");
		writeFileSync(join(overlayTemplateDir, "tsconfig.json"), '{ "strict": true }');

		const result = await scaffold({
			template: overlayTemplateDir,
			dest: destDir,

			context: { name: "my-project" },
			conflict: "overwrite",
		});

		// Verify files from both scaffolds exist
		expect(existsSync(join(destDir, "package.json"))).toBe(true);
		expect(existsSync(join(destDir, "README.md"))).toBe(true);
		expect(existsSync(join(destDir, "src/index.ts"))).toBe(true);
		expect(existsSync(join(destDir, "tsconfig.json"))).toBe(true);

		// Verify content from first scaffold is preserved
		expect(readFileSync(join(destDir, "package.json"), "utf-8")).toBe('{ "name": "my-project" }');
		expect(readFileSync(join(destDir, "README.md"), "utf-8")).toBe("# my-project");

		// Verify content from second scaffold is correct
		expect(readFileSync(join(destDir, "src/index.ts"), "utf-8")).toBe("// my-project entry");
		expect(readFileSync(join(destDir, "tsconfig.json"), "utf-8")).toBe('{ "strict": true }');

		// The result only contains files from the second scaffold call
		expect(result.files).toContain(join("src", "index.ts"));
		expect(result.files).toContain("tsconfig.json");
	});

	it("resolves template from a file: URL", async () => {
		createTemplateFile("hello.txt", "hi {{who}}");

		const result = await scaffold({
			template: pathToFileURL(templateDir),
			dest: destDir,
			context: { who: "URL" },
		});

		expect(result.files).toContain("hello.txt");
		expect(readOutputFile("hello.txt")).toBe("hi URL");
	});

	it("resolves a relative template string from the current working directory, like dest", async () => {
		createTemplateFile("hello.txt", "hi {{who}}");
		const originalCwd = process.cwd();
		process.chdir(tempDir);

		try {
			const result = await scaffold({
				template: "template",
				dest: "output",
				context: { who: "cwd" },
			});

			expect(result.files).toContain("hello.txt");
			expect(readOutputFile("hello.txt")).toBe("hi cwd");
		} finally {
			process.chdir(originalCwd);
		}
	});

	it("does not infer a package root for relative templates", async () => {
		// A generator's own templates need an explicit module-relative file: URL;
		// a bare relative string is looked up from cwd and reported as such.
		const packageRoot = join(tempDir, "my-generator");
		mkdirSync(join(packageRoot, "templates", "base"), { recursive: true });
		writeFileSync(join(packageRoot, "package.json"), '{"name":"my-generator"}');
		const originalArgv1 = process.argv[1];
		process.argv[1] = join(packageRoot, "dist", "index.js");

		try {
			await expect(
				scaffold({ template: "templates/base", dest: destDir, context: {} }),
			).rejects.toThrow(
				`Template directory "${join(process.cwd(), "templates", "base")}" does not exist`,
			);
		} finally {
			process.argv[1] = originalArgv1 as string;
		}
	});

	it("throws when template URL uses non-file protocol", async () => {
		await expect(
			scaffold({
				template: new URL("https://example.com/templates/base"),
				dest: destDir,
				context: {},
			}),
		).rejects.toThrow("The URL must be of scheme file");
	});

	it("throws when template directory does not exist", async () => {
		await expect(
			scaffold({
				template: "/nonexistent/path/to/template",
				dest: destDir,
				context: {},
			}),
		).rejects.toThrow("does not exist");
	});

	it("throws when template path is a file, not a directory", async () => {
		const filePath = join(tempDir, "not-a-dir.txt");
		writeFileSync(filePath, "I am a file");

		await expect(
			scaffold({
				template: filePath,
				dest: destDir,
				context: {},
			}),
		).rejects.toThrow("is not a directory");
	});
});
