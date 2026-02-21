import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { scaffold } from "../src/scaffold.ts";

// ────────────────────────────────────────────────────────────────────────────
// Test Helpers
// ────────────────────────────────────────────────────────────────────────────

let tempDir: string;
let templateDir: string;
let destDir: string;

beforeEach(() => {
	tempDir = resolve(
		`.tmp-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
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
		createTemplateFile(
			"package.json",
			'{ "name": "{{name}}", "description": "{{description}}" }',
		);
		createTemplateFile("src/index.ts", "// {{name}} - {{description}}");

		const result = await scaffold({
			template: templateDir,
			dest: destDir,
			importMeta: `file://${resolve(".")}/test.ts`,
			context: { name: "my-app", description: "A cool CLI" },
		});

		expect(result.files).toContain("package.json");
		expect(result.files).toContain(join("src", "index.ts"));
		expect(result.files).toHaveLength(2);

		expect(readOutputFile("package.json")).toBe(
			'{ "name": "my-app", "description": "A cool CLI" }',
		);
		expect(readOutputFile(join("src", "index.ts"))).toBe(
			"// my-app - A cool CLI",
		);
	});

	it("renames dotfiles: _gitignore becomes .gitignore", async () => {
		createTemplateFile("_gitignore", "node_modules\ndist\n");

		const result = await scaffold({
			template: templateDir,
			dest: destDir,
			importMeta: `file://${resolve(".")}/test.ts`,
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
			importMeta: `file://${resolve(".")}/test.ts`,
			context: {},
		});

		const expected = join("config", ".eslintrc.json");
		expect(result.files).toContain(expected);
		expect(readOutputFile(expected)).toBe('{ "root": true }');
	});

	it("throws when conflict is 'abort' and dest is non-empty", async () => {
		// Create a non-empty destination directory
		mkdirSync(destDir, { recursive: true });
		writeFileSync(join(destDir, "existing.txt"), "existing content");

		createTemplateFile("file.txt", "hello");

		expect(
			scaffold({
				template: templateDir,
				dest: destDir,
				importMeta: `file://${resolve(".")}/test.ts`,
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

		expect(
			scaffold({
				template: templateDir,
				dest: destDir,
				importMeta: `file://${resolve(".")}/test.ts`,
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
			importMeta: `file://${resolve(".")}/test.ts`,
			context: { author: "crust" },
			conflict: "overwrite",
		});

		expect(result.files).toContain("file.txt");
		expect(readOutputFile("file.txt")).toBe("new content from crust");
	});

	it("copies binary files without interpolation", async () => {
		// Create a binary file with null bytes (simulating an image)
		const binaryData = Buffer.from([
			0x89, 0x50, 0x4e, 0x47, 0x00, 0x0d, 0x0a, 0x1a, 0x0a,
		]);
		createTemplateBinaryFile("assets/image.png", binaryData);

		// Also create a text file with {{var}} to show binary skips interpolation
		createTemplateFile("readme.txt", "Hello {{name}}");

		const result = await scaffold({
			template: templateDir,
			dest: destDir,
			importMeta: `file://${resolve(".")}/test.ts`,
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

	it("handles templates with no interpolation placeholders", async () => {
		createTemplateFile("static.txt", "No placeholders here.");

		const result = await scaffold({
			template: templateDir,
			dest: destDir,
			importMeta: `file://${resolve(".")}/test.ts`,
			context: { name: "unused" },
		});

		expect(result.files).toContain("static.txt");
		expect(readOutputFile("static.txt")).toBe("No placeholders here.");
	});

	it("scaffolds into a non-existent destination directory (creates it)", async () => {
		createTemplateFile("hello.txt", "hi {{who}}");

		const result = await scaffold({
			template: templateDir,
			dest: destDir,
			importMeta: `file://${resolve(".")}/test.ts`,
			context: { who: "there" },
		});

		expect(existsSync(destDir)).toBe(true);
		expect(result.files).toContain("hello.txt");
		expect(readOutputFile("hello.txt")).toBe("hi there");
	});

	it("allows scaffold on an empty existing directory with conflict 'abort'", async () => {
		// Create an empty destination directory
		mkdirSync(destDir, { recursive: true });

		createTemplateFile("file.txt", "content");

		const result = await scaffold({
			template: templateDir,
			dest: destDir,
			importMeta: `file://${resolve(".")}/test.ts`,
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
		writeFileSync(
			join(baseTemplateDir, "package.json"),
			'{ "name": "{{name}}" }',
		);
		writeFileSync(join(baseTemplateDir, "README.md"), "# {{name}}");

		await scaffold({
			template: baseTemplateDir,
			dest: destDir,
			importMeta: `file://${resolve(".")}/test.ts`,
			context: { name: "my-project" },
		});

		// Second scaffold: overlay template (adds/overwrites)
		const overlayTemplateDir = join(tempDir, "template-overlay");
		mkdirSync(join(overlayTemplateDir, "src"), { recursive: true });
		writeFileSync(
			join(overlayTemplateDir, "src/index.ts"),
			"// {{name}} entry",
		);
		writeFileSync(
			join(overlayTemplateDir, "tsconfig.json"),
			'{ "strict": true }',
		);

		const result = await scaffold({
			template: overlayTemplateDir,
			dest: destDir,
			importMeta: `file://${resolve(".")}/test.ts`,
			context: { name: "my-project" },
			conflict: "overwrite",
		});

		// Verify files from both scaffolds exist
		expect(existsSync(join(destDir, "package.json"))).toBe(true);
		expect(existsSync(join(destDir, "README.md"))).toBe(true);
		expect(existsSync(join(destDir, "src/index.ts"))).toBe(true);
		expect(existsSync(join(destDir, "tsconfig.json"))).toBe(true);

		// Verify content from first scaffold is preserved
		expect(readFileSync(join(destDir, "package.json"), "utf-8")).toBe(
			'{ "name": "my-project" }',
		);
		expect(readFileSync(join(destDir, "README.md"), "utf-8")).toBe(
			"# my-project",
		);

		// Verify content from second scaffold is correct
		expect(readFileSync(join(destDir, "src/index.ts"), "utf-8")).toBe(
			"// my-project entry",
		);
		expect(readFileSync(join(destDir, "tsconfig.json"), "utf-8")).toBe(
			'{ "strict": true }',
		);

		// The result only contains files from the second scaffold call
		expect(result.files).toContain(join("src", "index.ts"));
		expect(result.files).toContain("tsconfig.json");
	});

	it("preserves nested directory structure", async () => {
		createTemplateFile(
			"src/components/Button.tsx",
			"<button>{{label}}</button>",
		);
		createTemplateFile("src/utils/helpers.ts", "export const APP = '{{name}}'");
		createTemplateFile("public/index.html", "<h1>{{name}}</h1>");

		const result = await scaffold({
			template: templateDir,
			dest: destDir,
			importMeta: `file://${resolve(".")}/test.ts`,
			context: { name: "my-app", label: "Click me" },
		});

		expect(result.files).toHaveLength(3);
		expect(readOutputFile(join("src", "components", "Button.tsx"))).toBe(
			"<button>Click me</button>",
		);
		expect(readOutputFile(join("src", "utils", "helpers.ts"))).toBe(
			"export const APP = 'my-app'",
		);
		expect(readOutputFile(join("public", "index.html"))).toBe(
			"<h1>my-app</h1>",
		);
	});

	it("returns files sorted relative to dest", async () => {
		createTemplateFile("b.txt", "b");
		createTemplateFile("a.txt", "a");

		const result = await scaffold({
			template: templateDir,
			dest: destDir,
			importMeta: `file://${resolve(".")}/test.ts`,
			context: {},
		});

		// Files are returned, though order depends on filesystem readdir order
		expect(result.files).toHaveLength(2);
		expect(result.files).toContain("a.txt");
		expect(result.files).toContain("b.txt");
	});
});
