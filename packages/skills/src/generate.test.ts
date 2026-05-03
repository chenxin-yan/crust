import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	chmod,
	lstat,
	mkdir,
	readdir,
	readFile,
	stat,
	writeFile,
} from "node:fs/promises";
import { delimiter, join } from "node:path";
import type { ArgDef, CommandNode, FlagDef } from "@crustjs/core";
import { Crust } from "@crustjs/core";

import { getUniversalAgents } from "./agents.ts";
import { SkillConflictError } from "./errors.ts";
import {
	generateSkill,
	isValidSkillName,
	resolveSkillName,
	skillStatus,
	uninstallSkill,
} from "./generate.ts";
import type { AgentResult, UninstallResult } from "./types.ts";
import { CRUST_MANIFEST, readInstalledVersion } from "./version.ts";

// ────────────────────────────────────────────────────────────────────────────
// Helper — builds a CommandNode for introspection tests
// ────────────────────────────────────────────────────────────────────────────

function makeCommand(opts: {
	meta: { name: string; description?: string; usage?: string };
	args?: readonly ArgDef[];
	flags?: Record<string, FlagDef>;
	run?: () => void;
	subCommands?: Record<string, CommandNode>;
}): CommandNode {
	const node = new Crust(opts.meta.name)._node;
	Object.assign(node.meta, opts.meta);
	if (opts.args) node.args = opts.args as ArgDef[];
	if (opts.flags) {
		node.localFlags = { ...opts.flags };
		node.effectiveFlags = { ...opts.flags };
	}
	if (opts.run) node.run = opts.run;
	if (opts.subCommands) {
		node.subCommands = opts.subCommands;
	}
	return node;
}

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

/**
 * Overrides `process.env.PATH` for the duration of a callback.
 *
 * Used to deterministically control what `detectInstalledAgents()` returns
 * when the public entrypoints fall back to their default agent resolution.
 * Tests pass a directory that contains zero or more fake executables.
 */
async function withPath<T>(dirs: string[], fn: () => Promise<T>): Promise<T> {
	const original = process.env.PATH;
	process.env.PATH = dirs.join(delimiter);
	try {
		return await fn();
	} finally {
		if (original === undefined) delete process.env.PATH;
		else process.env.PATH = original;
	}
}

/**
 * Creates a fake executable at `dir/name` that `detectInstalledAgents()`
 * will discover via its non-executing PATH probe. The probe is
 * platform-specific (see `isCommandOnPath` in `agents.ts`):
 *
 * - POSIX: checks `dir/name` with `X_OK`, so we write a shebang script
 *   and `chmod 0o755`.
 * - Windows: checks `dir/name + ext` for each `PATHEXT` entry (default
 *   `.EXE;.CMD;.BAT;.COM`), so we write `dir/name.cmd`. `X_OK` collapses
 *   to `R_OK` on Windows, so no `chmod` is needed.
 */
async function makeFakeExecutable(dir: string, name: string): Promise<void> {
	if (process.platform === "win32") {
		await writeFile(
			join(dir, `${name}.cmd`),
			"@echo off\r\nexit /b 0\r\n",
			"utf-8",
		);
		return;
	}
	const filePath = join(dir, name);
	await writeFile(filePath, "#!/bin/sh\nexit 0\n", "utf-8");
	await chmod(filePath, 0o755);
}

// ────────────────────────────────────────────────────────────────────────────
// Fixture commands
// ────────────────────────────────────────────────────────────────────────────

/** Simple single-command CLI (leaf, runnable). */
function simpleCommand(): CommandNode {
	return makeCommand({
		meta: { name: "my-cli", description: "A simple CLI tool" },
		args: [{ name: "file", type: "string", required: true }] as ArgDef[],
		flags: {
			verbose: {
				type: "boolean",
				description: "Enable verbose output",
				short: "v",
			},
		},
		run() {},
	});
}

/** CLI with nested subcommands (git-like). */
function nestedCommand(): CommandNode {
	return makeCommand({
		meta: { name: "git", description: "A distributed VCS" },
		subCommands: {
			remote: makeCommand({
				meta: { name: "remote", description: "Manage remotes" },
				subCommands: {
					add: makeCommand({
						meta: { name: "add", description: "Add a remote" },
						args: [
							{ name: "name", type: "string", required: true },
							{ name: "url", type: "string", required: true },
						] as ArgDef[],
						run() {},
					}),
					remove: makeCommand({
						meta: { name: "remove", description: "Remove a remote" },
						args: [
							{ name: "name", type: "string", required: true },
						] as ArgDef[],
						run() {},
					}),
				},
			}),
			commit: makeCommand({
				meta: { name: "commit", description: "Record changes" },
				flags: {
					message: {
						type: "string",
						description: "Commit message",
						short: "m",
						required: true,
					},
					amend: {
						type: "boolean",
						description: "Amend the last commit",
					},
				},
				run() {},
			}),
		},
	});
}

// ────────────────────────────────────────────────────────────────────────────
// resolveSkillName
// ────────────────────────────────────────────────────────────────────────────

describe("resolveSkillName", () => {
	it("returns a plain name unchanged", () => {
		expect(resolveSkillName("my-cli")).toBe("my-cli");
	});

	it("preserves a name already starting with use-", () => {
		expect(resolveSkillName("use-my-cli")).toBe("use-my-cli");
	});

	it("handles empty string", () => {
		expect(resolveSkillName("")).toBe("");
	});

	// NOTE: resolveSkillName is an identity function — it passes through any
	// string, but only names satisfying isValidSkillName are accepted by
	// generateSkill. Invalid names (e.g. "@scope/my-cli") are intentionally
	// not tested here to avoid implying they are supported.
});

// ────────────────────────────────────────────────────────────────────────────
// isValidSkillName
// ────────────────────────────────────────────────────────────────────────────

describe("isValidSkillName", () => {
	it("accepts valid names", () => {
		expect(isValidSkillName("my-cli")).toBe(true);
		expect(isValidSkillName("deploy")).toBe(true);
		expect(isValidSkillName("git")).toBe(true);
		expect(isValidSkillName("use-cases")).toBe(true);
		expect(isValidSkillName("a")).toBe(true);
		expect(isValidSkillName("abc123")).toBe(true);
	});

	it("rejects names with uppercase characters", () => {
		expect(isValidSkillName("My-CLI")).toBe(false);
	});

	it("rejects names with underscores", () => {
		expect(isValidSkillName("my_cli")).toBe(false);
	});

	it("rejects names with dots", () => {
		expect(isValidSkillName("my.cli")).toBe(false);
	});

	it("rejects names with @ or /", () => {
		expect(isValidSkillName("@scope/cli")).toBe(false);
	});

	it("rejects names starting with hyphen", () => {
		expect(isValidSkillName("-cli")).toBe(false);
	});

	it("rejects names ending with hyphen", () => {
		expect(isValidSkillName("cli-")).toBe(false);
	});

	it("rejects names with consecutive hyphens", () => {
		expect(isValidSkillName("my--cli")).toBe(false);
	});

	it("rejects empty string", () => {
		expect(isValidSkillName("")).toBe(false);
	});

	it("rejects names longer than 64 characters", () => {
		const longName = "a".repeat(65);
		expect(longName.length).toBeGreaterThan(64);
		expect(isValidSkillName(longName)).toBe(false);
	});

	it("accepts names exactly 64 characters", () => {
		const name = "a".repeat(64);
		expect(name.length).toBe(64);
		expect(isValidSkillName(name)).toBe(true);
	});
});

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
			expect(agent.files).not.toContain("command-index.md");
			expect(agent.files).toContain(CRUST_MANIFEST);
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
			expect(files).not.toContain("command-index.md");
			expect(files).toContain("commands/my-cli.md");
			expect(files).toContain(CRUST_MANIFEST);
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
			expect(files).not.toContain("command-index.md");
			expect(files).toContain("commands/git.md");
			expect(files).toContain("commands/commit.md");
			expect(files).toContain("commands/remote.md");
			expect(files).toContain("commands/remote/add.md");
			expect(files).toContain("commands/remote/remove.md");
			expect(files).toContain(CRUST_MANIFEST);
		});

		it("does not generate manifest.json (renamed to crust.json)", async () => {
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
			expect(agent.files).not.toContain("manifest.json");
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

			const expected = join(tmpDir, ".agents", "skills", "my-cli");
			expect((result.agents[0] as AgentResult).outputDir).toBe(expected);
		});

		it("writes canonical bundle once and exposes files in agent path", async () => {
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

			const canonical = join(tmpDir, ".crust", "skills", "my-cli");
			const linkedPath = (result.agents[0] as AgentResult).outputDir;

			expect((await stat(canonical)).isDirectory()).toBe(true);
			expect((await stat(join(linkedPath, "SKILL.md"))).isFile()).toBe(true);
		});

		it("supports strict symlink install mode", async () => {
			if (process.platform === "win32") {
				return;
			}

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
					installMode: "symlink",
				}),
			);

			const outputDir = (result.agents[0] as AgentResult).outputDir;
			expect((await lstat(outputDir)).isSymbolicLink()).toBe(true);
		});

		it("supports copy install mode", async () => {
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
					installMode: "copy",
				}),
			);

			const outputDir = (result.agents[0] as AgentResult).outputDir;
			expect((await lstat(outputDir)).isSymbolicLink()).toBe(false);
			expect((await stat(join(outputDir, "SKILL.md"))).isFile()).toBe(true);
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
	// crust.json content
	// ────────────────────────────────────────────────────────────────────────

	describe("crust.json", () => {
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
				join((result.agents[0] as AgentResult).outputDir, CRUST_MANIFEST),
			);
			const manifest = JSON.parse(content);

			expect(manifest.name).toBe("my-cli");
			expect(manifest.description).toBe("Simple CLI");
			expect(manifest.version).toBe("2.0.0");
			expect(manifest.entrypoint).toBeUndefined();
		});

		it("does not include entrypoint or commands fields", async () => {
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
				join((result.agents[0] as AgentResult).outputDir, CRUST_MANIFEST),
			);
			const manifest = JSON.parse(content);

			expect(manifest.entrypoint).toBeUndefined();
			expect(manifest.commands).toBeUndefined();
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
				join((result.agents[0] as AgentResult).outputDir, CRUST_MANIFEST),
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
				join((result.agents[0] as AgentResult).outputDir, CRUST_MANIFEST),
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

		it("SKILL.md command reference links resolve to command files", async () => {
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
			const skill = await readText(join(agent.outputDir, "SKILL.md"));
			const files = await listFiles(agent.outputDir);

			const linkPattern = /\[([^\]]+)\]\(([^)]+)\)/g;
			let match: RegExpExecArray | null;
			// biome-ignore lint/suspicious/noAssignInExpressions: regex exec loop pattern
			while ((match = linkPattern.exec(skill)) !== null) {
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
			const cmd = makeCommand({
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
			expect(agent.files).toContain(CRUST_MANIFEST);
			expect(agent.files).not.toContain("command-index.md");
		});

		it("handles deeply nested command hierarchy", async () => {
			const cmd = makeCommand({
				meta: { name: "top" },
				subCommands: {
					level1: makeCommand({
						meta: { name: "level1" },
						subCommands: {
							level2: makeCommand({
								meta: { name: "level2" },
								subCommands: {
									level3: makeCommand({
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

		it("throws on invalid skill name with special characters", async () => {
			await expect(
				withCwd(tmpDir, () =>
					generateSkill({
						command: simpleCommand(),
						meta: {
							name: "@scope/my-cli",
							description: "Test",
							version: "1.0.0",
						},
						agents: ["claude-code"],
						scope: "project",
					}),
				),
			).rejects.toThrow("Invalid skill name");
		});

		it("throws on invalid skill name with uppercase", async () => {
			await expect(
				withCwd(tmpDir, () =>
					generateSkill({
						command: simpleCommand(),
						meta: {
							name: "My-CLI",
							description: "Test",
							version: "1.0.0",
						},
						agents: ["claude-code"],
						scope: "project",
					}),
				),
			).rejects.toThrow("Invalid skill name");
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

	// ────────────────────────────────────────────────────────────────────────
	// Conflict detection
	// ────────────────────────────────────────────────────────────────────────

	describe("conflict detection", () => {
		it("throws SkillConflictError when directory exists without crust.json", async () => {
			// Pre-create the skill directory without crust.json (simulating a non-Crust skill)
			const skillDir = join(tmpDir, ".claude", "skills", "my-cli");
			await mkdir(skillDir, { recursive: true });
			await writeFile(join(skillDir, "SKILL.md"), "# Manual skill");

			await expect(
				withCwd(tmpDir, () =>
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
				),
			).rejects.toThrow(SkillConflictError);
		});

		it("includes agent and outputDir in conflict error details", async () => {
			const skillDir = join(tmpDir, ".claude", "skills", "my-cli");
			await mkdir(skillDir, { recursive: true });
			await writeFile(join(skillDir, "SKILL.md"), "# Manual skill");

			try {
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
				expect(true).toBe(false); // Should not reach here
			} catch (err) {
				expect(err).toBeInstanceOf(SkillConflictError);
				const conflict = err as SkillConflictError;
				expect(conflict.details.agent).toBe("claude-code");
				expect(conflict.details.outputDir).toBe(skillDir);
			}
		});

		it("throws SkillConflictError when the canonical store exists without crust.json", async () => {
			const canonicalDir = join(tmpDir, ".crust", "skills", "my-cli");
			await mkdir(canonicalDir, { recursive: true });
			await writeFile(join(canonicalDir, "SKILL.md"), "# Manual canonical");

			try {
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
				expect(true).toBe(false);
			} catch (err) {
				expect(err).toBeInstanceOf(SkillConflictError);
				const conflict = err as SkillConflictError;
				expect(conflict.details.outputDir).toBe(canonicalDir);
			}
		});

		it("does not throw when directory exists with valid crust.json", async () => {
			// First install — creates crust.json
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

			// Second install — same source, different version — should not throw
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
		});

		it("does not throw for fresh install (no directory)", async () => {
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
		});

		it("throws when directory has only non-Crust files", async () => {
			const skillDir = join(tmpDir, ".agents", "skills", "my-cli");
			await mkdir(skillDir, { recursive: true });
			await writeFile(
				join(skillDir, "manifest.json"),
				JSON.stringify({ name: "my-cli", version: "1.0.0" }),
			);

			await expect(
				withCwd(tmpDir, () =>
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
				),
			).rejects.toThrow(SkillConflictError);
		});

		it("succeeds with force when directory exists without crust.json", async () => {
			const skillDir = join(tmpDir, ".claude", "skills", "my-cli");
			await mkdir(skillDir, { recursive: true });
			await writeFile(join(skillDir, "SKILL.md"), "# Manual skill");

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
					force: true,
				}),
			);

			expect((result.agents[0] as AgentResult).status).toBe("installed");
			expect((result.agents[0] as AgentResult).files.length).toBeGreaterThan(0);
		});

		it("ignores a legacy manual directory and installs to the new path", async () => {
			const legacySkillDir = join(tmpDir, ".agents", "skills", "use-my-cli");
			await mkdir(legacySkillDir, { recursive: true });
			await writeFile(
				join(legacySkillDir, "SKILL.md"),
				"# Manual legacy skill",
			);

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

			expect((result.agents[0] as AgentResult).outputDir).toBe(
				join(tmpDir, ".agents", "skills", "my-cli"),
			);
			expect(await readText(join(legacySkillDir, "SKILL.md"))).toBe(
				"# Manual legacy skill",
			);
		});

		it("migrates a legacy Crust install to the new path", async () => {
			const legacyCanonicalDir = join(tmpDir, ".crust", "skills", "use-my-cli");
			const legacySkillDir = join(tmpDir, ".claude", "skills", "use-my-cli");
			await mkdir(legacyCanonicalDir, { recursive: true });
			await mkdir(legacySkillDir, { recursive: true });
			await writeFile(
				join(legacyCanonicalDir, CRUST_MANIFEST),
				`${JSON.stringify(
					{ name: "use-my-cli", description: "Test", version: "1.0.0" },
					null,
					"\t",
				)}\n`,
			);
			await writeFile(
				join(legacyCanonicalDir, "SKILL.md"),
				'---\nname: use-my-cli\ndescription: Test\nmetadata:\n  version: "1.0.0"\n---\n',
			);
			await writeFile(
				join(legacySkillDir, CRUST_MANIFEST),
				`${JSON.stringify(
					{ name: "use-my-cli", description: "Test", version: "1.0.0" },
					null,
					"\t",
				)}\n`,
			);

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
					installMode: "copy",
				}),
			);

			const newSkillDir = join(tmpDir, ".claude", "skills", "my-cli");
			const newCanonicalDir = join(tmpDir, ".crust", "skills", "my-cli");

			expect((result.agents[0] as AgentResult).status).toBe("updated");
			expect(await readInstalledVersion(newSkillDir)).toBe("1.0.0");
			expect(await readInstalledVersion(newCanonicalDir)).toBe("1.0.0");
			await expect(stat(legacySkillDir)).rejects.toThrow();
			await expect(stat(legacyCanonicalDir)).rejects.toThrow();
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

		const agentResult = result.agents[0] as UninstallResult["agents"][number];
		expect(agentResult.status).toBe("not-found");
	});

	it("removes a legacy Crust-managed install", async () => {
		const legacyCanonicalDir = join(tmpDir, ".crust", "skills", "use-my-cli");
		const legacySkillDir = join(tmpDir, ".claude", "skills", "use-my-cli");
		await mkdir(legacyCanonicalDir, { recursive: true });
		await mkdir(legacySkillDir, { recursive: true });
		await writeFile(
			join(legacyCanonicalDir, CRUST_MANIFEST),
			JSON.stringify({ name: "use-my-cli", version: "1.0.0" }, null, "\t") +
				"\n",
		);
		await writeFile(
			join(legacySkillDir, CRUST_MANIFEST),
			JSON.stringify({ name: "use-my-cli", version: "1.0.0" }, null, "\t") +
				"\n",
		);

		const result = await withCwd(tmpDir, () =>
			uninstallSkill({
				name: "my-cli",
				agents: ["claude-code"],
				scope: "project",
			}),
		);

		expect(result.agents[0]?.status).toBe("removed");
		await expect(stat(legacySkillDir)).rejects.toThrow();
		await expect(stat(legacyCanonicalDir)).rejects.toThrow();
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

	it("reports a legacy Crust install using the legacy output path", async () => {
		const legacyCanonicalDir = join(tmpDir, ".crust", "skills", "use-my-cli");
		const legacySkillDir = join(tmpDir, ".claude", "skills", "use-my-cli");
		await mkdir(legacyCanonicalDir, { recursive: true });
		await mkdir(legacySkillDir, { recursive: true });
		await writeFile(
			join(legacyCanonicalDir, CRUST_MANIFEST),
			JSON.stringify({ name: "use-my-cli", version: "1.0.0" }, null, "\t") +
				"\n",
		);
		await writeFile(
			join(legacySkillDir, CRUST_MANIFEST),
			JSON.stringify({ name: "use-my-cli", version: "1.0.0" }, null, "\t") +
				"\n",
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
		expect(status.agents[0]?.outputDir).toBe(legacySkillDir);
	});

	it("does not treat a legacy manual directory as installed", async () => {
		const legacySkillDir = join(tmpDir, ".claude", "skills", "use-my-cli");
		await mkdir(legacySkillDir, { recursive: true });
		await writeFile(join(legacySkillDir, "SKILL.md"), "# Manual legacy skill");

		const status = await withCwd(tmpDir, () =>
			skillStatus({
				name: "my-cli",
				agents: ["claude-code"],
				scope: "project",
			}),
		);

		expect(status.agents[0]?.installed).toBe(false);
		expect(status.agents[0]?.outputDir).toBe(
			join(tmpDir, ".claude", "skills", "my-cli"),
		);
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Default agent resolution — omitted `agents` triggers universal + detected
// ────────────────────────────────────────────────────────────────────────────

describe("default agent resolution", () => {
	/**
	 * `getUniversalAgents()` is fixed at module-load time, so we capture it
	 * once and reuse for assertions about the default-resolution shape.
	 */
	const universalAgents = getUniversalAgents();

	describe("generateSkill", () => {
		it("defaults to universal + detected when `agents` is omitted", async () => {
			const pathDir = join(tmpDir, "fake-bin");
			await mkdir(pathDir, { recursive: true });
			// `claude-code` is detected when `claude` is on PATH.
			await makeFakeExecutable(pathDir, "claude");

			const result = await withCwd(tmpDir, () =>
				withPath([pathDir], () =>
					generateSkill({
						command: simpleCommand(),
						meta: {
							name: "my-cli",
							description: "Test",
							version: "1.0.0",
						},
						scope: "project",
					}),
				),
			);

			const targets = new Set(result.agents.map((a) => a.agent));
			// Every universal agent is included...
			for (const universal of universalAgents) {
				expect(targets.has(universal)).toBe(true);
			}
			// ...plus the detected additional agent.
			expect(targets.has("claude-code")).toBe(true);
			expect(result.agents.length).toBe(universalAgents.length + 1);
		});

		it("falls back to universal-only when nothing is detected", async () => {
			const pathDir = join(tmpDir, "empty-bin");
			await mkdir(pathDir, { recursive: true });

			const result = await withCwd(tmpDir, () =>
				withPath([pathDir], () =>
					generateSkill({
						command: simpleCommand(),
						meta: {
							name: "my-cli",
							description: "Test",
							version: "1.0.0",
						},
						scope: "project",
					}),
				),
			);

			const targets = new Set(result.agents.map((a) => a.agent));
			expect(result.agents.length).toBe(universalAgents.length);
			for (const universal of universalAgents) {
				expect(targets.has(universal)).toBe(true);
			}
		});

		it("treats `agents: []` as no-op (does not trigger default)", async () => {
			const pathDir = join(tmpDir, "fake-bin");
			await mkdir(pathDir, { recursive: true });
			await makeFakeExecutable(pathDir, "claude");

			const result = await withCwd(tmpDir, () =>
				withPath([pathDir], () =>
					generateSkill({
						command: simpleCommand(),
						meta: {
							name: "my-cli",
							description: "Test",
							version: "1.0.0",
						},
						agents: [],
						scope: "project",
					}),
				),
			);

			expect(result.agents).toEqual([]);
		});

		it("honors an explicit `agents` list (default not triggered)", async () => {
			const pathDir = join(tmpDir, "fake-bin");
			await mkdir(pathDir, { recursive: true });
			// Add many fake agents to PATH — explicit list must still win.
			await makeFakeExecutable(pathDir, "claude");
			await makeFakeExecutable(pathDir, "windsurf");

			const result = await withCwd(tmpDir, () =>
				withPath([pathDir], () =>
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
				),
			);

			expect(result.agents).toHaveLength(1);
			expect(result.agents[0]?.agent).toBe("claude-code");
		});
	});

	describe("uninstallSkill", () => {
		it("defaults to universal + detected when `agents` is omitted", async () => {
			const pathDir = join(tmpDir, "fake-bin");
			await mkdir(pathDir, { recursive: true });
			await makeFakeExecutable(pathDir, "claude");

			// Install with explicit list, then uninstall using the default.
			await withCwd(tmpDir, () =>
				withPath([pathDir], () =>
					generateSkill({
						command: simpleCommand(),
						meta: {
							name: "my-cli",
							description: "Test",
							version: "1.0.0",
						},
						agents: ["claude-code", "opencode"],
						scope: "project",
					}),
				),
			);

			const result = await withCwd(tmpDir, () =>
				withPath([pathDir], () =>
					uninstallSkill({
						name: "my-cli",
						scope: "project",
					}),
				),
			);

			const targets = new Set(result.agents.map((a) => a.agent));
			for (const universal of universalAgents) {
				expect(targets.has(universal)).toBe(true);
			}
			expect(targets.has("claude-code")).toBe(true);
			expect(result.agents.length).toBe(universalAgents.length + 1);
		});

		it("treats `agents: []` as no-op (does not trigger default)", async () => {
			const pathDir = join(tmpDir, "fake-bin");
			await mkdir(pathDir, { recursive: true });
			await makeFakeExecutable(pathDir, "claude");

			const result = await withCwd(tmpDir, () =>
				withPath([pathDir], () =>
					uninstallSkill({
						name: "my-cli",
						agents: [],
						scope: "project",
					}),
				),
			);

			expect(result.agents).toEqual([]);
		});
	});

	describe("skillStatus", () => {
		it("defaults to universal + detected when `agents` is omitted", async () => {
			const pathDir = join(tmpDir, "fake-bin");
			await mkdir(pathDir, { recursive: true });
			await makeFakeExecutable(pathDir, "claude");

			const status = await withCwd(tmpDir, () =>
				withPath([pathDir], () =>
					skillStatus({
						name: "my-cli",
						scope: "project",
					}),
				),
			);

			const targets = new Set(status.agents.map((a) => a.agent));
			for (const universal of universalAgents) {
				expect(targets.has(universal)).toBe(true);
			}
			expect(targets.has("claude-code")).toBe(true);
			expect(status.agents.length).toBe(universalAgents.length + 1);
			// Nothing was installed, so all entries report `installed: false`.
			for (const entry of status.agents) {
				expect(entry.installed).toBe(false);
			}
		});

		it("treats `agents: []` as no-op (does not trigger default)", async () => {
			const pathDir = join(tmpDir, "fake-bin");
			await mkdir(pathDir, { recursive: true });
			await makeFakeExecutable(pathDir, "claude");

			const status = await withCwd(tmpDir, () =>
				withPath([pathDir], () =>
					skillStatus({
						name: "my-cli",
						agents: [],
						scope: "project",
					}),
				),
			);

			expect(status.agents).toEqual([]);
		});
	});
});
