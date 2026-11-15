import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
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
 * Scaffold the test template into the output directory with an empty context.
 */
function scaffoldTemplate(options: Partial<ScaffoldOptions> = {}) {
	return scaffold({ template: templateDir, dest: destDir, context: {}, ...options });
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

		const result = await scaffoldTemplate({
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
	});

	it("overwrites files when conflict is 'overwrite'", async () => {
		// Create destination with an existing file
		mkdirSync(destDir, { recursive: true });
		writeFileSync(join(destDir, "file.txt"), "old content");

		createTemplateFile("file.txt", "new content from {{author}}");

		const result = await scaffoldTemplate({ context: { author: "crust" }, conflict: "overwrite" });

		expect(result.files).toContain("file.txt");
		expect(readOutputFile("file.txt")).toBe("new content from crust");
	});

	describe("render", () => {
		it("replaces interpolation with the renderer's output for text files only", async () => {
			const binaryData = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x7b, 0x7b, 0x7d, 0x7d]);
			createTemplateBinaryFile("assets/image.png", binaryData);
			createTemplateFile("readme.txt", "Hello {{name}}");
			const context = { name: "world" };
			const calls: [string, Record<string, string>][] = [];

			const result = await scaffoldTemplate({
				context,
				// Output keeps a placeholder: no second interpolation pass may fill it.
				render: (source, ctx) => {
					calls.push([source, ctx]);
					return `${source.replace("Hello", "Bye")} ${ctx.name}`;
				},
			});

			expect(calls).toEqual([["Hello {{name}}", context]]);
			expect(readOutputFile("readme.txt")).toBe("Bye {{name}} world");
			expect(Buffer.compare(readFileSync(join(destDir, "assets", "image.png")), binaryData)).toBe(
				0,
			);
			expect(result.files).toHaveLength(2);
		});
	});

	// Windows needs a privilege to create symlinks; the traversal itself is the same on every platform.
	it.skipIf(process.platform === "win32")(
		"skips symlinked files and writes only template-relative paths under dest",
		async () => {
			createTemplateFile("src/index.ts", "// {{name}}");
			const outsideFile = join(tempDir, "outside.txt");
			writeFileSync(outsideFile, "outside", "utf-8");
			symlinkSync(outsideFile, join(templateDir, "linked.txt"));

			const result = await scaffoldTemplate({ context: { name: "my-app" } });

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
			createTemplateFile("config.txt", "{{name}}");
			symlinkSync(sentinel, join(destDir, "config.txt"));

			await expect(
				scaffoldTemplate({ context: { name: "my-app" }, conflict: "overwrite" }),
			).rejects.toThrow(/config\.txt.*outside the destination/);
			expect(readFileSync(sentinel, "utf-8")).toBe("original");
		});

		it("rejects a destination ancestor directory link that escapes the destination", async () => {
			createTemplateFile("src/deep/index.ts", "{{name}}");
			symlinkSync(outsideDir, join(destDir, "src"));

			await expect(
				scaffoldTemplate({ context: { name: "my-app" }, conflict: "overwrite" }),
			).rejects.toThrow(/src.*outside the destination/);
			expect(existsSync(join(outsideDir, "deep"))).toBe(false);
		});

		it("rejects a dangling destination link, which would create its target", async () => {
			createTemplateFile("notes.txt", "{{name}}");
			const missingTarget = join(outsideDir, "created-by-write.txt");
			symlinkSync(missingTarget, join(destDir, "notes.txt"));

			await expect(
				scaffoldTemplate({ context: { name: "my-app" }, conflict: "overwrite" }),
			).rejects.toThrow(/notes\.txt.*outside the destination/);
			expect(existsSync(missingTarget)).toBe(false);
		});

		it("does not render or write earlier template files when a later one escapes", async () => {
			createTemplateFile("a.txt", "a");
			createTemplateFile("z.txt", "z");
			symlinkSync(sentinel, join(destDir, "z.txt"));
			const rendered: string[] = [];

			await expect(
				scaffoldTemplate({
					conflict: "overwrite",
					render: (source) => {
						rendered.push(source);
						return source;
					},
				}),
			).rejects.toThrow("outside the destination");
			expect(rendered).toEqual([]);
			expect(existsSync(join(destDir, "a.txt"))).toBe(false);
			expect(readFileSync(sentinel, "utf-8")).toBe("original");
		});

		it.each(["file", "directory", "root"])(
			"rejects a %s redirected outside the destination during rendering",
			async (target) => {
				createTemplateFile(target === "directory" ? "nested/sentinel.txt" : "sentinel.txt", "new");
				const swappedPath =
					target === "file"
						? join(destDir, "sentinel.txt")
						: target === "directory"
							? join(destDir, "nested")
							: destDir;

				await expect(
					scaffoldTemplate({
						render: async (source) => {
							await Promise.resolve();
							rmSync(swappedPath, { recursive: true, force: true });
							symlinkSync(target === "file" ? sentinel : outsideDir, swappedPath);
							return source;
						},
					}),
				).rejects.toThrow("outside the destination");
				expect(readFileSync(sentinel, "utf-8")).toBe("original");
			},
		);

		it("rechecks binary destinations after an earlier renderer runs", async () => {
			createTemplateFile("a.txt", "text");
			createTemplateBinaryFile("z.bin", Buffer.from([0, 1]));

			await expect(
				scaffoldTemplate({
					render: async (source) => {
						await Promise.resolve();
						symlinkSync(sentinel, join(destDir, "z.bin"));
						return source;
					},
				}),
			).rejects.toThrow("outside the destination");
			expect(readFileSync(sentinel, "utf-8")).toBe("original");
			expect(readOutputFile("a.txt")).toBe("text");
		});

		it("writes through a link that stays inside the destination", async () => {
			createTemplateFile("alias.txt", "{{name}}");
			writeFileSync(join(destDir, "real.txt"), "old", "utf-8");
			symlinkSync(join(destDir, "real.txt"), join(destDir, "alias.txt"));

			const result = await scaffoldTemplate({ context: { name: "my-app" }, conflict: "overwrite" });

			expect(result.files).toEqual(["alias.txt"]);
			expect(readOutputFile("real.txt")).toBe("my-app");
		});

		it("treats an explicitly chosen symlinked root as the destination", async () => {
			createTemplateFile("src/index.ts", "{{name}}");
			const linkedRoot = join(tempDir, "linked-root");
			symlinkSync(destDir, linkedRoot);

			const result = await scaffoldTemplate({ dest: linkedRoot, context: { name: "my-app" } });

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
		createTemplateFile("hello.txt", "hi {{who}}");

		const result = await scaffoldTemplate({
			template: pathToFileURL(templateDir),
			context: { who: "URL" },
		});

		expect(result.files).toContain("hello.txt");
		expect(readOutputFile("hello.txt")).toBe("hi URL");
	});

	it("throws when template directory does not exist", async () => {
		await expect(scaffoldTemplate({ template: "/nonexistent/path/to/template" })).rejects.toThrow(
			"does not exist",
		);
	});

	it("throws when template path is a file, not a directory", async () => {
		const filePath = join(tempDir, "not-a-dir.txt");
		writeFileSync(filePath, "I am a file");

		await expect(scaffoldTemplate({ template: filePath })).rejects.toThrow("is not a directory");
	});
});
