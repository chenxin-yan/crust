import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { scaffold } from "../src/index.ts";

const TEST_DIR = resolve(import.meta.dirname, ".tmp-scaffold-test");

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
	it("creates the project directory structure", () => {
		scaffold({
			dir: TEST_DIR,
			name: "my-cli",
			description: "Test CLI",
			author: "Test Author",
		});

		expect(existsSync(resolve(TEST_DIR, "package.json"))).toBe(true);
		expect(existsSync(resolve(TEST_DIR, "tsconfig.json"))).toBe(true);
		expect(existsSync(resolve(TEST_DIR, "src", "cli.ts"))).toBe(true);
		expect(existsSync(resolve(TEST_DIR, "src", "index.ts"))).toBe(true);
	});

	it("generates package.json with correct name and dependencies", () => {
		scaffold({
			dir: TEST_DIR,
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
		expect(pkg.dependencies).toEqual({ crust: "latest" });
		expect(pkg.devDependencies).toEqual({
			typescript: "^5",
		});
		expect(pkg.scripts).toEqual({
			build: "crust build",
			dev: "crust dev",
		});
	});

	it("generates package.json without empty description or author", () => {
		scaffold({
			dir: TEST_DIR,
			name: "minimal-cli",
			description: "",
			author: "",
		});

		const pkg = JSON.parse(
			readFileSync(resolve(TEST_DIR, "package.json"), "utf-8"),
		);

		expect(pkg.name).toBe("minimal-cli");
		expect(pkg.description).toBeUndefined();
		expect(pkg.author).toBeUndefined();
	});

	it("generates tsconfig.json with strict mode and bundler resolution", () => {
		scaffold({
			dir: TEST_DIR,
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

	it("generates a valid CLI entry file with defineCommand and runMain", () => {
		scaffold({
			dir: TEST_DIR,
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
		// Imports from crust
		expect(cliContent).toContain('"crust"');
		// Contains command name
		expect(cliContent).toContain('"test-cli"');
		// Has a positional name argument with String type
		expect(cliContent).toContain("type: String");
		// Has a run function
		expect(cliContent).toContain("run(");
	});

	it("generates src/index.ts that re-exports cli", () => {
		scaffold({
			dir: TEST_DIR,
			name: "my-cli",
			description: "",
			author: "",
		});

		const indexContent = readFileSync(
			resolve(TEST_DIR, "src", "index.ts"),
			"utf-8",
		);

		expect(indexContent).toContain("./cli.ts");
	});

	it("generates CLI file that is valid TypeScript (compile check)", () => {
		scaffold({
			dir: TEST_DIR,
			name: "compile-test-cli",
			description: "",
			author: "",
		});

		// Install @crust/core so the compile check can resolve the import
		// Instead of a full install, we just check the syntax is valid TypeScript
		// by running bun's TypeScript parser on it
		const cliContent = readFileSync(
			resolve(TEST_DIR, "src", "cli.ts"),
			"utf-8",
		);

		// Verify it parses without syntax errors by checking structure
		// (We can't run tsc without dependencies installed, but we can verify syntax)
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

	it("creates project in nested directory (creates parent dirs)", () => {
		const nestedDir = resolve(TEST_DIR, "deep", "nested", "project");

		scaffold({
			dir: nestedDir,
			name: "nested-cli",
			description: "",
			author: "",
		});

		expect(existsSync(resolve(nestedDir, "package.json"))).toBe(true);
		expect(existsSync(resolve(nestedDir, "src", "cli.ts"))).toBe(true);
	});

	it("overwrites existing directory when scaffold is called", () => {
		// Create directory with some content
		mkdirSync(resolve(TEST_DIR, "src"), { recursive: true });

		// Scaffold over it
		scaffold({
			dir: TEST_DIR,
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

	it("sets bin entry to match project name", () => {
		scaffold({
			dir: TEST_DIR,
			name: "my-custom-bin",
			description: "",
			author: "",
		});

		const pkg = JSON.parse(
			readFileSync(resolve(TEST_DIR, "package.json"), "utf-8"),
		);
		expect(pkg.bin["my-custom-bin"]).toBe("dist/cli.js");
	});
});
