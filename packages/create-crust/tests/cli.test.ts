import { afterEach, beforeAll, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const packageRoot = resolve(import.meta.dir, "..");
const builtCliPath = join(packageRoot, "dist", "index.js");
const tempRoots: string[] = [];

function makeTempRoot(label: string): string {
	const dir = join(tmpdir(), `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	mkdirSync(dir, { recursive: true });
	tempRoots.push(dir);
	return dir;
}

async function runCreateCrust(
	args: string[],
	options?: { env?: Record<string, string>; cwd?: string },
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
	const proc = Bun.spawn(["node", builtCliPath, ...args], {
		cwd: options?.cwd ?? packageRoot,
		env: {
			...process.env,
			...options?.env,
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
	beforeAll(() => {
		if (!existsSync(builtCliPath)) {
			throw new Error(
				`Built CLI not found at ${builtCliPath}. Run the package build before tests (e.g. bun run build in this package or turbo run test).`,
			);
		}
	});

	it("scaffolds a project non-interactively when flags are provided", async () => {
		const tempRoot = makeTempRoot("create-crust-cli");
		const projectDir = join(tempRoot, "my-cli");

		const result = await runCreateCrust([
			projectDir,
			"--distribution",
			"binary",
			"--no-install",
			"--no-git",
		]);

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
	}, 30_000);

	it("fails with a clear error for an invalid distribution", async () => {
		const tempRoot = makeTempRoot("create-crust-invalid-distribution");
		const projectDir = join(tempRoot, "bad-distribution");

		const result = await runCreateCrust([
			projectDir,
			"--distribution",
			"invalid",
			"--no-install",
			"--no-git",
		]);

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain(
			'Error: Invalid value "invalid" for --distribution. Expected one of: binary, runtime',
		);
		expect(existsSync(projectDir)).toBe(false);
	}, 30_000);

	it("aborts cleanly when the destination exists and --no-overwrite is passed", async () => {
		const tempRoot = makeTempRoot("create-crust-no-overwrite");
		const projectDir = join(tempRoot, "existing-cli");
		mkdirSync(projectDir, { recursive: true });
		writeFileSync(join(projectDir, "sentinel.txt"), "keep me", "utf-8");

		const result = await runCreateCrust([
			projectDir,
			"--distribution",
			"binary",
			"--no-install",
			"--no-git",
			"--no-overwrite",
		]);

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("Aborted.");
		expect(readFileSync(join(projectDir, "sentinel.txt"), "utf-8")).toBe("keep me");
		expect(existsSync(join(projectDir, "package.json"))).toBe(false);
	}, 30_000);

	it("aborts scaffolding into a non-empty current directory without --overwrite", async () => {
		const tempRoot = makeTempRoot("create-crust-dot-non-empty");
		writeFileSync(join(tempRoot, "sentinel.txt"), "keep me", "utf-8");

		const result = await runCreateCrust(
			[".", "--distribution", "binary", "--no-install", "--no-git", "--no-overwrite"],
			{ cwd: tempRoot },
		);

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("Aborted.");
		expect(readFileSync(join(tempRoot, "sentinel.txt"), "utf-8")).toBe("keep me");
		expect(existsSync(join(tempRoot, "package.json"))).toBe(false);
	}, 30_000);

	it("scaffolds into a non-empty current directory when --overwrite is passed", async () => {
		const tempRoot = makeTempRoot("create-crust-dot-overwrite");
		writeFileSync(join(tempRoot, "package.json"), '{"name":"old"}', "utf-8");

		const result = await runCreateCrust(
			[".", "--distribution", "binary", "--no-install", "--no-git", "--overwrite"],
			{ cwd: tempRoot },
		);

		expect(result.exitCode).toBe(0);
		expect(result.stderr).not.toContain("Error:");
		expect(result.stdout).not.toContain("overwriting (--overwrite)");
		expect(existsSync(join(tempRoot, "src", "cli.ts"))).toBe(true);
		const pkg = JSON.parse(readFileSync(join(tempRoot, "package.json"), "utf-8"));
		expect(pkg.name).not.toBe("old");
	}, 30_000);

	it("scaffolds into an empty current directory without prompting", async () => {
		const tempRoot = makeTempRoot("create-crust-dot-empty");

		const result = await runCreateCrust(
			[".", "--distribution", "binary", "--no-install", "--no-git"],
			{ cwd: tempRoot },
		);

		expect(result.exitCode).toBe(0);
		expect(result.stderr).not.toContain("Error:");
		expect(result.stdout).not.toContain("Overwrite");
		expect(existsSync(join(tempRoot, "package.json"))).toBe(true);
	}, 30_000);

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

		const result = await runCreateCrust([
			projectDir,
			"--distribution",
			"binary",
			"--no-install",
			"--git",
		]);

		expect(result.exitCode).toBe(0);
		expect(existsSync(join(projectDir, "package.json"))).toBe(true);
		expect(existsSync(join(projectDir, ".git"))).toBe(false);
	}, 30_000);
});
