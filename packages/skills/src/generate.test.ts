import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { defineCommand } from "@crustjs/core";
import { generateSkill } from "./generate.ts";

// ────────────────────────────────────────────────────────────────────────────
// Test helpers
// ────────────────────────────────────────────────────────────────────────────

/** Creates a unique temporary directory for each test. */
async function makeTmpDir(): Promise<string> {
	const base = join(import.meta.dirname ?? ".", ".tmp-test");
	const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
	const dir = join(base, id);
	await Bun.write(join(dir, ".keep"), "");
	return dir;
}

/** Recursively lists all files under a directory (relative paths). */
async function listFiles(dir: string, prefix = ""): Promise<string[]> {
	const entries = await readdir(dir, { withFileTypes: true });
	const files: string[] = [];
	for (const entry of entries) {
		const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
		if (entry.isDirectory()) {
			files.push(...(await listFiles(join(dir, entry.name), rel)));
		} else {
			files.push(rel);
		}
	}
	return files.sort();
}

/** Reads a file's content as UTF-8 text. */
async function readText(filePath: string): Promise<string> {
	return readFile(filePath, "utf-8");
}

// ────────────────────────────────────────────────────────────────────────────
// Fixture commands
// ────────────────────────────────────────────────────────────────────────────

/** Simple single-command CLI (leaf, runnable). */
function simpleCommand() {
	return defineCommand({
		meta: { name: "my-cli", description: "A simple CLI tool" },
		args: [{ name: "file", type: "string" as const, required: true }],
		flags: {
			verbose: {
				type: "boolean" as const,
				description: "Enable verbose output",
				alias: "v",
			},
		},
		run() {},
	});
}

/** CLI with nested subcommands (git-like). */
function nestedCommand() {
	return defineCommand({
		meta: { name: "git", description: "A distributed VCS" },
		subCommands: {
			remote: defineCommand({
				meta: { name: "remote", description: "Manage remotes" },
				subCommands: {
					add: defineCommand({
						meta: { name: "add", description: "Add a remote" },
						args: [
							{ name: "name", type: "string" as const, required: true },
							{ name: "url", type: "string" as const, required: true },
						],
						run() {},
					}),
					remove: defineCommand({
						meta: { name: "remove", description: "Remove a remote" },
						args: [{ name: "name", type: "string" as const, required: true }],
						run() {},
					}),
				},
			}),
			commit: defineCommand({
				meta: { name: "commit", description: "Record changes" },
				flags: {
					message: {
						type: "string" as const,
						description: "Commit message",
						alias: "m",
						required: true,
					},
					amend: {
						type: "boolean" as const,
						description: "Amend the last commit",
					},
				},
				run() {},
			}),
		},
	});
}

// ────────────────────────────────────────────────────────────────────────────
// Test suites
// ────────────────────────────────────────────────────────────────────────────

let tmpDir: string;

beforeEach(async () => {
	tmpDir = await makeTmpDir();
});

afterEach(async () => {
	// Clean up temp directory
	const { rm } = await import("node:fs/promises");
	try {
		await rm(tmpDir, { recursive: true });
	} catch {
		// Ignore cleanup errors
	}
});

// ────────────────────────────────────────────────────────────────────────────
// generateSkill — basic output structure
// ────────────────────────────────────────────────────────────────────────────

describe("generateSkill", () => {
	describe("output structure", () => {
		it("creates skill directory under skills/<name>/", async () => {
			const result = await generateSkill({
				command: simpleCommand(),
				meta: { name: "my-cli", description: "Simple CLI" },
				outDir: tmpDir,
			});

			expect(result.outputDir).toEndWith("/skills/my-cli");

			const stats = await stat(result.outputDir);
			expect(stats.isDirectory()).toBe(true);
		});

		it("returns list of written files", async () => {
			const result = await generateSkill({
				command: simpleCommand(),
				meta: { name: "my-cli", description: "Simple CLI" },
				outDir: tmpDir,
			});

			expect(result.files.length).toBeGreaterThan(0);
			expect(result.files).toContain("SKILL.md");
			expect(result.files).toContain("command-index.md");
			expect(result.files).toContain("manifest.json");
			expect(result.files).toContain("README.md");
		});

		it("writes all returned files to disk", async () => {
			const result = await generateSkill({
				command: simpleCommand(),
				meta: { name: "my-cli", description: "Simple CLI" },
				outDir: tmpDir,
			});

			const diskFiles = await listFiles(result.outputDir);
			const sorted = [...result.files].sort();
			expect(diskFiles).toEqual(sorted);
		});

		it("creates correct files for simple command", async () => {
			const result = await generateSkill({
				command: simpleCommand(),
				meta: { name: "my-cli", description: "Simple CLI" },
				outDir: tmpDir,
			});

			const files = await listFiles(result.outputDir);
			expect(files).toContain("SKILL.md");
			expect(files).toContain("command-index.md");
			expect(files).toContain("commands/my-cli.md");
			expect(files).toContain("manifest.json");
			expect(files).toContain("README.md");
		});

		it("creates correct files for nested commands", async () => {
			const result = await generateSkill({
				command: nestedCommand(),
				meta: { name: "git-tool", description: "Git tool" },
				outDir: tmpDir,
			});

			const files = await listFiles(result.outputDir);
			expect(files).toContain("SKILL.md");
			expect(files).toContain("command-index.md");
			expect(files).toContain("commands/git.md");
			expect(files).toContain("commands/commit.md");
			expect(files).toContain("commands/remote.md");
			expect(files).toContain("commands/remote/add.md");
			expect(files).toContain("commands/remote/remove.md");
			expect(files).toContain("manifest.json");
			expect(files).toContain("README.md");
		});
	});

	// ────────────────────────────────────────────────────────────────────────
	// outDir defaults and custom paths
	// ────────────────────────────────────────────────────────────────────────

	describe("outDir option", () => {
		it("uses current directory as default outDir", async () => {
			// Use a custom tmpDir as cwd to avoid polluting the project
			const result = await generateSkill({
				command: simpleCommand(),
				meta: { name: "test-cli", description: "Test" },
				outDir: tmpDir,
			});

			expect(result.outputDir).toContain("skills/test-cli");
		});

		it("resolves nested outDir paths", async () => {
			const nested = join(tmpDir, "deep", "nested");
			const result = await generateSkill({
				command: simpleCommand(),
				meta: { name: "my-cli", description: "Test" },
				outDir: nested,
			});

			expect(result.outputDir).toContain("deep/nested/skills/my-cli");
			const stats = await stat(result.outputDir);
			expect(stats.isDirectory()).toBe(true);
		});
	});

	// ────────────────────────────────────────────────────────────────────────
	// Clean behavior
	// ────────────────────────────────────────────────────────────────────────

	describe("clean option", () => {
		it("removes existing skill directory when clean is true (default)", async () => {
			// First generation
			await generateSkill({
				command: simpleCommand(),
				meta: { name: "my-cli", description: "Test" },
				outDir: tmpDir,
			});

			// Write a stale file into the skill directory
			const staleFile = join(tmpDir, "skills", "my-cli", "stale-file.txt");
			await writeFile(staleFile, "stale content", "utf-8");

			// Second generation — should clean
			const result = await generateSkill({
				command: simpleCommand(),
				meta: { name: "my-cli", description: "Test" },
				outDir: tmpDir,
			});

			const files = await listFiles(result.outputDir);
			expect(files).not.toContain("stale-file.txt");
		});

		it("preserves existing files when clean is false", async () => {
			// First generation
			await generateSkill({
				command: simpleCommand(),
				meta: { name: "my-cli", description: "Test" },
				outDir: tmpDir,
			});

			// Write a stale file into the skill directory
			const staleFile = join(tmpDir, "skills", "my-cli", "extra.txt");
			await writeFile(staleFile, "extra content", "utf-8");

			// Second generation with clean: false
			const result = await generateSkill({
				command: simpleCommand(),
				meta: { name: "my-cli", description: "Test" },
				outDir: tmpDir,
				clean: false,
			});

			const files = await listFiles(result.outputDir);
			expect(files).toContain("extra.txt");
		});

		it("succeeds when skill directory does not exist and clean is true", async () => {
			const result = await generateSkill({
				command: simpleCommand(),
				meta: { name: "fresh-cli", description: "Test" },
				outDir: tmpDir,
			});

			expect(result.files.length).toBeGreaterThan(0);
		});
	});

	// ────────────────────────────────────────────────────────────────────────
	// manifest.json content
	// ────────────────────────────────────────────────────────────────────────

	describe("manifest.json", () => {
		it("contains valid JSON", async () => {
			const result = await generateSkill({
				command: simpleCommand(),
				meta: { name: "my-cli", description: "Simple CLI" },
				outDir: tmpDir,
			});

			const content = await readText(join(result.outputDir, "manifest.json"));
			expect(() => JSON.parse(content)).not.toThrow();
		});

		it("includes skill metadata", async () => {
			const result = await generateSkill({
				command: simpleCommand(),
				meta: {
					name: "my-cli",
					description: "Simple CLI",
					version: "2.0.0",
				},
				outDir: tmpDir,
			});

			const content = await readText(join(result.outputDir, "manifest.json"));
			const manifest = JSON.parse(content);

			expect(manifest.name).toBe("my-cli");
			expect(manifest.description).toBe("Simple CLI");
			expect(manifest.version).toBe("2.0.0");
		});

		it("includes entrypoint field", async () => {
			const result = await generateSkill({
				command: simpleCommand(),
				meta: { name: "my-cli", description: "Test" },
				outDir: tmpDir,
			});

			const content = await readText(join(result.outputDir, "manifest.json"));
			const manifest = JSON.parse(content);

			expect(manifest.entrypoint).toBe("SKILL.md");
		});

		it("lists all command paths", async () => {
			const result = await generateSkill({
				command: nestedCommand(),
				meta: { name: "git-tool", description: "Test" },
				outDir: tmpDir,
			});

			const content = await readText(join(result.outputDir, "manifest.json"));
			const manifest = JSON.parse(content);

			expect(manifest.commands).toContain("git");
			expect(manifest.commands).toContain("git commit");
			expect(manifest.commands).toContain("git remote");
			expect(manifest.commands).toContain("git remote add");
			expect(manifest.commands).toContain("git remote remove");
		});

		it("omits version when not provided", async () => {
			const result = await generateSkill({
				command: simpleCommand(),
				meta: { name: "my-cli", description: "Test" },
				outDir: tmpDir,
			});

			const content = await readText(join(result.outputDir, "manifest.json"));
			const manifest = JSON.parse(content);

			expect(manifest.version).toBeUndefined();
		});

		it("ends with a trailing newline", async () => {
			const result = await generateSkill({
				command: simpleCommand(),
				meta: { name: "my-cli", description: "Test" },
				outDir: tmpDir,
			});

			const content = await readText(join(result.outputDir, "manifest.json"));
			expect(content.endsWith("\n")).toBe(true);
		});
	});

	// ────────────────────────────────────────────────────────────────────────
	// README.md content
	// ────────────────────────────────────────────────────────────────────────

	describe("README.md", () => {
		it("contains skill name as title", async () => {
			const result = await generateSkill({
				command: simpleCommand(),
				meta: { name: "my-cli", description: "A simple CLI tool" },
				outDir: tmpDir,
			});

			const content = await readText(join(result.outputDir, "README.md"));
			expect(content).toContain("# my-cli");
		});

		it("includes skill description", async () => {
			const result = await generateSkill({
				command: simpleCommand(),
				meta: { name: "my-cli", description: "A simple CLI tool" },
				outDir: tmpDir,
			});

			const content = await readText(join(result.outputDir, "README.md"));
			expect(content).toContain("A simple CLI tool");
		});

		it("includes version when provided", async () => {
			const result = await generateSkill({
				command: simpleCommand(),
				meta: {
					name: "my-cli",
					description: "Test",
					version: "3.0.0",
				},
				outDir: tmpDir,
			});

			const content = await readText(join(result.outputDir, "README.md"));
			expect(content).toContain("3.0.0");
		});

		it("includes OpenCode install instructions", async () => {
			const result = await generateSkill({
				command: simpleCommand(),
				meta: { name: "my-cli", description: "Test" },
				outDir: tmpDir,
			});

			const content = await readText(join(result.outputDir, "README.md"));
			expect(content).toContain("OpenCode");
			expect(content).toContain(".opencode/skills/my-cli/");
		});

		it("includes Claude Code install instructions", async () => {
			const result = await generateSkill({
				command: simpleCommand(),
				meta: { name: "my-cli", description: "Test" },
				outDir: tmpDir,
			});

			const content = await readText(join(result.outputDir, "README.md"));
			expect(content).toContain("Claude Code");
			expect(content).toContain(".claude/skills/my-cli/");
		});

		it("includes structure overview", async () => {
			const result = await generateSkill({
				command: simpleCommand(),
				meta: { name: "my-cli", description: "Test" },
				outDir: tmpDir,
			});

			const content = await readText(join(result.outputDir, "README.md"));
			expect(content).toContain("SKILL.md");
			expect(content).toContain("command-index.md");
			expect(content).toContain("commands/");
			expect(content).toContain("manifest.json");
		});
	});

	// ────────────────────────────────────────────────────────────────────────
	// Deterministic output
	// ────────────────────────────────────────────────────────────────────────

	describe("determinism", () => {
		it("produces identical output across multiple runs", async () => {
			const tmpDir1 = await makeTmpDir();
			const tmpDir2 = await makeTmpDir();

			try {
				const cmd = nestedCommand();
				const meta = {
					name: "git-tool",
					description: "Git tool",
					version: "1.0.0",
				};

				const result1 = await generateSkill({
					command: cmd,
					meta,
					outDir: tmpDir1,
				});
				const result2 = await generateSkill({
					command: cmd,
					meta,
					outDir: tmpDir2,
				});

				// Same file list
				expect(result1.files).toEqual(result2.files);

				// Same file contents
				for (const file of result1.files) {
					const content1 = await readText(join(result1.outputDir, file));
					const content2 = await readText(join(result2.outputDir, file));
					expect(content1).toBe(content2);
				}
			} finally {
				const { rm } = await import("node:fs/promises");
				await rm(tmpDir1, { recursive: true }).catch(() => {});
				await rm(tmpDir2, { recursive: true }).catch(() => {});
			}
		});

		it("returns files in sorted order", async () => {
			const result = await generateSkill({
				command: nestedCommand(),
				meta: { name: "git-tool", description: "Test" },
				outDir: tmpDir,
			});

			const sorted = [...result.files].sort();
			expect(result.files).toEqual(sorted);
		});
	});

	// ────────────────────────────────────────────────────────────────────────
	// SKILL.md and command files wiring
	// ────────────────────────────────────────────────────────────────────────

	describe("content wiring", () => {
		it("SKILL.md is written correctly to disk", async () => {
			const result = await generateSkill({
				command: simpleCommand(),
				meta: { name: "my-cli", description: "A simple CLI tool" },
				outDir: tmpDir,
			});

			const content = await readText(join(result.outputDir, "SKILL.md"));
			expect(content).toContain("---");
			expect(content).toContain("name: my-cli");
			expect(content).toContain("description: A simple CLI tool");
		});

		it("command-index.md references existing command files", async () => {
			const result = await generateSkill({
				command: nestedCommand(),
				meta: { name: "git-tool", description: "Test" },
				outDir: tmpDir,
			});

			const index = await readText(join(result.outputDir, "command-index.md"));
			const files = await listFiles(result.outputDir);

			// Extract all file paths referenced in command-index.md links
			const linkPattern = /\[([^\]]+)\]\(([^)]+)\)/g;
			let match: RegExpExecArray | null;
			// biome-ignore lint/suspicious/noAssignInExpressions: regex exec loop pattern
			while ((match = linkPattern.exec(index)) !== null) {
				const linked = match[2];
				if (linked?.startsWith("commands/")) {
					expect(files).toContain(linked);
				}
			}
		});

		it("command files contain expected content for leaf commands", async () => {
			const result = await generateSkill({
				command: nestedCommand(),
				meta: { name: "git-tool", description: "Test" },
				outDir: tmpDir,
			});

			const addCmd = await readText(
				join(result.outputDir, "commands", "remote", "add.md"),
			);
			expect(addCmd).toContain("git remote add");
			expect(addCmd).toContain("Add a remote");
		});

		it("command files contain expected content for group commands", async () => {
			const result = await generateSkill({
				command: nestedCommand(),
				meta: { name: "git-tool", description: "Test" },
				outDir: tmpDir,
			});

			const remote = await readText(
				join(result.outputDir, "commands", "remote.md"),
			);
			expect(remote).toContain("Manage remotes");
			expect(remote).toContain("Subcommands");
			expect(remote).toContain("add");
			expect(remote).toContain("remove");
		});
	});

	// ────────────────────────────────────────────────────────────────────────
	// Edge cases
	// ────────────────────────────────────────────────────────────────────────

	describe("edge cases", () => {
		it("handles command with no subcommands, no args, no flags", async () => {
			const cmd = defineCommand({
				meta: { name: "minimal", description: "Bare minimum" },
				run() {},
			});

			const result = await generateSkill({
				command: cmd,
				meta: { name: "minimal", description: "Bare minimum" },
				outDir: tmpDir,
			});

			expect(result.files).toContain("SKILL.md");
			expect(result.files).toContain("manifest.json");
			expect(result.files).toContain("README.md");
			expect(result.files).toContain("command-index.md");
		});

		it("handles deeply nested command hierarchy", async () => {
			const cmd = defineCommand({
				meta: { name: "top" },
				subCommands: {
					level1: defineCommand({
						meta: { name: "level1" },
						subCommands: {
							level2: defineCommand({
								meta: { name: "level2" },
								subCommands: {
									level3: defineCommand({
										meta: { name: "level3", description: "Deep" },
										run() {},
									}),
								},
							}),
						},
					}),
				},
			});

			const result = await generateSkill({
				command: cmd,
				meta: { name: "deep-tool", description: "Test" },
				outDir: tmpDir,
			});

			const files = await listFiles(result.outputDir);
			expect(files).toContain("commands/level1/level2/level3.md");
		});

		it("does not produce partial output on successful run", async () => {
			const result = await generateSkill({
				command: nestedCommand(),
				meta: { name: "git-tool", description: "Test" },
				outDir: tmpDir,
			});

			// All files from result should exist on disk
			for (const file of result.files) {
				const stats = await stat(join(result.outputDir, file));
				expect(stats.isFile()).toBe(true);
			}
		});

		it("handles skill name with special characters", async () => {
			const cmd = defineCommand({
				meta: { name: "my-cli", description: "Test" },
				run() {},
			});

			const result = await generateSkill({
				command: cmd,
				meta: { name: "my-cli-tool", description: "Test" },
				outDir: tmpDir,
			});

			expect(result.outputDir).toContain("skills/my-cli-tool");
		});
	});
});
