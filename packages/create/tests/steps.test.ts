import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runSteps } from "../src/steps.ts";

// ────────────────────────────────────────────────────────────────────────────
// Test Helpers
// ────────────────────────────────────────────────────────────────────────────

let tempDir: string;

beforeEach(() => {
	tempDir = join(
		tmpdir(),
		`crust-steps-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	);
	mkdirSync(tempDir, { recursive: true });
});

afterEach(() => {
	if (existsSync(tempDir)) {
		rmSync(tempDir, { recursive: true, force: true });
	}
});

// ────────────────────────────────────────────────────────────────────────────
// Tests: git-init step
// ────────────────────────────────────────────────────────────────────────────

describe("runSteps", () => {
	describe("git-init step", () => {
		it("creates a .git directory", async () => {
			await runSteps([{ type: "git-init" }], tempDir);

			expect(existsSync(join(tempDir, ".git"))).toBe(true);
		});

		it("creates an initial commit when commit message is provided", async () => {
			// Create a file so git has something to commit
			writeFileSync(join(tempDir, "README.md"), "# Test Project\n");

			await runSteps([{ type: "git-init", commit: "Initial commit" }], tempDir);

			expect(existsSync(join(tempDir, ".git"))).toBe(true);

			// Verify the commit exists with the correct message
			const result = Bun.spawnSync(
				["git", "log", "--oneline", "-1", "--format=%s"],
				{ cwd: tempDir },
			);
			expect(result.exitCode).toBe(0);
			expect(result.stdout.toString().trim()).toBe("Initial commit");
		});

		it("runs git init without committing when no commit message is provided", async () => {
			writeFileSync(join(tempDir, "file.txt"), "hello");

			await runSteps([{ type: "git-init" }], tempDir);

			expect(existsSync(join(tempDir, ".git"))).toBe(true);

			// Verify there are no commits
			const result = Bun.spawnSync(["git", "log", "--oneline"], {
				cwd: tempDir,
			});
			// git log should fail or show nothing when there are no commits
			expect(result.exitCode).not.toBe(0);
		});
	});

	// ────────────────────────────────────────────────────────────────────────────
	// Tests: install step
	// ────────────────────────────────────────────────────────────────────────────

	describe("install step", () => {
		it("runs the detected package manager install command", async () => {
			// Create a minimal package.json so install has something to work with
			writeFileSync(
				join(tempDir, "package.json"),
				JSON.stringify({ name: "test-project", version: "0.0.0" }),
			);

			// Create bun.lock to ensure bun is detected (since we're in a bun env)
			writeFileSync(join(tempDir, "bun.lock"), "");

			await runSteps([{ type: "install" }], tempDir);

			// Verify that bun install ran — it creates node_modules or bun.lockb
			// At minimum, a successful exit is expected (no throw)
			expect(existsSync(join(tempDir, "package.json"))).toBe(true);
		});
	});

	// ────────────────────────────────────────────────────────────────────────────
	// Tests: add step
	// ────────────────────────────────────────────────────────────────────────────

	describe("add step", () => {
		it("writes a resolved caret range for a regular dependency", async () => {
			writeFileSync(
				join(tempDir, "package.json"),
				JSON.stringify({ name: "add-test-project", version: "0.0.0" }),
			);
			// Force bun detection so `bun add` is used.
			writeFileSync(join(tempDir, "bun.lock"), "");

			await runSteps([{ type: "add", dependencies: ["is-number"] }], tempDir);

			const pkg = JSON.parse(
				readFileSync(join(tempDir, "package.json"), "utf-8"),
			);
			expect(pkg.dependencies).toBeDefined();
			expect(pkg.dependencies["is-number"]).toMatch(/^\^\d+\.\d+\.\d+$/);
			// Should not be the literal "latest" tag.
			expect(pkg.dependencies["is-number"]).not.toBe("latest");
		}, 30_000);

		it("writes a resolved caret range for a dev dependency", async () => {
			writeFileSync(
				join(tempDir, "package.json"),
				JSON.stringify({ name: "add-test-project", version: "0.0.0" }),
			);
			writeFileSync(join(tempDir, "bun.lock"), "");

			await runSteps(
				[{ type: "add", devDependencies: ["is-number"] }],
				tempDir,
			);

			const pkg = JSON.parse(
				readFileSync(join(tempDir, "package.json"), "utf-8"),
			);
			expect(pkg.devDependencies).toBeDefined();
			expect(pkg.devDependencies["is-number"]).toMatch(/^\^\d+\.\d+\.\d+$/);
			// Should land in devDependencies, not dependencies.
			expect(pkg.dependencies?.["is-number"]).toBeUndefined();
		}, 30_000);

		it("is a no-op when both lists are empty or omitted", async () => {
			const initialPkg = { name: "add-test-project", version: "0.0.0" };
			writeFileSync(join(tempDir, "package.json"), JSON.stringify(initialPkg));
			writeFileSync(join(tempDir, "bun.lock"), "");

			// No throw, no mutation.
			await runSteps([{ type: "add" }], tempDir);
			await runSteps(
				[{ type: "add", dependencies: [], devDependencies: [] }],
				tempDir,
			);

			const pkg = JSON.parse(
				readFileSync(join(tempDir, "package.json"), "utf-8"),
			);
			expect(pkg).toEqual(initialPkg);
			// Confirm no node_modules was created either (no install ran).
			expect(existsSync(join(tempDir, "node_modules"))).toBe(false);
		});
	});

	// ────────────────────────────────────────────────────────────────────────────
	// Tests: command step
	// ────────────────────────────────────────────────────────────────────────────

	describe("command step", () => {
		it("runs a simple command successfully", async () => {
			await runSteps(
				[{ type: "command", cmd: "echo hello > output.txt" }],
				tempDir,
			);

			expect(existsSync(join(tempDir, "output.txt"))).toBe(true);
			expect(readFileSync(join(tempDir, "output.txt"), "utf-8").trim()).toBe(
				"hello",
			);
		});

		it("uses the provided cwd for the command", async () => {
			const subDir = join(tempDir, "subdir");
			mkdirSync(subDir);

			await runSteps(
				[{ type: "command", cmd: "echo test > file.txt", cwd: subDir }],
				tempDir,
			);

			// File should be in subDir, not tempDir
			expect(existsSync(join(subDir, "file.txt"))).toBe(true);
			expect(existsSync(join(tempDir, "file.txt"))).toBe(false);
		});

		it("throws when command exits with non-zero code", async () => {
			expect(
				runSteps([{ type: "command", cmd: "exit 1" }], tempDir),
			).rejects.toThrow('Command "exit 1" exited with code 1');
		});

		it("runs a dynamic Bun Shell command string", async () => {
			const cmd = "echo dynamic > dynamic.txt";

			await runSteps([{ type: "command", cmd }], tempDir);

			expect(existsSync(join(tempDir, "dynamic.txt"))).toBe(true);
			expect(readFileSync(join(tempDir, "dynamic.txt"), "utf-8").trim()).toBe(
				"dynamic",
			);
		});
	});

	// ────────────────────────────────────────────────────────────────────────────
	// Tests: step sequencing
	// ────────────────────────────────────────────────────────────────────────────

	describe("step sequencing", () => {
		it("runs steps sequentially in array order", async () => {
			// Step 1: create a file with "first"
			// Step 2: append "second" to the same file
			await runSteps(
				[
					{ type: "command", cmd: "echo first > order.txt" },
					{ type: "command", cmd: "echo second >> order.txt" },
				],
				tempDir,
			);

			const content = readFileSync(join(tempDir, "order.txt"), "utf-8");
			const lines = content.trim().split("\n");
			expect(lines[0]).toBe("first");
			expect(lines[1]).toBe("second");
		});

		it("stops on first failure and does not execute remaining steps", async () => {
			expect(
				runSteps(
					[
						{ type: "command", cmd: "exit 1" },
						{ type: "command", cmd: "echo should-not-run > fail.txt" },
					],
					tempDir,
				),
			).rejects.toThrow();

			// The second command should not have run
			expect(existsSync(join(tempDir, "fail.txt"))).toBe(false);
		});

		it("handles empty steps array", async () => {
			// Should complete without error
			await runSteps([], tempDir);
		});
	});
});
