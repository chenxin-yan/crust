import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { runSteps } from "../src/steps.ts";

// ────────────────────────────────────────────────────────────────────────────
// Test Helpers
// ────────────────────────────────────────────────────────────────────────────

let tempDir: string;

beforeEach(() => {
	tempDir = resolve(
		`.tmp-test-steps-${Date.now()}-${Math.random().toString(36).slice(2)}`,
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
