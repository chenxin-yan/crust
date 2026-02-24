/**
 * End-to-end tests for skill generation.
 *
 * These tests exercise the full pipeline (defineCommand → generateSkill → disk)
 * and validate:
 * - Complete output tree structure
 * - SKILL.md frontmatter and content
 * - command-index.md links resolve to real files
 * - Leaf and group command file content
 * - Cross-file link integrity (every markdown link points to a real file)
 * - Generated bundle is usable as a downloaded skill (valid frontmatter, paths, structure)
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { defineCommand } from "@crustjs/core";
import { generateSkill } from "../src/generate.ts";

// ────────────────────────────────────────────────────────────────────────────
// Test helpers
// ────────────────────────────────────────────────────────────────────────────

/** Creates a unique temporary directory for each test. */
async function makeTmpDir(): Promise<string> {
	const base = join(import.meta.dirname ?? ".", ".tmp-e2e");
	const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
	const dir = join(base, id);
	await Bun.write(join(dir, ".keep"), "");
	return dir;
}

/** Recursively lists all files under a directory (relative paths, sorted). */
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
 * Extracts all markdown links `[text](href)` from content.
 * Returns array of { text, href } objects.
 */
function extractLinks(content: string): { text: string; href: string }[] {
	const pattern = /\[([^\]]*)\]\(([^)]+)\)/g;
	const links: { text: string; href: string }[] = [];
	let match: RegExpExecArray | null;
	// biome-ignore lint/suspicious/noAssignInExpressions: regex exec loop pattern
	while ((match = pattern.exec(content)) !== null) {
		const text = match[1] ?? "";
		const href = match[2] ?? "";
		links.push({ text, href });
	}
	return links;
}

/**
 * Resolves a relative link from a source file path to a target path.
 * Both are relative to the skill root directory.
 */
function resolveLink(fromFile: string, href: string): string {
	const fromDir = fromFile.split("/").slice(0, -1);
	const hrefParts = href.split("/");
	const resolved: string[] = [...fromDir];
	for (const part of hrefParts) {
		if (part === "..") {
			resolved.pop();
		} else if (part !== ".") {
			resolved.push(part);
		}
	}
	return resolved.join("/");
}

// ────────────────────────────────────────────────────────────────────────────
// E2E fixture — realistic multi-level CLI
// ────────────────────────────────────────────────────────────────────────────

/**
 * Builds a realistic multi-level CLI command tree resembling a deployment tool.
 *
 * Structure:
 *   deploy (root, runnable)
 *   ├── app (group, not runnable)
 *   │   ├── create (leaf, runnable)
 *   │   ├── delete (leaf, runnable)
 *   │   └── list (leaf, runnable)
 *   ├── config (group + runnable)
 *   │   ├── get (leaf, runnable)
 *   │   └── set (leaf, runnable)
 *   └── status (leaf, runnable)
 */
function buildFixtureCommand() {
	return defineCommand({
		meta: {
			name: "deploy",
			description: "A cloud deployment CLI for managing applications",
		},
		args: [
			{
				name: "environment",
				type: "string" as const,
				description: "Target environment",
			},
		],
		flags: {
			verbose: {
				type: "boolean" as const,
				description: "Enable verbose output",
				alias: "v",
			},
			region: {
				type: "string" as const,
				description: "Cloud region to target",
				alias: "r",
				default: "us-east-1",
			},
		},
		run() {},
		subCommands: {
			app: defineCommand({
				meta: {
					name: "app",
					description: "Manage applications",
				},
				subCommands: {
					create: defineCommand({
						meta: {
							name: "create",
							description: "Create a new application",
						},
						args: [
							{
								name: "name",
								type: "string" as const,
								description: "Application name",
								required: true,
							},
						],
						flags: {
							template: {
								type: "string" as const,
								description: "Application template",
								alias: "t",
								default: "default",
							},
							"dry-run": {
								type: "boolean" as const,
								description: "Preview without creating",
							},
						},
						run() {},
					}),
					delete: defineCommand({
						meta: {
							name: "delete",
							description: "Delete an application",
						},
						args: [
							{
								name: "name",
								type: "string" as const,
								description: "Application name",
								required: true,
							},
						],
						flags: {
							force: {
								type: "boolean" as const,
								description: "Skip confirmation",
								alias: "f",
							},
						},
						run() {},
					}),
					list: defineCommand({
						meta: {
							name: "list",
							description: "List all applications",
						},
						flags: {
							format: {
								type: "string" as const,
								description: "Output format",
								default: "table",
							},
							limit: {
								type: "number" as const,
								description: "Maximum number of results",
							},
						},
						run() {},
					}),
				},
			}),
			config: defineCommand({
				meta: {
					name: "config",
					description: "View and manage configuration",
				},
				flags: {
					global: {
						type: "boolean" as const,
						description: "Use global configuration",
						alias: "g",
					},
				},
				run() {},
				subCommands: {
					get: defineCommand({
						meta: {
							name: "get",
							description: "Get a configuration value",
						},
						args: [
							{
								name: "key",
								type: "string" as const,
								description: "Configuration key",
								required: true,
							},
						],
						run() {},
					}),
					set: defineCommand({
						meta: {
							name: "set",
							description: "Set a configuration value",
						},
						args: [
							{
								name: "key",
								type: "string" as const,
								description: "Configuration key",
								required: true,
							},
							{
								name: "value",
								type: "string" as const,
								description: "Value to set",
								required: true,
							},
						],
						run() {},
					}),
				},
			}),
			status: defineCommand({
				meta: {
					name: "status",
					description: "Show deployment status",
				},
				flags: {
					watch: {
						type: "boolean" as const,
						description: "Watch for changes",
						alias: "w",
					},
				},
				run() {},
			}),
		},
	});
}

const SKILL_META = {
	name: "deploy-cli",
	description: "Agent skill for the deploy CLI tool",
	version: "1.2.0",
};

// ────────────────────────────────────────────────────────────────────────────
// Test lifecycle
// ────────────────────────────────────────────────────────────────────────────

let tmpDir: string;

beforeEach(async () => {
	tmpDir = await makeTmpDir();
});

afterEach(async () => {
	try {
		await rm(tmpDir, { recursive: true });
	} catch {
		// Ignore cleanup errors
	}
});

// ────────────────────────────────────────────────────────────────────────────
// E2E: Full output structure
// ────────────────────────────────────────────────────────────────────────────

describe("E2E: skill generation", () => {
	describe("output tree structure", () => {
		it("creates the correct directory and file layout", async () => {
			const result = await generateSkill({
				command: buildFixtureCommand(),
				meta: SKILL_META,
				outDir: tmpDir,
			});

			const files = await listFiles(result.outputDir);
			const expected = [
				"README.md",
				"SKILL.md",
				"command-index.md",
				"commands/app.md",
				"commands/app/create.md",
				"commands/app/delete.md",
				"commands/app/list.md",
				"commands/config.md",
				"commands/config/get.md",
				"commands/config/set.md",
				"commands/deploy.md",
				"commands/status.md",
				"manifest.json",
			];

			expect(files).toEqual(expected);
		});

		it("returns files matching on-disk files", async () => {
			const result = await generateSkill({
				command: buildFixtureCommand(),
				meta: SKILL_META,
				outDir: tmpDir,
			});

			const diskFiles = await listFiles(result.outputDir);
			const sorted = [...result.files].sort();
			expect(diskFiles).toEqual(sorted);
		});

		it("produces a non-empty file for every entry", async () => {
			const result = await generateSkill({
				command: buildFixtureCommand(),
				meta: SKILL_META,
				outDir: tmpDir,
			});

			for (const file of result.files) {
				const content = await readText(join(result.outputDir, file));
				expect(content.length).toBeGreaterThan(0);
			}
		});
	});

	// ────────────────────────────────────────────────────────────────────────
	// E2E: SKILL.md validation
	// ────────────────────────────────────────────────────────────────────────

	describe("SKILL.md", () => {
		it("has valid YAML frontmatter with required fields", async () => {
			const result = await generateSkill({
				command: buildFixtureCommand(),
				meta: SKILL_META,
				outDir: tmpDir,
			});

			const content = await readText(join(result.outputDir, "SKILL.md"));

			// Frontmatter block
			expect(content).toMatch(/^---\n/);
			expect(content).toContain("name: deploy-cli");
			expect(content).toContain(
				"description: Agent skill for the deploy CLI tool",
			);
			expect(content).toContain('version: "1.2.0"');
			expect(content).toMatch(/---\n/);
		});

		it("contains the skill title and description", async () => {
			const result = await generateSkill({
				command: buildFixtureCommand(),
				meta: SKILL_META,
				outDir: tmpDir,
			});

			const content = await readText(join(result.outputDir, "SKILL.md"));
			expect(content).toContain("# deploy-cli");
			expect(content).toContain(
				"A cloud deployment CLI for managing applications",
			);
		});

		it("lists all top-level subcommands", async () => {
			const result = await generateSkill({
				command: buildFixtureCommand(),
				meta: SKILL_META,
				outDir: tmpDir,
			});

			const content = await readText(join(result.outputDir, "SKILL.md"));
			expect(content).toContain("`app`");
			expect(content).toContain("`config`");
			expect(content).toContain("`status`");
		});

		it("includes lazy-load instructions", async () => {
			const result = await generateSkill({
				command: buildFixtureCommand(),
				meta: SKILL_META,
				outDir: tmpDir,
			});

			const content = await readText(join(result.outputDir, "SKILL.md"));
			expect(content).toContain("command-index.md");
			expect(content).toContain("commands/");
		});

		it("references root command usage (since root is runnable)", async () => {
			const result = await generateSkill({
				command: buildFixtureCommand(),
				meta: SKILL_META,
				outDir: tmpDir,
			});

			const content = await readText(join(result.outputDir, "SKILL.md"));
			expect(content).toContain("## Usage");
			expect(content).toContain("commands/deploy.md");
		});

		it("all links in SKILL.md resolve to real files", async () => {
			const result = await generateSkill({
				command: buildFixtureCommand(),
				meta: SKILL_META,
				outDir: tmpDir,
			});

			const content = await readText(join(result.outputDir, "SKILL.md"));
			const diskFiles = new Set(await listFiles(result.outputDir));
			const links = extractLinks(content);

			expect(links.length).toBeGreaterThan(0);
			for (const link of links) {
				const resolved = resolveLink("SKILL.md", link.href);
				expect(diskFiles.has(resolved)).toBe(true);
			}
		});
	});

	// ────────────────────────────────────────────────────────────────────────
	// E2E: command-index.md validation
	// ────────────────────────────────────────────────────────────────────────

	describe("command-index.md", () => {
		it("lists every command in the tree", async () => {
			const result = await generateSkill({
				command: buildFixtureCommand(),
				meta: SKILL_META,
				outDir: tmpDir,
			});

			const content = await readText(
				join(result.outputDir, "command-index.md"),
			);
			const expectedCommands = [
				"deploy",
				"deploy app",
				"deploy app create",
				"deploy app delete",
				"deploy app list",
				"deploy config",
				"deploy config get",
				"deploy config set",
				"deploy status",
			];

			for (const cmd of expectedCommands) {
				expect(content).toContain(`\`${cmd}\``);
			}
		});

		it("has correct type labels", async () => {
			const result = await generateSkill({
				command: buildFixtureCommand(),
				meta: SKILL_META,
				outDir: tmpDir,
			});

			const content = await readText(
				join(result.outputDir, "command-index.md"),
			);

			// deploy root is runnable + has children
			expect(content).toMatch(/`deploy`\s*\|\s*runnable, group/);
			// deploy app is group only (no run handler)
			expect(content).toMatch(/`deploy app`\s*\|\s*group/);
			// deploy config is runnable + group
			expect(content).toMatch(/`deploy config`\s*\|\s*runnable, group/);
			// deploy status is leaf/runnable
			expect(content).toMatch(/`deploy status`\s*\|\s*runnable/);
		});

		it("all documentation links resolve to real files", async () => {
			const result = await generateSkill({
				command: buildFixtureCommand(),
				meta: SKILL_META,
				outDir: tmpDir,
			});

			const content = await readText(
				join(result.outputDir, "command-index.md"),
			);
			const diskFiles = new Set(await listFiles(result.outputDir));
			const links = extractLinks(content);

			expect(links.length).toBeGreaterThan(0);
			for (const link of links) {
				const resolved = resolveLink("command-index.md", link.href);
				expect(diskFiles.has(resolved)).toBe(true);
			}
		});

		it("uses markdown table format", async () => {
			const result = await generateSkill({
				command: buildFixtureCommand(),
				meta: SKILL_META,
				outDir: tmpDir,
			});

			const content = await readText(
				join(result.outputDir, "command-index.md"),
			);
			expect(content).toContain("| Command | Type | Documentation |");
			expect(content).toContain("| ------- | ---- | ------------- |");
		});
	});

	// ────────────────────────────────────────────────────────────────────────
	// E2E: Leaf command files
	// ────────────────────────────────────────────────────────────────────────

	describe("leaf command files", () => {
		it("deploy app create has full invocation details", async () => {
			const result = await generateSkill({
				command: buildFixtureCommand(),
				meta: SKILL_META,
				outDir: tmpDir,
			});

			const content = await readText(
				join(result.outputDir, "commands", "app", "create.md"),
			);

			// Title
			expect(content).toContain("# `deploy app create`");
			// Description
			expect(content).toContain("Create a new application");
			// Usage line
			expect(content).toContain("deploy app create <name>");
			// Arguments section
			expect(content).toContain("## Arguments");
			expect(content).toContain("`name`");
			// Flags section
			expect(content).toContain("## Flags");
			expect(content).toContain("`--template`");
			expect(content).toContain("`-t`");
			expect(content).toContain("`--dry-run`");
		});

		it("deploy status has a watch flag", async () => {
			const result = await generateSkill({
				command: buildFixtureCommand(),
				meta: SKILL_META,
				outDir: tmpDir,
			});

			const content = await readText(
				join(result.outputDir, "commands", "status.md"),
			);

			expect(content).toContain("# `deploy status`");
			expect(content).toContain("Show deployment status");
			expect(content).toContain("`--watch`");
			expect(content).toContain("`-w`");
		});

		it("leaf command file includes navigation links", async () => {
			const result = await generateSkill({
				command: buildFixtureCommand(),
				meta: SKILL_META,
				outDir: tmpDir,
			});

			const content = await readText(
				join(result.outputDir, "commands", "app", "create.md"),
			);

			// Parent link
			expect(content).toContain("Parent:");
			expect(content).toContain("`deploy app`");
			// Command index link
			expect(content).toContain("Command Index");
		});

		it("deploy config get has arguments documented", async () => {
			const result = await generateSkill({
				command: buildFixtureCommand(),
				meta: SKILL_META,
				outDir: tmpDir,
			});

			const content = await readText(
				join(result.outputDir, "commands", "config", "get.md"),
			);

			expect(content).toContain("# `deploy config get`");
			expect(content).toContain("Get a configuration value");
			expect(content).toContain("`key`");
			expect(content).toContain("Yes"); // required
		});
	});

	// ────────────────────────────────────────────────────────────────────────
	// E2E: Group command files
	// ────────────────────────────────────────────────────────────────────────

	describe("group command files", () => {
		it("deploy app lists subcommands with links", async () => {
			const result = await generateSkill({
				command: buildFixtureCommand(),
				meta: SKILL_META,
				outDir: tmpDir,
			});

			const content = await readText(
				join(result.outputDir, "commands", "app.md"),
			);

			expect(content).toContain("# `deploy app`");
			expect(content).toContain("Manage applications");
			expect(content).toContain("## Subcommands");
			expect(content).toContain("`create`");
			expect(content).toContain("`delete`");
			expect(content).toContain("`list`");
		});

		it("deploy config is a runnable group with usage and subcommands", async () => {
			const result = await generateSkill({
				command: buildFixtureCommand(),
				meta: SKILL_META,
				outDir: tmpDir,
			});

			const content = await readText(
				join(result.outputDir, "commands", "config.md"),
			);

			expect(content).toContain("# `deploy config`");
			expect(content).toContain("View and manage configuration");
			// Should have usage section (runnable)
			expect(content).toContain("## Usage");
			// Should have flags (global flag)
			expect(content).toContain("`--global`");
			expect(content).toContain("`-g`");
			// Should have subcommands
			expect(content).toContain("## Subcommands");
			expect(content).toContain("`get`");
			expect(content).toContain("`set`");
		});

		it("root command (deploy.md) is rendered as a group with usage", async () => {
			const result = await generateSkill({
				command: buildFixtureCommand(),
				meta: SKILL_META,
				outDir: tmpDir,
			});

			const content = await readText(
				join(result.outputDir, "commands", "deploy.md"),
			);

			expect(content).toContain("# `deploy`");
			expect(content).toContain(
				"A cloud deployment CLI for managing applications",
			);
			// Root has args and flags
			expect(content).toContain("`environment`");
			expect(content).toContain("`--verbose`");
			expect(content).toContain("`--region`");
			// Root has subcommands
			expect(content).toContain("## Subcommands");
		});
	});

	// ────────────────────────────────────────────────────────────────────────
	// E2E: Cross-file link integrity
	// ────────────────────────────────────────────────────────────────────────

	describe("cross-file link integrity", () => {
		it("every markdown link across all files resolves to a real file", async () => {
			const result = await generateSkill({
				command: buildFixtureCommand(),
				meta: SKILL_META,
				outDir: tmpDir,
			});

			const diskFiles = new Set(await listFiles(result.outputDir));
			const mdFiles = result.files.filter((f) => f.endsWith(".md"));

			let totalLinks = 0;
			const brokenLinks: string[] = [];

			for (const mdFile of mdFiles) {
				const content = await readText(join(result.outputDir, mdFile));
				const links = extractLinks(content);

				for (const link of links) {
					totalLinks++;
					const resolved = resolveLink(mdFile, link.href);
					if (!diskFiles.has(resolved)) {
						brokenLinks.push(
							`${mdFile} → ${link.href} (resolved: ${resolved})`,
						);
					}
				}
			}

			// Ensure we actually checked a meaningful number of links
			expect(totalLinks).toBeGreaterThan(10);
			expect(brokenLinks).toEqual([]);
		});

		it("group commands link correctly to child files", async () => {
			const result = await generateSkill({
				command: buildFixtureCommand(),
				meta: SKILL_META,
				outDir: tmpDir,
			});

			// Check that commands/app.md links resolve to commands/app/create.md etc.
			const appContent = await readText(
				join(result.outputDir, "commands", "app.md"),
			);
			const appLinks = extractLinks(appContent);
			const subcommandLinks = appLinks.filter(
				(l) =>
					l.href.includes("create") ||
					l.href.includes("delete") ||
					l.href.includes("list"),
			);

			expect(subcommandLinks.length).toBe(3);

			const diskFiles = new Set(await listFiles(result.outputDir));
			for (const link of subcommandLinks) {
				const resolved = resolveLink("commands/app.md", link.href);
				expect(diskFiles.has(resolved)).toBe(true);
			}
		});

		it("leaf commands link back to parent group", async () => {
			const result = await generateSkill({
				command: buildFixtureCommand(),
				meta: SKILL_META,
				outDir: tmpDir,
			});

			const createContent = await readText(
				join(result.outputDir, "commands", "app", "create.md"),
			);
			const links = extractLinks(createContent);

			// Should have a link pointing back to app.md
			const parentLink = links.find((l) => l.text.includes("deploy app"));
			expect(parentLink).toBeDefined();

			const diskFiles = new Set(await listFiles(result.outputDir));
			const resolved = resolveLink(
				"commands/app/create.md",
				parentLink?.href ?? "",
			);
			expect(diskFiles.has(resolved)).toBe(true);
		});
	});

	// ────────────────────────────────────────────────────────────────────────
	// E2E: Distribution metadata
	// ────────────────────────────────────────────────────────────────────────

	describe("distribution metadata", () => {
		it("manifest.json contains all commands", async () => {
			const result = await generateSkill({
				command: buildFixtureCommand(),
				meta: SKILL_META,
				outDir: tmpDir,
			});

			const content = await readText(join(result.outputDir, "manifest.json"));
			const manifest = JSON.parse(content);

			expect(manifest.name).toBe("deploy-cli");
			expect(manifest.description).toBe("Agent skill for the deploy CLI tool");
			expect(manifest.version).toBe("1.2.0");
			expect(manifest.entrypoint).toBe("SKILL.md");

			const expectedCommands = [
				"deploy",
				"deploy app",
				"deploy app create",
				"deploy app delete",
				"deploy app list",
				"deploy config",
				"deploy config get",
				"deploy config set",
				"deploy status",
			];
			for (const cmd of expectedCommands) {
				expect(manifest.commands).toContain(cmd);
			}
			expect(manifest.commands.length).toBe(expectedCommands.length);
		});

		it("README.md has install instructions for both agents", async () => {
			const result = await generateSkill({
				command: buildFixtureCommand(),
				meta: SKILL_META,
				outDir: tmpDir,
			});

			const content = await readText(join(result.outputDir, "README.md"));

			expect(content).toContain("# deploy-cli");
			expect(content).toContain("Agent skill for the deploy CLI tool");
			expect(content).toContain("1.2.0");
			expect(content).toContain("OpenCode");
			expect(content).toContain(".opencode/skills/deploy-cli/");
			expect(content).toContain("Claude Code");
			expect(content).toContain(".claude/skills/deploy-cli/");
		});
	});

	// ────────────────────────────────────────────────────────────────────────
	// E2E: Bundle usability (as a downloaded skill)
	// ────────────────────────────────────────────────────────────────────────

	describe("bundle usability", () => {
		it("SKILL.md has valid Agent Skills frontmatter", async () => {
			const result = await generateSkill({
				command: buildFixtureCommand(),
				meta: SKILL_META,
				outDir: tmpDir,
			});

			const content = await readText(join(result.outputDir, "SKILL.md"));

			// Must start with YAML frontmatter delimiters
			const lines = content.split("\n");
			expect(lines[0]).toBe("---");

			// Find the closing delimiter
			let closingIdx = -1;
			for (let i = 1; i < lines.length; i++) {
				if (lines[i] === "---") {
					closingIdx = i;
					break;
				}
			}
			expect(closingIdx).toBeGreaterThan(0);

			// Frontmatter must contain required fields
			const frontmatter = lines.slice(1, closingIdx).join("\n");
			expect(frontmatter).toContain("name:");
			expect(frontmatter).toContain("description:");
		});

		it("SKILL.md body has markdown heading and instruction text", async () => {
			const result = await generateSkill({
				command: buildFixtureCommand(),
				meta: SKILL_META,
				outDir: tmpDir,
			});

			const content = await readText(join(result.outputDir, "SKILL.md"));

			// Should have an H1 heading
			expect(content).toMatch(/^# .+$/m);
			// Should have command reference section
			expect(content).toContain("## Command Reference");
		});

		it("output is deterministic across multiple generations", async () => {
			const cmd = buildFixtureCommand();
			const tmpDir2 = await makeTmpDir();

			try {
				const result1 = await generateSkill({
					command: cmd,
					meta: SKILL_META,
					outDir: tmpDir,
				});
				const result2 = await generateSkill({
					command: cmd,
					meta: SKILL_META,
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
				await rm(tmpDir2, { recursive: true }).catch(() => {});
			}
		});

		it("all markdown files are valid UTF-8 text", async () => {
			const result = await generateSkill({
				command: buildFixtureCommand(),
				meta: SKILL_META,
				outDir: tmpDir,
			});

			const mdFiles = result.files.filter((f) => f.endsWith(".md"));
			for (const mdFile of mdFiles) {
				const content = await readText(join(result.outputDir, mdFile));
				// Should be non-empty strings
				expect(typeof content).toBe("string");
				expect(content.length).toBeGreaterThan(0);
				// Should not contain null bytes or other binary artifacts
				expect(content).not.toContain("\0");
			}
		});

		it("manifest.json is valid JSON", async () => {
			const result = await generateSkill({
				command: buildFixtureCommand(),
				meta: SKILL_META,
				outDir: tmpDir,
			});

			const content = await readText(join(result.outputDir, "manifest.json"));
			expect(() => JSON.parse(content)).not.toThrow();
		});

		it("command file paths in manifest match actual files", async () => {
			const result = await generateSkill({
				command: buildFixtureCommand(),
				meta: SKILL_META,
				outDir: tmpDir,
			});

			const manifestContent = await readText(
				join(result.outputDir, "manifest.json"),
			);
			const manifest = JSON.parse(manifestContent);
			const diskFiles = new Set(await listFiles(result.outputDir));

			// command-index should reference files for all commands
			const indexContent = await readText(
				join(result.outputDir, "command-index.md"),
			);

			// For each command in manifest, verify its documentation file exists
			for (const cmd of manifest.commands) {
				expect(indexContent).toContain(`\`${cmd}\``);
			}

			// Every commands/ file on disk should be referenced in the index
			const commandFiles = [...diskFiles].filter((f) =>
				f.startsWith("commands/"),
			);
			for (const cmdFile of commandFiles) {
				expect(indexContent).toContain(cmdFile);
			}
		});
	});
});
