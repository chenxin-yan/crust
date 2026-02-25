import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { defineCommand } from "@crustjs/core";

import { generateSkill, skillStatus, uninstallSkill } from "./generate.ts";
import type { AgentResult, UninstallResult } from "./types.ts";

// ────────────────────────────────────────────────────────────────────────────
// Test helpers
// ────────────────────────────────────────────────────────────────────────────

/** Creates a unique temporary directory for each test. */
async function makeTmpDir(): Promise<string> {
	const base = join(import.meta.dirname ?? ".", ".tmp-test");
	const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
	const dir = join(base, id);
	await mkdir(dir, { recursive: true });
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

/**
 * Overrides process.cwd() for the duration of a callback.
 * Used to control project-scope output paths in tests.
 */
async function withCwd<T>(dir: string, fn: () => Promise<T>): Promise<T> {
	const original = process.cwd;
	process.cwd = () => dir;
	try {
		return await fn();
	} finally {
		process.cwd = original;
	}
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
		it("creates skill directories for each agent", async () => {
			const result = await withCwd(tmpDir, () =>
				generateSkill({
					command: simpleCommand(),
					meta: {
						name: "my-cli",
						description: "Simple CLI",
						version: "1.0.0",
					},
					agents: ["claude-code", "opencode"],
					scope: "project",
				}),
			);

			expect(result.agents).toHaveLength(2);
			for (const agent of result.agents) {
				const stats = await stat(agent.outputDir);
				expect(stats.isDirectory()).toBe(true);
			}
		});

		it("returns per-agent results with files and status", async () => {
			const result = await withCwd(tmpDir, () =>
				generateSkill({
					command: simpleCommand(),
					meta: {
						name: "my-cli",
						description: "Simple CLI",
						version: "1.0.0",
					},
					agents: ["claude-code"],
					scope: "project",
				}),
			);

			expect(result.agents).toHaveLength(1);
			const agent = result.agents[0] as AgentResult;
			expect(agent.agent).toBe("claude-code");
			expect(agent.status).toBe("installed");
			expect(agent.files.length).toBeGreaterThan(0);
			expect(agent.files).toContain("SKILL.md");
			expect(agent.files).toContain("command-index.md");
			expect(agent.files).toContain("manifest.json");
		});

		it("writes all returned files to disk", async () => {
			const result = await withCwd(tmpDir, () =>
				generateSkill({
					command: simpleCommand(),
					meta: {
						name: "my-cli",
						description: "Simple CLI",
						version: "1.0.0",
					},
					agents: ["claude-code"],
					scope: "project",
				}),
			);

			const agent = result.agents[0] as AgentResult;
			const diskFiles = await listFiles(agent.outputDir);
			const sorted = [...agent.files].sort();
			expect(diskFiles).toEqual(sorted);
		});

		it("creates correct files for simple command", async () => {
			const result = await withCwd(tmpDir, () =>
				generateSkill({
					command: simpleCommand(),
					meta: {
						name: "my-cli",
						description: "Simple CLI",
						version: "1.0.0",
					},
					agents: ["claude-code"],
					scope: "project",
				}),
			);

			const agent = result.agents[0] as AgentResult;
			const files = await listFiles(agent.outputDir);
			expect(files).toContain("SKILL.md");
			expect(files).toContain("command-index.md");
			expect(files).toContain("commands/my-cli.md");
			expect(files).toContain("manifest.json");
		});

		it("creates correct files for nested commands", async () => {
			const result = await withCwd(tmpDir, () =>
				generateSkill({
					command: nestedCommand(),
					meta: {
						name: "git-tool",
						description: "Git tool",
						version: "1.0.0",
					},
					agents: ["claude-code"],
					scope: "project",
				}),
			);

			const agent = result.agents[0] as AgentResult;
			const files = await listFiles(agent.outputDir);
			expect(files).toContain("SKILL.md");
			expect(files).toContain("command-index.md");
			expect(files).toContain("commands/git.md");
			expect(files).toContain("commands/commit.md");
			expect(files).toContain("commands/remote.md");
			expect(files).toContain("commands/remote/add.md");
			expect(files).toContain("commands/remote/remove.md");
			expect(files).toContain("manifest.json");
		});

		it("does not generate README.md (removed in redesign)", async () => {
			const result = await withCwd(tmpDir, () =>
				generateSkill({
					command: simpleCommand(),
					meta: {
						name: "my-cli",
						description: "Simple CLI",
						version: "1.0.0",
					},
					agents: ["claude-code"],
					scope: "project",
				}),
			);

			const agent = result.agents[0] as AgentResult;
			expect(agent.files).not.toContain("README.md");
		});
	});

	// ────────────────────────────────────────────────────────────────────────
	// Agent path resolution
	// ────────────────────────────────────────────────────────────────────────

	describe("agent paths", () => {
		it("writes to correct claude-code project path", async () => {
			const result = await withCwd(tmpDir, () =>
				generateSkill({
					command: simpleCommand(),
					meta: {
						name: "my-cli",
						description: "Test",
						version: "1.0.0",
					},
					agents: ["claude-code"],
					scope: "project",
				}),
			);

			const expected = join(tmpDir, ".claude", "skills", "my-cli");
			expect((result.agents[0] as AgentResult).outputDir).toBe(expected);
		});

		it("writes to correct opencode project path", async () => {
			const result = await withCwd(tmpDir, () =>
				generateSkill({
					command: simpleCommand(),
					meta: {
						name: "my-cli",
						description: "Test",
						version: "1.0.0",
					},
					agents: ["opencode"],
					scope: "project",
				}),
			);

			const expected = join(tmpDir, ".opencode", "skills", "my-cli");
			expect((result.agents[0] as AgentResult).outputDir).toBe(expected);
		});
	});

	// ────────────────────────────────────────────────────────────────────────
	// Version checking and skip logic
	// ────────────────────────────────────────────────────────────────────────

	describe("version checking", () => {
		it("skips installation when version is up-to-date", async () => {
			// First install
			await withCwd(tmpDir, () =>
				generateSkill({
					command: simpleCommand(),
					meta: {
						name: "my-cli",
						description: "Test",
						version: "1.0.0",
					},
					agents: ["claude-code"],
					scope: "project",
				}),
			);

			// Second install — same version
			const result = await withCwd(tmpDir, () =>
				generateSkill({
					command: simpleCommand(),
					meta: {
						name: "my-cli",
						description: "Test",
						version: "1.0.0",
					},
					agents: ["claude-code"],
					scope: "project",
				}),
			);

			expect((result.agents[0] as AgentResult).status).toBe("up-to-date");
			expect((result.agents[0] as AgentResult).files).toHaveLength(0);
		});

		it("updates when version changes", async () => {
			// First install
			await withCwd(tmpDir, () =>
				generateSkill({
					command: simpleCommand(),
					meta: {
						name: "my-cli",
						description: "Test",
						version: "1.0.0",
					},
					agents: ["claude-code"],
					scope: "project",
				}),
			);

			// Second install — new version
			const result = await withCwd(tmpDir, () =>
				generateSkill({
					command: simpleCommand(),
					meta: {
						name: "my-cli",
						description: "Test",
						version: "2.0.0",
					},
					agents: ["claude-code"],
					scope: "project",
				}),
			);

			expect((result.agents[0] as AgentResult).status).toBe("updated");
			expect((result.agents[0] as AgentResult).previousVersion).toBe("1.0.0");
			expect((result.agents[0] as AgentResult).files.length).toBeGreaterThan(0);
		});

		it("returns installed status for fresh install", async () => {
			const result = await withCwd(tmpDir, () =>
				generateSkill({
					command: simpleCommand(),
					meta: {
						name: "my-cli",
						description: "Test",
						version: "1.0.0",
					},
					agents: ["claude-code"],
					scope: "project",
				}),
			);

			expect((result.agents[0] as AgentResult).status).toBe("installed");
			expect((result.agents[0] as AgentResult).previousVersion).toBeUndefined();
		});
	});

	// ────────────────────────────────────────────────────────────────────────
	// Clean behavior
	// ────────────────────────────────────────────────────────────────────────

	describe("clean option", () => {
		it("removes stale files when clean is true (default)", async () => {
			// First generation
			const first = await withCwd(tmpDir, () =>
				generateSkill({
					command: simpleCommand(),
					meta: {
						name: "my-cli",
						description: "Test",
						version: "1.0.0",
					},
					agents: ["claude-code"],
					scope: "project",
				}),
			);

			// Write a stale file
			const staleFile = join(
				(first.agents[0] as AgentResult).outputDir,
				"stale-file.txt",
			);
			await writeFile(staleFile, "stale content", "utf-8");

			// Second generation — different version to trigger update
			const result = await withCwd(tmpDir, () =>
				generateSkill({
					command: simpleCommand(),
					meta: {
						name: "my-cli",
						description: "Test",
						version: "2.0.0",
					},
					agents: ["claude-code"],
					scope: "project",
				}),
			);

			const files = await listFiles(
				(result.agents[0] as AgentResult).outputDir,
			);
			expect(files).not.toContain("stale-file.txt");
		});

		it("preserves existing files when clean is false", async () => {
			// First generation
			const first = await withCwd(tmpDir, () =>
				generateSkill({
					command: simpleCommand(),
					meta: {
						name: "my-cli",
						description: "Test",
						version: "1.0.0",
					},
					agents: ["claude-code"],
					scope: "project",
				}),
			);

			// Write an extra file
			const extraFile = join(
				(first.agents[0] as AgentResult).outputDir,
				"extra.txt",
			);
			await writeFile(extraFile, "extra content", "utf-8");

			// Second generation with clean: false and new version
			const result = await withCwd(tmpDir, () =>
				generateSkill({
					command: simpleCommand(),
					meta: {
						name: "my-cli",
						description: "Test",
						version: "2.0.0",
					},
					agents: ["claude-code"],
					scope: "project",
					clean: false,
				}),
			);

			const files = await listFiles(
				(result.agents[0] as AgentResult).outputDir,
			);
			expect(files).toContain("extra.txt");
		});
	});

	// ────────────────────────────────────────────────────────────────────────
	// manifest.json content
	// ────────────────────────────────────────────────────────────────────────

	describe("manifest.json", () => {
		it("contains valid JSON with version", async () => {
			const result = await withCwd(tmpDir, () =>
				generateSkill({
					command: simpleCommand(),
					meta: {
						name: "my-cli",
						description: "Simple CLI",
						version: "2.0.0",
					},
					agents: ["claude-code"],
					scope: "project",
				}),
			);

			const content = await readText(
				join((result.agents[0] as AgentResult).outputDir, "manifest.json"),
			);
			const manifest = JSON.parse(content);

			expect(manifest.name).toBe("my-cli");
			expect(manifest.description).toBe("Simple CLI");
			expect(manifest.version).toBe("2.0.0");
			expect(manifest.entrypoint).toBe("SKILL.md");
		});

		it("lists all command paths", async () => {
			const result = await withCwd(tmpDir, () =>
				generateSkill({
					command: nestedCommand(),
					meta: {
						name: "git-tool",
						description: "Test",
						version: "1.0.0",
					},
					agents: ["claude-code"],
					scope: "project",
				}),
			);

			const content = await readText(
				join((result.agents[0] as AgentResult).outputDir, "manifest.json"),
			);
			const manifest = JSON.parse(content);

			expect(manifest.commands).toContain("git");
			expect(manifest.commands).toContain("git commit");
			expect(manifest.commands).toContain("git remote");
			expect(manifest.commands).toContain("git remote add");
			expect(manifest.commands).toContain("git remote remove");
		});

		it("always includes version field", async () => {
			const result = await withCwd(tmpDir, () =>
				generateSkill({
					command: simpleCommand(),
					meta: {
						name: "my-cli",
						description: "Test",
						version: "1.0.0",
					},
					agents: ["claude-code"],
					scope: "project",
				}),
			);

			const content = await readText(
				join((result.agents[0] as AgentResult).outputDir, "manifest.json"),
			);
			const manifest = JSON.parse(content);
			expect(manifest.version).toBe("1.0.0");
		});

		it("ends with a trailing newline", async () => {
			const result = await withCwd(tmpDir, () =>
				generateSkill({
					command: simpleCommand(),
					meta: {
						name: "my-cli",
						description: "Test",
						version: "1.0.0",
					},
					agents: ["claude-code"],
					scope: "project",
				}),
			);

			const content = await readText(
				join((result.agents[0] as AgentResult).outputDir, "manifest.json"),
			);
			expect(content.endsWith("\n")).toBe(true);
		});
	});

	// ────────────────────────────────────────────────────────────────────────
	// Deterministic output
	// ────────────────────────────────────────────────────────────────────────

	describe("determinism", () => {
		it("produces identical output across agents", async () => {
			const result = await withCwd(tmpDir, () =>
				generateSkill({
					command: nestedCommand(),
					meta: {
						name: "git-tool",
						description: "Git tool",
						version: "1.0.0",
					},
					agents: ["claude-code", "opencode"],
					scope: "project",
				}),
			);

			const claude = result.agents[0] as AgentResult;
			const opencode = result.agents[1] as (typeof result.agents)[number];

			// Same file list
			expect(claude.files).toEqual(opencode.files);

			// Same file contents
			for (const file of claude.files) {
				const content1 = await readText(join(claude.outputDir, file));
				const content2 = await readText(join(opencode.outputDir, file));
				expect(content1).toBe(content2);
			}
		});

		it("returns files in sorted order", async () => {
			const result = await withCwd(tmpDir, () =>
				generateSkill({
					command: nestedCommand(),
					meta: {
						name: "git-tool",
						description: "Test",
						version: "1.0.0",
					},
					agents: ["claude-code"],
					scope: "project",
				}),
			);

			const agent = result.agents[0] as AgentResult;
			const sorted = [...agent.files].sort();
			expect(agent.files).toEqual(sorted);
		});
	});

	// ────────────────────────────────────────────────────────────────────────
	// Content wiring
	// ────────────────────────────────────────────────────────────────────────

	describe("content wiring", () => {
		it("SKILL.md is written correctly to disk", async () => {
			const result = await withCwd(tmpDir, () =>
				generateSkill({
					command: simpleCommand(),
					meta: {
						name: "my-cli",
						description: "A simple CLI tool",
						version: "1.0.0",
					},
					agents: ["claude-code"],
					scope: "project",
				}),
			);

			const content = await readText(
				join((result.agents[0] as AgentResult).outputDir, "SKILL.md"),
			);
			expect(content).toContain("---");
			expect(content).toContain("name: my-cli");
			expect(content).toContain("description: A simple CLI tool");
			expect(content).toContain('version: "1.0.0"');
		});

		it("command-index.md references existing command files", async () => {
			const result = await withCwd(tmpDir, () =>
				generateSkill({
					command: nestedCommand(),
					meta: {
						name: "git-tool",
						description: "Test",
						version: "1.0.0",
					},
					agents: ["claude-code"],
					scope: "project",
				}),
			);

			const agent = result.agents[0] as AgentResult;
			const index = await readText(join(agent.outputDir, "command-index.md"));
			const files = await listFiles(agent.outputDir);

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
			const result = await withCwd(tmpDir, () =>
				generateSkill({
					command: nestedCommand(),
					meta: {
						name: "git-tool",
						description: "Test",
						version: "1.0.0",
					},
					agents: ["claude-code"],
					scope: "project",
				}),
			);

			const addCmd = await readText(
				join(
					(result.agents[0] as AgentResult).outputDir,
					"commands",
					"remote",
					"add.md",
				),
			);
			expect(addCmd).toContain("git remote add");
			expect(addCmd).toContain("Add a remote");
		});

		it("command files contain expected content for group commands", async () => {
			const result = await withCwd(tmpDir, () =>
				generateSkill({
					command: nestedCommand(),
					meta: {
						name: "git-tool",
						description: "Test",
						version: "1.0.0",
					},
					agents: ["claude-code"],
					scope: "project",
				}),
			);

			const remote = await readText(
				join(
					(result.agents[0] as AgentResult).outputDir,
					"commands",
					"remote.md",
				),
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

			const result = await withCwd(tmpDir, () =>
				generateSkill({
					command: cmd,
					meta: {
						name: "minimal",
						description: "Bare minimum",
						version: "1.0.0",
					},
					agents: ["claude-code"],
					scope: "project",
				}),
			);

			const agent = result.agents[0] as AgentResult;
			expect(agent.files).toContain("SKILL.md");
			expect(agent.files).toContain("manifest.json");
			expect(agent.files).toContain("command-index.md");
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

			const result = await withCwd(tmpDir, () =>
				generateSkill({
					command: cmd,
					meta: {
						name: "deep-tool",
						description: "Test",
						version: "1.0.0",
					},
					agents: ["claude-code"],
					scope: "project",
				}),
			);

			const files = await listFiles(
				(result.agents[0] as AgentResult).outputDir,
			);
			expect(files).toContain("commands/level1/level2/level3.md");
		});

		it("does not produce partial output on successful run", async () => {
			const result = await withCwd(tmpDir, () =>
				generateSkill({
					command: nestedCommand(),
					meta: {
						name: "git-tool",
						description: "Test",
						version: "1.0.0",
					},
					agents: ["claude-code"],
					scope: "project",
				}),
			);

			const agent = result.agents[0] as AgentResult;
			for (const file of agent.files) {
				const stats = await stat(join(agent.outputDir, file));
				expect(stats.isFile()).toBe(true);
			}
		});
	});
});

// ────────────────────────────────────────────────────────────────────────────
// uninstallSkill
// ────────────────────────────────────────────────────────────────────────────

describe("uninstallSkill", () => {
	it("removes installed skill directory", async () => {
		// Install first
		await withCwd(tmpDir, () =>
			generateSkill({
				command: simpleCommand(),
				meta: { name: "my-cli", description: "Test", version: "1.0.0" },
				agents: ["claude-code"],
				scope: "project",
			}),
		);

		// Uninstall
		const result = await withCwd(tmpDir, () =>
			uninstallSkill({
				name: "my-cli",
				agents: ["claude-code"],
				scope: "project",
			}),
		);

		const agentResult = result.agents[0] as UninstallResult["agents"][number];
		expect(agentResult.status).toBe("removed");

		// Verify directory is gone
		try {
			await stat(agentResult.outputDir);
			expect(true).toBe(false); // Should not reach here
		} catch {
			// Expected — directory should not exist
		}
	});

	it("returns not-found for non-existent skill", async () => {
		const result = await withCwd(tmpDir, () =>
			uninstallSkill({
				name: "nonexistent",
				agents: ["claude-code"],
				scope: "project",
			}),
		);

		// Should be removed (rm -rf on non-existent succeeds) or not-found
		const agentResult = result.agents[0] as UninstallResult["agents"][number];
		expect(["removed", "not-found"]).toContain(agentResult.status);
	});
});

// ────────────────────────────────────────────────────────────────────────────
// skillStatus
// ────────────────────────────────────────────────────────────────────────────

describe("skillStatus", () => {
	it("reports installed with version for existing skill", async () => {
		await withCwd(tmpDir, () =>
			generateSkill({
				command: simpleCommand(),
				meta: { name: "my-cli", description: "Test", version: "1.0.0" },
				agents: ["claude-code"],
				scope: "project",
			}),
		);

		const status = await withCwd(tmpDir, () =>
			skillStatus({
				name: "my-cli",
				agents: ["claude-code"],
				scope: "project",
			}),
		);

		expect(status.agents[0]?.installed).toBe(true);
		expect(status.agents[0]?.version).toBe("1.0.0");
	});

	it("reports not installed for missing skill", async () => {
		const status = await withCwd(tmpDir, () =>
			skillStatus({
				name: "nonexistent",
				agents: ["claude-code"],
				scope: "project",
			}),
		);

		expect(status.agents[0]?.installed).toBe(false);
		expect(status.agents[0]?.version).toBeUndefined();
	});

	it("checks multiple agents", async () => {
		// Install for claude-code only
		await withCwd(tmpDir, () =>
			generateSkill({
				command: simpleCommand(),
				meta: { name: "my-cli", description: "Test", version: "1.0.0" },
				agents: ["claude-code"],
				scope: "project",
			}),
		);

		const status = await withCwd(tmpDir, () =>
			skillStatus({
				name: "my-cli",
				agents: ["claude-code", "opencode"],
				scope: "project",
			}),
		);

		expect(status.agents).toHaveLength(2);
		const claude = status.agents.find((a) => a.agent === "claude-code");
		const opencode = status.agents.find((a) => a.agent === "opencode");
		expect(claude?.installed).toBe(true);
		expect(opencode?.installed).toBe(false);
	});
});
