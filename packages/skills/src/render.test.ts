import { describe, expect, it } from "bun:test";

import type { ArgDef, CommandSection, FlagDef } from "@crustjs/core";
import { Crust, defineCommand, defineContext, defineFlag } from "@crustjs/core";
import { snapshotCommand } from "@crustjs/core/tooling";
type CommandNode = Parameters<typeof snapshotCommand>[0];

import { buildManifest } from "./manifest.ts";
import { renderSkill } from "./render.ts";
import type { ManifestNode, RenderedFile, SkillMeta } from "./types.ts";

// ────────────────────────────────────────────────────────────────────────────
// Helper — builds a CommandNode for introspection tests
// ────────────────────────────────────────────────────────────────────────────

function makeCommand(opts: {
	meta: {
		name: string;
		description?: string;
		usage?: string;
		sections?: readonly Pick<CommandSection, "title" | "body">[];
	};
	args?: readonly ArgDef[];
	flags?: Record<string, FlagDef>;
	run?: () => void;
	subCommands?: Record<string, CommandNode>;
}): CommandNode {
	const node = new Crust(opts.meta.name)._node;
	Object.assign(node.meta, opts.meta);
	if (opts.args) node.args = opts.args;
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
};

/**
 * Finds a rendered file by path from the result array.
 */
function findFile(files: RenderedFile[], path: string): RenderedFile | undefined {
	return files.find((f) => f.path === path);
}

function expectTextContent(file: RenderedFile | undefined): string {
	expect(file).toBeDefined();
	expect(typeof file?.content).toBe("string");
	return file?.content as string;
}

/**
 * Builds a simple manifest from a makeCommand call for testing.
 */
function buildSimpleManifest(): ManifestNode {
	const cmd = makeCommand({
		meta: { name: "test-cli", description: "A test CLI tool" },
		run() {},
	});
	return buildManifest(snapshotCommand(cmd));
}

describe("renderSkill", () => {
	// ────────────────────────────────────────────────────────────────────────
	// SKILL.md content
	// ────────────────────────────────────────────────────────────────────────

	describe("SKILL.md content", () => {
		it("includes version in metadata when provided", () => {
			const manifest = buildSimpleManifest();
			const meta: SkillMeta = { ...baseMeta, version: "1.2.3" };
			const files = renderSkill(manifest, meta);
			const skill = findFile(files, "SKILL.md");

			expect(skill?.content).toContain("metadata:");
			expect(skill?.content).toContain('  version: "1.2.3"');
		});

		it("omits the metadata block when no version is provided", () => {
			const manifest = buildSimpleManifest();
			const files = renderSkill(manifest, baseMeta);
			const skill = findFile(files, "SKILL.md");

			expect(skill?.content).not.toContain("metadata:");
			expect(skill?.content).not.toContain("version:");
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

			const manifest = buildManifest(snapshotCommand(root));
			const meta: SkillMeta = {
				name: "app",
				description: "App",
				version: "1.0.0",
			};
			const files = renderSkill(manifest, meta);
			const skill = findFile(files, "SKILL.md");

			// Should not contain the runnable usage section
			expect(skill?.content).not.toContain("root command is directly executable");
		});

		it("uses the literal skill name in when-to-use text", () => {
			const manifest = buildSimpleManifest();
			const meta: SkillMeta = {
				...baseMeta,
				name: "use-my-tool",
			};
			const files = renderSkill(manifest, meta);
			const skill = findFile(files, "SKILL.md");

			expect(skill?.content).toContain(
				"You should use this skill when you need accurate help with `use-my-tool` commands",
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
			expect(skill?.content).toContain('description: "Deploy: the \\"app\\" to {production}"');
		});

		it("does not quote YAML values that are safe plain scalars", () => {
			const manifest = buildSimpleManifest();
			const files = renderSkill(manifest, baseMeta);
			const skill = findFile(files, "SKILL.md");

			// "A test CLI tool" has no special chars — should not be quoted
			expect(skill?.content).toContain("description: A test CLI tool");
		});
	});

	// ────────────────────────────────────────────────────────────────────────
	// SKILL.md command reference content
	// ────────────────────────────────────────────────────────────────────────

	describe("SKILL.md command reference content", () => {
		it("includes command descriptions in the markdown table", () => {
			const child = makeCommand({
				meta: { name: "child" },
				run() {},
			});
			const root = makeCommand({
				meta: { name: "app", description: "Build | deploy" },
				subCommands: { child },
			});
			const files = renderSkill(buildManifest(snapshotCommand(root)), baseMeta);
			const skill = findFile(files, "SKILL.md");

			expect(skill).toBeDefined();
			expect(skill?.content).toContain("## Command Reference");
			expect(skill?.content).toContain("| Command | Type | Description | Documentation |");
			expect(skill?.content).toContain(
				"| `app` | group | Build \\| deploy | [commands/app.md](commands/app.md) |",
			);
			expect(skill?.content).toContain(
				"| `app child` | runnable | - | [commands/child.md](commands/child.md) |",
			);
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

			const manifest = buildManifest(snapshotCommand(hybrid));
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

			const manifest = buildManifest(snapshotCommand(cmd));
			const meta: SkillMeta = {
				name: "copy",
				description: "Copy",
				version: "1.0.0",
			};
			const files = renderSkill(manifest, meta);
			const copy = findFile(files, "commands/copy.md");

			expect(copy?.content).toContain("## Arguments");
			expect(copy?.content).toContain("| `source` | string | Yes | Source path |");
			expect(copy?.content).toContain("| `dest` | string | No | Destination path |");
			expect(copy?.content).toContain("| `extras...` | string | No | Extra files |");
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

			const manifest = buildManifest(snapshotCommand(cmd));
			const meta: SkillMeta = {
				name: "serve",
				description: "Serve",
				version: "1.0.0",
			};
			const files = renderSkill(manifest, meta);
			const serve = findFile(files, "commands/serve.md");

			expect(serve?.content).toContain("Default: `3000`");
		});

		it("renders Context-owned flags from a Core-built command tree", () => {
			const apiKey = defineFlag("api-key", {
				type: "string",
				description: "API credential",
			});
			const auth = defineContext("auth", { flags: [apiKey] }, () => ({}));
			const app = new Crust("test-cli")
				.provide(auth())
				.add(defineCommand("deploy", (command) => command.action(() => {})));
			const files = renderSkill(buildManifest(snapshotCommand(app._node)), baseMeta);
			const deploy = findFile(files, "commands/deploy.md");

			expect(deploy?.content).toContain("--api-key");
			expect(deploy?.content).toContain("API credential");
		});

		it("renders a flags table with doc-model spellings and defaults", () => {
			const cmd = makeCommand({
				meta: { name: "build" },
				flags: {
					verbose: {
						type: "boolean",
						description: "Enable verbose output",
						short: "v",
						aliases: ["debug"],
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

			const manifest = buildManifest(snapshotCommand(cmd));
			const meta: SkillMeta = {
				name: "build",
				description: "Build",
				version: "1.0.0",
			};
			const files = renderSkill(manifest, meta);
			const build = findFile(files, "commands/build.md");

			expect(build?.content).toContain("## Flags");
			expect(build?.content).toContain("`-o`, `--output`");
			expect(build?.content).toContain(
				"`-v`, `--verbose`, `--debug`, `--no-verbose`, `--no-debug`",
			);
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

			const manifest = buildManifest(snapshotCommand(cmd));
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

			const manifest = buildManifest(snapshotCommand(cmd));
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

			const manifest = buildManifest(snapshotCommand(cmd));
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

		it("renders metadata sections for leaf commands", () => {
			const cmd = makeCommand({
				meta: {
					name: "deploy",
					sections: [
						{
							title: "Preview",
							body: "Prefer preview flags before executing changes.",
						},
						{
							title: "Safety",
							body: "Call out risky production operations explicitly.",
						},
					],
				},
				run() {},
			});

			const manifest = buildManifest(snapshotCommand(cmd));
			const files = renderSkill(manifest, {
				name: "deploy",
				description: "Deploy",
				version: "1.0.0",
			});
			const deploy = findFile(files, "commands/deploy.md");

			expect(deploy?.content).toContain(
				"## Preview\nPrefer preview flags before executing changes.",
			);
			expect(deploy?.content).toContain(
				"## Safety\nCall out risky production operations explicitly.",
			);
		});

		it("omits arguments section when command has no args", () => {
			const cmd = makeCommand({
				meta: { name: "serve" },
				run() {},
			});

			const manifest = buildManifest(snapshotCommand(cmd));
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

			const manifest = buildManifest(snapshotCommand(cmd));
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

			const manifest = buildManifest(snapshotCommand(cmd));
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

			const manifest = buildManifest(snapshotCommand(cmd));
			const meta: SkillMeta = {
				name: "test",
				description: "Test",
				version: "1.0.0",
			};
			const files = renderSkill(manifest, meta);
			const test = findFile(files, "commands/test.md");

			expect(test?.content).toContain("| `--quiet`, `--no-quiet` | boolean | No | - |");
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

			const manifest = buildManifest(snapshotCommand(root));
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

			const manifest = buildManifest(snapshotCommand(parent));
			const meta: SkillMeta = {
				name: "parent",
				description: "Parent",
				version: "1.0.0",
			};
			const files = renderSkill(manifest, meta);
			const parentFile = findFile(files, "commands/parent.md");

			expect(parentFile?.content).toContain("## Usage");
			expect(parentFile?.content).toContain("## Flags");
			expect(parentFile?.content).toContain("## Command Documentation Authority");
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

			const manifest = buildManifest(snapshotCommand(parent));
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

		it("renders metadata sections for group commands", () => {
			const sub = makeCommand({
				meta: { name: "sub" },
				run() {},
			});
			const parent = makeCommand({
				meta: {
					name: "parent",
					description: "Parent command",
					sections: [
						{
							title: "Workflow",
							body: "Read a child command doc before recommending execution details.",
						},
					],
				},
				subCommands: { sub },
			});

			const manifest = buildManifest(snapshotCommand(parent));
			const files = renderSkill(manifest, {
				name: "parent",
				description: "Parent",
				version: "1.0.0",
			});
			const parentFile = findFile(files, "commands/parent.md");

			expect(parentFile?.content).toContain(
				"## Workflow\nRead a child command doc before recommending execution details.",
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

			const manifest = buildManifest(snapshotCommand(root));
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

			const manifest = buildManifest(snapshotCommand(root));
			const meta: SkillMeta = {
				name: "app",
				description: "App CLI",
				version: "1.0.0",
			};
			const files = renderSkill(manifest, meta);
			const allPaths = new Set(files.map((f) => f.path));

			const skillContent = expectTextContent(findFile(files, "SKILL.md"));

			// Extract markdown link targets (non-relative only)
			const linkRegex = /\]\(([^)]+)\)/g;
			const links: string[] = [];
			let match: RegExpExecArray | null = null;
			while ((match = linkRegex.exec(skillContent)) !== null) {
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

			const manifest = buildManifest(snapshotCommand(root));
			const meta: SkillMeta = {
				name: "git",
				description: "Git",
				version: "1.0.0",
			};
			const files = renderSkill(manifest, meta);
			const skill = findFile(files, "SKILL.md");
			const commandFiles = files.filter((f) => f.path.startsWith("commands/")).map((f) => f.path);

			for (const cmdPath of commandFiles) {
				expect(skill?.content).toContain(cmdPath);
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

			const manifest = buildManifest(snapshotCommand(root));
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
			expect(skill?.content).toContain("[commands/clone.md](commands/clone.md)");
			expect(skill?.content).toContain("[commands/remote.md](commands/remote.md)");

			// Verify clone leaf command has args and flags
			const cloneFile = findFile(files, "commands/clone.md");
			expect(cloneFile?.content).toContain("# `git clone`");
			expect(cloneFile?.content).toContain("## Arguments");
			expect(cloneFile?.content).toContain("## Flags");
			expect(cloneFile?.content).toContain("`-b`, `--branch`");
			expect(cloneFile?.content).toContain("git clone <url> [directory] [options]");

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

			const manifest = buildManifest(snapshotCommand(root));
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

			const manifest = buildManifest(snapshotCommand(cmd));
			const meta: SkillMeta = {
				name: "test",
				description: "Test tool",
				version: "1.0.0",
			};
			const files = renderSkill(manifest, meta);
			const testContent = expectTextContent(findFile(files, "commands/test.md"));

			// Pipe should be escaped inside table cells
			expect(testContent).toContain("Use enable \\| disable to toggle");
			// But the raw | should not appear unescaped in a table row
			const tableRows = testContent
				.split("\n")
				.filter((l) => l.startsWith("| ") && l.includes("enable"));
			for (const row of tableRows) {
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

			const manifest = buildManifest(snapshotCommand(cmd));
			const meta: SkillMeta = {
				name: "test",
				description: "Test tool",
				version: "1.0.0",
			};
			const files = renderSkill(manifest, meta);
			const test = findFile(files, "commands/test.md");

			// Outside tables, the raw description is preserved as-is
			expect(test?.content).toContain("Use `--flag` to enable | disable features");
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

			const manifest = buildManifest(snapshotCommand(cmd));
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

			const manifest = buildManifest(snapshotCommand(cmd));
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
