import { describe, expect, it } from "bun:test";
import { defineCommand } from "@crustjs/core";
import { buildManifest } from "./manifest.ts";
import { renderSkill } from "./render.ts";
import type { ManifestNode, RenderedFile, SkillMeta } from "./types.ts";

// ────────────────────────────────────────────────────────────────────────────
// Test helpers
// ────────────────────────────────────────────────────────────────────────────

const baseMeta: SkillMeta = {
	name: "test-cli",
	description: "A test CLI tool",
};

/**
 * Finds a rendered file by path from the result array.
 */
function findFile(
	files: RenderedFile[],
	path: string,
): RenderedFile | undefined {
	return files.find((f) => f.path === path);
}

/**
 * Builds a simple manifest from a defineCommand call for testing.
 */
function buildSimpleManifest(): ManifestNode {
	const cmd = defineCommand({
		meta: { name: "test-cli", description: "A test CLI tool" },
		run() {},
	});
	return buildManifest(cmd);
}

// ────────────────────────────────────────────────────────────────────────────
// renderSkill — output structure
// ────────────────────────────────────────────────────────────────────────────

describe("renderSkill", () => {
	describe("output structure", () => {
		it("returns an array of RenderedFile objects", () => {
			const manifest = buildSimpleManifest();
			const files = renderSkill(manifest, baseMeta);

			expect(Array.isArray(files)).toBe(true);
			expect(files.length).toBeGreaterThan(0);
			for (const file of files) {
				expect(typeof file.path).toBe("string");
				expect(typeof file.content).toBe("string");
			}
		});

		it("always includes SKILL.md and command-index.md", () => {
			const manifest = buildSimpleManifest();
			const files = renderSkill(manifest, baseMeta);

			const paths = files.map((f) => f.path);
			expect(paths).toContain("SKILL.md");
			expect(paths).toContain("command-index.md");
		});

		it("produces one command file for a root-only command", () => {
			const manifest = buildSimpleManifest();
			const files = renderSkill(manifest, baseMeta);

			const commandFiles = files.filter((f) => f.path.startsWith("commands/"));
			expect(commandFiles).toHaveLength(1);
			expect(commandFiles[0]?.path).toBe("commands/test-cli.md");
		});

		it("produces command files mirroring the command hierarchy", () => {
			const add = defineCommand({
				meta: { name: "add", description: "Add a remote" },
				run() {},
			});
			const remove = defineCommand({
				meta: { name: "remove", description: "Remove a remote" },
				run() {},
			});
			const remote = defineCommand({
				meta: { name: "remote", description: "Manage remotes" },
				subCommands: { add, remove },
			});
			const root = defineCommand({
				meta: { name: "git", description: "Version control" },
				subCommands: { remote },
			});

			const manifest = buildManifest(root);
			const meta: SkillMeta = { name: "git", description: "Version control" };
			const files = renderSkill(manifest, meta);

			const paths = files.map((f) => f.path).sort();
			expect(paths).toContain("commands/git.md");
			expect(paths).toContain("commands/remote.md");
			expect(paths).toContain("commands/remote/add.md");
			expect(paths).toContain("commands/remote/remove.md");
		});
	});

	// ────────────────────────────────────────────────────────────────────────
	// SKILL.md content
	// ────────────────────────────────────────────────────────────────────────

	describe("SKILL.md content", () => {
		it("includes YAML frontmatter with name and description", () => {
			const manifest = buildSimpleManifest();
			const files = renderSkill(manifest, baseMeta);
			const skill = findFile(files, "SKILL.md");

			expect(skill).toBeDefined();
			expect(skill?.content).toContain("---");
			expect(skill?.content).toContain("name: test-cli");
			expect(skill?.content).toContain("description: A test CLI tool");
		});

		it("includes version in metadata when provided", () => {
			const manifest = buildSimpleManifest();
			const meta: SkillMeta = { ...baseMeta, version: "1.2.3" };
			const files = renderSkill(manifest, meta);
			const skill = findFile(files, "SKILL.md");

			expect(skill?.content).toContain("metadata:");
			expect(skill?.content).toContain('  version: "1.2.3"');
		});

		it("omits metadata block when no version", () => {
			const manifest = buildSimpleManifest();
			const files = renderSkill(manifest, baseMeta);
			const skill = findFile(files, "SKILL.md");

			expect(skill?.content).not.toContain("metadata:");
		});

		it("includes the manifest description in the body", () => {
			const manifest = buildSimpleManifest();
			const files = renderSkill(manifest, baseMeta);
			const skill = findFile(files, "SKILL.md");

			expect(skill?.content).toContain("A test CLI tool");
		});

		it("links to command-index.md", () => {
			const manifest = buildSimpleManifest();
			const files = renderSkill(manifest, baseMeta);
			const skill = findFile(files, "SKILL.md");

			expect(skill?.content).toContain("[command-index.md](command-index.md)");
		});

		it("lists available subcommands with links", () => {
			const serve = defineCommand({
				meta: { name: "serve", description: "Start server" },
				run() {},
			});
			const build = defineCommand({
				meta: { name: "build", description: "Build project" },
				run() {},
			});
			const root = defineCommand({
				meta: { name: "app", description: "App CLI" },
				subCommands: { serve, build },
			});

			const manifest = buildManifest(root);
			const meta: SkillMeta = { name: "app", description: "App CLI" };
			const files = renderSkill(manifest, meta);
			const skill = findFile(files, "SKILL.md");

			expect(skill?.content).toContain("## Available Commands");
			// Children sorted alphabetically
			expect(skill?.content).toContain("[`build`](commands/build.md)");
			expect(skill?.content).toContain("[`serve`](commands/serve.md)");
		});

		it("includes usage section when root is runnable", () => {
			const manifest = buildSimpleManifest();
			const files = renderSkill(manifest, baseMeta);
			const skill = findFile(files, "SKILL.md");

			expect(skill?.content).toContain("## Usage");
			expect(skill?.content).toContain("root command is directly executable");
		});

		it("omits usage section when root is not runnable", () => {
			const child = defineCommand({
				meta: { name: "child" },
				run() {},
			});
			const root = defineCommand({
				meta: { name: "app", description: "App" },
				subCommands: { child },
			});

			const manifest = buildManifest(root);
			const meta: SkillMeta = { name: "app", description: "App" };
			const files = renderSkill(manifest, meta);
			const skill = findFile(files, "SKILL.md");

			// Should not contain the runnable usage section
			expect(skill?.content).not.toContain(
				"root command is directly executable",
			);
		});

		it("includes lazy-load instructions", () => {
			const manifest = buildSimpleManifest();
			const files = renderSkill(manifest, baseMeta);
			const skill = findFile(files, "SKILL.md");

			expect(skill?.content).toContain("Command Reference");
			expect(skill?.content).toContain(
				"load the corresponding file from the `commands/` directory",
			);
		});
	});

	// ────────────────────────────────────────────────────────────────────────
	// command-index.md content
	// ────────────────────────────────────────────────────────────────────────

	describe("command-index.md content", () => {
		it("includes a markdown table header", () => {
			const manifest = buildSimpleManifest();
			const files = renderSkill(manifest, baseMeta);
			const index = findFile(files, "command-index.md");

			expect(index).toBeDefined();
			expect(index?.content).toContain("# Command Index");
			expect(index?.content).toContain("| Command | Type | Documentation |");
		});

		it("lists all commands with correct paths", () => {
			const serve = defineCommand({
				meta: { name: "serve", description: "Start server" },
				run() {},
			});
			const root = defineCommand({
				meta: { name: "app", description: "App CLI" },
				subCommands: { serve },
			});

			const manifest = buildManifest(root);
			const meta: SkillMeta = { name: "app", description: "App CLI" };
			const files = renderSkill(manifest, meta);
			const index = findFile(files, "command-index.md");

			expect(index?.content).toContain("`app`");
			expect(index?.content).toContain("`app serve`");
			expect(index?.content).toContain("commands/app.md");
			expect(index?.content).toContain("commands/serve.md");
		});

		it("shows correct type labels for runnable vs group", () => {
			const leaf = defineCommand({
				meta: { name: "leaf" },
				run() {},
			});
			const group = defineCommand({
				meta: { name: "group" },
				subCommands: { leaf },
			});
			const hybrid = defineCommand({
				meta: { name: "hybrid" },
				subCommands: { group },
				run() {},
			});

			const manifest = buildManifest(hybrid);
			const meta: SkillMeta = { name: "hybrid", description: "Test" };
			const files = renderSkill(manifest, meta);
			const index = findFile(files, "command-index.md");

			// hybrid is both runnable and has children
			expect(index?.content).toContain("| `hybrid` | runnable, group |");
			// group has children but is not runnable
			expect(index?.content).toContain("| `hybrid group` | group |");
			// leaf is runnable with no children
			expect(index?.content).toContain("| `hybrid group leaf` | runnable |");
		});
	});

	// ────────────────────────────────────────────────────────────────────────
	// Leaf command files
	// ────────────────────────────────────────────────────────────────────────

	describe("leaf command files", () => {
		it("renders a heading with full invocation", () => {
			const cmd = defineCommand({
				meta: { name: "deploy", description: "Deploy the app" },
				run() {},
			});
			const root = defineCommand({
				meta: { name: "app" },
				subCommands: { deploy: cmd },
			});

			const manifest = buildManifest(root);
			const meta: SkillMeta = { name: "app", description: "App" };
			const files = renderSkill(manifest, meta);
			const deploy = findFile(files, "commands/deploy.md");

			expect(deploy).toBeDefined();
			expect(deploy?.content).toContain("# `app deploy`");
		});

		it("renders description when present", () => {
			const cmd = defineCommand({
				meta: { name: "serve", description: "Start the dev server" },
				run() {},
			});

			const manifest = buildManifest(cmd);
			const meta: SkillMeta = { name: "serve", description: "Server" };
			const files = renderSkill(manifest, meta);
			const serve = findFile(files, "commands/serve.md");

			expect(serve?.content).toContain("Start the dev server");
		});

		it("renders auto-generated usage line", () => {
			const cmd = defineCommand({
				meta: { name: "deploy" },
				args: [
					{ name: "env", type: "string", required: true },
					{ name: "tag", type: "string" },
				] as const,
				flags: {
					force: { type: "boolean" },
				},
				run() {},
			});
			const root = defineCommand({
				meta: { name: "app" },
				subCommands: { deploy: cmd },
			});

			const manifest = buildManifest(root);
			const meta: SkillMeta = { name: "app", description: "App" };
			const files = renderSkill(manifest, meta);
			const deploy = findFile(files, "commands/deploy.md");

			expect(deploy?.content).toContain("app deploy <env> [tag] [options]");
		});

		it("renders custom usage when provided", () => {
			const cmd = defineCommand({
				meta: {
					name: "build",
					usage: "build [--watch] [entry...]",
				},
				run() {},
			});

			const manifest = buildManifest(cmd);
			const meta: SkillMeta = { name: "build", description: "Build" };
			const files = renderSkill(manifest, meta);
			const build = findFile(files, "commands/build.md");

			expect(build?.content).toContain("build [--watch] [entry...]");
		});

		it("renders an arguments table with required/optional/variadic", () => {
			const cmd = defineCommand({
				meta: { name: "copy" },
				args: [
					{
						name: "source",
						type: "string",
						required: true,
						description: "Source path",
					},
					{
						name: "dest",
						type: "string",
						description: "Destination path",
					},
					{
						name: "extras",
						type: "string",
						variadic: true,
						description: "Extra files",
					},
				] as const,
				run() {},
			});

			const manifest = buildManifest(cmd);
			const meta: SkillMeta = { name: "copy", description: "Copy" };
			const files = renderSkill(manifest, meta);
			const copy = findFile(files, "commands/copy.md");

			expect(copy?.content).toContain("## Arguments");
			expect(copy?.content).toContain(
				"| `source` | string | Yes | Source path |",
			);
			expect(copy?.content).toContain(
				"| `dest` | string | No | Destination path |",
			);
			expect(copy?.content).toContain(
				"| `extras...` | string | No | Extra files |",
			);
		});

		it("renders argument default values", () => {
			const cmd = defineCommand({
				meta: { name: "serve" },
				args: [
					{
						name: "port",
						type: "number",
						default: 3000,
						description: "Port number",
					},
				] as const,
				run() {},
			});

			const manifest = buildManifest(cmd);
			const meta: SkillMeta = { name: "serve", description: "Serve" };
			const files = renderSkill(manifest, meta);
			const serve = findFile(files, "commands/serve.md");

			expect(serve?.content).toContain("Default: `3000`");
		});

		it("renders a flags table with aliases and defaults", () => {
			const cmd = defineCommand({
				meta: { name: "build" },
				flags: {
					verbose: {
						type: "boolean",
						description: "Enable verbose output",
						alias: "v",
					},
					output: {
						type: "string",
						description: "Output directory",
						alias: "o",
						default: "dist",
					},
					target: {
						type: "string",
						required: true,
						description: "Build target",
					},
				},
				run() {},
			});

			const manifest = buildManifest(cmd);
			const meta: SkillMeta = { name: "build", description: "Build" };
			const files = renderSkill(manifest, meta);
			const build = findFile(files, "commands/build.md");

			expect(build?.content).toContain("## Flags");
			expect(build?.content).toContain("`--output`, `-o`");
			expect(build?.content).toContain("`--verbose`, `-v`");
			expect(build?.content).toContain("`--target`");
			expect(build?.content).toContain("Default: `dist`");
			expect(build?.content).toContain("| Yes |");
		});

		it("renders multiple flag indicator", () => {
			const cmd = defineCommand({
				meta: { name: "lint" },
				flags: {
					ignore: {
						type: "string",
						multiple: true,
						description: "Patterns to ignore",
					},
				},
				run() {},
			});

			const manifest = buildManifest(cmd);
			const meta: SkillMeta = { name: "lint", description: "Lint" };
			const files = renderSkill(manifest, meta);
			const lint = findFile(files, "commands/lint.md");

			expect(lint?.content).toContain("Can be specified multiple times");
		});

		it("renders variadic args in usage line", () => {
			const cmd = defineCommand({
				meta: { name: "install" },
				args: [
					{
						name: "packages",
						type: "string",
						variadic: true,
						required: true,
					},
				] as const,
				run() {},
			});

			const manifest = buildManifest(cmd);
			const meta: SkillMeta = { name: "install", description: "Install" };
			const files = renderSkill(manifest, meta);
			const install = findFile(files, "commands/install.md");

			expect(install?.content).toContain("install <packages...>");
		});

		it("renders navigation with link to command index", () => {
			const cmd = defineCommand({
				meta: { name: "serve" },
				run() {},
			});

			const manifest = buildManifest(cmd);
			const meta: SkillMeta = { name: "serve", description: "Serve" };
			const files = renderSkill(manifest, meta);
			const serve = findFile(files, "commands/serve.md");

			expect(serve?.content).toContain("[Command Index]");
			expect(serve?.content).toContain("command-index.md");
		});

		it("renders navigation with link to parent command", () => {
			const add = defineCommand({
				meta: { name: "add", description: "Add a remote" },
				run() {},
			});
			const remote = defineCommand({
				meta: { name: "remote", description: "Manage remotes" },
				subCommands: { add },
			});
			const root = defineCommand({
				meta: { name: "git" },
				subCommands: { remote },
			});

			const manifest = buildManifest(root);
			const meta: SkillMeta = { name: "git", description: "Git" };
			const files = renderSkill(manifest, meta);
			const addFile = findFile(files, "commands/remote/add.md");

			expect(addFile?.content).toContain("Parent:");
			expect(addFile?.content).toContain("`git remote`");
		});

		it("omits arguments section when command has no args", () => {
			const cmd = defineCommand({
				meta: { name: "serve" },
				run() {},
			});

			const manifest = buildManifest(cmd);
			const meta: SkillMeta = { name: "serve", description: "Serve" };
			const files = renderSkill(manifest, meta);
			const serve = findFile(files, "commands/serve.md");

			expect(serve?.content).not.toContain("## Arguments");
		});

		it("omits flags section when command has no flags", () => {
			const cmd = defineCommand({
				meta: { name: "serve" },
				run() {},
			});

			const manifest = buildManifest(cmd);
			const meta: SkillMeta = { name: "serve", description: "Serve" };
			const files = renderSkill(manifest, meta);
			const serve = findFile(files, "commands/serve.md");

			expect(serve?.content).not.toContain("## Flags");
		});

		it("renders dash in description cell when arg has no description or default", () => {
			const cmd = defineCommand({
				meta: { name: "test" },
				args: [{ name: "file", type: "string" }] as const,
				run() {},
			});

			const manifest = buildManifest(cmd);
			const meta: SkillMeta = { name: "test", description: "Test" };
			const files = renderSkill(manifest, meta);
			const test = findFile(files, "commands/test.md");

			expect(test?.content).toContain("| `file` | string | No | - |");
		});

		it("renders dash in description cell when flag has no description or default", () => {
			const cmd = defineCommand({
				meta: { name: "test" },
				flags: {
					quiet: { type: "boolean" },
				},
				run() {},
			});

			const manifest = buildManifest(cmd);
			const meta: SkillMeta = { name: "test", description: "Test" };
			const files = renderSkill(manifest, meta);
			const test = findFile(files, "commands/test.md");

			expect(test?.content).toContain("| `--quiet` | boolean | No | - |");
		});
	});

	// ────────────────────────────────────────────────────────────────────────
	// Group command files
	// ────────────────────────────────────────────────────────────────────────

	describe("group command files", () => {
		it("lists subcommands with links", () => {
			const add = defineCommand({
				meta: { name: "add", description: "Add a remote" },
				run() {},
			});
			const remove = defineCommand({
				meta: { name: "remove", description: "Remove a remote" },
				run() {},
			});
			const remote = defineCommand({
				meta: { name: "remote", description: "Manage remotes" },
				subCommands: { add, remove },
			});
			const root = defineCommand({
				meta: { name: "git" },
				subCommands: { remote },
			});

			const manifest = buildManifest(root);
			const meta: SkillMeta = { name: "git", description: "Git" };
			const files = renderSkill(manifest, meta);
			const remoteFile = findFile(files, "commands/remote.md");

			expect(remoteFile?.content).toContain("## Subcommands");
			expect(remoteFile?.content).toContain("[`add`]");
			expect(remoteFile?.content).toContain("[`remove`]");
			expect(remoteFile?.content).toContain("Add a remote");
			expect(remoteFile?.content).toContain("Remove a remote");
		});

		it("includes usage section when group is also runnable", () => {
			const sub = defineCommand({
				meta: { name: "sub" },
				run() {},
			});
			const parent = defineCommand({
				meta: { name: "parent", description: "Parent command" },
				flags: {
					verbose: {
						type: "boolean",
						description: "Enable verbose output",
					},
				},
				subCommands: { sub },
				run() {},
			});

			const manifest = buildManifest(parent);
			const meta: SkillMeta = { name: "parent", description: "Parent" };
			const files = renderSkill(manifest, meta);
			const parentFile = findFile(files, "commands/parent.md");

			expect(parentFile?.content).toContain("## Usage");
			expect(parentFile?.content).toContain("## Flags");
			expect(parentFile?.content).toContain("## Subcommands");
		});

		it("omits usage/args/flags sections when group is not runnable", () => {
			const sub = defineCommand({
				meta: { name: "sub" },
				run() {},
			});
			const parent = defineCommand({
				meta: { name: "parent", description: "Parent command" },
				subCommands: { sub },
			});

			const manifest = buildManifest(parent);
			const meta: SkillMeta = { name: "parent", description: "Parent" };
			const files = renderSkill(manifest, meta);
			const parentFile = findFile(files, "commands/parent.md");

			expect(parentFile?.content).not.toContain("## Usage");
			expect(parentFile?.content).not.toContain("## Arguments");
			expect(parentFile?.content).not.toContain("## Flags");
			expect(parentFile?.content).toContain("## Subcommands");
		});

		it("uses relative links to child command files", () => {
			const add = defineCommand({
				meta: { name: "add" },
				run() {},
			});
			const remote = defineCommand({
				meta: { name: "remote" },
				subCommands: { add },
			});
			const root = defineCommand({
				meta: { name: "git" },
				subCommands: { remote },
			});

			const manifest = buildManifest(root);
			const meta: SkillMeta = { name: "git", description: "Git" };
			const files = renderSkill(manifest, meta);
			const remoteFile = findFile(files, "commands/remote.md");

			// commands/remote.md → commands/remote/add.md should be "remote/add.md"
			expect(remoteFile?.content).toContain("(remote/add.md)");
		});
	});

	// ────────────────────────────────────────────────────────────────────────
	// Link integrity
	// ────────────────────────────────────────────────────────────────────────

	describe("link integrity", () => {
		it("all file references in SKILL.md point to existing files", () => {
			const serve = defineCommand({
				meta: { name: "serve", description: "Start server" },
				run() {},
			});
			const build = defineCommand({
				meta: { name: "build", description: "Build project" },
				run() {},
			});
			const root = defineCommand({
				meta: { name: "app", description: "App CLI" },
				subCommands: { serve, build },
			});

			const manifest = buildManifest(root);
			const meta: SkillMeta = { name: "app", description: "App CLI" };
			const files = renderSkill(manifest, meta);
			const allPaths = new Set(files.map((f) => f.path));

			const skill = findFile(files, "SKILL.md");
			expect(skill).toBeDefined();

			// Extract markdown link targets (non-relative only)
			const linkRegex = /\]\(([^)]+)\)/g;
			const links: string[] = [];
			let match: RegExpExecArray | null = null;
			// biome-ignore lint/suspicious/noAssignInExpressions: standard regex exec loop pattern
			while ((match = linkRegex.exec(skill?.content ?? "")) !== null) {
				const target = match[1];
				if (target && !target.startsWith("http") && !target.startsWith("#")) {
					links.push(target);
				}
			}

			for (const link of links) {
				expect(allPaths.has(link)).toBe(true);
			}
		});

		it("command-index.md references all generated command files", () => {
			const add = defineCommand({
				meta: { name: "add" },
				run() {},
			});
			const remote = defineCommand({
				meta: { name: "remote" },
				subCommands: { add },
			});
			const root = defineCommand({
				meta: { name: "git" },
				subCommands: { remote },
			});

			const manifest = buildManifest(root);
			const meta: SkillMeta = { name: "git", description: "Git" };
			const files = renderSkill(manifest, meta);
			const index = findFile(files, "command-index.md");
			const commandFiles = files
				.filter((f) => f.path.startsWith("commands/"))
				.map((f) => f.path);

			for (const cmdPath of commandFiles) {
				expect(index?.content).toContain(cmdPath);
			}
		});
	});

	// ────────────────────────────────────────────────────────────────────────
	// Deterministic output
	// ────────────────────────────────────────────────────────────────────────

	describe("deterministic output", () => {
		it("produces identical output from the same input", () => {
			const serve = defineCommand({
				meta: { name: "serve", description: "Start server" },
				args: [{ name: "port", type: "number", default: 3000 }] as const,
				flags: {
					watch: { type: "boolean", alias: "w" },
					host: { type: "string", default: "localhost" },
				},
				run() {},
			});
			const build = defineCommand({
				meta: { name: "build", description: "Build project" },
				flags: {
					minify: { type: "boolean" },
					outdir: { type: "string", default: "dist" },
				},
				run() {},
			});
			const root = defineCommand({
				meta: { name: "app", description: "App CLI" },
				subCommands: { serve, build },
			});

			const manifest = buildManifest(root);
			const meta: SkillMeta = {
				name: "app",
				description: "App CLI",
				version: "1.0.0",
			};

			const first = renderSkill(manifest, meta);
			const second = renderSkill(manifest, meta);

			expect(first.length).toBe(second.length);
			for (let i = 0; i < first.length; i++) {
				expect(first[i]?.path).toBe(second[i]?.path);
				expect(first[i]?.content).toBe(second[i]?.content);
			}
		});
	});

	// ────────────────────────────────────────────────────────────────────────
	// Complex fixture — full command tree
	// ────────────────────────────────────────────────────────────────────────

	describe("complex command tree fixture", () => {
		it("renders a realistic git-like CLI correctly", () => {
			const clone = defineCommand({
				meta: { name: "clone", description: "Clone a repository" },
				args: [
					{
						name: "url",
						type: "string",
						required: true,
						description: "Repository URL",
					},
					{
						name: "directory",
						type: "string",
						description: "Target directory",
					},
				] as const,
				flags: {
					branch: {
						type: "string",
						alias: "b",
						description: "Branch to clone",
					},
					depth: { type: "number", description: "Shallow clone depth" },
					bare: { type: "boolean", description: "Create a bare repository" },
				},
				run() {},
			});

			const remoteAdd = defineCommand({
				meta: { name: "add", description: "Add a remote" },
				args: [
					{ name: "name", type: "string", required: true },
					{ name: "url", type: "string", required: true },
				] as const,
				run() {},
			});

			const remoteRemove = defineCommand({
				meta: { name: "remove", description: "Remove a remote" },
				args: [{ name: "name", type: "string", required: true }] as const,
				run() {},
			});

			const remote = defineCommand({
				meta: { name: "remote", description: "Manage remotes" },
				flags: { verbose: { type: "boolean", alias: "v" } },
				subCommands: { add: remoteAdd, remove: remoteRemove },
				run() {},
			});

			const root = defineCommand({
				meta: {
					name: "git",
					description: "A distributed version control system",
				},
				subCommands: { clone, remote },
			});

			const manifest = buildManifest(root);
			const meta: SkillMeta = {
				name: "git",
				description:
					"A distributed version control system. Use when working with git repositories.",
				version: "2.0.0",
			};
			const files = renderSkill(manifest, meta);

			// Verify file count: SKILL.md + command-index.md + 5 commands
			// (git, clone, remote, remote/add, remote/remove)
			expect(files).toHaveLength(7);

			// Verify all expected files exist
			const paths = files.map((f) => f.path).sort();
			expect(paths).toEqual([
				"SKILL.md",
				"command-index.md",
				"commands/clone.md",
				"commands/git.md",
				"commands/remote.md",
				"commands/remote/add.md",
				"commands/remote/remove.md",
			]);

			// Verify SKILL.md frontmatter
			const skill = findFile(files, "SKILL.md");
			expect(skill?.content).toContain("name: git");
			expect(skill?.content).toContain('version: "2.0.0"');
			expect(skill?.content).toContain("[`clone`](commands/clone.md)");
			expect(skill?.content).toContain("[`remote`](commands/remote.md)");

			// Verify clone leaf command has args and flags
			const cloneFile = findFile(files, "commands/clone.md");
			expect(cloneFile?.content).toContain("# `git clone`");
			expect(cloneFile?.content).toContain("## Arguments");
			expect(cloneFile?.content).toContain("## Flags");
			expect(cloneFile?.content).toContain("`--branch`, `-b`");
			expect(cloneFile?.content).toContain(
				"git clone <url> [directory] [options]",
			);

			// Verify remote is rendered as group (has children) but also runnable
			const remoteFile = findFile(files, "commands/remote.md");
			expect(remoteFile?.content).toContain("# `git remote`");
			expect(remoteFile?.content).toContain("## Usage");
			expect(remoteFile?.content).toContain("## Subcommands");
			expect(remoteFile?.content).toContain("[`add`]");
			expect(remoteFile?.content).toContain("[`remove`]");

			// Verify deep nested command has parent link
			const addFile = findFile(files, "commands/remote/add.md");
			expect(addFile?.content).toContain("# `git remote add`");
			expect(addFile?.content).toContain("Parent:");
			expect(addFile?.content).toContain("`git remote`");
		});
	});

	// ────────────────────────────────────────────────────────────────────────
	// Edge cases
	// ────────────────────────────────────────────────────────────────────────

	describe("edge cases", () => {
		it("handles root command with no description", () => {
			const cmd = defineCommand({
				meta: { name: "app" },
				run() {},
			});

			const manifest = buildManifest(cmd);
			const meta: SkillMeta = { name: "app", description: "An app" };
			const files = renderSkill(manifest, meta);

			expect(files.length).toBeGreaterThan(0);
			const skill = findFile(files, "SKILL.md");
			expect(skill).toBeDefined();
		});

		it("handles deeply nested commands (4 levels)", () => {
			const deep = defineCommand({
				meta: { name: "deep", description: "Deep command" },
				run() {},
			});
			const level3 = defineCommand({
				meta: { name: "level3" },
				subCommands: { deep },
			});
			const level2 = defineCommand({
				meta: { name: "level2" },
				subCommands: { level3 },
			});
			const root = defineCommand({
				meta: { name: "root" },
				subCommands: { level2 },
			});

			const manifest = buildManifest(root);
			const meta: SkillMeta = { name: "root", description: "Root" };
			const files = renderSkill(manifest, meta);

			const deepFile = findFile(files, "commands/level2/level3/deep.md");
			expect(deepFile).toBeDefined();
			expect(deepFile?.content).toContain("# `root level2 level3 deep`");
			expect(deepFile?.content).toContain("Parent:");
			expect(deepFile?.content).toContain("`root level2 level3`");
		});

		it("handles command with description containing special markdown characters", () => {
			const cmd = defineCommand({
				meta: {
					name: "test",
					description: "Use `--flag` to enable | disable features",
				},
				run() {},
			});

			const manifest = buildManifest(cmd);
			const meta: SkillMeta = { name: "test", description: "Test tool" };
			const files = renderSkill(manifest, meta);
			const test = findFile(files, "commands/test.md");

			expect(test?.content).toContain(
				"Use `--flag` to enable | disable features",
			);
		});

		it("root command file does not have parent navigation", () => {
			const cmd = defineCommand({
				meta: { name: "app" },
				run() {},
			});

			const manifest = buildManifest(cmd);
			const meta: SkillMeta = { name: "app", description: "App" };
			const files = renderSkill(manifest, meta);
			const app = findFile(files, "commands/app.md");

			expect(app?.content).not.toContain("Parent:");
		});
	});
});
