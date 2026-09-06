import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runSteps } from "../src/steps.ts";

// ────────────────────────────────────────────────────────────────────────────
// Test Helpers
// ────────────────────────────────────────────────────────────────────────────

let tempDir: string;

beforeEach(() => {
	tempDir = join(tmpdir(), `crust-steps-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
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
		it("creates an initial commit when commit message is provided", async () => {
			// Create a file so git has something to commit
			writeFileSync(join(tempDir, "README.md"), "# Test Project\n");

			await runSteps([{ type: "git-init", commit: "Initial commit" }], tempDir);

			expect(existsSync(join(tempDir, ".git"))).toBe(true);

			// Verify the commit exists with the correct message
			const result = Bun.spawnSync(["git", "log", "--oneline", "-1", "--format=%s"], {
				cwd: tempDir,
			});
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
		it.skipIf(process.platform === "win32")(
			"runs the detected package manager install command",
			async () => {
				writeFileSync(join(tempDir, "pnpm-lock.yaml"), "");
				const binDir = join(tempDir, "bin");
				mkdirSync(binDir);
				writeFileSync(join(binDir, "pnpm"), '#!/bin/sh\nprintf "%s\\n" "$@" > install-ran\n', {
					mode: 0o755,
				});
				const originalPath = process.env.PATH;
				process.env.PATH = binDir;
				try {
					await runSteps([{ type: "install" }], tempDir);
					expect(readFileSync(join(tempDir, "install-ran"), "utf-8")).toBe("install\n");
				} finally {
					if (originalPath === undefined) delete process.env.PATH;
					else process.env.PATH = originalPath;
				}
			},
		);

		it("reports when the detected package manager is unavailable", async () => {
			writeFileSync(join(tempDir, "pnpm-lock.yaml"), "");
			const originalPath = process.env.PATH;
			process.env.PATH = tempDir;

			try {
				await expect(runSteps([{ type: "install" }], tempDir)).rejects.toThrow(
					'Package manager "pnpm" was not found on PATH. Install pnpm and try again.',
				);
			} finally {
				process.env.PATH = originalPath;
			}
		});
	});

	// ────────────────────────────────────────────────────────────────────────────
	// Tests: command step
	// ────────────────────────────────────────────────────────────────────────────

	describe("command step", () => {
		it("uses the provided cwd for the command", async () => {
			const subDir = join(tempDir, "subdir");
			mkdirSync(subDir);

			await runSteps([{ type: "command", cmd: "echo test > file.txt", cwd: subDir }], tempDir);

			// File should be in subDir, not tempDir
			expect(existsSync(join(subDir, "file.txt"))).toBe(true);
			expect(existsSync(join(tempDir, "file.txt"))).toBe(false);
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
			await expect(
				runSteps(
					[
						{ type: "command", cmd: "exit 1" },
						{ type: "command", cmd: "echo should-not-run > fail.txt" },
					],
					tempDir,
				),
			).rejects.toThrow('Command "exit 1" exited with code 1');

			// The second command should not have run
			expect(existsSync(join(tempDir, "fail.txt"))).toBe(false);
		});
	});
});
