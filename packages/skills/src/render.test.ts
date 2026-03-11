import { describe, expect, it } from "bun:test";
import type { ArgDef, CommandNode, FlagDef } from "@crustjs/core";
import { Crust } from "@crustjs/core";
import { annotate } from "./annotations.ts";
import { buildManifest } from "./manifest.ts";
import { renderSkill } from "./render.ts";
import type { ManifestNode, RenderedFile, SkillMeta } from "./types.ts";

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

const baseMeta: SkillMeta = {
	name: "test-cli",
	description: "A test CLI tool",
	version: "1.0.0",
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
 * Builds a simple manifest from a makeCommand call for testing.
 */
function buildSimpleManifest(): ManifestNode {
	const cmd = makeCommand({
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

		it("always includes SKILL.md", () => {
			const manifest = buildSimpleManifest();
			const files = renderSkill(manifest, baseMeta);

			const paths = files.map((f) => f.path);
			expect(paths).toContain("SKILL.md");
			expect(paths).not.toContain("command-index.md");
		});

		it("produces one command file for a root-only command", () => {
			const manifest = buildSimpleManifest();
			const files = renderSkill(manifest, baseMeta);

			const commandFiles = files.filter((f) => f.path.startsWith("commands/"));
			expect(commandFiles).toHaveLength(1);
			expect(commandFiles[0]?.path).toBe("commands/test-cli.md");
		});

		it("produces command files mirroring the command hierarchy", () => {
			const add = makeCommand({
				meta: { name: "add", description: "Add a remote" },
				run() {},
			});
			const remove = makeCommand({
				meta: { name: "remove", description: "Remove a remote" },
				run() {},
			});
			const remote = makeCommand({
				meta: { name: "remote", description: "Manage remotes" },
				subCommands: { add, remove },
			});
			const root = makeCommand({
				meta: { name: "git", description: "Version control" },
				subCommands: { remote },
			});

			const manifest = buildManifest(root);
			const meta: SkillMeta = {
				name: "git",
				description: "Version control",
				version: "1.0.0",
			};
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

		it("always includes metadata block with required version", () => {
			const manifest = buildSimpleManifest();
			const files = renderSkill(manifest, baseMeta);
			const skill = findFile(files, "SKILL.md");

			expect(skill?.content).toContain("metadata:");
			expect(skill?.content).toContain('  version: "1.0.0"');
		});

		it("includes the manifest description in the body", () => {
			const manifest = buildSimpleManifest();
			const files = renderSkill(manifest, baseMeta);
			const skill = findFile(files, "SKILL.md");

			expect(skill?.content).toContain("A test CLI tool");
		});

		it("includes a command reference table", () => {
			const manifest = buildSimpleManifest();
			const files = renderSkill(manifest, baseMeta);
			const skill = findFile(files, "SKILL.md");

			expect(skill?.content).toContain("| Command | Type | Documentation |");
			expect(skill?.content).toContain("| `test-cli` | runnable |");
		});

		it("includes nested commands in SKILL.md command reference", () => {
			const serve = makeCommand({
				meta: { name: "serve", description: "Start server" },
				run() {},
			});
			const build = makeCommand({
				meta: { name: "build", description: "Build project" },
				run() {},
			});
			const root = makeCommand({
				meta: { name: "app", description: "App CLI" },
				subCommands: { serve, build },
			});

			const manifest = buildManifest(root);
			const meta: SkillMeta = {
				name: "app",
				description: "App CLI",
				version: "1.0.0",
			};
			const files = renderSkill(manifest, meta);
			const skill = findFile(files, "SKILL.md");

			expect(skill?.content).toContain("| `app` | group |");
			expect(skill?.content).toContain("| `app build` | runnable |");
			expect(skill?.content).toContain("| `app serve` | runnable |");
		});

		it("includes usage section when root is runnable", () => {
			const manifest = buildSimpleManifest();
			const files = renderSkill(manifest, baseMeta);
			const skill = findFile(files, "SKILL.md");

			expect(skill?.content).toContain("## Usage");
			expect(skill?.content).toContain("root command is directly executable");
		});

		it("omits usage section when root is not runnable", () => {
			const child = makeCommand({
				meta: { name: "child" },
				run() {},
			});
			const root = makeCommand({
				meta: { name: "app", description: "App" },
				subCommands: { child },
			});

			const manifest = buildManifest(root);
			const meta: SkillMeta = {
				name: "app",
				description: "App",
				version: "1.0.0",
			};
			const files = renderSkill(manifest, meta);
			const skill = findFile(files, "SKILL.md");

			// Should not contain the runnable usage section
			expect(skill?.content).not.toContain(
				"root command is directly executable",
			);
		});

		it("includes command-reference workflow instructions", () => {
			const manifest = buildSimpleManifest();
			const files = renderSkill(manifest, baseMeta);
			const skill = findFile(files, "SKILL.md");

			expect(skill?.content).toContain("## How to Use This Skill");
			expect(skill?.content).toContain("## Command Reference");
			expect(skill?.content).toContain(
				"Use this table to locate the command file you need.",
			);
			expect(skill?.content).not.toContain(
				"This table maps each command to its documentation file.",
			);
			expect(skill?.content).not.toContain(
				"Read only the files you need for the current task",
			);
			expect(skill?.content).toContain("Find the command that best matches");
			expect(skill?.content).toContain(
				"Check the `Type` column before suggesting execution",
			);
			expect(skill?.content).toContain(
				"Before answering a command-specific question or suggesting a command, read that command's file",
			);
			expect(skill?.content).toContain(
				"Treat the command file as the source of truth",
			);
			expect(skill?.content).toContain(
				"say it is not documented instead of guessing",
			);
		});

		it("includes when-to-use guidance", () => {
			const manifest = buildSimpleManifest();
			const files = renderSkill(manifest, baseMeta);
			const skill = findFile(files, "SKILL.md");

			expect(skill?.content).toContain(
				"Use this skill when you need accurate help with `test-cli` commands",
			);
		});

		it("renders additional top-level instructions when provided", () => {
			const manifest = buildSimpleManifest();
			const files = renderSkill(manifest, {
				...baseMeta,
				instructions: [
					"Prefer readonly commands before making changes.",
					"Ask for confirmation before destructive actions.",
				],
			});
			const skill = findFile(files, "SKILL.md");

			expect(skill?.content).toContain("## General Guidance");
			expect(skill?.content).toContain(
				"- Prefer readonly commands before making changes.",
			);
			expect(skill?.content).toContain(
				"- Ask for confirmation before destructive actions.",
			);
		});

		it("renders top-level instructions from a markdown string", () => {
			const manifest = buildSimpleManifest();
			const files = renderSkill(manifest, {
				...baseMeta,
				instructions: `Read the command docs before answering.

## Response Policy

- Prefer exact documented flags.`,
			});
			const skill = findFile(files, "SKILL.md");

			expect(skill?.content).toContain("## General Guidance");
			expect(skill?.content).toContain(
				"Read the command docs before answering.",
			);
			expect(skill?.content).toContain("## Response Policy");
			expect(skill?.content).toContain("- Prefer exact documented flags.");
		});

		it("omits additional instructions for a whitespace-only markdown string", () => {
			const manifest = buildSimpleManifest();
			const files = renderSkill(manifest, {
				...baseMeta,
				instructions: "   ",
			});
			const skill = findFile(files, "SKILL.md");

			expect(skill?.content).not.toContain("## General Guidance");
		});

		it("omits additional instructions for a whitespace-only array", () => {
			const manifest = buildSimpleManifest();
			const files = renderSkill(manifest, {
				...baseMeta,
				instructions: ["", "  "],
			});
			const skill = findFile(files, "SKILL.md");

			expect(skill?.content).not.toContain("## General Guidance");
		});

		it("trims and filters top-level instruction list items", () => {
			const manifest = buildSimpleManifest();
			const files = renderSkill(manifest, {
				...baseMeta,
				instructions: ["  first  ", "", "second"],
			});
			const skill = findFile(files, "SKILL.md");

			expect(skill?.content).toContain("## General Guidance");
			expect(skill?.content).toContain("- first");
			expect(skill?.content).toContain("- second");
			expect(skill?.content).not.toContain("- ");
		});

		it("strips use- prefix from CLI name in when-to-use text", () => {
			const manifest = buildSimpleManifest();
			const meta: SkillMeta = {
				...baseMeta,
				name: "use-my-tool",
			};
			const files = renderSkill(manifest, meta);
			const skill = findFile(files, "SKILL.md");

			expect(skill?.content).toContain(
				"Use this skill when you need accurate help with `my-tool` commands",
			);
		});

		it("escapes YAML-special characters in description", () => {
			const manifest = buildSimpleManifest();
			const meta: SkillMeta = {
				...baseMeta,
				description: 'Deploy: the "app" to {production}',
			};
			const files = renderSkill(manifest, meta);
			const skill = findFile(files, "SKILL.md");

			// Should be wrapped in double quotes with internal quotes escaped
			expect(skill?.content).toContain(
				'description: "Deploy: the \\"app\\" to {production}"',
			);
		});

		it("does not quote YAML values that are safe plain scalars", () => {
			const manifest = buildSimpleManifest();
			const files = renderSkill(manifest, baseMeta);
			const skill = findFile(files, "SKILL.md");

			// "A test CLI tool" has no special chars — should not be quoted
			expect(skill?.content).toContain("description: A test CLI tool");
		});

		it("renders license field when provided", () => {
			const manifest = buildSimpleManifest();
			const meta: SkillMeta = {
				...baseMeta,
				license: "MIT",
			};
			const files = renderSkill(manifest, meta);
			const skill = findFile(files, "SKILL.md");

			expect(skill?.content).toContain("license: MIT");
		});

		it("renders compatibility field when provided", () => {
			const manifest = buildSimpleManifest();
			const meta: SkillMeta = {
				...baseMeta,
				compatibility: "Requires test-cli on PATH",
			};
			const files = renderSkill(manifest, meta);
			const skill = findFile(files, "SKILL.md");

			expect(skill?.content).toContain(
				"compatibility: Requires test-cli on PATH",
			);
		});

		it("renders disable-model-invocation when true", () => {
			const manifest = buildSimpleManifest();
			const meta: SkillMeta = {
				...baseMeta,
				disableModelInvocation: true,
			};
			const files = renderSkill(manifest, meta);
			const skill = findFile(files, "SKILL.md");

			expect(skill?.content).toContain("disable-model-invocation: true");
		});

		it("omits disable-model-invocation when false or unset", () => {
			const manifest = buildSimpleManifest();
			const files = renderSkill(manifest, baseMeta);
			const skill = findFile(files, "SKILL.md");

			expect(skill?.content).not.toContain("disable-model-invocation");
		});

		it("renders allowed-tools when provided", () => {
			const manifest = buildSimpleManifest();
			const meta: SkillMeta = {
				...baseMeta,
				allowedTools: "Bash(test-cli *) Read Grep",
			};
			const files = renderSkill(manifest, meta);
			const skill = findFile(files, "SKILL.md");

			// The value contains special YAML chars (* and parentheses),
			// so it gets escaped with double quotes
			expect(skill?.content).toContain(
				'allowed-tools: "Bash(test-cli *) Read Grep"',
			);
		});

		it("omits optional fields when not provided", () => {
			const manifest = buildSimpleManifest();
			const files = renderSkill(manifest, baseMeta);
			const skill = findFile(files, "SKILL.md");

			expect(skill?.content).not.toContain("license:");
			expect(skill?.content).not.toContain("compatibility:");
			expect(skill?.content).not.toContain("allowed-tools:");
		});
	});

	// ────────────────────────────────────────────────────────────────────────
	// SKILL.md command reference content
	// ────────────────────────────────────────────────────────────────────────

	describe("SKILL.md command reference content", () => {
		it("includes a markdown table header", () => {
			const manifest = buildSimpleManifest();
			const files = renderSkill(manifest, baseMeta);
			const skill = findFile(files, "SKILL.md");

			expect(skill).toBeDefined();
			expect(skill?.content).toContain("## Command Reference");
			expect(skill?.content).toContain("| Command | Type | Documentation |");
		});

		it("lists all commands with correct paths", () => {
			const serve = makeCommand({
				meta: { name: "serve", description: "Start server" },
				run() {},
			});
			const root = makeCommand({
				meta: { name: "app", description: "App CLI" },
				subCommands: { serve },
			});

			const manifest = buildManifest(root);
			const meta: SkillMeta = {
				name: "app",
				description: "App CLI",
				version: "1.0.0",
			};
			const files = renderSkill(manifest, meta);
			const skill = findFile(files, "SKILL.md");

			expect(skill?.content).toContain("`app`");
			expect(skill?.content).toContain("`app serve`");
			expect(skill?.content).toContain("commands/app.md");
			expect(skill?.content).toContain("commands/serve.md");
		});

		it("shows correct type labels for runnable vs group", () => {
			const leaf = makeCommand({
				meta: { name: "leaf" },
				run() {},
			});
			const group = makeCommand({
				meta: { name: "group" },
				subCommands: { leaf },
			});
			const hybrid = makeCommand({
				meta: { name: "hybrid" },
				subCommands: { group },
				run() {},
			});

			const manifest = buildManifest(hybrid);
			const meta: SkillMeta = {
				name: "hybrid",
				description: "Test",
				version: "1.0.0",
			};
			const files = renderSkill(manifest, meta);
			const skill = findFile(files, "SKILL.md");

			// hybrid is both runnable and has children
			expect(skill?.content).toContain("| `hybrid` | runnable, group |");
			// group has children but is not runnable
			expect(skill?.content).toContain("| `hybrid group` | group |");
			// leaf is runnable with no children
			expect(skill?.content).toContain("| `hybrid group leaf` | runnable |");
		});
	});

	// ────────────────────────────────────────────────────────────────────────
	// Leaf command files
	// ────────────────────────────────────────────────────────────────────────

	describe("leaf command files", () => {
		it("renders a heading with full invocation", () => {
			const cmd = makeCommand({
				meta: { name: "deploy", description: "Deploy the app" },
				run() {},
			});
			const root = makeCommand({
				meta: { name: "app" },
				subCommands: { deploy: cmd },
			});

			const manifest = buildManifest(root);
			const meta: SkillMeta = {
				name: "app",
				description: "App",
				version: "1.0.0",
			};
			const files = renderSkill(manifest, meta);
			const deploy = findFile(files, "commands/deploy.md");

			expect(deploy).toBeDefined();
			expect(deploy?.content).toContain("# `app deploy`");
		});

		it("renders description when present", () => {
			const cmd = makeCommand({
				meta: { name: "serve", description: "Start the dev server" },
				run() {},
			});

			const manifest = buildManifest(cmd);
			const meta: SkillMeta = {
				name: "serve",
				description: "Server",
				version: "1.0.0",
			};
			const files = renderSkill(manifest, meta);
			const serve = findFile(files, "commands/serve.md");

			expect(serve?.content).toContain("Start the dev server");
		});

		it("renders auto-generated usage line", () => {
			const cmd = makeCommand({
				meta: { name: "deploy" },
				args: [
					{ name: "env", type: "string", required: true },
					{ name: "tag", type: "string" },
				] as ArgDef[],
				flags: {
					force: { type: "boolean" },
				},
				run() {},
			});
			const root = makeCommand({
				meta: { name: "app" },
				subCommands: { deploy: cmd },
			});

			const manifest = buildManifest(root);
			const meta: SkillMeta = {
				name: "app",
				description: "App",
				version: "1.0.0",
			};
			const files = renderSkill(manifest, meta);
			const deploy = findFile(files, "commands/deploy.md");

			expect(deploy?.content).toContain("app deploy <env> [tag] [options]");
		});

		it("renders custom usage when provided", () => {
			const cmd = makeCommand({
				meta: {
					name: "build",
					usage: "build [--watch] [entry...]",
				},
				run() {},
			});

			const manifest = buildManifest(cmd);
			const meta: SkillMeta = {
				name: "build",
				description: "Build",
				version: "1.0.0",
			};
			const files = renderSkill(manifest, meta);
			const build = findFile(files, "commands/build.md");

			expect(build?.content).toContain("build [--watch] [entry...]");
		});

		it("renders an arguments table with required/optional/variadic", () => {
			const cmd = makeCommand({
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
				] as ArgDef[],
				run() {},
			});

			const manifest = buildManifest(cmd);
			const meta: SkillMeta = {
				name: "copy",
				description: "Copy",
				version: "1.0.0",
			};
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
			const cmd = makeCommand({
				meta: { name: "serve" },
				args: [
					{
						name: "port",
						type: "number",
						default: 3000,
						description: "Port number",
					},
				] as ArgDef[],
				run() {},
			});

			const manifest = buildManifest(cmd);
			const meta: SkillMeta = {
				name: "serve",
				description: "Serve",
				version: "1.0.0",
			};
			const files = renderSkill(manifest, meta);
			const serve = findFile(files, "commands/serve.md");

			expect(serve?.content).toContain("Default: `3000`");
		});

		it("renders a flags table with aliases and defaults", () => {
			const cmd = makeCommand({
				meta: { name: "build" },
				flags: {
					verbose: {
						type: "boolean",
						description: "Enable verbose output",
						short: "v",
					},
					output: {
						type: "string",
						description: "Output directory",
						short: "o",
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
			const meta: SkillMeta = {
				name: "build",
				description: "Build",
				version: "1.0.0",
			};
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
			const cmd = makeCommand({
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
			const meta: SkillMeta = {
				name: "lint",
				description: "Lint",
				version: "1.0.0",
			};
			const files = renderSkill(manifest, meta);
			const lint = findFile(files, "commands/lint.md");

			expect(lint?.content).toContain("Can be specified multiple times");
		});

		it("renders variadic args in usage line", () => {
			const cmd = makeCommand({
				meta: { name: "install" },
				args: [
					{
						name: "packages",
						type: "string",
						variadic: true,
						required: true,
					},
				] as ArgDef[],
				run() {},
			});

			const manifest = buildManifest(cmd);
			const meta: SkillMeta = {
				name: "install",
				description: "Install",
				version: "1.0.0",
			};
			const files = renderSkill(manifest, meta);
			const install = findFile(files, "commands/install.md");

			expect(install?.content).toContain("install <packages...>");
		});

		it("renders navigation with link to SKILL.md", () => {
			const cmd = makeCommand({
				meta: { name: "serve" },
				run() {},
			});

			const manifest = buildManifest(cmd);
			const meta: SkillMeta = {
				name: "serve",
				description: "Serve",
				version: "1.0.0",
			};
			const files = renderSkill(manifest, meta);
			const serve = findFile(files, "commands/serve.md");

			expect(serve?.content).toContain("[Skill Overview]");
			expect(serve?.content).toContain("SKILL.md");
		});

		it("renders agent instructions for annotated leaf commands", () => {
			const cmd = annotate(
				makeCommand({
					meta: { name: "deploy" },
					run() {},
				}),
				[
					"Prefer preview flags before executing changes.",
					"Call out risky production operations explicitly.",
				],
			);

			const manifest = buildManifest(cmd);
			const files = renderSkill(manifest, {
				name: "deploy",
				description: "Deploy",
				version: "1.0.0",
			});
			const deploy = findFile(files, "commands/deploy.md");

			expect(deploy?.content).toContain("## Instructions");
			expect(deploy?.content).toContain(
				"- Prefer preview flags before executing changes.",
			);
			expect(deploy?.content).toContain(
				"- Call out risky production operations explicitly.",
			);
		});

		it("includes command authority instructions in leaf command files", () => {
			const cmd = makeCommand({
				meta: { name: "serve" },
				run() {},
			});

			const manifest = buildManifest(cmd);
			const meta: SkillMeta = {
				name: "serve",
				description: "Serve",
				version: "1.0.0",
			};
			const files = renderSkill(manifest, meta);
			const serve = findFile(files, "commands/serve.md");

			expect(serve?.content).toContain("## Command Documentation Authority");
			expect(serve?.content).toContain(
				"Only arguments, flags, options, aliases, and defaults documented in this file are supported",
			);
			expect(serve?.content).toContain(
				"Do not infer or invent additional command-line options",
			);
		});

		it("renders navigation with link to parent command", () => {
			const add = makeCommand({
				meta: { name: "add", description: "Add a remote" },
				run() {},
			});
			const remote = makeCommand({
				meta: { name: "remote", description: "Manage remotes" },
				subCommands: { add },
			});
			const root = makeCommand({
				meta: { name: "git" },
				subCommands: { remote },
			});

			const manifest = buildManifest(root);
			const meta: SkillMeta = {
				name: "git",
				description: "Git",
				version: "1.0.0",
			};
			const files = renderSkill(manifest, meta);
			const addFile = findFile(files, "commands/remote/add.md");

			expect(addFile?.content).toContain("Parent:");
			expect(addFile?.content).toContain("`git remote`");
		});

		it("omits arguments section when command has no args", () => {
			const cmd = makeCommand({
				meta: { name: "serve" },
				run() {},
			});

			const manifest = buildManifest(cmd);
			const meta: SkillMeta = {
				name: "serve",
				description: "Serve",
				version: "1.0.0",
			};
			const files = renderSkill(manifest, meta);
			const serve = findFile(files, "commands/serve.md");

			expect(serve?.content).not.toContain("## Arguments");
		});

		it("omits flags section when command has no flags", () => {
			const cmd = makeCommand({
				meta: { name: "serve" },
				run() {},
			});

			const manifest = buildManifest(cmd);
			const meta: SkillMeta = {
				name: "serve",
				description: "Serve",
				version: "1.0.0",
			};
			const files = renderSkill(manifest, meta);
			const serve = findFile(files, "commands/serve.md");

			expect(serve?.content).not.toContain("## Flags");
		});

		it("renders dash in description cell when arg has no description or default", () => {
			const cmd = makeCommand({
				meta: { name: "test" },
				args: [{ name: "file", type: "string" }] as ArgDef[],
				run() {},
			});

			const manifest = buildManifest(cmd);
			const meta: SkillMeta = {
				name: "test",
				description: "Test",
				version: "1.0.0",
			};
			const files = renderSkill(manifest, meta);
			const test = findFile(files, "commands/test.md");

			expect(test?.content).toContain("| `file` | string | No | - |");
		});

		it("renders dash in description cell when flag has no description or default", () => {
			const cmd = makeCommand({
				meta: { name: "test" },
				flags: {
					quiet: { type: "boolean" },
				},
				run() {},
			});

			const manifest = buildManifest(cmd);
			const meta: SkillMeta = {
				name: "test",
				description: "Test",
				version: "1.0.0",
			};
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
			const add = makeCommand({
				meta: { name: "add", description: "Add a remote" },
				run() {},
			});
			const remove = makeCommand({
				meta: { name: "remove", description: "Remove a remote" },
				run() {},
			});
			const remote = makeCommand({
				meta: { name: "remote", description: "Manage remotes" },
				subCommands: { add, remove },
			});
			const root = makeCommand({
				meta: { name: "git" },
				subCommands: { remote },
			});

			const manifest = buildManifest(root);
			const meta: SkillMeta = {
				name: "git",
				description: "Git",
				version: "1.0.0",
			};
			const files = renderSkill(manifest, meta);
			const remoteFile = findFile(files, "commands/remote.md");

			expect(remoteFile?.content).toContain("## Subcommands");
			expect(remoteFile?.content).toContain("[`add`]");
			expect(remoteFile?.content).toContain("[`remove`]");
			expect(remoteFile?.content).toContain("Add a remote");
			expect(remoteFile?.content).toContain("Remove a remote");
		});

		it("includes usage section when group is also runnable", () => {
			const sub = makeCommand({
				meta: { name: "sub" },
				run() {},
			});
			const parent = makeCommand({
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
			const meta: SkillMeta = {
				name: "parent",
				description: "Parent",
				version: "1.0.0",
			};
			const files = renderSkill(manifest, meta);
			const parentFile = findFile(files, "commands/parent.md");

			expect(parentFile?.content).toContain("## Usage");
			expect(parentFile?.content).toContain("## Flags");
			expect(parentFile?.content).toContain(
				"## Command Documentation Authority",
			);
			expect(parentFile?.content).toContain("## Subcommands");
		});

		it("omits usage/args/flags sections when group is not runnable", () => {
			const sub = makeCommand({
				meta: { name: "sub" },
				run() {},
			});
			const parent = makeCommand({
				meta: { name: "parent", description: "Parent command" },
				subCommands: { sub },
			});

			const manifest = buildManifest(parent);
			const meta: SkillMeta = {
				name: "parent",
				description: "Parent",
				version: "1.0.0",
			};
			const files = renderSkill(manifest, meta);
			const parentFile = findFile(files, "commands/parent.md");

			expect(parentFile?.content).not.toContain("## Usage");
			expect(parentFile?.content).not.toContain("## Arguments");
			expect(parentFile?.content).not.toContain("## Flags");
			expect(parentFile?.content).toContain("## Subcommands");
		});

		it("renders agent instructions for annotated group commands", () => {
			const sub = makeCommand({
				meta: { name: "sub" },
				run() {},
			});
			const parent = annotate(
				makeCommand({
					meta: { name: "parent", description: "Parent command" },
					subCommands: { sub },
				}),
				"Read a child command doc before recommending execution details.",
			);

			const manifest = buildManifest(parent);
			const files = renderSkill(manifest, {
				name: "parent",
				description: "Parent",
				version: "1.0.0",
			});
			const parentFile = findFile(files, "commands/parent.md");

			expect(parentFile?.content).toContain("## Instructions");
			expect(parentFile?.content).toContain(
				"- Read a child command doc before recommending execution details.",
			);
		});

		it("uses relative links to child command files", () => {
			const add = makeCommand({
				meta: { name: "add" },
				run() {},
			});
			const remote = makeCommand({
				meta: { name: "remote" },
				subCommands: { add },
			});
			const root = makeCommand({
				meta: { name: "git" },
				subCommands: { remote },
			});

			const manifest = buildManifest(root);
			const meta: SkillMeta = {
				name: "git",
				description: "Git",
				version: "1.0.0",
			};
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
			const serve = makeCommand({
				meta: { name: "serve", description: "Start server" },
				run() {},
			});
			const build = makeCommand({
				meta: { name: "build", description: "Build project" },
				run() {},
			});
			const root = makeCommand({
				meta: { name: "app", description: "App CLI" },
				subCommands: { serve, build },
			});

			const manifest = buildManifest(root);
			const meta: SkillMeta = {
				name: "app",
				description: "App CLI",
				version: "1.0.0",
			};
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

		it("SKILL.md command reference lists all generated command files", () => {
			const add = makeCommand({
				meta: { name: "add" },
				run() {},
			});
			const remote = makeCommand({
				meta: { name: "remote" },
				subCommands: { add },
			});
			const root = makeCommand({
				meta: { name: "git" },
				subCommands: { remote },
			});

			const manifest = buildManifest(root);
			const meta: SkillMeta = {
				name: "git",
				description: "Git",
				version: "1.0.0",
			};
			const files = renderSkill(manifest, meta);
			const skill = findFile(files, "SKILL.md");
			const commandFiles = files
				.filter((f) => f.path.startsWith("commands/"))
				.map((f) => f.path);

			for (const cmdPath of commandFiles) {
				expect(skill?.content).toContain(cmdPath);
			}
		});
	});

	// ────────────────────────────────────────────────────────────────────────
	// Deterministic output
	// ────────────────────────────────────────────────────────────────────────

	describe("deterministic output", () => {
		it("produces identical output from the same input", () => {
			const serve = makeCommand({
				meta: { name: "serve", description: "Start server" },
				args: [{ name: "port", type: "number", default: 3000 }] as ArgDef[],
				flags: {
					watch: { type: "boolean", short: "w" },
					host: { type: "string", default: "localhost" },
				},
				run() {},
			});
			const build = makeCommand({
				meta: { name: "build", description: "Build project" },
				flags: {
					minify: { type: "boolean" },
					outdir: { type: "string", default: "dist" },
				},
				run() {},
			});
			const root = makeCommand({
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
			const clone = makeCommand({
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
				] as ArgDef[],
				flags: {
					branch: {
						type: "string",
						short: "b",
						description: "Branch to clone",
					},
					depth: { type: "number", description: "Shallow clone depth" },
					bare: { type: "boolean", description: "Create a bare repository" },
				},
				run() {},
			});

			const remoteAdd = makeCommand({
				meta: { name: "add", description: "Add a remote" },
				args: [
					{ name: "name", type: "string", required: true },
					{ name: "url", type: "string", required: true },
				] as ArgDef[],
				run() {},
			});

			const remoteRemove = makeCommand({
				meta: { name: "remove", description: "Remove a remote" },
				args: [{ name: "name", type: "string", required: true }] as ArgDef[],
				run() {},
			});

			const remote = makeCommand({
				meta: { name: "remote", description: "Manage remotes" },
				flags: { verbose: { type: "boolean", short: "v" } },
				subCommands: { add: remoteAdd, remove: remoteRemove },
				run() {},
			});

			const root = makeCommand({
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

			// Verify file count: SKILL.md + 5 commands
			// (git, clone, remote, remote/add, remote/remove)
			expect(files).toHaveLength(6);

			// Verify all expected files exist
			const paths = files.map((f) => f.path).sort();
			expect(paths).toEqual([
				"SKILL.md",
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
			expect(skill?.content).toContain(
				"[commands/clone.md](commands/clone.md)",
			);
			expect(skill?.content).toContain(
				"[commands/remote.md](commands/remote.md)",
			);

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
			const cmd = makeCommand({
				meta: { name: "app" },
				run() {},
			});

			const manifest = buildManifest(cmd);
			const meta: SkillMeta = {
				name: "app",
				description: "An app",
				version: "1.0.0",
			};
			const files = renderSkill(manifest, meta);

			expect(files.length).toBeGreaterThan(0);
			const skill = findFile(files, "SKILL.md");
			expect(skill).toBeDefined();
		});

		it("handles deeply nested commands (4 levels)", () => {
			const deep = makeCommand({
				meta: { name: "deep", description: "Deep command" },
				run() {},
			});
			const level3 = makeCommand({
				meta: { name: "level3" },
				subCommands: { deep },
			});
			const level2 = makeCommand({
				meta: { name: "level2" },
				subCommands: { level3 },
			});
			const root = makeCommand({
				meta: { name: "root" },
				subCommands: { level2 },
			});

			const manifest = buildManifest(root);
			const meta: SkillMeta = {
				name: "root",
				description: "Root",
				version: "1.0.0",
			};
			const files = renderSkill(manifest, meta);

			const deepFile = findFile(files, "commands/level2/level3/deep.md");
			expect(deepFile).toBeDefined();
			expect(deepFile?.content).toContain("# `root level2 level3 deep`");
			expect(deepFile?.content).toContain("Parent:");
			expect(deepFile?.content).toContain("`root level2 level3`");
		});

		it("escapes pipe characters in description within table cells", () => {
			const cmd = makeCommand({
				meta: { name: "test" },
				flags: {
					mode: {
						type: "string",
						description: "Use enable | disable to toggle",
					},
				},
				run() {},
			});

			const manifest = buildManifest(cmd);
			const meta: SkillMeta = {
				name: "test",
				description: "Test tool",
				version: "1.0.0",
			};
			const files = renderSkill(manifest, meta);
			const test = findFile(files, "commands/test.md");

			// Pipe should be escaped inside table cells
			expect(test?.content).toContain("Use enable \\| disable to toggle");
			// But the raw | should not appear unescaped in a table row
			const tableRows = test?.content
				.split("\n")
				.filter((l) => l.startsWith("| ") && l.includes("enable"));
			for (const row of tableRows ?? []) {
				// Count unescaped pipes — they should only be column separators
				const cells = row.split(/(?<!\\)\|/).filter((c) => c.trim());
				expect(cells.length).toBe(4); // Flag, Type, Required, Description
			}
		});

		it("preserves pipe in command description outside tables", () => {
			const cmd = makeCommand({
				meta: {
					name: "test",
					description: "Use `--flag` to enable | disable features",
				},
				run() {},
			});

			const manifest = buildManifest(cmd);
			const meta: SkillMeta = {
				name: "test",
				description: "Test tool",
				version: "1.0.0",
			};
			const files = renderSkill(manifest, meta);
			const test = findFile(files, "commands/test.md");

			// Outside tables, the raw description is preserved as-is
			expect(test?.content).toContain(
				"Use `--flag` to enable | disable features",
			);
		});

		it("escapes pipe characters in arg description within table cells", () => {
			const cmd = makeCommand({
				meta: { name: "test" },
				args: [
					{
						name: "input",
						type: "string",
						description: "File path | URL to process",
					},
				] as ArgDef[],
				run() {},
			});

			const manifest = buildManifest(cmd);
			const meta: SkillMeta = {
				name: "test",
				description: "Test tool",
				version: "1.0.0",
			};
			const files = renderSkill(manifest, meta);
			const test = findFile(files, "commands/test.md");

			expect(test?.content).toContain("File path \\| URL to process");
		});

		it("root command file does not have parent navigation", () => {
			const cmd = makeCommand({
				meta: { name: "app" },
				run() {},
			});

			const manifest = buildManifest(cmd);
			const meta: SkillMeta = {
				name: "app",
				description: "App",
				version: "1.0.0",
			};
			const files = renderSkill(manifest, meta);
			const app = findFile(files, "commands/app.md");

			expect(app?.content).not.toContain("Parent:");
		});
	});
});
