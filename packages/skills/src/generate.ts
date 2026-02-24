// ────────────────────────────────────────────────────────────────────────────
// Top-level generation — orchestrates manifest → render → write pipeline
// ────────────────────────────────────────────────────────────────────────────

import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { buildManifest } from "./manifest.ts";
import { renderSkill } from "./render.ts";
import type {
	GenerateOptions,
	GenerateResult,
	ManifestNode,
	RenderedFile,
	SkillMeta,
} from "./types.ts";

// ────────────────────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────────────────────

/**
 * Generates a distributable agent skill bundle from a Crust command tree.
 *
 * This is the primary high-level API for skill generation. It:
 * 1. Builds a canonical manifest from the command tree
 * 2. Renders markdown files from the manifest
 * 3. Generates distribution metadata (`manifest.json`, `README.md`)
 * 4. Writes all files to `<outDir>/skills/<name>/`
 *
 * When `clean` is `true` (default), the existing skill directory is removed
 * before writing to prevent stale files from previous generations.
 *
 * @param options - Generation options including the root command, metadata, and output config
 * @returns Result containing the output directory path and list of written files
 *
 * @example
 * ```ts
 * import { generateSkill } from "@crustjs/skills";
 * import { rootCommand } from "./commands.ts";
 *
 * const result = await generateSkill({
 *   command: rootCommand,
 *   meta: {
 *     name: "my-cli",
 *     description: "CLI tool for managing widgets",
 *     version: "1.0.0",
 *   },
 *   outDir: "./dist",
 * });
 *
 * console.log(`Generated ${result.files.length} files to ${result.outputDir}`);
 * ```
 */
export async function generateSkill(
	options: GenerateOptions,
): Promise<GenerateResult> {
	const { command, meta, outDir = ".", clean = true } = options;

	// 1. Build canonical manifest from command tree
	const manifest = buildManifest(command);

	// 2. Render markdown skill files
	const renderedFiles = renderSkill(manifest, meta);

	// 3. Generate distribution metadata files
	const metadataFiles = renderDistributionMetadata(manifest, meta);

	// 4. Combine all files — rendered first, then metadata, sorted for determinism
	// Use plain string comparison (not localeCompare) for stable ASCII ordering
	const allFiles = [...renderedFiles, ...metadataFiles].sort((a, b) =>
		a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
	);

	// 5. Resolve output directory
	const skillDir = resolve(outDir, "skills", meta.name);

	// 6. Clean existing directory if requested
	if (clean) {
		await cleanDirectory(skillDir);
	}

	// 7. Write all files to disk
	await writeFiles(skillDir, allFiles);

	return {
		outputDir: skillDir,
		files: allFiles.map((f) => f.path),
	};
}

// ────────────────────────────────────────────────────────────────────────────
// Distribution metadata renderers
// ────────────────────────────────────────────────────────────────────────────

/**
 * Renders distribution metadata files (`manifest.json` and `README.md`)
 * that help consumers discover and install the generated skill bundle.
 *
 * @param manifest - The canonical manifest tree
 * @param meta - Skill metadata
 * @returns Array of rendered metadata files
 */
function renderDistributionMetadata(
	manifest: ManifestNode,
	meta: SkillMeta,
): RenderedFile[] {
	return [
		{
			path: "manifest.json",
			content: renderManifestJson(manifest, meta),
		},
		{
			path: "README.md",
			content: renderReadme(meta),
		},
	];
}

/**
 * Renders `manifest.json` — a machine-readable distribution manifest
 * describing the skill bundle contents.
 *
 * The manifest is sorted deterministically: top-level keys in a stable
 * order, and the `files` array sorted alphabetically by path.
 */
function renderManifestJson(manifest: ManifestNode, meta: SkillMeta): string {
	const commands = collectCommandPaths(manifest);

	const obj: Record<string, unknown> = {
		name: meta.name,
		description: meta.description,
	};

	if (meta.version !== undefined) {
		obj.version = meta.version;
	}

	obj.entrypoint = "SKILL.md";
	obj.commands = commands;

	return `${JSON.stringify(obj, null, "\t")}\n`;
}

/**
 * Collects all command invocation paths from the manifest tree.
 * Used in `manifest.json` to list available commands.
 */
function collectCommandPaths(node: ManifestNode): string[] {
	const paths: string[] = [node.path.join(" ")];
	for (const child of node.children) {
		paths.push(...collectCommandPaths(child));
	}
	return paths;
}

/**
 * Renders `README.md` — a human-readable file with install instructions
 * for downstream consumers using OpenCode or Claude Code.
 */
function renderReadme(meta: SkillMeta): string {
	const lines: string[] = [];

	lines.push(`# ${meta.name} — Agent Skill`);
	lines.push("");
	lines.push(meta.description);
	lines.push("");

	// Version info
	if (meta.version) {
		lines.push(`**Version:** ${meta.version}`);
		lines.push("");
	}

	// Install instructions
	lines.push("## Installation");
	lines.push("");
	lines.push(
		"Copy this skill directory into your agent's skills location to enable CLI command documentation.",
	);
	lines.push("");

	// OpenCode
	lines.push("### OpenCode");
	lines.push("");
	lines.push("```sh");
	lines.push(`cp -r ${meta.name}/ .opencode/skills/${meta.name}/`);
	lines.push("```");
	lines.push("");

	// Claude Code
	lines.push("### Claude Code");
	lines.push("");
	lines.push("```sh");
	lines.push(`cp -r ${meta.name}/ .claude/skills/${meta.name}/`);
	lines.push("```");
	lines.push("");

	// Structure overview
	lines.push("## Structure");
	lines.push("");
	lines.push("```");
	lines.push(`${meta.name}/`);
	lines.push("  SKILL.md            # Entrypoint — loaded by agent");
	lines.push("  command-index.md    # Maps commands to documentation files");
	lines.push("  commands/           # Per-command documentation");
	lines.push("  manifest.json       # Machine-readable bundle metadata");
	lines.push("  README.md           # This file");
	lines.push("```");
	lines.push("");

	return lines.join("\n");
}

// ────────────────────────────────────────────────────────────────────────────
// File system operations
// ────────────────────────────────────────────────────────────────────────────

/**
 * Removes a directory and all its contents if it exists.
 * Silently succeeds if the directory does not exist.
 *
 * @param dir - Absolute path to the directory to remove
 */
async function cleanDirectory(dir: string): Promise<void> {
	try {
		// Check if directory exists before removing
		await readdir(dir);
		await rm(dir, { recursive: true });
	} catch (error) {
		// Directory doesn't exist — nothing to clean
		if (isNodeError(error) && error.code === "ENOENT") {
			return;
		}
		throw error;
	}
}

/**
 * Writes an array of rendered files to disk under the given base directory.
 *
 * Creates parent directories as needed. Files are written sequentially
 * in sorted order for deterministic behavior.
 *
 * @param baseDir - Absolute path to the skill output directory
 * @param files - Rendered files to write (paths are relative to baseDir)
 */
async function writeFiles(
	baseDir: string,
	files: RenderedFile[],
): Promise<void> {
	// Collect all unique directories first and create them
	const dirs = new Set<string>();
	for (const file of files) {
		const filePath = join(baseDir, file.path);
		const dir = dirname(filePath);
		dirs.add(dir);
	}

	// Sort directories to create parents before children
	const sortedDirs = [...dirs].sort();
	for (const dir of sortedDirs) {
		await mkdir(dir, { recursive: true });
	}

	// Write files sequentially in deterministic order (already sorted by caller)
	for (const file of files) {
		const filePath = join(baseDir, file.path);
		await writeFile(filePath, file.content, "utf-8");
	}
}

// ────────────────────────────────────────────────────────────────────────────
// Utility helpers
// ────────────────────────────────────────────────────────────────────────────

/**
 * Type guard for Node.js system errors with a `code` property.
 */
function isNodeError(error: unknown): error is NodeJS.ErrnoException {
	return error instanceof Error && "code" in error;
}
