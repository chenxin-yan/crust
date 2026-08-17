import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";

import { scaffold } from "@crustjs/create";

import corePackage from "../../core/package.json";
import crustPackage from "../../crust/package.json";
import extensionsPackage from "../../extensions/package.json";

const TEST_DIR = resolve(import.meta.dirname, ".tmp-scaffold-test");
const TEMPLATE_DIR = resolve(import.meta.dirname, "../templates");
const TEMPLATE_VERSION_CONTEXT = {
	crustCoreVersion: corePackage.version,
	crustExtensionsVersion: extensionsPackage.version,
	crustCliVersion: crustPackage.version,
} satisfies Record<string, string>;
const EXPECTED_CRUST_DEPENDENCIES = {
	"@crustjs/core": `^${corePackage.version}`,
	"@crustjs/extensions": `^${extensionsPackage.version}`,
};
const EXPECTED_CRUST_DEV_DEPENDENCIES = {
	"@crustjs/crust": `^${crustPackage.version}`,
};

type DistributionMode = "binary" | "runtime";

/**
 * Helper to scaffold a project by layering base + style + distribution templates.
 */
async function scaffoldProject(
	dest: string,
	context: { name: string },
	options?: {
		distribution?: DistributionMode;
	},
): Promise<void> {
	const distribution = options?.distribution ?? "binary";
	const scaffoldContext = { ...context, ...TEMPLATE_VERSION_CONTEXT };

	await scaffold({
		template: resolve(TEMPLATE_DIR, "base"),
		dest,
		context: scaffoldContext,
	});

	await scaffold({
		template: resolve(TEMPLATE_DIR, "minimal"),
		dest,
		context: scaffoldContext,
		conflict: "overwrite",
	});

	await scaffold({
		template: resolve(TEMPLATE_DIR, "distribution", distribution),
		dest,
		context: scaffoldContext,
		conflict: "overwrite",
	});
}

async function scaffoldBase(dest: string, context: { name: string }): Promise<void> {
	await scaffoldProject(dest, context, { distribution: "binary" });
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
	it("generates package.json with correct name and dependencies", async () => {
		await scaffoldBase(TEST_DIR, { name: "my-awesome-cli" });

		const pkg = JSON.parse(readFileSync(resolve(TEST_DIR, "package.json"), "utf-8"));

		expect(pkg.name).toBe("my-awesome-cli");
		expect(pkg.version).toBe("0.0.0");
		expect(pkg.type).toBe("module");
		expect(pkg.bin).toEqual({ "my-awesome-cli": "dist/cli" });
		expect(pkg.dependencies).toBeUndefined();
		expect(pkg.devDependencies).toEqual({
			...EXPECTED_CRUST_DEPENDENCIES,
			...EXPECTED_CRUST_DEV_DEPENDENCIES,
			"@types/bun": "latest",
			typescript: "^7.0.2",
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
		await scaffoldProject(TEST_DIR, { name: "runtime-cli" }, { distribution: "runtime" });

		const pkg = JSON.parse(readFileSync(resolve(TEST_DIR, "package.json"), "utf-8"));

		expect(pkg.bin).toEqual({ "runtime-cli": "dist/cli.js" });
		expect(pkg.files).toEqual(["dist"]);
		expect(pkg.dependencies).toEqual(EXPECTED_CRUST_DEPENDENCIES);
		expect(pkg.devDependencies).toEqual({
			...EXPECTED_CRUST_DEV_DEPENDENCIES,
			"@types/bun": "latest",
			typescript: "^7.0.2",
		});
		expect(pkg.scripts).toEqual({
			dev: "bun run src/cli.ts",
			build: "bun build src/cli.ts --target bun --outfile dist/cli.js",
			prepack: "bun run build",
			start: "bun run dist/cli.js",
			"check:types": "tsc --noEmit",
		});
	});

	it("generates a valid CLI entry file with Crust builder API", async () => {
		await scaffoldBase(TEST_DIR, { name: "test-cli" });

		const cliContent = readFileSync(resolve(TEST_DIR, "src", "cli.ts"), "utf-8");

		// No shebang — compiled binary is standalone
		expect(cliContent.startsWith("import")).toBe(true);
		// Uses the public Crust builder
		expect(cliContent).toContain("new Crust(");
		// Uses execute()
		expect(cliContent).toContain(".execute()");
		// Uses help/version extensions
		expect(cliContent).toContain("help()");
		expect(cliContent).toContain("version(");
		expect(cliContent).toContain('import pkg from "../package.json"');
		expect(cliContent).toContain("version(pkg.version)");
		// Imports from @crustjs/core and @crustjs/extensions
		expect(cliContent).toContain('"@crustjs/core"');
		expect(cliContent).toContain('"@crustjs/extensions"');
		// Contains command name
		expect(cliContent).toContain('"test-cli"');
		// Has a positional name argument with string literal type
		expect(cliContent).toContain('type: "string"');
		// Has a run function
		expect(cliContent).toContain(".action(");
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
