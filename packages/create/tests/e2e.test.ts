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
import { runSteps } from "../src/steps.ts";

// ────────────────────────────────────────────────────────────────────────────
// End-to-End Integration Test
// ────────────────────────────────────────────────────────────────────────────

describe("end-to-end scaffold + runSteps", () => {
	let tempDir: string;
	let templateDir: string;
	let destDir: string;

	beforeEach(() => {
		tempDir = resolve(
			`.tmp-test-e2e-${Date.now()}-${Math.random().toString(36).slice(2)}`,
		);
		templateDir = join(tempDir, "template");
		destDir = join(tempDir, "output");

		// Create a realistic template directory with multiple file types:
		// - _gitignore  (dotfile renaming)
		// - package.json (interpolation)
		// - src/index.ts (interpolation in nested dir)
		mkdirSync(join(templateDir, "src"), { recursive: true });

		writeFileSync(
			join(templateDir, "_gitignore"),
			"node_modules\ndist\n.env\n",
		);

		writeFileSync(
			join(templateDir, "package.json"),
			JSON.stringify(
				{
					name: "{{name}}",
					version: "0.0.1",
					description: "{{description}}",
					type: "module",
				},
				null,
				"\t",
			),
		);

		writeFileSync(
			join(templateDir, "src/index.ts"),
			["// {{description}}", 'console.log("Welcome to {{name}}!");', ""].join(
				"\n",
			),
		);
	});

	afterEach(() => {
		if (existsSync(tempDir)) {
			rmSync(tempDir, { recursive: true, force: true });
		}
	});

	it("scaffolds a full project and initializes git", async () => {
		const context = {
			name: "my-awesome-cli",
			description: "A blazing-fast CLI tool",
		};

		// ── Step 1: Scaffold the template ───────────────────────────────────
		const result = await scaffold({
			template: templateDir,
			dest: destDir,
			importMeta: `file://${resolve(".")}/test.ts`,
			context,
		});

		// Verify all expected files were created
		expect(result.files).toHaveLength(3);
		expect(result.files).toContain(".gitignore"); // dotfile renamed
		expect(result.files).toContain("package.json");
		expect(result.files).toContain(join("src", "index.ts"));

		// Verify dotfile renaming: _gitignore → .gitignore
		expect(existsSync(join(destDir, ".gitignore"))).toBe(true);
		expect(existsSync(join(destDir, "_gitignore"))).toBe(false);
		expect(readFileSync(join(destDir, ".gitignore"), "utf-8")).toBe(
			"node_modules\ndist\n.env\n",
		);

		// Verify package.json interpolation
		const pkg = JSON.parse(
			readFileSync(join(destDir, "package.json"), "utf-8"),
		);
		expect(pkg.name).toBe("my-awesome-cli");
		expect(pkg.description).toBe("A blazing-fast CLI tool");
		expect(pkg.version).toBe("0.0.1"); // static value preserved
		expect(pkg.type).toBe("module"); // static value preserved

		// Verify src/index.ts interpolation
		const indexContent = readFileSync(join(destDir, "src/index.ts"), "utf-8");
		expect(indexContent).toContain("// A blazing-fast CLI tool");
		expect(indexContent).toContain(
			'console.log("Welcome to my-awesome-cli!");',
		);

		// ── Step 2: Run post-scaffold steps (git-init) ──────────────────────
		await runSteps([{ type: "git-init", commit: "Initial commit" }], destDir);

		// Verify git was initialized
		expect(existsSync(join(destDir, ".git"))).toBe(true);

		// Verify the initial commit was created with the correct message
		const gitLog = Bun.spawnSync(
			["git", "log", "--oneline", "-1", "--format=%s"],
			{ cwd: destDir },
		);
		expect(gitLog.exitCode).toBe(0);
		expect(gitLog.stdout.toString().trim()).toBe("Initial commit");

		// Verify all files were committed (no untracked or modified files)
		const gitStatus = Bun.spawnSync(["git", "status", "--porcelain"], {
			cwd: destDir,
		});
		expect(gitStatus.exitCode).toBe(0);
		expect(gitStatus.stdout.toString().trim()).toBe("");
	});
});
