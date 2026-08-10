import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";

import { scaffold } from "@crustjs/create";

import corePackage from "../../core/package.json";
import crustPackage from "../../crust/package.json";
import extensionsPackage from "../../extensions/package.json";
import testingPackage from "../../testing/package.json";

const TEST_DIR = resolve(import.meta.dirname, ".tmp-scaffold-test");
const TEMPLATE_DIR = resolve(import.meta.dirname, "../templates");
const TEMPLATE_VERSION_CONTEXT = {
	crustCoreVersion: corePackage.version,
	crustExtensionsVersion: extensionsPackage.version,
	crustCliVersion: crustPackage.version,
	crustTestingVersion: testingPackage.version,
} satisfies Record<string, string>;
const EXPECTED_RUNTIME_DEPENDENCIES = {
	"@crustjs/core": `^${corePackage.version}`,
	"@crustjs/extensions": `^${extensionsPackage.version}`,
};
const EXPECTED_SHARED_DEV_DEPENDENCIES = {
	"@crustjs/testing": `^${testingPackage.version}`,
	"@types/bun": "latest",
	typescript: "^7.0.2",
};

type DistributionMode = "binary" | "runtime";

async function scaffoldProject(
	dest: string,
	context: { name: string },
	options?: { distribution?: DistributionMode; conflict?: "abort" | "overwrite" },
): Promise<void> {
	const distribution = options?.distribution ?? "binary";
	const conflict = options?.conflict ?? "overwrite";
	const scaffoldContext = { ...context, ...TEMPLATE_VERSION_CONTEXT };

	await scaffold({
		template: resolve(TEMPLATE_DIR, "base"),
		dest,
		context: scaffoldContext,
		conflict,
	});
	await scaffold({
		template: resolve(TEMPLATE_DIR, "app"),
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

function projectFiles(dir: string, prefix = ""): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
		return entry.isDirectory() ? projectFiles(resolve(dir, entry.name), relative) : [relative];
	});
}

beforeEach(() => rmSync(TEST_DIR, { recursive: true, force: true }));
afterEach(() => rmSync(TEST_DIR, { recursive: true, force: true }));

describe("create-crust templates", () => {
	it("creates the canonical split-file todo application", async () => {
		await scaffoldProject(TEST_DIR, { name: "my-cli" });

		expect(projectFiles(TEST_DIR).sort()).toEqual([
			".gitignore",
			"README.md",
			"package.json",
			"src/app.test.ts",
			"src/app.ts",
			"src/cli.ts",
			"src/commands/add.ts",
			"src/commands/done.ts",
			"src/commands/list.ts",
			"src/commands/remove.ts",
			"src/shared.ts",
			"tsconfig.json",
		]);
	});

	it("generates the binary distribution manifest", async () => {
		await scaffoldProject(TEST_DIR, { name: "my-awesome-cli" });
		const pkg = JSON.parse(readFileSync(resolve(TEST_DIR, "package.json"), "utf8"));

		expect(pkg).toMatchObject({
			name: "my-awesome-cli",
			version: "0.0.0",
			type: "module",
			description: "A todo CLI built with Crust",
			files: ["dist/cli", "dist/cli.cmd", "dist/*-bun-*"],
			bin: { "my-awesome-cli": "dist/cli" },
			scripts: {
				dev: "bun run src/cli.ts",
				build: "crust build",
				package: "crust build --package",
				publish: "crust publish --stage-dir dist/npm",
				start: "./dist/cli",
				"check:types": "tsc --noEmit",
				test: "bun test",
			},
			devDependencies: {
				...EXPECTED_RUNTIME_DEPENDENCIES,
				"@crustjs/crust": `^${crustPackage.version}`,
				...EXPECTED_SHARED_DEV_DEPENDENCIES,
			},
		});
		expect(pkg.dependencies).toBeUndefined();
		expect(pkg.author).toBeUndefined();
	});

	it("generates the Bun runtime distribution manifest", async () => {
		await scaffoldProject(TEST_DIR, { name: "runtime-cli" }, { distribution: "runtime" });
		const pkg = JSON.parse(readFileSync(resolve(TEST_DIR, "package.json"), "utf8"));

		expect(pkg).toMatchObject({
			name: "runtime-cli",
			files: ["dist"],
			bin: { "runtime-cli": "dist/cli.js" },
			dependencies: EXPECTED_RUNTIME_DEPENDENCIES,
			devDependencies: EXPECTED_SHARED_DEV_DEPENDENCIES,
			scripts: {
				dev: "bun run src/cli.ts",
				build: "bun build src/cli.ts --target bun --outfile dist/cli.js",
				prepack: "bun run build",
				start: "bun run dist/cli.js",
				"check:types": "tsc --noEmit",
				test: "bun test",
			},
		});
		expect(pkg.devDependencies["@crustjs/crust"]).toBeUndefined();
		expect(pkg.scripts.package).toBeUndefined();
		expect(pkg.scripts.publish).toBeUndefined();
	});

	it("keeps strict TypeScript and dotfile defaults", async () => {
		await scaffoldProject(TEST_DIR, { name: "my-cli" });
		const tsconfig = JSON.parse(readFileSync(resolve(TEST_DIR, "tsconfig.json"), "utf8"));

		expect(tsconfig.compilerOptions).toMatchObject({
			strict: true,
			moduleResolution: "bundler",
			target: "ESNext",
			module: "Preserve",
		});
		expect(tsconfig.include).toEqual(["src"]);
		expect(readFileSync(resolve(TEST_DIR, ".gitignore"), "utf8")).toContain("node_modules");
	});

	it("wires the composition root, context, commands, and safe extensions", async () => {
		await scaffoldProject(TEST_DIR, { name: "test-cli" });
		const cli = readFileSync(resolve(TEST_DIR, "src/cli.ts"), "utf8");
		const app = readFileSync(resolve(TEST_DIR, "src/app.ts"), "utf8");
		const shared = readFileSync(resolve(TEST_DIR, "src/shared.ts"), "utf8");

		expect(cli).toContain("app.add(addCommand, listCommand, doneCommand, removeCommand).execute()");
		expect(app).toContain('new Crust("test-cli"');
		expect(app).toContain("version(pkg.version)");
		expect(app).toContain("help()");
		expect(app).toContain("noColor()");
		expect(app).toContain("didYouMean()");
		expect(app).toContain("completion({ binName: pkg.name, version: pkg.version })");
		expect(app).toContain("// updateNotifier(");
		expect(app).toContain("needs a cache adapter to avoid a registry request per run");
		expect(app).toContain(".provide(todoStore())");
		expect(shared).toContain('defineFlag("data-file", {');
		expect(shared).toContain('type: "path"');
		expect(shared).toContain("Symbol.asyncDispose");
	});

	it("defines the requested todo command grammar", async () => {
		await scaffoldProject(TEST_DIR, { name: "test-cli" });
		const add = readFileSync(resolve(TEST_DIR, "src/commands/add.ts"), "utf8");
		const list = readFileSync(resolve(TEST_DIR, "src/commands/list.ts"), "utf8");
		const done = readFileSync(resolve(TEST_DIR, "src/commands/done.ts"), "utf8");
		const remove = readFileSync(resolve(TEST_DIR, "src/commands/remove.ts"), "utf8");

		expect(add).toContain("variadic: true");
		expect(add).toContain("required: true");
		expect(add).toContain('choices: ["low", "medium", "high"]');
		expect(list).toContain('name: "done"');
		expect(list).toContain('type: "boolean"');
		expect(done).toContain('name: "id"');
		expect(done).toContain('type: "number"');
		expect(remove).toContain('name: "force"');
		expect(remove).toContain('short: "f"');
	});

	it("ships an application test using captureRun and a Context double", async () => {
		await scaffoldProject(TEST_DIR, { name: "test-cli" });
		const test = readFileSync(resolve(TEST_DIR, "src/app.test.ts"), "utf8");

		expect(test).toContain('from "@crustjs/testing"');
		expect(test).toContain("captureRun(");
		expect(test).toContain("todoStore.of(");
	});

	it("writes variant-specific local release instructions without CI workflows", async () => {
		await scaffoldProject(TEST_DIR, { name: "binary-readme" });
		const binaryReadme = readFileSync(resolve(TEST_DIR, "README.md"), "utf8");
		expect(binaryReadme).toContain("bun run package");
		expect(binaryReadme).toContain("bun run publish");
		expect(binaryReadme).not.toContain("GitHub Actions");

		rmSync(TEST_DIR, { recursive: true, force: true });
		await scaffoldProject(TEST_DIR, { name: "runtime-readme" }, { distribution: "runtime" });
		const runtimeReadme = readFileSync(resolve(TEST_DIR, "README.md"), "utf8");
		expect(runtimeReadme).toContain("bun publish");
		expect(runtimeReadme).not.toContain("bun run package");
		expect(runtimeReadme).not.toContain("GitHub Actions");
	});

	it("creates nested destinations and overwrites template conflicts", async () => {
		const nested = resolve(TEST_DIR, "deep", "nested", "project");
		mkdirSync(resolve(nested, "src"), { recursive: true });
		await scaffoldProject(nested, { name: "nested-cli" });

		expect(existsSync(resolve(nested, "src/commands/add.ts"))).toBe(true);
		expect(JSON.parse(readFileSync(resolve(nested, "package.json"), "utf8")).name).toBe(
			"nested-cli",
		);
	});
});
