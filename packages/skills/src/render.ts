// ────────────────────────────────────────────────────────────────────────────
// Markdown renderers — produce distributable skill files from manifest
// ────────────────────────────────────────────────────────────────────────────

import {
	hasNormalizedInstructions,
	normalizeInstructionList,
	normalizeMarkdownBlock,
} from "./instructions.ts";
import type {
	ManifestArg,
	ManifestFlag,
	ManifestNode,
	RenderedFile,
	SkillMeta,
} from "./types.ts";

// ────────────────────────────────────────────────────────────────────────────
// Text escaping helpers
// ────────────────────────────────────────────────────────────────────────────

/**
 * Escapes a string for safe use as a YAML scalar value.
 *
 * Wraps the value in double quotes if it contains characters that would
 * break plain YAML scalars (colons, hash signs, brackets, quotes, etc.).
 * Internal double quotes are escaped with a backslash.
 */
function escapeYaml(value: string): string {
	// Characters that make a plain YAML scalar ambiguous
	if (/[:#[\]{}&*!|>'"`,@?\\]|^\s|\s$|^---|[\n\r]/.test(value)) {
		return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\r/g, "\\r")}"`;
	}
	return value;
}

/**
 * Escapes pipe characters in text intended for markdown table cells.
 *
 * Unescaped `|` characters break markdown table structure. This replaces
 * them with `\|` while leaving already-escaped `\|` sequences untouched.
 */
function escapeTableCell(value: string): string {
	// Replace | that is NOT preceded by \
	return value.replace(/(?<!\\)\|/g, "\\|");
}

// ────────────────────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────────────────────

/**
 * Renders a complete set of skill files from a manifest tree and metadata.
 *
 * Produces:
 * - `SKILL.md` — entrypoint with frontmatter and lazy-load instructions
 * - `commands/` — per-command markdown files mirroring the command hierarchy
 *
 * @param manifest - The canonical manifest tree from {@link buildManifest}
 * @param meta - Skill metadata for frontmatter and naming
 * @returns Array of rendered files ready for writing
 *
 * @example
 * ```ts
 * import { buildManifest, renderSkill } from "@crustjs/skills";
 *
 * const manifest = buildManifest(rootCommand);
 * const files = renderSkill(manifest, {
 *   name: "my-cli",
 *   description: "My CLI tool",
 * });
 * // files contains RenderedFile[] with paths like "SKILL.md", "commands/serve.md"
 * ```
 */
export function renderSkill(
	manifest: ManifestNode,
	meta: SkillMeta,
): RenderedFile[] {
	const files: RenderedFile[] = [];

	// Collect all command nodes from the tree (including the root)
	const allNodes = collectNodes(manifest);

	// 1. SKILL.md — entrypoint
	files.push({
		path: "SKILL.md",
		content: renderSkillMd(manifest, meta, allNodes),
	});

	// 2. commands/ — per-command markdown files
	for (const node of allNodes) {
		const filePath = commandFilePath(node);
		const content =
			node.children.length > 0
				? renderGroupCommand(node, manifest)
				: renderLeafCommand(node, manifest);
		files.push({ path: filePath, content });
	}

	return files;
}

// ────────────────────────────────────────────────────────────────────────────
// Tree traversal helpers
// ────────────────────────────────────────────────────────────────────────────

/**
 * Collects all nodes in the manifest tree via depth-first traversal.
 * Includes the root node and all descendants.
 */
function collectNodes(root: ManifestNode): ManifestNode[] {
	const nodes: ManifestNode[] = [root];
	for (const child of root.children) {
		nodes.push(...collectNodes(child));
	}
	return nodes;
}

/**
 * Computes the file path for a command node within the `commands/` directory.
 *
 * The root command maps to `commands/<root-name>.md`.
 * Subcommands strip the root prefix:
 *   `["cli", "remote", "add"]` → `commands/remote/add.md`
 *
 * Single-segment paths (root only) map to `commands/<name>.md`.
 */
function commandFilePath(node: ManifestNode): string {
	if (node.path.length <= 1) {
		return `commands/${node.name}.md`;
	}
	// Strip the root segment — subcommands start from path[1]
	const segments = node.path.slice(1);
	return `commands/${segments.join("/")}.md`;
}

/**
 * Builds the full invocation string for a command.
 * Example: `my-cli remote add`
 */
function commandInvocation(node: ManifestNode): string {
	return node.path.join(" ");
}

/**
 * Computes a relative path from one file to another within the skill directory.
 *
 * Both paths are relative to the skill root (e.g. "commands/remote/add.md").
 */
function relativePath(from: string, to: string): string {
	const fromParts = from.split("/").slice(0, -1); // directory of `from`
	const toParts = to.split("/");

	// Find common prefix length
	let common = 0;
	while (
		common < fromParts.length &&
		common < toParts.length &&
		fromParts[common] === toParts[common]
	) {
		common++;
	}

	const ups = fromParts.length - common;
	const remaining = toParts.slice(common);

	if (ups === 0) {
		return remaining.join("/");
	}

	const upSegments = Array.from({ length: ups }, () => "..");
	return [...upSegments, ...remaining].join("/");
}

// ────────────────────────────────────────────────────────────────────────────
// SKILL.md renderer
// ────────────────────────────────────────────────────────────────────────────

/**
 * Renders the `SKILL.md` entrypoint file with YAML frontmatter and
 * lazy-load instructions directing agents to supporting files.
 */
function renderSkillMd(
	manifest: ManifestNode,
	meta: SkillMeta,
	allNodes: ManifestNode[],
): string {
	const lines: string[] = [];

	// YAML frontmatter
	lines.push("---");
	lines.push(`name: ${escapeYaml(meta.name)}`);
	lines.push(`description: ${escapeYaml(meta.description)}`);
	if (meta.license) {
		lines.push(`license: ${escapeYaml(meta.license)}`);
	}
	if (meta.compatibility) {
		lines.push(`compatibility: ${escapeYaml(meta.compatibility)}`);
	}
	if (meta.disableModelInvocation) {
		lines.push("disable-model-invocation: true");
	}
	if (meta.allowedTools) {
		lines.push(`allowed-tools: ${escapeYaml(meta.allowedTools)}`);
	}
	lines.push("metadata:");
	lines.push(`  version: "${meta.version}"`);
	lines.push("---");
	lines.push("");

	// Title and overview
	lines.push(`# ${meta.name}`);
	lines.push("");
	if (manifest.description) {
		lines.push(manifest.description);
		lines.push("");
	}

	// When-to-use guidance for agents
	lines.push(
		`Use this skill when you need accurate help with \`${meta.name}\` commands, including command selection, syntax, arguments, flags, defaults, and subcommands.`,
	);
	lines.push("");

	const topLevelInstructions = renderTopLevelInstructions(meta.instructions);

	// Agent workflow for navigating command documentation
	lines.push("## How to Use This Skill");
	lines.push("");
	lines.push(
		"1. Find the command that best matches the user's task from the Command Reference below",
	);
	lines.push(
		"2. Check the `Type` column before suggesting execution: `runnable` and `runnable, group` commands can be executed, while `group` commands are organizational only",
	);
	lines.push("3. Read only the linked file or files you need from `commands/`");
	lines.push(
		"4. Before answering a command-specific question or suggesting a command, read that command's file",
	);
	lines.push(
		"5. Treat the command file as the source of truth for usage, arguments, flags, aliases, and defaults",
	);
	lines.push(
		"6. If a flag, argument, alias, or default is not documented there, say it is not documented instead of guessing",
	);
	lines.push("");

	if (hasNormalizedInstructions(topLevelInstructions)) {
		lines.push("## General Guidance");
		lines.push("");
		lines.push(...topLevelInstructions);
		lines.push("");
	}

	// Lazy-load table for command docs
	lines.push("## Command Reference");
	lines.push("");
	lines.push("Use this table to locate the command file you need.");
	lines.push("");
	lines.push(...renderCommandReferenceTable(allNodes));
	lines.push("");

	// Root command details (if runnable)
	if (manifest.runnable) {
		lines.push("## Usage");
		lines.push("");
		const rootFile = commandFilePath(manifest);
		lines.push(
			`The root command is directly executable. See [${manifest.name}](${rootFile}) for usage details.`,
		);
		lines.push("");
	}

	return lines.join("\n");
}

// ────────────────────────────────────────────────────────────────────────────
// Command reference renderer
// ────────────────────────────────────────────────────────────────────────────

/**
 * Renders a markdown table mapping all command paths to their
 * documentation file paths.
 */
function renderCommandReferenceTable(allNodes: ManifestNode[]): string[] {
	const lines: string[] = [];

	lines.push("| Command | Type | Documentation |");
	lines.push("| ------- | ---- | ------------- |");

	for (const node of allNodes) {
		const invocation = commandInvocation(node);
		const filePath = commandFilePath(node);
		const type = commandType(node);
		lines.push(`| \`${invocation}\` | ${type} | [${filePath}](${filePath}) |`);
	}

	return lines;
}

/**
 * Returns a human-readable label for the command type.
 */
function commandType(node: ManifestNode): string {
	if (node.runnable && node.children.length > 0) {
		return "runnable, group";
	}
	if (node.runnable) {
		return "runnable";
	}
	return "group";
}

// ────────────────────────────────────────────────────────────────────────────
// Leaf command renderer
// ────────────────────────────────────────────────────────────────────────────

/**
 * Renders a leaf command markdown file with full invocation details:
 * description, usage, arguments, flags, defaults, aliases, and examples.
 */
function renderLeafCommand(node: ManifestNode, root: ManifestNode): string {
	const lines: string[] = [];
	lines.push(...renderCommandHeading(node));
	lines.push(...renderAgentInstructions(node));
	lines.push(...renderRunnableCommandSections(node));

	// Parent navigation
	lines.push(...renderNavigation(node, root));

	return lines.join("\n");
}

// ────────────────────────────────────────────────────────────────────────────
// Group command renderer
// ────────────────────────────────────────────────────────────────────────────

/**
 * Renders a non-leaf (group) command markdown file as a concise overview
 * linking to child command documentation files.
 */
function renderGroupCommand(node: ManifestNode, root: ManifestNode): string {
	const lines: string[] = [];
	const filePath = commandFilePath(node);
	lines.push(...renderCommandHeading(node));
	lines.push(...renderAgentInstructions(node));

	// If the group is also runnable, show its own usage
	if (node.runnable) {
		lines.push(...renderRunnableCommandSections(node));
	}

	// Subcommands list
	lines.push(...renderSubcommandLinks(node, filePath));

	// Parent navigation
	lines.push(...renderNavigation(node, root));

	return lines.join("\n");
}

// ────────────────────────────────────────────────────────────────────────────
// Shared rendering helpers
// ────────────────────────────────────────────────────────────────────────────

/**
 * Builds an auto-generated usage line from the command's path, args, and flags.
 *
 * Example: `my-cli deploy <env> [--force] [--target <value>]`
 */
function buildUsageLine(node: ManifestNode): string {
	const parts = [...node.path];

	for (const arg of node.args) {
		if (arg.variadic) {
			parts.push(arg.required ? `<${arg.name}...>` : `[${arg.name}...]`);
		} else {
			parts.push(arg.required ? `<${arg.name}>` : `[${arg.name}]`);
		}
	}

	if (node.flags.length > 0) {
		parts.push("[options]");
	}

	return parts.join(" ");
}

function renderCommandHeading(node: ManifestNode): string[] {
	const lines = [`# \`${commandInvocation(node)}\``, ""];

	if (node.description) {
		lines.push(node.description, "");
	}

	return lines;
}

function renderAgentInstructions(node: ManifestNode): string[] {
	const instructions = node.instructions ?? [];

	if (!hasNormalizedInstructions(instructions)) {
		return [];
	}

	return [
		"## Command Instructions",
		"",
		...renderInstructionList(instructions),
		"",
	];
}

function renderRunnableCommandSections(node: ManifestNode): string[] {
	const lines = [
		"## Usage",
		"",
		"```",
		node.usage ?? buildUsageLine(node),
		"```",
		"",
	];

	if (node.args.length > 0) {
		lines.push("## Arguments", "", ...renderArgsTable(node.args), "");
	}

	if (node.flags.length > 0) {
		lines.push("## Flags", "", ...renderFlagsTable(node.flags), "");
	}

	lines.push(
		"## Command Documentation Authority",
		"",
		"Only arguments, flags, options, aliases, and defaults documented in this file are supported for this command.",
		"Do not infer or invent additional command-line options.",
		"",
	);

	return lines;
}

function renderSubcommandLinks(node: ManifestNode, filePath: string): string[] {
	const lines = ["## Subcommands", ""];

	for (const child of node.children) {
		const childPath = commandFilePath(child);
		const childRelative = relativePath(filePath, childPath);
		const desc = child.description ? ` - ${child.description}` : "";
		lines.push(`- [\`${child.name}\`](${childRelative})${desc}`);
	}

	lines.push("");
	return lines;
}

/**
 * Renders a markdown table for positional arguments.
 */
function renderArgsTable(args: ManifestArg[]): string[] {
	const lines: string[] = [];

	lines.push("| Argument | Type | Required | Description |");
	lines.push("| -------- | ---- | -------- | ----------- |");

	for (const arg of args) {
		const name = arg.variadic ? `${arg.name}...` : arg.name;
		const required = arg.required ? "Yes" : "No";
		const desc = escapeTableCell(formatArgDescription(arg));
		lines.push(`| \`${name}\` | ${arg.type} | ${required} | ${desc} |`);
	}

	return lines;
}

/**
 * Formats the description cell for an argument, including default value.
 */
function formatArgDescription(arg: ManifestArg): string {
	const parts: string[] = [];
	if (arg.description) {
		parts.push(arg.description);
	}
	if (arg.default !== undefined) {
		parts.push(`Default: \`${arg.default}\``);
	}
	return parts.join(". ") || "-";
}

/**
 * Renders a markdown table for named flags.
 */
function renderFlagsTable(flags: ManifestFlag[]): string[] {
	const lines: string[] = [];

	lines.push("| Flag | Type | Required | Description |");
	lines.push("| ---- | ---- | -------- | ----------- |");

	for (const flag of flags) {
		const name = formatFlagName(flag);
		const required = flag.required ? "Yes" : "No";
		const desc = escapeTableCell(formatFlagDescription(flag));
		lines.push(`| ${name} | ${flag.type} | ${required} | ${desc} |`);
	}

	return lines;
}

/**
 * Formats the flag name cell with aliases.
 *
 * Example: `--verbose`, `-v` or `--output`, `-o`, `-O`
 */
function formatFlagName(flag: ManifestFlag): string {
	const parts = [`\`--${flag.name}\``];
	if (flag.short) {
		parts.push(`\`-${flag.short}\``);
	}
	for (const alias of flag.aliases) {
		parts.push(`\`--${alias}\``);
	}
	return parts.join(", ");
}

/**
 * Formats the description cell for a flag, including default value
 * and multiplicity.
 */
function formatFlagDescription(flag: ManifestFlag): string {
	const parts: string[] = [];
	if (flag.description) {
		parts.push(flag.description);
	}
	if (flag.multiple) {
		parts.push("Can be specified multiple times");
	}
	if (flag.default !== undefined) {
		parts.push(`Default: \`${flag.default}\``);
	}
	return parts.join(". ") || "-";
}

/**
 * Renders a compact bullet list of instruction lines.
 */
function renderInstructionList(instructions: string[]): string[] {
	return instructions.map((instruction) => `- ${instruction}`);
}

function renderTopLevelInstructions(
	instructions: string | string[] | undefined,
): string[] {
	if (typeof instructions === "string") {
		return normalizeMarkdownBlock(instructions);
	}

	return renderInstructionList(normalizeInstructionList(instructions));
}

/**
 * Renders navigation links back to the parent command and skill entrypoint.
 */
function renderNavigation(node: ManifestNode, root: ManifestNode): string[] {
	const lines: string[] = [];
	const filePath = commandFilePath(node);

	lines.push("---");
	lines.push("");

	// Link to parent (if not root)
	if (node.path.length > 1) {
		const parentPath = node.path.slice(0, -1);
		const parentNode = findNode(root, parentPath);
		if (parentNode) {
			const parentFile = commandFilePath(parentNode);
			const parentRelative = relativePath(filePath, parentFile);
			const parentInvocation = commandInvocation(parentNode);
			lines.push(`Parent: [\`${parentInvocation}\`](${parentRelative})`);
			lines.push("");
		}
	}

	// Link to SKILL.md
	const skillRelative = relativePath(filePath, "SKILL.md");
	lines.push(`[Skill Overview](${skillRelative})`);
	lines.push("");

	return lines;
}

/**
 * Finds a node in the manifest tree by its full path.
 */
function findNode(
	root: ManifestNode,
	path: string[],
): ManifestNode | undefined {
	if (arraysEqual(root.path, path)) {
		return root;
	}
	for (const child of root.children) {
		const found = findNode(child, path);
		if (found) return found;
	}
	return undefined;
}

/**
 * Compares two string arrays for equality.
 */
function arraysEqual(a: string[], b: string[]): boolean {
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) {
		if (a[i] !== b[i]) return false;
	}
	return true;
}
