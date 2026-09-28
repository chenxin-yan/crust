// ────────────────────────────────────────────────────────────────────────────
// Markdown renderers — produce distributable skill files from Core command documentation
// ────────────────────────────────────────────────────────────────────────────

import { posix } from "node:path";

import {
	formatDefault,
	sectionsFor,
	type CommandDocumentation,
	type DocumentationArg,
	type DocumentationFlag,
} from "@crustjs/core/tooling";
import type { BaseValueType } from "@crustjs/utils/primitive";

import { SKILLS } from "./extension.ts";
import type { RenderedFile, SkillMeta } from "./types.ts";

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
		return JSON.stringify(value);
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
 * Renders a complete set of skill files from a command documentation tree and metadata.
 *
 * Produces:
 * - `SKILL.md` — entrypoint with frontmatter and lazy-load instructions
 * - `commands/` — per-command markdown files mirroring the command hierarchy
 *
 * Command names are trimmed and lowercased for file names and invocations; children and
 * flags render alphabetically, and only sections whose audience includes skills render.
 *
 * @param root - Core documentation tree from `buildCommandDocumentation()`
 * @param meta - Skill metadata for frontmatter and naming
 * @returns Array of rendered files ready for writing
 */
export function renderSkill(root: CommandDocumentation, meta: SkillMeta): RenderedFile[] {
	assertCommandFiles(root, new Map());
	const files: RenderedFile[] = [];

	// Collect all command nodes from the tree (including the root)
	const allNodes = collectNodes(root);

	// 1. SKILL.md — entrypoint
	files.push({
		path: "SKILL.md",
		content: renderSkillMd(root, meta, allNodes),
	});

	// 2. commands/ — per-command markdown files
	for (const node of allNodes) {
		files.push({ path: commandFilePath(node), content: renderCommand(node, root) });
	}

	return files;
}

// ────────────────────────────────────────────────────────────────────────────
// Tree traversal helpers
// ────────────────────────────────────────────────────────────────────────────

/**
 * Collects all nodes in the documentation tree via depth-first traversal.
 * Includes the root node and all descendants.
 */
function collectNodes(root: CommandDocumentation): CommandDocumentation[] {
	const nodes: CommandDocumentation[] = [root];
	for (const child of sortedChildren(root)) {
		nodes.push(...collectNodes(child));
	}
	return nodes;
}

function sortedChildren(node: CommandDocumentation): CommandDocumentation[] {
	return [...node.children].sort((a, b) => a.name.localeCompare(b.name));
}

function normalizeName(raw: string): string {
	return raw.trim().toLowerCase();
}

/** Raw command names that become file-name segments under `commands/`; the root keeps its own. */
function fileSegments(node: CommandDocumentation): readonly string[] {
	return node.path.length <= 1 ? [node.name] : node.path.slice(1);
}

/**
 * Computes the file path for a command node within the `commands/` directory.
 *
 * The root command maps to `commands/<root-name>.md`.
 * Subcommands strip the root prefix:
 *   `["cli", "remote", "add"]` → `commands/remote/add.md`
 */
function commandFilePath(node: CommandDocumentation): string {
	return `commands/${fileSegments(node).map(normalizeName).join("/")}.md`;
}

/**
 * Core accepts any non-empty command name, but each one becomes a file-name segment under
 * `commands/`. Rejects names that would traverse out of it or that normalize onto another
 * command's file or directory, before any output is replaced.
 */
function assertCommandFiles(node: CommandDocumentation, owners: Map<string, string>): void {
	for (const raw of fileSegments(node)) {
		const segment = normalizeName(raw);
		if (segment === "." || segment === ".." || /[/\\\0]/.test(segment)) {
			throw new Error(
				`Cannot generate skills for command name "${raw}": it must be a single file-name segment, without "/" or "\\" and not "." or "..".`,
			);
		}
	}
	const invocation = node.path.join(" ");
	const file = commandFilePath(node);
	// A nested command's directory `commands/<path>` must not collide with another `<name>.md` file.
	const hasDirectory = node.path.length > 1 && node.children.length > 0;
	for (const path of hasDirectory ? [file, file.slice(0, -".md".length)] : [file]) {
		const owner = owners.get(path);
		if (owner !== undefined) {
			throw new Error(
				`Cannot generate skills: commands "${owner}" and "${invocation}" both render to "${path}".`,
			);
		}
		owners.set(path, invocation);
	}
	for (const child of node.children) assertCommandFiles(child, owners);
}

/**
 * Builds the full invocation string for a command.
 * Example: `my-cli remote add`
 */
function commandInvocation(node: CommandDocumentation): string {
	return node.path.map(normalizeName).join(" ");
}

/** Displayed value type; schema-backed and richer Core types document as `string`. */
function displayType(type: string | undefined): BaseValueType {
	return type === "number" || type === "boolean" ? type : "string";
}

/**
 * Computes a relative path from one file to another within the skill directory.
 *
 * Both paths are relative to the skill root (e.g. "commands/remote/add.md").
 */
function relativePath(from: string, to: string): string {
	return posix.relative(posix.dirname(from), to);
}

// ────────────────────────────────────────────────────────────────────────────
// SKILL.md renderer
// ────────────────────────────────────────────────────────────────────────────

/**
 * Renders the `SKILL.md` entrypoint file with YAML frontmatter and
 * lazy-load instructions directing agents to supporting files.
 */
function renderSkillMd(
	root: CommandDocumentation,
	meta: SkillMeta,
	allNodes: CommandDocumentation[],
): string {
	const lines: string[] = [];

	// YAML frontmatter
	lines.push("---");
	lines.push(`name: ${escapeYaml(meta.name)}`);
	lines.push(`description: ${escapeYaml(meta.description)}`);
	if (meta.version !== undefined) {
		lines.push("metadata:");
		lines.push(`  version: "${meta.version}"`);
	}
	lines.push("---");
	lines.push("");

	// Title and overview
	lines.push(`# ${meta.name}`);
	lines.push("");
	if (root.description) {
		lines.push(root.description);
		lines.push("");
	}

	// When-to-use guidance for agents
	lines.push(
		`You should use this skill when you need accurate help with \`${meta.name}\` commands, including command selection, syntax, arguments, flags, defaults, and subcommands.`,
	);
	lines.push("");

	// Agent workflow for navigating command documentation
	lines.push("## How to Use This Skill");
	lines.push("");
	lines.push(
		"1. You must find the command that best matches the user's task from the Command Reference below.",
	);
	lines.push(
		"2. You must check the `Type` column before suggesting execution: `runnable` and `runnable, group` commands can be executed, while `group` commands are organizational only.",
	);
	lines.push("3. You should read only the linked file or files you need from `commands/`.");
	lines.push(
		"4. You must read a command's file before answering a command-specific question or suggesting that command.",
	);
	lines.push(
		"5. You must treat the command file as the source of truth for usage, arguments, flags, aliases, and defaults.",
	);
	lines.push(
		"6. If a flag, argument, alias, or default is not documented there, you must say it is not documented instead of guessing.",
	);
	lines.push("");

	// Lazy-load table for command docs
	lines.push("## Command Reference");
	lines.push("");
	lines.push("You should use this table to locate the command file you need.");
	lines.push("");
	lines.push(...renderCommandReferenceTable(allNodes));
	lines.push("");

	// Root command details (if runnable)
	if (root.hasAction) {
		lines.push("## Usage");
		lines.push("");
		const rootFile = commandFilePath(root);
		lines.push(
			`The root command is directly executable. You should see [${normalizeName(root.name)}](${rootFile}) for usage details.`,
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
function renderCommandReferenceTable(allNodes: CommandDocumentation[]): string[] {
	const lines: string[] = [];

	lines.push("| Command | Type | Description | Documentation |");
	lines.push("| ------- | ---- | ----------- | ------------- |");

	for (const node of allNodes) {
		const invocation = commandInvocation(node);
		const filePath = commandFilePath(node);
		const type = commandType(node);
		const description = escapeTableCell(node.description || "-");
		lines.push(`| \`${invocation}\` | ${type} | ${description} | [${filePath}](${filePath}) |`);
	}

	return lines;
}

/**
 * Returns a human-readable label for the command type.
 */
function commandType(node: CommandDocumentation): string {
	if (node.hasAction && node.children.length > 0) {
		return "runnable, group";
	}
	if (node.hasAction) {
		return "runnable";
	}
	return "group";
}

// ────────────────────────────────────────────────────────────────────────────
// Command renderer
// ────────────────────────────────────────────────────────────────────────────

/** Renders a command markdown file with its runnable details and child links. */
function renderCommand(node: CommandDocumentation, root: CommandDocumentation): string {
	const lines = [...renderCommandHeading(node), ...renderCommandSections(node)];
	if (node.hasAction) lines.push(...renderRunnableCommandSections(node));
	if (node.children.length > 0) lines.push(...renderSubcommandLinks(node, commandFilePath(node)));
	lines.push(...renderNavigation(node, root));
	return lines.join("\n");
}

// ────────────────────────────────────────────────────────────────────────────
// Shared rendering helpers
// ────────────────────────────────────────────────────────────────────────────

function renderCommandHeading(node: CommandDocumentation): string[] {
	const lines = [`# \`${commandInvocation(node)}\``, ""];

	if (node.description) {
		lines.push(node.description, "");
	}

	return lines;
}

function renderCommandSections(node: CommandDocumentation): string[] {
	return sectionsFor(node.sections, SKILLS).flatMap((section) => [
		`## ${section.title}`,
		section.body,
		"",
	]);
}

function renderRunnableCommandSections(node: CommandDocumentation): string[] {
	const lines = ["## Usage", "", "```", node.usage, "```", ""];

	if (node.args.length > 0) {
		lines.push("## Arguments", "", ...renderArgsTable(node.args), "");
	}

	if (node.flags.length > 0) {
		const flags = [...node.flags].sort((a, b) => a.name.localeCompare(b.name));
		lines.push("## Flags", "", ...renderFlagsTable(flags), "");
	}

	lines.push(
		"## Command Documentation Authority",
		"",
		"You must treat only the arguments, flags, options, aliases, and defaults documented in this file as supported for this command.",
		"You must not infer or invent additional command-line options.",
		"",
	);

	return lines;
}

function renderSubcommandLinks(node: CommandDocumentation, filePath: string): string[] {
	const lines = ["## Subcommands", ""];

	for (const child of sortedChildren(node)) {
		const childPath = commandFilePath(child);
		const childRelative = relativePath(filePath, childPath);
		const desc = child.description ? ` - ${child.description}` : "";
		lines.push(`- [\`${normalizeName(child.name)}\`](${childRelative})${desc}`);
	}

	lines.push("");
	return lines;
}

/**
 * Renders a markdown table for positional arguments.
 */
function renderArgsTable(args: readonly DocumentationArg[]): string[] {
	const lines: string[] = [];

	lines.push("| Argument | Type | Required | Description |");
	lines.push("| -------- | ---- | -------- | ----------- |");

	for (const arg of args) {
		const name = arg.variadic ? `${arg.name}...` : arg.name;
		const required = arg.required ? "Yes" : "No";
		const desc = escapeTableCell(formatFieldDescription(arg));
		lines.push(`| \`${name}\` | ${displayType(arg.type)} | ${required} | ${desc} |`);
	}

	return lines;
}

/**
 * Renders a markdown table for named flags.
 */
function renderFlagsTable(flags: readonly DocumentationFlag[]): string[] {
	const lines: string[] = [];

	lines.push("| Flag | Type | Required | Description |");
	lines.push("| ---- | ---- | -------- | ----------- |");

	for (const flag of flags) {
		const name = flag.spellings.map((spelling) => `\`${spelling}\``).join(", ");
		const required = flag.required ? "Yes" : "No";
		const desc = escapeTableCell(formatFieldDescription(flag));
		lines.push(`| ${name} | ${displayType(flag.type)} | ${required} | ${desc} |`);
	}

	return lines;
}

function formatFieldDescription(field: DocumentationArg | DocumentationFlag): string {
	const parts: string[] = [];
	if (field.description) {
		parts.push(field.description);
	}
	if ("multiple" in field && field.multiple) {
		parts.push("Can be specified multiple times");
	}
	if (field.default !== undefined) {
		parts.push(`Default: \`${formatDefault(field.default)}\``);
	}
	return parts.join(". ") || "-";
}

/**
 * Renders navigation links back to the parent command and skill entrypoint.
 */
function renderNavigation(node: CommandDocumentation, root: CommandDocumentation): string[] {
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
 * Finds a node in the documentation tree by its full path.
 */
function findNode(
	root: CommandDocumentation,
	path: readonly string[],
): CommandDocumentation | undefined {
	if (root.path.length === path.length && root.path.every((value, i) => value === path[i])) {
		return root;
	}
	for (const child of root.children) {
		const found = findNode(child, path);
		if (found) return found;
	}
	return undefined;
}
