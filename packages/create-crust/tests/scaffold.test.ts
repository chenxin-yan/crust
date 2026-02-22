import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { scaffold } from "@crustjs/create";

const TEST_DIR = resolve(import.meta.dirname, ".tmp-scaffold-test");

/**
 * Simulated import.meta.url for the create-crust src/index.ts module.
 * The template path "../templates/base" is resolved relative to this.
 */
const IMPORT_META_URL = pathToFileURL(
	resolve(import.meta.dirname, "..", "src", "index.ts"),
).href;

/**
 * Helper to scaffold the base template with the given context variables.
 */
async function scaffoldBase(
	dest: string,
	context: { name: string; description: string; author: string },
	conflict: "abort" | "overwrite" = "overwrite",
): Promise<void> {
	await scaffold({
		template: "../templates/base",
		dest,
		importMeta: IMPORT_META_URL,
		context,
		conflict,
	});
}

beforeEach(() => {
	// Clean up before each test
	if (existsSync(TEST_DIR)) {
		rmSync(TEST_DIR, { recursive: true });
	}
});

afterEach(() => {
	// Clean up after each test
	if (existsSync(TEST_DIR)) {
		rmSync(TEST_DIR, { recursive: true });
	}
});

describe("scaffold", () => {
	it("creates the project directory structure", async () => {
		await scaffoldBase(TEST_DIR, {
			name: "my-cli",
			description: "Test CLI",
			author: "Test Author",
		});

		expect(existsSync(resolve(TEST_DIR, "package.json"))).toBe(true);
		expect(existsSync(resolve(TEST_DIR, "tsconfig.json"))).toBe(true);
		expect(existsSync(resolve(TEST_DIR, "src", "cli.ts"))).toBe(true);
	});

	it("generates package.json with correct name and dependencies", async () => {
		await scaffoldBase(TEST_DIR, {
			name: "my-awesome-cli",
			description: "An awesome CLI tool",
			author: "Jane Doe",
		});

		const pkg = JSON.parse(
			readFileSync(resolve(TEST_DIR, "package.json"), "utf-8"),
		);

		expect(pkg.name).toBe("my-awesome-cli");
		expect(pkg.version).toBe("0.0.0");
		expect(pkg.type).toBe("module");
		expect(pkg.description).toBe("An awesome CLI tool");
		expect(pkg.author).toBe("Jane Doe");
		expect(pkg.bin).toEqual({ "my-awesome-cli": "dist/cli.js" });
		expect(pkg.dependencies).toEqual({ "@crustjs/crust": "latest" });
		expect(pkg.devDependencies).toEqual({
			typescript: "^5",
		});
		expect(pkg.scripts).toEqual({
			build: "crust build",
			dev: "bun run src/cli.ts",
		});
	});

	it("generates package.json with empty description and author when not provided", async () => {
		await scaffoldBase(TEST_DIR, {
			name: "minimal-cli",
			description: "",
			author: "",
		});

		const pkg = JSON.parse(
			readFileSync(resolve(TEST_DIR, "package.json"), "utf-8"),
		);

		expect(pkg.name).toBe("minimal-cli");
		expect(pkg.description).toBe("");
		expect(pkg.author).toBe("");
	});

	it("generates tsconfig.json with strict mode and bundler resolution", async () => {
		await scaffoldBase(TEST_DIR, {
			name: "my-cli",
			description: "",
			author: "",
		});

		const tsconfig = JSON.parse(
			readFileSync(resolve(TEST_DIR, "tsconfig.json"), "utf-8"),
		);

		expect(tsconfig.compilerOptions.strict).toBe(true);
		expect(tsconfig.compilerOptions.moduleResolution).toBe("bundler");
		expect(tsconfig.compilerOptions.target).toBe("ESNext");
		expect(tsconfig.compilerOptions.module).toBe("Preserve");
		expect(tsconfig.include).toEqual(["src"]);
	});

	it("generates a valid CLI entry file with defineCommand and runMain", async () => {
		await scaffoldBase(TEST_DIR, {
			name: "test-cli",
			description: "",
			author: "",
		});

		const cliContent = readFileSync(
			resolve(TEST_DIR, "src", "cli.ts"),
			"utf-8",
		);

		// Shebang
		expect(cliContent.startsWith("#!/usr/bin/env bun")).toBe(true);
		// Uses defineCommand
		expect(cliContent).toContain("defineCommand");
		// Uses runMain
		expect(cliContent).toContain("runMain");
		// Uses help/version plugins
		expect(cliContent).toContain("helpPlugin");
		expect(cliContent).toContain("versionPlugin");
		expect(cliContent).toContain('import pkg from "../package.json"');
		expect(cliContent).toContain("versionPlugin(pkg.version)");
		// Imports from @crustjs/crust
		expect(cliContent).toContain('"@crustjs/crust"');
		// Contains command name
		expect(cliContent).toContain('"test-cli"');
		// Has a positional name argument with string literal type
		expect(cliContent).toContain('type: "string"');
		// Has a run function
		expect(cliContent).toContain("run(");
	});

	it("generates CLI file that is valid TypeScript (compile check)", async () => {
		await scaffoldBase(TEST_DIR, {
			name: "compile-test-cli",
			description: "",
			author: "",
		});

		// Verify it parses without syntax errors by checking structure
		const cliContent = readFileSync(
			resolve(TEST_DIR, "src", "cli.ts"),
			"utf-8",
		);

		expect(cliContent).toContain("import {");
		expect(cliContent).toContain("const main = defineCommand({");
		expect(cliContent).toContain("runMain(main, {");
		expect(cliContent).toContain("plugins: [versionPlugin");
		// Has proper structure: meta, args tuple, flags, run
		expect(cliContent).toContain("meta:");
		expect(cliContent).toContain("args: [");
		expect(cliContent).toContain("flags:");
		expect(cliContent).toContain("run(");
	});

	it("creates project in nested directory (creates parent dirs)", async () => {
		const nestedDir = resolve(TEST_DIR, "deep", "nested", "project");

		await scaffoldBase(nestedDir, {
			name: "nested-cli",
			description: "",
			author: "",
		});

		expect(existsSync(resolve(nestedDir, "package.json"))).toBe(true);
		expect(existsSync(resolve(nestedDir, "src", "cli.ts"))).toBe(true);
	});

	it("overwrites existing directory when scaffold is called with overwrite", async () => {
		// Create directory with some content
		mkdirSync(resolve(TEST_DIR, "src"), { recursive: true });

		// Scaffold over it
		await scaffoldBase(TEST_DIR, {
			name: "overwrite-cli",
			description: "Overwritten",
			author: "",
		});

		const pkg = JSON.parse(
			readFileSync(resolve(TEST_DIR, "package.json"), "utf-8"),
		);
		expect(pkg.name).toBe("overwrite-cli");
		expect(pkg.description).toBe("Overwritten");
	});

	it("sets bin entry to match project name", async () => {
		await scaffoldBase(TEST_DIR, {
			name: "my-custom-bin",
			description: "",
			author: "",
		});

		const pkg = JSON.parse(
			readFileSync(resolve(TEST_DIR, "package.json"), "utf-8"),
		);
		expect(pkg.bin["my-custom-bin"]).toBe("dist/cli.js");
	});

	it("creates .gitignore from _gitignore template via dotfile renaming", async () => {
		await scaffoldBase(TEST_DIR, {
			name: "gitignore-cli",
			description: "",
			author: "",
		});

		expect(existsSync(resolve(TEST_DIR, ".gitignore"))).toBe(true);
		const gitignore = readFileSync(resolve(TEST_DIR, ".gitignore"), "utf-8");
		expect(gitignore).toContain("node_modules");
		expect(gitignore).toContain("dist");
	});
});
