import type { ArgDef } from "@crustjs/core";
import { defineExtensionId } from "@crustjs/core";
import { buildCommandDocumentation, type CommandDocumentation } from "@crustjs/core/tooling";
import { describe, expect, it } from "vite-plus/test";

import { makeCommand, snapshotFixture } from "../tests/fixtures.ts";
import { SKILLS } from "./id.ts";
import { renderSkill } from "./render.ts";
import type { RenderedFile, SkillMeta } from "./types.ts";

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

function hasTextContent(
	file: RenderedFile | undefined,
): file is RenderedFile & { content: string } {
	return typeof file?.content === "string";
}

function expectTextContent(file: RenderedFile | undefined): string {
	expect(file).toBeDefined();
	expect(hasTextContent(file)).toBe(true);
	if (!hasTextContent(file)) throw new Error("Expected rendered text content");
	return file.content;
}

/**
 * Builds a simple documentation tree from a makeCommand call for testing.
 */
async function buildSimpleDocumentation(): Promise<CommandDocumentation> {
	const cmd = makeCommand({
		meta: { name: "test-cli", description: "A test CLI tool" },
		run() {},
	});
	return buildCommandDocumentation(await snapshotFixture(cmd));
}

describe("renderSkill", () => {
	// ────────────────────────────────────────────────────────────────────────
	// SKILL.md content
	// ────────────────────────────────────────────────────────────────────────

	describe("SKILL.md content", () => {
		it("includes version in metadata when provided", async () => {
			const documentation = await buildSimpleDocumentation();
			const meta: SkillMeta = { ...baseMeta, version: "1.2.3" };
			const files = renderSkill(documentation, meta);
			const skill = findFile(files, "SKILL.md");

			expect(skill?.content).toContain("metadata:");
			expect(skill?.content).toContain('  version: "1.2.3"');
		});

		it("omits the metadata block when no version is provided", async () => {
			const documentation = await buildSimpleDocumentation();
			const files = renderSkill(documentation, baseMeta);
			const skill = findFile(files, "SKILL.md");

			expect(skill?.content).not.toContain("metadata:");
			expect(skill?.content).not.toContain("version:");
		});

		it("includes usage section when root is runnable", async () => {
			const documentation = await buildSimpleDocumentation();
			const files = renderSkill(documentation, baseMeta);
			const skill = findFile(files, "SKILL.md");

			expect(skill?.content).toContain("## Usage");
			expect(skill?.content).toContain("root command is directly executable");
		});

		it("omits usage section when root is not runnable", async () => {
			const child = makeCommand({
				meta: { name: "child" },
				run() {},
			});
			const root = makeCommand({
				meta: { name: "app", description: "App" },
				subCommands: { child },
			});

			const documentation = buildCommandDocumentation(await snapshotFixture(root));
			const meta: SkillMeta = {
				name: "app",
				description: "App",
				version: "1.0.0",
			};
			const files = renderSkill(documentation, meta);
			const skill = findFile(files, "SKILL.md");

			// Should not contain the runnable usage section
			expect(skill?.content).not.toContain("root command is directly executable");
		});

		it("escapes YAML-special characters in description", async () => {
			const documentation = await buildSimpleDocumentation();
			const meta: SkillMeta = {
				...baseMeta,
				description: 'Deploy: the "app" to {production}',
			};
			const files = renderSkill(documentation, meta);
			const skill = findFile(files, "SKILL.md");

			// Should be wrapped in double quotes with internal quotes escaped
			expect(skill?.content).toContain('description: "Deploy: the \\"app\\" to {production}"');
		});

		it("does not quote YAML values that are safe plain scalars", async () => {
			const documentation = await buildSimpleDocumentation();
			const files = renderSkill(documentation, baseMeta);
			const skill = findFile(files, "SKILL.md");

			// "A test CLI tool" has no special chars — should not be quoted
			expect(skill?.content).toContain("description: A test CLI tool");
		});
	});

	// ────────────────────────────────────────────────────────────────────────
	// SKILL.md command reference content
	// ────────────────────────────────────────────────────────────────────────

	describe("SKILL.md command reference content", () => {
		it("includes command descriptions in the markdown table", async () => {
			const child = makeCommand({
				meta: { name: "child" },
				run() {},
			});
			const root = makeCommand({
				meta: { name: "app", description: "Build | deploy" },
				subCommands: { child },
			});
			const files = renderSkill(buildCommandDocumentation(await snapshotFixture(root)), baseMeta);
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

		it("shows correct type labels for runnable vs group", async () => {
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

			const documentation = buildCommandDocumentation(await snapshotFixture(hybrid));
			const meta: SkillMeta = {
				name: "hybrid",
				description: "Test",
				version: "1.0.0",
			};
			const files = renderSkill(documentation, meta);
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
		it("renders an arguments table with required/optional/variadic", async () => {
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

			const documentation = buildCommandDocumentation(await snapshotFixture(cmd));
			const meta: SkillMeta = {
				name: "copy",
				description: "Copy",
				version: "1.0.0",
			};
			const files = renderSkill(documentation, meta);
			const copy = findFile(files, "commands/copy.md");

			expect(copy?.content).toContain("## Arguments");
			expect(copy?.content).toContain("| `source` | string | Yes | Source path |");
			expect(copy?.content).toContain("| `dest` | string | No | Destination path |");
			expect(copy?.content).toContain("| `extras...` | string | No | Extra files |");
		});

		it("omits arguments and flags sections when neither is defined", async () => {
			const cmd = makeCommand({
				meta: { name: "serve" },
				run() {},
			});

			const documentation = buildCommandDocumentation(await snapshotFixture(cmd));
			const meta: SkillMeta = {
				name: "serve",
				description: "Serve",
				version: "1.0.0",
			};
			const files = renderSkill(documentation, meta);
			const serve = findFile(files, "commands/serve.md");

			expect(serve?.content).not.toContain("## Arguments");
			expect(serve?.content).not.toContain("## Flags");
		});
	});

	// ────────────────────────────────────────────────────────────────────────
	// Group command files
	// ────────────────────────────────────────────────────────────────────────

	describe("group command files", () => {
		it("lists subcommands with links", async () => {
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

			const documentation = buildCommandDocumentation(await snapshotFixture(root));
			const meta: SkillMeta = {
				name: "git",
				description: "Git",
				version: "1.0.0",
			};
			const files = renderSkill(documentation, meta);
			const remoteFile = findFile(files, "commands/remote.md");

			expect(remoteFile?.content).toContain("## Subcommands");
			expect(remoteFile?.content).toContain("[`add`]");
			expect(remoteFile?.content).toContain("[`remove`]");
			expect(remoteFile?.content).toContain("Add a remote");
			expect(remoteFile?.content).toContain("Remove a remote");
		});

		it("includes usage section when group is also runnable", async () => {
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

			const documentation = buildCommandDocumentation(await snapshotFixture(parent));
			const meta: SkillMeta = {
				name: "parent",
				description: "Parent",
				version: "1.0.0",
			};
			const files = renderSkill(documentation, meta);
			const parentFile = findFile(files, "commands/parent.md");

			expect(parentFile?.content).toContain("## Usage");
			expect(parentFile?.content).toContain("## Flags");
			expect(parentFile?.content).toContain("## Command Documentation Authority");
			expect(parentFile?.content).toContain("## Subcommands");
		});

		it("omits usage/args/flags sections when group is not runnable", async () => {
			const sub = makeCommand({
				meta: { name: "sub" },
				run() {},
			});
			const parent = makeCommand({
				meta: { name: "parent", description: "Parent command" },
				subCommands: { sub },
			});

			const documentation = buildCommandDocumentation(await snapshotFixture(parent));
			const meta: SkillMeta = {
				name: "parent",
				description: "Parent",
				version: "1.0.0",
			};
			const files = renderSkill(documentation, meta);
			const parentFile = findFile(files, "commands/parent.md");

			expect(parentFile?.content).not.toContain("## Usage");
			expect(parentFile?.content).not.toContain("## Arguments");
			expect(parentFile?.content).not.toContain("## Flags");
			expect(parentFile?.content).toContain("## Subcommands");
		});
	});

	// ────────────────────────────────────────────────────────────────────────
	// Link integrity
	// ────────────────────────────────────────────────────────────────────────

	describe("link integrity", () => {
		it("SKILL.md command reference lists all generated command files", async () => {
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

			const documentation = buildCommandDocumentation(await snapshotFixture(root));
			const meta: SkillMeta = {
				name: "git",
				description: "Git",
				version: "1.0.0",
			};
			const files = renderSkill(documentation, meta);
			const skillContent = expectTextContent(findFile(files, "SKILL.md"));
			const commandFiles = files.filter((f) => f.path.startsWith("commands/")).map((f) => f.path);
			expect(commandFiles.sort()).toEqual([
				"commands/git.md",
				"commands/remote.md",
				"commands/remote/add.md",
			]);

			for (const cmdPath of commandFiles) {
				expect(skillContent).toContain(cmdPath);
			}
		});
	});

	// ────────────────────────────────────────────────────────────────────────
	// Edge cases
	// ────────────────────────────────────────────────────────────────────────

	describe("edge cases", () => {
		it("handles deeply nested commands (4 levels)", async () => {
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

			const documentation = buildCommandDocumentation(await snapshotFixture(root));
			const meta: SkillMeta = {
				name: "root",
				description: "Root",
				version: "1.0.0",
			};
			const files = renderSkill(documentation, meta);

			const deepFile = findFile(files, "commands/level2/level3/deep.md");
			expect(deepFile).toBeDefined();
			expect(deepFile?.content).toContain("# `root level2 level3 deep`");
			expect(deepFile?.content).toContain("Parent: [`root level2 level3`](../level3.md)");
			expect(deepFile?.content).toContain("[Skill Overview](../../../SKILL.md)");
		});

		it("escapes pipe characters in description within table cells", async () => {
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

			const documentation = buildCommandDocumentation(await snapshotFixture(cmd));
			const meta: SkillMeta = {
				name: "test",
				description: "Test tool",
				version: "1.0.0",
			};
			const files = renderSkill(documentation, meta);
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

		it("preserves pipe in command description outside tables", async () => {
			const cmd = makeCommand({
				meta: {
					name: "test",
					description: "Use `--flag` to enable | disable features",
				},
				run() {},
			});

			const documentation = buildCommandDocumentation(await snapshotFixture(cmd));
			const meta: SkillMeta = {
				name: "test",
				description: "Test tool",
				version: "1.0.0",
			};
			const files = renderSkill(documentation, meta);
			const test = findFile(files, "commands/test.md");

			// Outside tables, the raw description is preserved as-is
			expect(test?.content).toContain("Use `--flag` to enable | disable features");
		});

		it("root command file does not have parent navigation", async () => {
			const cmd = makeCommand({
				meta: { name: "app" },
				run() {},
			});

			const documentation = buildCommandDocumentation(await snapshotFixture(cmd));
			const meta: SkillMeta = {
				name: "app",
				description: "App",
				version: "1.0.0",
			};
			const files = renderSkill(documentation, meta);
			const app = findFile(files, "commands/app.md");

			expect(app?.content).not.toContain("Parent:");
		});
	});

	// ────────────────────────────────────────────────────────────────────────
	// Skills-specific projection of Core command documentation
	// ────────────────────────────────────────────────────────────────────────

	describe("command documentation projection", () => {
		async function render(fixture: Parameters<typeof snapshotFixture>[0]): Promise<RenderedFile[]> {
			return renderSkill(buildCommandDocumentation(await snapshotFixture(fixture)), baseMeta);
		}

		it("rejects a direct subcommand that would overwrite the root command file", async () => {
			const child = makeCommand({ meta: { name: "demo" }, run: () => {} });
			const root = makeCommand({ meta: { name: "demo" }, subCommands: { demo: child } });

			await expect(render(root)).rejects.toThrow(
				'Cannot generate skills: commands "demo" and "demo demo" both render to "commands/demo.md".',
			);
		});

		it("omits hidden commands, including a hidden child named like the root", async () => {
			const root = makeCommand({
				meta: { name: "demo" },
				subCommands: {
					demo: makeCommand({ meta: { name: "demo", hidden: true }, run() {} }),
					visible: makeCommand({ meta: { name: "visible" }, run() {} }),
					secret: makeCommand({ meta: { name: "secret", hidden: true }, run() {} }),
				},
			});

			const files = await render(root);

			expect(files.map((file) => file.path)).toEqual([
				"SKILL.md",
				"commands/demo.md",
				"commands/visible.md",
			]);
			expect(expectTextContent(findFile(files, "commands/demo.md"))).toContain(
				"- [`visible`](visible.md)\n\n",
			);
		});

		it("trims and lowercases command names in files, invocations, and links", async () => {
			const root = makeCommand({
				meta: { name: "  My-CLI  " },
				subCommands: { Sub: makeCommand({ meta: { name: "Sub" }, run() {} }) },
				run() {},
			});

			const files = await render(root);
			const skill = expectTextContent(findFile(files, "SKILL.md"));

			expect(files.map((file) => file.path)).toEqual([
				"SKILL.md",
				"commands/my-cli.md",
				"commands/sub.md",
			]);
			expect(skill).toContain(
				"| `my-cli sub` | runnable | - | [commands/sub.md](commands/sub.md) |",
			);
			expect(skill).toContain("You should see [my-cli](commands/my-cli.md) for usage details.");
			expect(expectTextContent(findFile(files, "commands/my-cli.md"))).toContain(
				"- [`sub`](sub.md)",
			);
		});

		it("renders custom usage verbatim and generated usage otherwise", async () => {
			const root = makeCommand({
				meta: { name: "app" },
				subCommands: {
					build: makeCommand({
						meta: { name: "build", usage: "build [options] <entry>" },
						run() {},
					}),
				},
				run() {},
			});

			const files = await render(root);

			expect(findFile(files, "commands/build.md")?.content).toContain(
				"```\nbuild [options] <entry>\n```",
			);
			expect(findFile(files, "commands/app.md")?.content).toContain("```\napp\n```");
		});

		it("renders only sections whose audience includes skills", async () => {
			const other = defineExtensionId("acme:other");
			const cmd = makeCommand({
				meta: {
					name: "deploy",
					sections: [
						{ title: "Skills only", body: "visible", only: [SKILLS] },
						{ title: "Other only", body: "hidden", only: [other] },
						{ title: "Not skills", body: "hidden", except: [SKILLS] },
						{ title: "Everyone", body: "shared" },
					],
				},
				run() {},
			});

			const deploy = expectTextContent(findFile(await render(cmd), "commands/deploy.md"));

			expect(deploy).toContain("## Skills only\nvisible\n\n## Everyone\nshared\n\n## Usage");
			expect(deploy).not.toContain("hidden");
		});

		it("sorts subcommands and flags alphabetically", async () => {
			const group = makeCommand({
				meta: { name: "group" },
				subCommands: {
					zeta: makeCommand({ meta: { name: "zeta" }, run() {} }),
					alpha: makeCommand({ meta: { name: "alpha" }, run() {} }),
					beta: makeCommand({ meta: { name: "beta" }, run() {} }),
				},
				flags: { zulu: { type: "boolean", noNegate: true }, able: { type: "string" } },
				run() {},
			});

			const files = await render(makeCommand({ meta: { name: "app" }, subCommands: { group } }));
			const content = expectTextContent(findFile(files, "commands/group.md"));

			expect(files.map((file) => file.path).slice(3)).toEqual([
				"commands/group/alpha.md",
				"commands/group/beta.md",
				"commands/group/zeta.md",
			]);
			expect(content).toContain("| `--able` | string | No | - |\n| `--zulu` | boolean | No | - |");
			expect(content).toContain(
				"- [`alpha`](group/alpha.md)\n- [`beta`](group/beta.md)\n- [`zeta`](group/zeta.md)",
			);
		});

		it("annotates env, defaults, and choices like Core help", async () => {
			const cmd = makeCommand({
				meta: { name: "serve" },
				args: [{ name: "mode", type: "string", choices: ["dev", "prod"], default: "dev" }],
				flags: {
					format: {
						type: "string",
						description: "Output format",
						choices: ["json", "text"],
						env: { name: "SERVE_FORMAT" },
					},
				},
				run() {},
			});

			const serve = expectTextContent(findFile(await render(cmd), "commands/serve.md"));

			expect(serve).toContain(
				'| `mode` | string | No | `[default: "dev"]` `[choices: dev, prod]` |',
			);
			expect(serve).toContain(
				"| `--format` | string | No | Output format `[env: SERVE_FORMAT]` `[choices: json, text]` |",
			);
		});

		it("formats defaults like Core help and displays other value types as strings", async () => {
			const schemaArg = {
				name: "target",
				schema: {
					"~standard": { version: 1, vendor: "test", validate: (value: unknown) => ({ value }) },
				},
			} as ArgDef;
			const cmd = makeCommand({
				meta: { name: "serve" },
				args: [schemaArg],
				flags: {
					port: { type: "number", default: 8080 },
					host: { type: "string", default: "localhost" },
					watch: { type: "boolean", default: true },
					entry: { type: "string", multiple: true, default: ["src/index.ts", "src/cli.ts"] },
					root: { type: "path" },
				},
				run() {},
			});

			const serve = expectTextContent(findFile(await render(cmd), "commands/serve.md"));

			expect(serve).toContain("| `target` | string | No | - |");
			expect(serve).toContain(
				"| `--entry` | string | No | Can be specified multiple times `[default: src/index.ts, src/cli.ts]` |",
			);
			expect(serve).toContain('| `--host` | string | No | `[default: "localhost"]` |');
			expect(serve).toContain("| `--port` | number | No | `[default: 8080]` |");
			expect(serve).toContain("| `--root` | string | No | - |");
			expect(serve).toContain("| `--watch`, `--no-watch` | boolean | No | `[default: true]` |");
		});
	});
});
