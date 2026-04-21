import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { scaffold } from "@crustjs/create";

const TEST_DIR = resolve(import.meta.dirname, ".tmp-scaffold-test");

type TemplateStyle = "minimal" | "modular";
type DistributionMode = "binary" | "runtime";

/**
 * Helper to scaffold a project by layering base + style + distribution templates.
 */
async function scaffoldProject(
	dest: string,
	context: { name: string },
	options?: {
		style?: TemplateStyle;
		distribution?: DistributionMode;
		conflict?: "abort" | "overwrite";
	},
): Promise<void> {
	const style = options?.style ?? "minimal";
	const distribution = options?.distribution ?? "binary";
	const conflict = options?.conflict ?? "overwrite";

	await scaffold({
		template: "templates/base",
		dest,
		context,
		conflict,
	});

	await scaffold({
		template: style === "minimal" ? "templates/minimal" : "templates/modular",
		dest,
		context,
		conflict: "overwrite",
	});

	await scaffold({
		template:
			distribution === "binary"
				? "templates/distribution/binary"
				: "templates/distribution/runtime",
		dest,
		context,
		conflict: "overwrite",
	});
}

async function scaffoldBase(
	dest: string,
	context: { name: string },
	conflict: "abort" | "overwrite" = "overwrite",
): Promise<void> {
	await scaffoldProject(dest, context, {
		style: "minimal",
		distribution: "binary",
		conflict,
	});
}

async function scaffoldModular(
	dest: string,
	context: { name: string },
	conflict: "abort" | "overwrite" = "overwrite",
): Promise<void> {
	await scaffoldProject(dest, context, {
		style: "modular",
		distribution: "binary",
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
		await scaffoldBase(TEST_DIR, { name: "my-cli" });

		expect(existsSync(resolve(TEST_DIR, "package.json"))).toBe(true);
		expect(existsSync(resolve(TEST_DIR, "tsconfig.json"))).toBe(true);
		expect(existsSync(resolve(TEST_DIR, "src", "cli.ts"))).toBe(true);
		expect(existsSync(resolve(TEST_DIR, "README.md"))).toBe(true);
	});

	it("generates package.json with correct name and dependencies", async () => {
		await scaffoldBase(TEST_DIR, { name: "my-awesome-cli" });

		const pkg = JSON.parse(
			readFileSync(resolve(TEST_DIR, "package.json"), "utf-8"),
		);

		expect(pkg.name).toBe("my-awesome-cli");
		expect(pkg.version).toBe("0.0.0");
		expect(pkg.type).toBe("module");
		expect(pkg.bin).toEqual({ "my-awesome-cli": "dist/cli" });
		// @crustjs/* packages are added by the post-scaffold `add` step
		// (when installDeps is true), not by the template itself, so the
		// raw scaffolded package.json only contains typescript here.
		expect(pkg.dependencies).toBeUndefined();
		expect(pkg.devDependencies).toEqual({
			typescript: "^6",
		});
		expect(pkg.scripts).toEqual({
			dev: "bun run src/cli.ts",
			build: "crust build",
			package: "crust build --package",
			publish: "crust publish --stage-dir dist/npm",
			start: "./dist/cli",
			"check:types": "tsc --noEmit",
		});
	});

	it("generates runtime distribution package.json when selected", async () => {
		await scaffoldProject(
			TEST_DIR,
			{ name: "runtime-cli" },
			{ distribution: "runtime" },
		);

		const pkg = JSON.parse(
			readFileSync(resolve(TEST_DIR, "package.json"), "utf-8"),
		);

		expect(pkg.bin).toEqual({ "runtime-cli": "dist/cli.js" });
		expect(pkg.files).toEqual(["dist"]);
		// @crustjs/* packages are added by the post-scaffold `add` step,
		// not by the template itself.
		expect(pkg.dependencies).toBeUndefined();
		expect(pkg.devDependencies).toEqual({
			typescript: "^6",
		});
		expect(pkg.scripts).toEqual({
			dev: "bun run src/cli.ts",
			build: "bun build src/cli.ts --target bun --outfile dist/cli.js",
			prepack: "bun run build",
			start: "bun run dist/cli.js",
			"check:types": "tsc --noEmit",
		});
	});

	it("generates package.json with generic description and no author", async () => {
		await scaffoldBase(TEST_DIR, { name: "minimal-cli" });

		const pkg = JSON.parse(
			readFileSync(resolve(TEST_DIR, "package.json"), "utf-8"),
		);

		expect(pkg.name).toBe("minimal-cli");
		expect(pkg.description).toBe("A CLI built with Crust");
		expect(pkg.author).toBeUndefined();
	});

	it("generates tsconfig.json with strict mode and bundler resolution", async () => {
		await scaffoldBase(TEST_DIR, { name: "my-cli" });

		const tsconfig = JSON.parse(
			readFileSync(resolve(TEST_DIR, "tsconfig.json"), "utf-8"),
		);

		expect(tsconfig.compilerOptions.strict).toBe(true);
		expect(tsconfig.compilerOptions.moduleResolution).toBe("bundler");
		expect(tsconfig.compilerOptions.target).toBe("ESNext");
		expect(tsconfig.compilerOptions.module).toBe("Preserve");
		expect(tsconfig.include).toEqual(["src"]);
	});

	it("generates a valid CLI entry file with Crust builder API", async () => {
		await scaffoldBase(TEST_DIR, { name: "test-cli" });

		const cliContent = readFileSync(
			resolve(TEST_DIR, "src", "cli.ts"),
			"utf-8",
		);

		// No shebang — compiled binary is standalone
		expect(cliContent.startsWith("import")).toBe(true);
		// Uses Crust builder
		expect(cliContent).toContain("new Crust(");
		// Uses execute()
		expect(cliContent).toContain(".execute()");
		// Uses help/version plugins
		expect(cliContent).toContain("helpPlugin");
		expect(cliContent).toContain("versionPlugin");
		expect(cliContent).toContain('import pkg from "../package.json"');
		expect(cliContent).toContain("versionPlugin(pkg.version)");
		// Imports from @crustjs/core and @crustjs/plugins
		expect(cliContent).toContain('"@crustjs/core"');
		expect(cliContent).toContain('"@crustjs/plugins"');
		// Contains command name
		expect(cliContent).toContain('"test-cli"');
		// Has a positional name argument with string literal type
		expect(cliContent).toContain('type: "string"');
		// Has a run function
		expect(cliContent).toContain(".run(");
	});

	it("generates CLI file that is valid TypeScript (compile check)", async () => {
		await scaffoldBase(TEST_DIR, { name: "compile-test-cli" });

		// Verify it parses without syntax errors by checking structure
		const cliContent = readFileSync(
			resolve(TEST_DIR, "src", "cli.ts"),
			"utf-8",
		);

		expect(cliContent).toContain("import {");
		expect(cliContent).toContain("const cli = new Crust(");
		expect(cliContent).toContain("await cli.execute()");
		expect(cliContent).toContain(".use(");
		expect(cliContent).toContain("versionPlugin(");
		expect(cliContent).toContain("helpPlugin()");
		// Has proper structure: name, args, flags, run
		expect(cliContent).toContain('new Crust("compile-test-cli")');
		expect(cliContent).toContain(".args([");
		expect(cliContent).toContain(".flags(");
		expect(cliContent).toContain(".run(");
	});

	it("generates modular template with file-splitting .sub() pattern", async () => {
		await scaffoldModular(TEST_DIR, { name: "modular-cli" });

		expect(existsSync(resolve(TEST_DIR, "src", "app.ts"))).toBe(true);
		expect(existsSync(resolve(TEST_DIR, "src", "cli.ts"))).toBe(true);
		expect(existsSync(resolve(TEST_DIR, "src", "commands", "greet.ts"))).toBe(
			true,
		);

		const appContent = readFileSync(
			resolve(TEST_DIR, "src", "app.ts"),
			"utf-8",
		);
		const cliContent = readFileSync(
			resolve(TEST_DIR, "src", "cli.ts"),
			"utf-8",
		);
		const greetContent = readFileSync(
			resolve(TEST_DIR, "src", "commands", "greet.ts"),
			"utf-8",
		);

		expect(appContent).toContain('new Crust("modular-cli")');
		expect(appContent).toContain("inherit: true");
		expect(greetContent).toContain('.sub("greet")');
		expect(greetContent).toContain("flags.greet");
		expect(cliContent).toContain(".command(greetCmd)");
		expect(cliContent).toContain(".execute()");
	});

	it("supports modular template with runtime distribution", async () => {
		await scaffoldProject(
			TEST_DIR,
			{ name: "modular-runtime-cli" },
			{
				style: "modular",
				distribution: "runtime",
			},
		);

		expect(existsSync(resolve(TEST_DIR, "src", "app.ts"))).toBe(true);
		expect(existsSync(resolve(TEST_DIR, "src", "commands", "greet.ts"))).toBe(
			true,
		);

		const pkg = JSON.parse(
			readFileSync(resolve(TEST_DIR, "package.json"), "utf-8"),
		);
		expect(pkg.bin["modular-runtime-cli"]).toBe("dist/cli.js");
		// @crustjs/* packages are added by the post-scaffold `add` step,
		// not by the template itself.
		expect(pkg.dependencies).toBeUndefined();
		expect(pkg.devDependencies).toEqual({
			typescript: "^6",
		});
	});

	it("creates project in nested directory (creates parent dirs)", async () => {
		const nestedDir = resolve(TEST_DIR, "deep", "nested", "project");

		await scaffoldBase(nestedDir, { name: "nested-cli" });

		expect(existsSync(resolve(nestedDir, "package.json"))).toBe(true);
		expect(existsSync(resolve(nestedDir, "src", "cli.ts"))).toBe(true);
	});

	it("overwrites existing directory when scaffold is called with overwrite", async () => {
		// Create directory with some content
		mkdirSync(resolve(TEST_DIR, "src"), { recursive: true });

		// Scaffold over it
		await scaffoldBase(TEST_DIR, { name: "overwrite-cli" });

		const pkg = JSON.parse(
			readFileSync(resolve(TEST_DIR, "package.json"), "utf-8"),
		);
		expect(pkg.name).toBe("overwrite-cli");
	});

	it("sets bin entry to match project name", async () => {
		await scaffoldBase(TEST_DIR, { name: "my-custom-bin" });

		const pkg = JSON.parse(
			readFileSync(resolve(TEST_DIR, "package.json"), "utf-8"),
		);
		expect(pkg.bin["my-custom-bin"]).toBe("dist/cli");
	});

	it("creates .gitignore from _gitignore template via dotfile renaming", async () => {
		await scaffoldBase(TEST_DIR, { name: "gitignore-cli" });

		expect(existsSync(resolve(TEST_DIR, ".gitignore"))).toBe(true);
		const gitignore = readFileSync(resolve(TEST_DIR, ".gitignore"), "utf-8");
		expect(gitignore).toContain("node_modules");
		expect(gitignore).toContain("dist");
	});

	it("generates README.md with project name", async () => {
		await scaffoldBase(TEST_DIR, { name: "readme-cli" });

		expect(existsSync(resolve(TEST_DIR, "README.md"))).toBe(true);
		const readme = readFileSync(resolve(TEST_DIR, "README.md"), "utf-8");
		expect(readme).toContain("# readme-cli");
		expect(readme).toContain("Crust");
		expect(readme).toContain("bun run dev");
		expect(readme).toContain("bun run build");
		expect(readme).toContain("bun run package");
	});
});
