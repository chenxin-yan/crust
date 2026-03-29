import { afterEach, describe, expect, it } from "bun:test";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const cliPath = resolve(import.meta.dir, "..", "src", "index.ts");
const tempRoots: string[] = [];

function makeTempRoot(label: string): string {
	const dir = join(
		tmpdir(),
		`${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	);
	mkdirSync(dir, { recursive: true });
	tempRoots.push(dir);
	return dir;
}

async function runCreateCrust(
	args: string[],
	cwd: string,
	env?: Record<string, string>,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
	const proc = Bun.spawn([process.execPath, cliPath, ...args], {
		cwd,
		env: {
			...process.env,
			...env,
			BUN_BE_BUN: "1",
		},
		stdout: "pipe",
		stderr: "pipe",
	});

	return {
		exitCode: await proc.exited,
		stdout: await new Response(proc.stdout).text(),
		stderr: await new Response(proc.stderr).text(),
	};
}

afterEach(() => {
	for (const root of tempRoots.splice(0)) {
		rmSync(root, { recursive: true, force: true });
	}
});

describe("create-crust CLI", () => {
	it("scaffolds a project non-interactively when flags are provided", async () => {
		const tempRoot = makeTempRoot("create-crust-cli");
		const projectDir = join(tempRoot, "my-cli");

		const result = await runCreateCrust(
			[
				projectDir,
				"--template",
				"minimal",
				"--distribution",
				"binary",
				"--no-install",
				"--no-git",
			],
			tempRoot,
		);

		expect(result.exitCode).toBe(0);
		expect(result.stderr).not.toContain("Error:");
		expect(result.stdout).toContain("Created my-cli!");
		expect(result.stdout).not.toContain("Template style");
		expect(result.stdout).not.toContain("Distribution mode");
		expect(result.stdout).not.toContain("Install dependencies?");
		expect(result.stdout).not.toContain("Initialize a git repository?");
		expect(existsSync(join(projectDir, "package.json"))).toBe(true);
		expect(existsSync(join(projectDir, "tsconfig.json"))).toBe(true);
		expect(existsSync(join(projectDir, "src", "cli.ts"))).toBe(true);
		expect(existsSync(join(projectDir, "README.md"))).toBe(true);
		expect(existsSync(join(projectDir, "node_modules"))).toBe(false);
		expect(existsSync(join(projectDir, ".git"))).toBe(false);
	});

	it("fails with a clear error for an invalid template", async () => {
		const tempRoot = makeTempRoot("create-crust-invalid-template");
		const projectDir = join(tempRoot, "bad-template");

		const result = await runCreateCrust(
			[
				projectDir,
				"--template",
				"invalid",
				"--distribution",
				"binary",
				"--no-install",
				"--no-git",
			],
			tempRoot,
		);

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain(
			'Error: Invalid template "invalid". Expected "minimal" or "modular".',
		);
		expect(existsSync(projectDir)).toBe(false);
	});

	it("fails with a clear error for an invalid distribution", async () => {
		const tempRoot = makeTempRoot("create-crust-invalid-distribution");
		const projectDir = join(tempRoot, "bad-distribution");

		const result = await runCreateCrust(
			[
				projectDir,
				"--template",
				"minimal",
				"--distribution",
				"invalid",
				"--no-install",
				"--no-git",
			],
			tempRoot,
		);

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain(
			'Error: Invalid distribution "invalid". Expected "binary" or "runtime".',
		);
		expect(existsSync(projectDir)).toBe(false);
	});

	it("aborts cleanly when the destination exists and --no-overwrite is passed", async () => {
		const tempRoot = makeTempRoot("create-crust-no-overwrite");
		const projectDir = join(tempRoot, "existing-cli");
		mkdirSync(projectDir, { recursive: true });
		writeFileSync(join(projectDir, "sentinel.txt"), "keep me", "utf-8");

		const result = await runCreateCrust(
			[
				projectDir,
				"--template",
				"minimal",
				"--distribution",
				"binary",
				"--no-install",
				"--no-git",
				"--no-overwrite",
			],
			tempRoot,
		);

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("Aborted.");
		expect(readFileSync(join(projectDir, "sentinel.txt"), "utf-8")).toBe(
			"keep me",
		);
		expect(existsSync(join(projectDir, "package.json"))).toBe(false);
	});

	it("skips git initialization inside an existing repository even when --git is passed", async () => {
		const tempRoot = makeTempRoot("create-crust-git-repo");
		const repoRoot = join(tempRoot, "repo");
		const projectName = "inside-repo-cli";
		const projectDir = join(repoRoot, projectName);
		mkdirSync(repoRoot, { recursive: true });

		const gitInit = Bun.spawnSync(["git", "init"], {
			cwd: repoRoot,
			stdout: "ignore",
			stderr: "pipe",
		});
		expect(gitInit.exitCode).toBe(0);

		const result = await runCreateCrust(
			[
				projectName,
				"--template",
				"minimal",
				"--distribution",
				"binary",
				"--no-install",
				"--git",
			],
			repoRoot,
		);

		expect(result.exitCode).toBe(0);
		expect(existsSync(join(projectDir, "package.json"))).toBe(true);
		expect(existsSync(join(projectDir, ".git"))).toBe(false);
	});
});
